import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScreenDefs, ScreenDefError } from "./screen-def";
import { validateRaci, RaciError } from "./raci";
import { validateStakeholders, StakeholderError } from "./stakeholder";

/**
 * Robustness / fuzz: malformed or hostile JSON must produce a TYPED validation error (which the settings
 * layer maps to HTTP 400) — never an untyped crash (which would 500). We throw a wide spread of junk at each
 * validator and assert every rejection is the module's own error class, and that no input escapes as a
 * non-validation throw. (Prototype-pollution keys are separately stripped by safeParseJson upstream.)
 */
const JUNK: unknown[] = [
  null, undefined, 0, 1, "", "x", true, false, NaN, Infinity, {}, { id: 1 },
  [null], [undefined], [0], ["str"], [[]], [{}], [{ id: "" }], [{ id: "a" }],
  [{ id: "a", label: "L" }], // (screen) missing panels; (others) missing task/name — must reject typed
  [{ id: "a", label: "L", panels: "no" }],
  [{ id: "a", label: "L", panels: [1, 2, 3] }],
  [{ id: "a", label: "L", panels: [{ id: "p" }] }],
  [{ id: "a", label: "L", panels: [{ kind: "table" }] }],
  [{ id: "a", label: "L", panels: [{ id: "p", kind: "table" }, { id: "p", kind: "chart" }] }],
  [{ id: "a", label: "L", panels: [{ id: "p", kind: "x", config: { a: { b: { c: 1 } } }, source: 42 }] }],
  [{ id: "dup", label: "A", panels: [] }, { id: "dup", label: "B", panels: [] }],
  [{ id: "r", task: "t", role: "x", responsibility: 5 }],
  [{ id: "s", name: "n", influence: 1, interest: [] }],
  [{ __proto__: { polluted: true }, id: "a", label: "L", panels: [] }],
  [{ id: { nested: true }, label: {}, panels: [{}] }],
  [Symbol.iterator],
  [() => {}],
  [{ id: "a", label: "L", panels: [{ id: "p", kind: "table", extra: Array(1000).fill("x") }] }],
];

function fuzz(name: string, run: (v: unknown) => unknown, ErrorClass: new (...a: never[]) => Error) {
  test(`${name}: every junk input is a typed error or a clean pass (never an untyped crash)`, () => {
    for (const input of JUNK) {
      try {
        run(input);
        // A pass is fine (some inputs are structurally valid, e.g. []); assert it returns an array.
        assert.ok(Array.isArray(run(input)), `${name} accepted ${String(input)} but didn't return an array`);
      } catch (e) {
        assert.ok(e instanceof ErrorClass, `${name} threw a non-${ErrorClass.name} for ${JSON.stringify(input) ?? String(input)}: ${(e as Error).message}`);
      }
    }
  });
}

fuzz("validateScreenDefs", validateScreenDefs, ScreenDefError);
fuzz("validateRaci", validateRaci, RaciError);
fuzz("validateStakeholders", validateStakeholders, StakeholderError);
