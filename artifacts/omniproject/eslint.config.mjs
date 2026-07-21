// ESLint (flat config) — React Hooks correctness gate for the SPA.
//
// SCOPE IS DELIBERATELY NARROW. This repo's authoritative quality gates are the vitest suites, the
// typecheck, and the many drift/guard ratchets; ESLint is NOT a general style layer here. It exists
// for exactly one class of defect that neither tsc nor tests reliably catch: React Hooks misuse —
// conditionally-called hooks (`rules-of-hooks`) and, above all, wrong/incomplete hook dependency
// arrays (`exhaustive-deps`). The latter is the "unstable reference / stale-closure per render" bug
// family that has bitten this SPA before (infinite effect loops, defeated memoisation); both rules
// are therefore ERRORS, not warnings, and CI blocks on them.
//
// PARSER NOTE: we parse with @babel/eslint-parser, NOT @typescript-eslint/parser. The latter hard-
// refuses to load against this repo's TypeScript (it version-checks and throws "does not support TS
// 7.0"), and the documented workaround — a side-by-side TS 6 install — would give the SPA a second,
// older compiler that its own `tsc` typecheck would then pick up, defeating the whole point. The
// Babel parser has NO dependency on the `typescript` package: it strips TS/TSX syntax with
// @babel/preset-typescript and emits an ESTree the hooks rules consume directly. Type correctness is
// owned by `tsc` (the typecheck job); ESLint here only reasons about hook syntax + dependency arrays,
// for which a type-free syntactic AST is exactly enough.
import reactHooks from "eslint-plugin-react-hooks";
import babelParser from "@babel/eslint-parser";

export default [
  // Never lint build output, coverage, generated reports, or vendored deps.
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "**/*.generated.ts", "public/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        // No .babelrc in this project (Vite owns the real build transform) — parse standalone.
        requireConfigFile: false,
        ecmaFeatures: { jsx: true },
        babelOptions: {
          babelrc: false,
          configFile: false,
          // isTSX + allExtensions lets one preset parse both .ts and .tsx (JSX enabled) for lint only.
          presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
        },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
