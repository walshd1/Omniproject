import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { evaluateTravel, checkLogin, __resetImpossibleTravelState } from "./impossible-travel";

/**
 * Impossible-travel detection. `evaluateTravel` is pure (no IO, no optional
 * dependency) so it's tested directly and thoroughly; `checkLogin` additionally
 * exercises the IO wrapper, whose behaviour in THIS test environment (where the
 * optional `geoip-lite` dependency is never installed) is to gracefully no-op —
 * confirmed explicitly, since "never blocks a login" is the actual safety property.
 */
afterEach(() => {
  delete process.env["IMPOSSIBLE_TRAVEL_MAX_KMH"];
  delete process.env["IMPOSSIBLE_TRAVEL_MIN_KM"];
  __resetImpossibleTravelState();
});

// London ~ (51.5, -0.12); Tokyo ~ (35.7, 139.7); Cambridge, UK ~ (52.2, 0.12) — roughly 9560km
// and 55km from London respectively (haversine great-circle distances).

test("no prior login for this principal never flags (nothing to compare)", () => {
  const result = evaluateTravel(undefined, { lat: 51.5, lon: -0.12, country: "GB", at: Date.now() });
  assert.equal(result.flagged, false);
});

test("a huge distance covered in minutes is flagged (implausible speed)", () => {
  const t0 = 1_000_000_000;
  const prev = { lat: 51.5, lon: -0.12, country: "GB", at: t0 }; // London
  const next = { lat: 35.7, lon: 139.7, country: "JP", at: t0 + 30 * 60_000 }; // Tokyo, 30 min later
  const result = evaluateTravel(prev, next);
  assert.equal(result.flagged, true);
  assert.equal(result.fromCountry, "GB");
  assert.equal(result.toCountry, "JP");
  assert.ok(result.distanceKm! > 9000, `expected >9000km, got ${result.distanceKm}`);
  assert.ok(result.speedKmh! > 1000, `expected implausible speed, got ${result.speedKmh}`);
});

test("the same huge distance covered over a plausible flight duration is NOT flagged", () => {
  const t0 = 1_000_000_000;
  const prev = { lat: 51.5, lon: -0.12, country: "GB", at: t0 };
  const next = { lat: 35.7, lon: 139.7, country: "JP", at: t0 + 14 * 60 * 60_000 }; // 14h later
  const result = evaluateTravel(prev, next);
  assert.equal(result.flagged, false);
});

test("a short hop (city-level GeoIP jitter) is never flagged, even if the timestamps are identical", () => {
  const t0 = 1_000_000_000;
  const prev = { lat: 51.5, lon: -0.12, country: "GB", at: t0 }; // London
  const next = { lat: 52.2, lon: 0.12, country: "GB", at: t0 }; // Cambridge, ~55km away, same instant
  const result = evaluateTravel(prev, next);
  assert.equal(result.flagged, false, "below the minimum-distance floor");
});

test("thresholds are configurable via IMPOSSIBLE_TRAVEL_MAX_KMH / IMPOSSIBLE_TRAVEL_MIN_KM", () => {
  const t0 = 1_000_000_000;
  const prev = { lat: 51.5, lon: -0.12, country: "GB", at: t0 };
  const next = { lat: 52.2, lon: 0.12, country: "GB", at: t0 + 60_000 }; // ~55km in 1 min ⇒ ~3300 km/h

  // Default thresholds (300km floor) treat this short hop as noise.
  assert.equal(evaluateTravel(prev, next).flagged, false);

  // Lower the floor so this distance is no longer ignored as noise — now it's implausible.
  process.env["IMPOSSIBLE_TRAVEL_MIN_KM"] = "10";
  assert.equal(evaluateTravel(prev, next).flagged, true);

  // Raise the speed ceiling high enough and even this stops being flagged.
  process.env["IMPOSSIBLE_TRAVEL_MAX_KMH"] = "100000";
  assert.equal(evaluateTravel(prev, next).flagged, false);
});

test("checkLogin never throws and never blocks a login when the optional geoip dependency is absent", async () => {
  // geoip-lite is genuinely not installed in this environment — this exercises the
  // real fallback path, not a mock.
  const result = await checkLogin("user-1", "203.0.113.1");
  assert.equal(result.flagged, false);
});

test("checkLogin is a no-op for a missing IP", async () => {
  const result = await checkLogin("user-1", undefined);
  assert.equal(result.flagged, false);
});
