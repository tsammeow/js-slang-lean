import type es from 'estree'
import { SourceMapConsumer } from 'source-map'

import createContext from './createContext'
import { InterruptedError } from './errors/errors'
import { findDeclarationNode, findIdentifierNode } from './finder'
import { looseParse, parseWithComments } from './parser/utils'
import { getAllOccurrencesInScopeHelper, getScopeHelper } from './scope-refactoring'
import { setBreakpointAtLine } from './stdlib/inspector'
import {
  type Context,
  type Error as ResultError,
  type ExecutionMethod,
  type Finished,
  type ModuleContext,
  type RecursivePartial,
  type Result,
  type SourceError,
  type SVMProgram,
  type Variant
} from './types'
import { assemble } from './vm/svml-assembler'
import { compileToIns } from './vm/svml-compiler'

import { CSEResultPromise, resumeEvaluate } from './cse-machine/interpreter'
import type { ImportOptions } from './modules/moduleTypes'
import preprocessFileImports from './modules/preprocessor'
import { validateFilePath } from './modules/preprocessor/filePaths'
import { getKeywords, getProgramNames, type NameDeclaration } from './name-extractor'
import { resolvedErrorPromise, sourceFilesRunner } from './runner'

export interface IOptions {
  steps: number
  stepLimit: number
  executionMethod: ExecutionMethod
  variant: Variant
  originalMaxExecTime: number
  useSubst: boolean
  isPrelude: boolean
  throwInfiniteLoops: boolean
  envSteps: number

  importOptions: ImportOptions

  /**
   * Set this to true if source file information should be
   * added when parsing programs into ASTs
   *
   * Set to null to let js-slang decide automatically
   */
  shouldAddFileName: boolean | null
}

// needed to work on browsers
if (typeof window !== 'undefined') {
  // @ts-expect-error Initialize doesn't exist on SourceMapConsumer
  SourceMapConsumer.initialize({
    'lib/mappings.wasm': 'https://unpkg.com/source-map@0.7.3/lib/mappings.wasm'
  })
}

let verboseErrors: boolean = false

export function parseError(errors: SourceError[], verbose: boolean = verboseErrors): string {
  const errorMessagesArr = errors.map(error => {
    // FIXME: Either refactor the parser to output an ESTree-compliant AST, or modify the ESTree types.
    const filePath = error.location?.source ? `[${error.location.source}] ` : ''
    const line = error.location ? error.location.start.line : '<unknown>'
    const column = error.location ? error.location.start.column : '<unknown>'
    const explanation = error.explain()

    if (verbose) {
      // TODO currently elaboration is just tagged on to a new line after the error message itself. find a better
      // way to display it.
      const elaboration = error.elaborate()
      return typeof line === 'number' && line < 1
        ? `${filePath}${explanation}\n${elaboration}\n`
        : `${filePath}Line ${line}, Column ${column}: ${explanation}\n${elaboration}\n`
    } else {
      return typeof line === 'number' && line < 1
        ? explanation
        : `${filePath}Line ${line}: ${explanation}`
    }
  })
  return errorMessagesArr.join('\n')
}

export function findDeclaration(
  code: string,
  context: Context,
  loc: { line: number; column: number }
): es.SourceLocation | null | undefined {
  const program = looseParse(code, context)
  if (!program) {
    return null
  }
  const identifierNode = findIdentifierNode(program, context, loc)
  if (!identifierNode) {
    return null
  }
  const declarationNode = findDeclarationNode(program, identifierNode)
  if (!declarationNode || identifierNode === declarationNode) {
    return null
  }
  return declarationNode.loc
}

export function getScope(
  code: string,
  context: Context,
  loc: { line: number; column: number }
): es.SourceLocation[] {
  const program = looseParse(code, context)
  if (!program) {
    return []
  }
  const identifierNode = findIdentifierNode(program, context, loc)
  if (!identifierNode) {
    return []
  }
  const declarationNode = findDeclarationNode(program, identifierNode)
  if (!declarationNode || declarationNode.loc == null || identifierNode !== declarationNode) {
    return []
  }

  return getScopeHelper(declarationNode.loc, program, identifierNode.name)
}

export function getAllOccurrencesInScope(
  code: string,
  context: Context,
  loc: { line: number; column: number }
): es.SourceLocation[] {
  const program = looseParse(code, context)
  if (!program) {
    return []
  }
  const identifierNode = findIdentifierNode(program, context, loc)
  if (!identifierNode) {
    return []
  }
  const declarationNode = findDeclarationNode(program, identifierNode)
  if (declarationNode == null || declarationNode.loc == null) {
    return []
  }
  return getAllOccurrencesInScopeHelper(declarationNode.loc, program, identifierNode.name)
}

export function hasDeclaration(
  code: string,
  context: Context,
  loc: { line: number; column: number }
): boolean {
  const program = looseParse(code, context)
  if (!program) {
    return false
  }
  const identifierNode = findIdentifierNode(program, context, loc)
  if (!identifierNode) {
    return false
  }
  const declarationNode = findDeclarationNode(program, identifierNode)
  if (declarationNode == null || declarationNode.loc == null) {
    return false
  }

  return true
}

/**
 * Gets names present within a string of code
 * @param code Code to parse
 * @param line Line position of the cursor
 * @param col Column position of the cursor
 * @param context Evaluation context
 * @returns `[NameDeclaration[], true]` if suggestions should be displayed, `[[], false]` otherwise
 */
export async function getNames(
  code: string,
  line: number,
  col: number,
  context: Context
): Promise<[NameDeclaration[], boolean]> {
  const [program, comments] = parseWithComments(code)

  if (!program) {
    return [[], false]
  }
  const cursorLoc: es.Position = { line, column: col }

  const [progNames, displaySuggestions] = await getProgramNames(program, comments, cursorLoc)
  const keywords = getKeywords(program, cursorLoc, context)
  return [progNames.concat(keywords), displaySuggestions]
}

export async function runInContext(
  code: string,
  context: Context,
  options: RecursivePartial<IOptions> = {}
): Promise<Result> {
  const defaultFilePath = '/default.js'
  const files: Partial<Record<string, string>> = {}
  files[defaultFilePath] = code
  return runFilesInContext(files, defaultFilePath, context, options)
}

// this is the first entrypoint for all source files.
// as such, all mapping functions required by alternate languages
// should be defined here.
export async function runFilesInContext(
  files: Partial<Record<string, string>>,
  entrypointFilePath: string,
  context: Context,
  options: RecursivePartial<IOptions> = {}
): Promise<Result> {
  for (const filePath in files) {
    const filePathError = validateFilePath(filePath)
    if (filePathError !== null) {
      context.errors.push(filePathError)
      return resolvedErrorPromise
    }
  }

  let result: Result

    // FIXME: Clean up state management so that the `parseError` function is pure.
    //        This is not a huge priority, but it would be good not to make use of
    //        global state.
  ;({ result, verboseErrors } = await sourceFilesRunner(
    p => Promise.resolve(files[p]),
    entrypointFilePath,
    context,
    {
      ...options,
      shouldAddFileName: options.shouldAddFileName ?? Object.keys(files).length > 1
    }
  ))

  return result
}

export function resume(result: Result): Finished | ResultError | Promise<Result> {
  if (result.status === 'finished' || result.status === 'error') {
    return result
  }
  const value = resumeEvaluate(result.context)
  return CSEResultPromise(result.context, value)
}

export function interrupt(context: Context) {
  const globalEnvironment = context.runtime.environments[context.runtime.environments.length - 1]
  context.runtime.environments = [globalEnvironment]
  context.runtime.isRunning = false
  context.errors.push(new InterruptedError(context.runtime.nodes[0]))
}

export function compile(
  code: string,
  context: Context,
  vmInternalFunctions?: string[]
): Promise<SVMProgram | undefined> {
  const defaultFilePath = '/default.js'
  const files: Partial<Record<string, string>> = {}
  files[defaultFilePath] = code
  return compileFiles(files, defaultFilePath, context, vmInternalFunctions)
}

export async function compileFiles(
  files: Partial<Record<string, string>>,
  entrypointFilePath: string,
  context: Context,
  vmInternalFunctions?: string[]
): Promise<SVMProgram | undefined> {
  for (const filePath in files) {
    const filePathError = validateFilePath(filePath)
    if (filePathError !== null) {
      context.errors.push(filePathError)
      return undefined
    }
  }

  const preprocessResult = await preprocessFileImports(
    p => Promise.resolve(files[p]),
    entrypointFilePath,
    context,
    { shouldAddFileName: Object.keys(files).length > 1 }
  )

  if (!preprocessResult.ok) {
    return undefined
  }

  try {
    return compileToIns(preprocessResult.program, undefined, vmInternalFunctions)
  } catch (error) {
    context.errors.push(error)
    return undefined
  }
}

export { createContext, Context, ModuleContext, Result, setBreakpointAtLine, assemble }
