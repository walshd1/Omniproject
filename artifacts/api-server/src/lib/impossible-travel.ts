import { logger } from "./logger";

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
let warnedMissing = false;

async function getGeoip(): Promise<GeoipModule | null> {
  geoipPromise ??= (async () => {
    // Variable specifier so the bundler/tsc don't statically resolve the optional dep.
    const pkgName = "geoip-lite";
    const mod = (await import(pkgName).catch(() => null)) as { lookup?: unknown; default?: { lookup?: unknown } } | null;
    const lookupFn =
      typeof mod?.lookup === "function" ? mod.lookup
      : typeof mod?.default?.lookup === "function" ? mod.default.lookup
      : null;
    if (!lookupFn) {
      if (!warnedMissing) {
        warnedMissing = true;
        logger.warn(
          "Impossible-travel geolocation checking is enabled by default but 'geoip-lite' is not installed — the check is a no-op (logins are never blocked by its absence). Run: pnpm --filter @workspace/api-server add geoip-lite",
        );
      }
      return null;
    }
    return { lookup: lookupFn as (ip: string) => GeoLookupResult | null };
  })();
  return geoipPromise;
}

/** Faster than any commercial flight door-to-door; generous margin for GeoIP imprecision. */
function maxPlausibleKmh(): number {
  const raw = Number(process.env["IMPOSSIBLE_TRAVEL_MAX_KMH"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

/** Ignore short hops (city-level GeoIP jitter, a metro-area move, a VPN exit-node swap
 *  within the same region) — only a genuinely long jump is worth flagging at all. */
function minFlagKm(): number {
  const raw = Number(process.env["IMPOSSIBLE_TRAVEL_MIN_KM"]);
  return Number.isFinite(raw) && raw >= 0 ? raw : 300;
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

const lastLogin = new Map<string, GeoPoint>();

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
  lastLogin.set(sub, next);
  return result;
}

/** Test-only: clear all remembered per-principal locations. */
export function __resetImpossibleTravelState(): void {
  lastLogin.clear();
}
