import { envInt } from "./env-config";
import { loadOptionalDependency } from "./optional-dependency";

/**
 * Impossible-travel detection — flags a login when the implied travel speed from the
 * same principal's previous login is beyond physically plausible. A stolen, still-valid
 * session cookie replayed from elsewhere, or credentials phished and reused from a
 * different country, both tend to show up first as this: two logins for one identity,
 * too far apart to have been the same person travelling between them.
 *
 * DEPENDENCY POSTURE (mirrors lib/saml.ts): `geoip-lite` is a RUNTIME-OPTIONAL
 * dependency — not declared in package.json, loaded via a dynamic import() only when
 * this check actually runs. If it isn't installed, the check no-ops (login is NEVER
 * blocked by its absence) and logs a one-time warning with the install command.
 *
 *   Enable with:  pnpm --filter @workspace/api-server add geoip-lite
 *
 * SCOPE: in-process only, mirroring lib/notify-bus.ts's per-replica default — in a
 * multi-replica deployment without sticky sessions, each replica holds its own view of
 * a principal's last known location, so a login landing on a different replica than the
 * previous one may not be compared at all. That's a false NEGATIVE (a missed detection),
 * which is the safer failure mode than a false positive that could lock a legitimate user
 * out — so this asymmetry is deliberate, not an oversight.
 *
 * A flagged login is never blocked or denied — see routes/auth.ts and lib/step-up.ts:
 * it stamps the session so the next step-up-gated (admin/pmo) action demands a FRESH
 * re-verification before proceeding, regardless of how recently the holder last stepped up.
 */

export interface ImpossibleTravelResult {
  flagged: boolean;
  distanceKm?: number;
  speedKmh?: number;
  minutesElapsed?: number;
  fromCountry?: string;
  toCountry?: string;
}

interface GeoPoint {
  lat: number;
  lon: number;
  country: string;
  at: number;
}

interface GeoLookupResult {
  country: string;
  ll: [number, number];
}

type GeoipModule = { lookup(ip: string): GeoLookupResult | null };

let geoipPromise: Promise<GeoipModule | null> | null = null;

async function getGeoip(): Promise<GeoipModule | null> {
  geoipPromise ??= loadOptionalDependency<GeoipModule>(
    "geoip-lite",
    (mod) => {
      const m = mod as { lookup?: unknown; default?: { lookup?: unknown } } | null;
      const lookupFn =
        typeof m?.lookup === "function" ? m.lookup
        : typeof m?.default?.lookup === "function" ? m.default.lookup
        : null;
      return lookupFn ? { lookup: lookupFn as (ip: string) => GeoLookupResult | null } : null;
    },
    "Impossible-travel geolocation checking is enabled by default but 'geoip-lite' is not installed — the check is a no-op (logins are never blocked by its absence). Run: pnpm --filter @workspace/api-server add geoip-lite",
  );
  return geoipPromise;
}

/** Faster than any commercial flight door-to-door; generous margin for GeoIP imprecision. */
function maxPlausibleKmh(): number {
  return envInt("IMPOSSIBLE_TRAVEL_MAX_KMH", 1000, { min: 1 });
}

/** Ignore short hops (city-level GeoIP jitter, a metro-area move, a VPN exit-node swap
 *  within the same region) — only a genuinely long jump is worth flagging at all. */
function minFlagKm(): number {
  return envInt("IMPOSSIBLE_TRAVEL_MIN_KM", 300, { min: 0 });
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Pure comparison of two login locations for one principal — no IO, fully unit-testable
 *  without the optional geoip-lite dependency installed. `prev` undefined (first login
 *  ever seen for this principal in this process) never flags — there's nothing to compare. */
export function evaluateTravel(prev: GeoPoint | undefined, next: GeoPoint): ImpossibleTravelResult {
  if (!prev) return { flagged: false };
  const distanceKm = haversineKm([prev.lat, prev.lon], [next.lat, next.lon]);
  // Floor at 1 second so two logins in the same instant don't divide by ~zero.
  const minutesElapsed = Math.max((next.at - prev.at) / 60_000, 1 / 60);
  const speedKmh = distanceKm / (minutesElapsed / 60);
  const flagged = distanceKm >= minFlagKm() && speedKmh > maxPlausibleKmh();
  return {
    flagged,
    distanceKm: Math.round(distanceKm),
    speedKmh: Math.round(speedKmh),
    minutesElapsed: Math.round(minutesElapsed),
    fromCountry: prev.country,
    toCountry: next.country,
  };
}

// Bounded LRU of last-known login locations. Keyed by principal `sub`; without a cap this map grows
// once per distinct identity ever seen (and `sub` can be an attacker-chosen email on the magic-link
// path), an unbounded slow leak. The cap is generous — impossible-travel only needs a RECENT prior
// location — and Map preserves insertion order, so evicting the oldest key on overflow is a cheap LRU.
const lastLogin = new Map<string, GeoPoint>();
/** Max distinct principals whose last location is tracked (read live so it's test-overridable). */
function maxTracked(): number {
  return envInt("IMPOSSIBLE_TRAVEL_MAX_TRACKED", 50_000, { min: 1 });
}

/** Record `sub`'s latest location, re-inserting so it becomes most-recent, and evict the oldest
 *  entries once the map exceeds the cap (bounded memory; a missed comparison for an evicted, long-
 *  idle principal is only a false negative — the safe failure mode this module already accepts). */
function rememberLocation(sub: string, point: GeoPoint): void {
  lastLogin.delete(sub); // re-insert at the end so recency == insertion order
  lastLogin.set(sub, point);
  const cap = maxTracked();
  while (lastLogin.size > cap) {
    const oldest = lastLogin.keys().next().value;
    if (oldest === undefined) break;
    lastLogin.delete(oldest);
  }
}

/** Record a login for `sub` from `ip` and check it against their last known location in
 *  this process. Always resolves (never throws) — a missing/unresolvable IP or absent
 *  geoip-lite dependency both degrade to `{ flagged: false }`, never blocking the login. */
export async function checkLogin(sub: string, ip: string | undefined): Promise<ImpossibleTravelResult> {
  if (!ip) return { flagged: false };
  const geoip = await getGeoip();
  if (!geoip) return { flagged: false };
  const geo = geoip.lookup(ip); // null for private/local/unresolvable addresses
  if (!geo) return { flagged: false };
  const next: GeoPoint = { lat: geo.ll[0], lon: geo.ll[1], country: geo.country, at: Date.now() };
  const prev = lastLogin.get(sub);
  const result = evaluateTravel(prev, next);
  rememberLocation(sub, next);
  return result;
}

/** Test-only: clear all remembered per-principal locations. */
export function __resetImpossibleTravelState(): void {
  lastLogin.clear();
}

/** Test-only: drive the bounded location map directly (geoip-lite isn't installed in unit tests, so
 *  checkLogin can't populate it) and read its size, to exercise the LRU eviction. */
export function __rememberLocationForTest(sub: string): void {
  rememberLocation(sub, { lat: 0, lon: 0, country: "XX", at: Date.now() });
}
export function __trackedCountForTest(): number { return lastLogin.size; }
