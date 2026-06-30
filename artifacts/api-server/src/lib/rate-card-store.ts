import fs from "node:fs";
import path from "node:path";
import { sealConfig, readMaybeSealed } from "./config-crypto";
import { logger } from "./logger";
import { emptyRateCard, emptyIdentityMap, hashIdentity, type RateCard, type IdentityMap, type RoleRates } from "./rate-card";

/**
 * Sealed at-rest store for the rate card, the hashed identity→role map, and the PMO's project-type
 * list. This is the most sensitive config in the product (pay grades mapped to people), so it lives in
 * its OWN AES-GCM-sealed file (`rate-card.json` in OMNI_CONFIG_DIR) — never in the general settings
 * snapshot/export. RAM-only when no config dir is set (dev/stateless). The map is stored as
 * hash(assignee)→hash(jobTitle); only a title's display label is kept in clear inside the sealed blob.
 */

export interface ProjectType {
  id: string;
  label: string;
}

interface RateCardState {
  card: RateCard;
  identities: IdentityMap;
  projectTypes: ProjectType[];
  /** projectId → projectType id (chosen at project setup). */
  projectTypeOf: Record<string, string>;
}

const empty = (): RateCardState => ({
  card: emptyRateCard(),
  identities: emptyIdentityMap(),
  projectTypes: [],
  projectTypeOf: {},
});

let cache: RateCardState | null = null;

function file(): string | null {
  const explicit = process.env["RATE_CARD_FILE"]?.trim();
  if (explicit) return explicit;
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  return dir ? path.join(dir, "rate-card.json") : null;
}

function load(): RateCardState {
  if (cache) return cache;
  const f = file();
  if (!f || !fs.existsSync(f)) return (cache = empty());
  try {
    const parsed = JSON.parse(readMaybeSealed(fs.readFileSync(f, "utf8"))) as Partial<RateCardState>;
    cache = {
      card: { titles: parsed.card?.titles ?? {}, rates: parsed.card?.rates ?? {} },
      identities: {
        central: parsed.identities?.central ?? {},
        programme: parsed.identities?.programme ?? {},
        project: parsed.identities?.project ?? {},
      },
      projectTypes: Array.isArray(parsed.projectTypes) ? parsed.projectTypes : [],
      projectTypeOf: parsed.projectTypeOf ?? {},
    };
  } catch (err) {
    logger.warn({ err }, "rate-card: failed to read sealed file — treating as empty");
    cache = empty();
  }
  return cache;
}

function persist(state: RateCardState): void {
  cache = state;
  const f = file();
  if (!f) return; // RAM-only deployment
  fs.writeFileSync(f, sealConfig(JSON.stringify(state)));
}

/** The current rate card (job-title hashes → label + rates), decrypted into memory. */
export function getRateCard(): RateCard {
  return load().card;
}
/** The hashed identity→role map (central + per-scope overrides). */
export function getIdentityMap(): IdentityMap {
  return load().identities;
}
/** The PMO-defined project-type list. */
export function getProjectTypes(): ProjectType[] {
  return load().projectTypes;
}
/** A project's chosen type id, or `"*"` (the default/any) when none is set. */
export function projectTypeFor(projectId: string): string {
  return load().projectTypeOf[projectId] ?? "*";
}

/** Replace the rate card (titles + rates), keyed by job-title hash. */
export function setRateCard(card: RateCard): void {
  persist({ ...load(), card: { titles: card.titles ?? {}, rates: card.rates ?? {} } });
}

/** Replace the PMO's project-type list. */
export function setProjectTypes(types: ProjectType[]): void {
  persist({ ...load(), projectTypes: types });
}

/** Assign a project to a project type (chosen at setup). `""`/unknown clears it. */
export function setProjectType(projectId: string, typeId: string): void {
  const state = load();
  const next = { ...state.projectTypeOf };
  if (typeId) next[projectId] = typeId;
  else delete next[projectId];
  persist({ ...state, projectTypeOf: next });
}

/**
 * Set the identity→role assignments for a scope from RAW (assignee, jobTitleHash) pairs — the assignee
 * is hashed here so the caller's plaintext name is never persisted. An empty title clears the entry.
 */
export function setIdentityAssignments(
  level: "central" | "programme" | "project",
  scopeId: string | null,
  pairs: ReadonlyArray<{ assignee: string; titleHash: string }>,
): void {
  const state = load();
  const identities: IdentityMap = {
    central: { ...state.identities.central },
    programme: { ...state.identities.programme },
    project: { ...state.identities.project },
  };
  const target: Record<string, string> =
    level === "central" ? identities.central : { ...((level === "programme" ? identities.programme : identities.project)[scopeId ?? ""] ?? {}) };
  for (const { assignee, titleHash } of pairs) {
    const h = hashIdentity(assignee);
    if (titleHash) target[h] = titleHash;
    else delete target[h];
  }
  if (level === "central") identities.central = target;
  else if (level === "programme" && scopeId) identities.programme[scopeId] = target;
  else if (level === "project" && scopeId) identities.project[scopeId] = target;
  persist({ ...state, identities });
}

/** Test-only: drop the in-memory cache (and reset to empty when RAM-only). */
export function __resetRateCardCache(): void {
  cache = null;
  if (!file()) cache = empty();
}

export type { RoleRates };
