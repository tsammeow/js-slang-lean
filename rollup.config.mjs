import alias from "@rollup/plugin-alias";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import nodePolyfills from "rollup-plugin-polyfill-node";

export default {
    plugins: [alias({ entries: [{ find: "path", replacement: "path-browserify" }] }), nodeResolve(), commonjs(), typescript(), json(), nodePolyfills()],
    input: "src/evaluator.ts",
    output: {
        plugins: [terser()],
        dir: "dist",
        format: "iife",
        sourcemap: true,
    }
}
