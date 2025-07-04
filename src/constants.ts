import * as es from 'estree'

import { AcornOptions } from './parser/types'
import { Chapter, Language, Variant } from './types'

export const DEFAULT_ECMA_VERSION = 6
export const ACORN_PARSE_OPTIONS: AcornOptions = { ecmaVersion: DEFAULT_ECMA_VERSION }

export const REQUIRE_PROVIDER_ID = 'requireProvider'
export const CUT = 'cut' // cut operator for Source 4.3
export const TRY_AGAIN = 'retry' // command for Source 4.3
export const GLOBAL =
  typeof window === 'undefined' ? (typeof global === 'undefined' ? {} : global) : window
export const NATIVE_STORAGE_ID = 'nativeStorage'
export const MAX_LIST_DISPLAY_LENGTH = 100
export const UNKNOWN_LOCATION: es.SourceLocation = {
  start: {
    line: -1,
    column: -1
  },
  end: {
    line: -1,
    column: -1
  }
}
export const JSSLANG_PROPERTIES = {
  maxExecTime: 1000,
  factorToIncreaseBy: 10
}

export const sourceLanguages: Language[] = [
  { chapter: Chapter.SOURCE_1, variant: Variant.DEFAULT },
  { chapter: Chapter.SOURCE_1, variant: Variant.TYPED },
  { chapter: Chapter.SOURCE_1, variant: Variant.WASM },
  { chapter: Chapter.SOURCE_2, variant: Variant.DEFAULT },
  { chapter: Chapter.SOURCE_2, variant: Variant.TYPED },
  { chapter: Chapter.SOURCE_3, variant: Variant.DEFAULT },
  { chapter: Chapter.SOURCE_3, variant: Variant.TYPED },
  { chapter: Chapter.SOURCE_4, variant: Variant.DEFAULT },
  { chapter: Chapter.SOURCE_4, variant: Variant.TYPED },
  { chapter: Chapter.SOURCE_4, variant: Variant.EXPLICIT_CONTROL }
]
