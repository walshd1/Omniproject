import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_KEYS, updateSettings, SettingsValidationError } from "../lib/settings";

/**
 * Settings-sanitizer coverage ratchet — the mechanical proof that NO persisted settings field is a
 * prototype-pollution / dangerous-key sink on the bulk-PATCH / config-restore path.
 *
 * The bulk PATCH (validatePatch → updateSettings) is the single write gate shared by PATCH /settings and
 * config-snapshot restore. This test iterates EVERY key in ALLOWED_KEYS (so a newly-added settings field
 * is automatically covered — there is no per-field test to remember) and drives a hostile payload carrying
 * __proto__ / constructor / prototype pollution keys at both the top level and one level deep. For each key
 * it asserts the two invariants that must hold whatever the field's shape:
 *
 *   1. Object.prototype is never polluted — an unrelated fresh object gains no property.
 *   2. If the write is accepted (many fields reject the malformed shape outright, which is equally safe),
 *      the stored value carries no own __proto__/constructor/prototype key.
 *
 * This is the settings-layer sibling of route-scope-coverage.test.ts: coverage is enumerated from the live
 * key list, not sampled, so the class stays closed as the schema grows.
 */

const DANGEROUS = ["__proto__", "constructor", "prototype"];

/** A payload that tries to pollute via a top-level dangerous key AND via a nested one, in the shapes a
 *  map/object-typed field might accept. Built with JSON.parse so __proto__ is a real OWN key, not the
 *  prototype accessor an object literal would set. */
function pollutingPayload(): unknown {
  return JSON.parse(`{
    "__proto__": { "polluted": "yes" },
    "constructor": { "polluted": "yes" },
    "prototype": { "polluted": "yes" },
    "someId": { "__proto__": { "polluted": "yes" }, "state": "x", "value": "y" }
  }`);
}

test("no settings field is a prototype-pollution sink on the bulk-PATCH path (every ALLOWED_KEY probed)", () => {
  for (const key of ALLOWED_KEYS) {
    // A canary object BEFORE the write: if the global prototype gets polluted, this gains `.polluted`.
    const canaryBefore = {} as Record<string, unknown>;
    assert.equal(canaryBefore["polluted"], undefined, "precondition: prototype clean");

    let stored: Record<string, unknown> | null = null;
    try {
      const result = updateSettings({ [key]: pollutingPayload() } as Record<string, unknown>);
      stored = result[key as keyof typeof result] as Record<string, unknown> | null;
    } catch (err) {
      // Rejecting the malformed shape is a valid, safe outcome — only a SettingsValidationError, though;
      // any other throw would be an unhandled crash on hostile input.
      assert.ok(err instanceof SettingsValidationError, `${key}: bad input must fail as SettingsValidationError, got ${String(err)}`);
    }

    // Invariant 1: the global prototype must be intact regardless of accept/reject.
    const canaryAfter = {} as Record<string, unknown>;
    assert.equal(canaryAfter["polluted"], undefined, `${key}: bulk PATCH polluted Object.prototype`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((Object.prototype as any)["polluted"], undefined, `${key}: Object.prototype gained a key`);

    // Invariant 2: if it persisted, no dangerous OWN key rode through into stored state.
    if (stored && typeof stored === "object") {
      for (const bad of DANGEROUS) {
        assert.equal(Object.prototype.hasOwnProperty.call(stored, bad), false, `${key}: stored value kept own "${bad}" key`);
      }
    }
  }
});

test("ALLOWED_KEYS is non-empty and unique (the ratchet actually iterates the real field list)", () => {
  assert.ok(ALLOWED_KEYS.length > 0);
  assert.equal(new Set(ALLOWED_KEYS).size, ALLOWED_KEYS.length, "duplicate key in ALLOWED_KEYS");
});
