import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePatch, getSettings, SettingsValidationError } from "./settings";

/** The scheduling working-time config: default seed + validation of hours/day, working week, holidays. */

test("scheduling seeds to 8h / Mon–Fri / no holidays by default", () => {
  const s = getSettings();
  assert.deepEqual(s.scheduling, { hoursPerDay: 8, workingWeekdays: [1, 2, 3, 4, 5], holidays: [] });
});

test("a valid scheduling patch passes validation", () => {
  const patch = validatePatch({ scheduling: { hoursPerDay: 7.5, workingWeekdays: [1, 2, 3, 4, 5, 6], holidays: ["2026-12-25"] } });
  assert.deepEqual(patch["scheduling"], { hoursPerDay: 7.5, workingWeekdays: [1, 2, 3, 4, 5, 6], holidays: ["2026-12-25"] });
});

test("hoursPerDay must be within (0, 24]", () => {
  assert.throws(() => validatePatch({ scheduling: { hoursPerDay: 0 } }), (e) => e instanceof SettingsValidationError && /hoursPerDay/.test((e as Error).message));
  assert.throws(() => validatePatch({ scheduling: { hoursPerDay: 25 } }), (e) => e instanceof SettingsValidationError);
});

test("an empty working week is rejected (non-terminating arithmetic)", () => {
  assert.throws(() => validatePatch({ scheduling: { workingWeekdays: [] } }), (e) => e instanceof SettingsValidationError && /workingWeekdays/.test((e as Error).message));
});

test("weekday entries must be integers 0–6 and holidays ISO dates", () => {
  assert.throws(() => validatePatch({ scheduling: { workingWeekdays: [7] } }), (e) => e instanceof SettingsValidationError);
  assert.throws(() => validatePatch({ scheduling: { holidays: ["25/12/2026"] } }), (e) => e instanceof SettingsValidationError && /holidays/.test((e as Error).message));
});
