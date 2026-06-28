import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUserPrefs, getUserPrefs, setUserPrefs, hasUserPrefs, DEFAULT_USER_PREFS } from "./user-prefs";

/**
 * Per-user prefs persist server-side keyed by sub, JSON with code defaults.
 */

test("sanitize fills every missing field from the code defaults", () => {
  assert.deepEqual(sanitizeUserPrefs(undefined), DEFAULT_USER_PREFS);
  assert.deepEqual(sanitizeUserPrefs({}), DEFAULT_USER_PREFS);
});

test("sanitize clamps font scale and validates the colour", () => {
  assert.equal(sanitizeUserPrefs({ fontScale: 9 }).fontScale, 1.5);
  assert.equal(sanitizeUserPrefs({ fontScale: 0.1 }).fontScale, 0.85);
  assert.equal(sanitizeUserPrefs({ backgroundColor: "#101418" }).backgroundColor, "#101418");
  assert.equal(sanitizeUserPrefs({ backgroundColor: "navy" }).backgroundColor, null);
  assert.equal(sanitizeUserPrefs({ highContrast: 1, reduceMotion: "yes" }).highContrast, true);
});

test("sanitize validates switch-scan mode, clamps the scan rate, coerces a11y toggles", () => {
  assert.equal(sanitizeUserPrefs({ switchScan: "single" }).switchScan, "single");
  assert.equal(sanitizeUserPrefs({ switchScan: "two" }).switchScan, "two");
  assert.equal(sanitizeUserPrefs({ switchScan: "nonsense" }).switchScan, "off");
  assert.equal(sanitizeUserPrefs({ scanRateMs: 99 }).scanRateMs, 500);
  assert.equal(sanitizeUserPrefs({ scanRateMs: 99999 }).scanRateMs, 5000);
  assert.equal(sanitizeUserPrefs({ screenReader: 1 }).screenReader, true);
  assert.equal(sanitizeUserPrefs({ speechInput: "yes" }).speechInput, true);
  assert.equal(sanitizeUserPrefs({}).speechInput, false);
});

test("get/set/has round-trip per user; unknown user ⇒ defaults", () => {
  const sub = `u-${Math.round(performance.now())}`; // unique-ish key (no Date.now in tests)
  assert.equal(hasUserPrefs(sub), false);
  assert.deepEqual(getUserPrefs(sub), DEFAULT_USER_PREFS);
  const saved = setUserPrefs(sub, { fontScale: 1.25, backgroundColor: "#0b1020", highContrast: true, reduceMotion: false });
  assert.equal(saved.fontScale, 1.25);
  assert.equal(hasUserPrefs(sub), true);
  assert.deepEqual(getUserPrefs(sub), saved);
  // a different user is unaffected
  assert.equal(hasUserPrefs(`${sub}-other`), false);
});
