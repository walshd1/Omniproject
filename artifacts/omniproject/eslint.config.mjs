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

  // Wrong-`this` / detached-native-callable gate (non-test source only). A native WebIDL global
  // (`structuredClone`, `queueMicrotask`, …) or a host-object METHOD (`performance.now`,
  // `crypto.getRandomValues`, `localStorage.getItem`, …) is bound to its defining global/object: invoke
  // it with the wrong `this` and the browser throws "TypeError: Illegal invocation" (Node/jsdom are
  // lenient, so unit tests miss it — it only bites in a real browser). The concrete trap this repo hit:
  // passing the bare global as a CALLBACK ARGUMENT to a helper that later re-invokes it as a member
  // (`ref.current(x)`, `obj.fn(x)`) — the RACI screen crashed exactly this way via `useDraftAdmin(rows,
  // structuredClone)`. Passing it as a call argument is the tell; a plain wrapper `(x) => structuredClone(x)`
  // is always safe. Also flags `arr.map(parseInt)` — a bare native fn as an iteratee gets the index as a
  // second arg (radix), a classic correctness bug of the same "don't pass a native callable bare" family.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}", "src/test/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression > Identifier.arguments[name=/^(structuredClone|queueMicrotask|reportError|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback|fetch|atob|btoa|createImageBitmap)$/]",
          message:
            "Don't pass a bare WebIDL global (e.g. structuredClone) as a callback — if the receiver invokes it as a member (ref.current(x) / obj.fn(x)) its `this` is wrong and the browser throws 'Illegal invocation'. Wrap it: (x) => structuredClone(x).",
        },
        {
          selector:
            "CallExpression > MemberExpression.arguments[object.name='performance'][property.name='now'], CallExpression > MemberExpression.arguments[object.name='crypto'][property.name=/^(getRandomValues|randomUUID|subtle)$/], CallExpression > MemberExpression.arguments[object.name=/^(localStorage|sessionStorage)$/][property.name=/^(getItem|setItem|removeItem|clear|key)$/], CallExpression > MemberExpression.arguments[object.name='history'][property.name=/^(pushState|replaceState|go|back|forward)$/]",
          message:
            "Don't pass a bare host-object method (e.g. performance.now, crypto.getRandomValues, localStorage.getItem) as a callback — detached from its receiver it throws 'Illegal invocation' in the browser. Wrap it: (...a) => performance.now(...a).",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(map|forEach|flatMap)$/] > Identifier.arguments:nth-child(1)[name='parseInt']",
          message:
            "Don't pass bare parseInt to map/forEach — it receives the element INDEX as its radix argument, silently corrupting results. Use (s) => parseInt(s, 10).",
        },
      ],
    },
  },
];
