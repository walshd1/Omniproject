import { hashIdentity, emptyIdentityMap, type RateCard, type IdentityMap, type Facing } from "./rate-card";

/**
 * Rate-card SOURCING — keep the system of record as the single source of truth.
 *
 * The rate card has three components, and each can be sourced independently: **job titles** from an HR
 * system, who-holds-which-title (**identities**) from HR too, and **rates** from a finance system — or
 * any of them from OmniProject's own sealed store. OmniProject composes them; it does NOT copy
 * backend-held data into its store (that would create a second, drifting source). Pulled data is fetched
 * through the broker on demand and held only ephemerally, per the stateful-data policy.
 *
 * This module is pure: the broker call is injected as a `fetch` function, so the compose/normalise logic
 * is fully unit-testable without a live backend.
 */

/** Where one rate-card component comes from. */
export type ComponentSource =
  | { kind: "local" }
  | { kind: "backend"; backend: string; action: string };

export interface RateCardSources {
  /** Job-title list (e.g. an HR system). */
  titles: ComponentSource;
  /** Who holds which title (e.g. HR). */
  identities: ComponentSource;
  /** Hourly rates per role (e.g. a finance system). */
  rates: ComponentSource;
}

export const localSources = (): RateCardSources => ({ titles: { kind: "local" }, identities: { kind: "local" }, rates: { kind: "local" } });

/** True if any component is sourced from a backend (so we need to call the broker). */
export function usesBackend(s: RateCardSources): boolean {
  return s.titles.kind === "backend" || s.identities.kind === "backend" || s.rates.kind === "backend";
}

/** The distinct backend sources referenced (for capability checks / diagnostics). */
export function referencedBackends(s: RateCardSources): { backend: string; action: string }[] {
  const out = new Map<string, { backend: string; action: string }>();
  for (const c of [s.titles, s.identities, s.rates]) if (c.kind === "backend") out.set(`${c.backend}:${c.action}`, { backend: c.backend, action: c.action });
  return [...out.values()];
}

// ── Normalisation: the shapes OmniProject expects a broker to return ─────────────
// The broker (n8n etc.) maps each backend's native API onto these rows, so the gateway stays
// backend-agnostic — it never knows HR's or finance's schema, only this normalised contract.

export interface TitleRow { title: string }
export interface RateRow { title: string; projectType?: string; facing?: Facing; rate: number }
export interface IdentityRow { assignee: string; title: string }

/** Backend title rows → `titleHash → label`. The label is the source-of-truth title text. */
export function normaliseTitles(rows: readonly TitleRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r?.title) out[hashIdentity(r.title)] = r.title;
  return out;
}

/** Backend rate rows → the rate card's `rates` map. Missing projectType ⇒ `"*"`; a missing facing
 *  applies the rate to BOTH client and internal (a single finance rate with no split). */
export function normaliseRates(rows: readonly RateRow[]): RateCard["rates"] {
  const out: RateCard["rates"] = {};
  for (const r of rows) {
    if (!r?.title || typeof r.rate !== "number" || !isFinite(r.rate)) continue;
    const h = hashIdentity(r.title);
    const pt = r.projectType || "*";
    const role = (out[h] ??= {});
    const cell = (role[pt] ??= {});
    if (r.facing === "client" || r.facing === "internal") cell[r.facing] = r.rate;
    else { cell.client = r.rate; cell.internal = r.rate; }
  }
  return out;
}

/** Backend identity rows → the central `hash(assignee) → hash(title)` map (no plaintext persisted). */
export function normaliseIdentities(rows: readonly IdentityRow[]): IdentityMap {
  const map = emptyIdentityMap();
  for (const r of rows) if (r?.assignee && r?.title) map.central[hashIdentity(r.assignee)] = hashIdentity(r.title);
  return map;
}

export interface LocalRateCard {
  card: RateCard;
  identities: IdentityMap;
}

/** Fetch normalised rows for a backend component source (injected; wraps the broker call). */
export type SourceFetcher = (source: { backend: string; action: string }) => Promise<unknown[]>;

/**
 * Compose the effective rate card by resolving each component from its source: a `local` component reads
 * the sealed store; a `backend` component is pulled through the broker and normalised. The result is a
 * plain in-memory RateCard + IdentityMap — never written back to the store, so the backend stays the one
 * source of truth.
 */
export async function resolveRateCard(sources: RateCardSources, local: LocalRateCard, fetch: SourceFetcher): Promise<LocalRateCard> {
  const titles = sources.titles.kind === "local" ? local.card.titles : normaliseTitles((await fetch(sources.titles)) as TitleRow[]);
  const rates = sources.rates.kind === "local" ? local.card.rates : normaliseRates((await fetch(sources.rates)) as RateRow[]);
  const identities = sources.identities.kind === "local" ? local.identities : normaliseIdentities((await fetch(sources.identities)) as IdentityRow[]);
  return { card: { titles, rates }, identities };
}
