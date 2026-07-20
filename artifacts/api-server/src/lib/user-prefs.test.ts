import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUserPrefs, sanitizePartialUserPrefs, getUserPrefs, setUserPrefs, hasUserPrefs, DEFAULT_USER_PREFS } from "./user-prefs";

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

test("sanitize coerces the reading tint (dyslexia aid): boolean flag + validated hex colour", () => {
  assert.equal(sanitizeUserPrefs({ tint: 1 }).tint, true);
  assert.equal(sanitizeUserPrefs({}).tint, false);
  assert.equal(sanitizeUserPrefs({ tintColor: "#abcdef" }).tintColor, "#abcdef");
  assert.equal(sanitizeUserPrefs({ tintColor: "not-a-colour" }).tintColor, "#f5e9c8"); // invalid → default
  assert.equal(sanitizeUserPrefs({}).tintColor, "#f5e9c8");
});

test("sanitize validates the per-user font family + accent colour (null when absent/invalid)", () => {
  assert.equal(sanitizeUserPrefs({ fontFamily: "serif" }).fontFamily, "serif");
  assert.equal(sanitizeUserPrefs({ fontFamily: "mono" }).fontFamily, "mono");
  assert.equal(sanitizeUserPrefs({ fontFamily: "comic-sans" }).fontFamily, null);
  assert.equal(sanitizeUserPrefs({}).fontFamily, null);
  assert.equal(sanitizeUserPrefs({ accentColor: "#2563eb" }).accentColor, "#2563eb");
  assert.equal(sanitizeUserPrefs({ accentColor: "rebeccapurple" }).accentColor, null);
  assert.equal(sanitizeUserPrefs({}).accentColor, null);
});

test("sanitize coerces saved scoped overrides: validates fields, drops empties + forbidden/oversized keys, caps total", () => {
  // Valid scope with a mix of fields; invalid field values fall to null and, if all null, drop the scope.
  const clean = sanitizeUserPrefs({
    scopedOverrides: {
      "screen:reports": { accentColor: "#2563eb", fontFamily: "serif", backgroundColor: "nope" },
      "artifact:report:x": { fontFamily: "comic-sans", accentColor: "bad" }, // all invalid → dropped
      "__proto__": { accentColor: "#ffffff" }, // prototype-pollution key → dropped
    },
  }).scopedOverrides;
  assert.deepEqual(clean["screen:reports"], { accentColor: "#2563eb", fontFamily: "serif", backgroundColor: null });
  assert.equal("artifact:report:x" in clean, false); // no surviving field ⇒ not stored
  assert.equal(Object.prototype.hasOwnProperty.call(clean, "__proto__"), false);
  assert.deepEqual(sanitizeUserPrefs({}).scopedOverrides, {});

  // Cap: more than the max are truncated (never unbounded growth in a user's prefs).
  const many: Record<string, unknown> = {};
  for (let i = 0; i < 250; i++) many[`screen:s${i}`] = { accentColor: "#000000" };
  assert.ok(Object.keys(sanitizeUserPrefs({ scopedOverrides: many }).scopedOverrides).length <= 200);
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
  assert.equal(sanitizeUserPrefs({ mobileMode: "on" }).mobileMode, "on");
  assert.equal(sanitizeUserPrefs({ mobileMode: "off" }).mobileMode, "off");
  assert.equal(sanitizeUserPrefs({ mobileMode: "bogus" }).mobileMode, "auto");
  assert.equal(sanitizeUserPrefs({}).mobileMode, "auto");
});

test("sanitize validates UI density, defaulting unknown values to comfortable", () => {
  assert.equal(sanitizeUserPrefs({ density: "compact" }).density, "compact");
  assert.equal(sanitizeUserPrefs({ density: "comfortable" }).density, "comfortable");
  assert.equal(sanitizeUserPrefs({ density: "bogus" }).density, "comfortable");
  assert.equal(sanitizeUserPrefs({}).density, "comfortable");
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

test("sanitizePartialUserPrefs keeps ONLY the provided valid keys (no defaults filled)", () => {
  assert.deepEqual(sanitizePartialUserPrefs({}), {});
  assert.deepEqual(sanitizePartialUserPrefs({ highContrast: true, fontScale: 1.25 }), { highContrast: true, fontScale: 1.25 });
  assert.deepEqual(sanitizePartialUserPrefs({ backgroundColor: "navy" }), {}); // present but coerces to null → dropped (a null default is not a default)
  assert.equal("reduceMotion" in sanitizePartialUserPrefs({ fontScale: 1.1 }), false);               // omitted → not present
});
