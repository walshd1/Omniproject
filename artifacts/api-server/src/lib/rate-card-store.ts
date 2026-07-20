import { SealedFile, resolveConfigFile } from "./sealed-file";
import { createUndoBuffer } from "./undo-buffer";
import { emptyRateCard, emptyIdentityMap, emptyUplift, hashIdentity, resolveScoped, DEFAULT_VALUE_MODEL, type RateCard, type IdentityMap, type RoleRates, type Uplift, type RateScope, type ValueColumn } from "./rate-card";
import type { CostRule } from "./cost-rules";
import { isForbiddenKey } from "./safe-json";

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
  /** The PMO-defined value model — any number of value columns. Absent ⇒ the default cost + charge. */
  values?: ValueColumn[];
}

/** Margin/overhead set centrally and overridden per scope (each field independently). */
interface UpliftConfig {
  central: Uplift;
  programme: Record<string, Partial<Uplift>>;
  project: Record<string, Partial<Uplift>>;
}

interface RateCardState {
  card: RateCard;
  identities: IdentityMap;
  projectTypes: ProjectType[];
  /** projectId → projectType id (chosen at project setup). */
  projectTypeOf: Record<string, string>;
  uplift: UpliftConfig;
  /** PMO-authored general cost rules (predicate → uplift override). */
  costRules: CostRule[];
}

const empty = (): RateCardState => ({
  card: emptyRateCard(),
  identities: emptyIdentityMap(),
  projectTypes: [],
  projectTypeOf: {},
  uplift: { central: emptyUplift(), programme: {}, project: {} },
  costRules: [],
});

let state: RateCardState = empty();

const store = new SealedFile(() => resolveConfigFile("RATE_CARD_FILE", "rate-card.json"), "rate-card");

function ensureLoaded(): RateCardState {
  store.loadOnce((raw) => {
    const parsed = JSON.parse(raw) as Partial<RateCardState>;
    state = {
      card: { titles: parsed.card?.titles ?? {}, rates: parsed.card?.rates ?? {} },
      identities: {
        central: parsed.identities?.central ?? {},
        programme: parsed.identities?.programme ?? {},
        project: parsed.identities?.project ?? {},
      },
      projectTypes: Array.isArray(parsed.projectTypes) ? parsed.projectTypes : [],
      projectTypeOf: parsed.projectTypeOf ?? {},
      uplift: {
        central: { margin: parsed.uplift?.central?.margin ?? 0, overhead: parsed.uplift?.central?.overhead ?? 0 },
        programme: parsed.uplift?.programme ?? {},
        project: parsed.uplift?.project ?? {},
      },
      costRules: Array.isArray(parsed.costRules) ? parsed.costRules : [],
    };
  });
  return state;
}

// One-generation undo buffer: the state as it was immediately before the LAST mutation,
// across every setter (they all funnel through `persist`, below). A bad edit from any of
// the rate-card family of admin editors — the card itself, uplift, identity map, project
// types, cost rules — can be undone in one step without an operator restart, closing the
// same "no admin-facing undo" gap the config directory's `.old` backup closes for its JSON.
// Batched per synchronous tick: a single logical request (e.g. PUT /rate-card) can call
// SEVERAL setters synchronously (setRateCard then setProjectTypes then setCentralUplift) —
// each is its own `persist()` call, so without batching the undo buffer would only capture
// the state between the last two calls, not before the whole request.
const undo = createUndoBuffer<RateCardState>(
  // Snapshot what was live BEFORE this batch — via ensureLoaded(), never the raw `state`, so
  // the very first mutation in a process still captures a real prior state (empty/from-disk),
  // not a false "nothing to undo" from the state simply not having been populated yet.
  () => ensureLoaded(),
  (restore) => applyAndWrite(restore),
);

function persist(next: RateCardState): void {
  undo.beginMutation();
  applyAndWrite(next);
}

function applyAndWrite(next: RateCardState): void {
  state = next;
  store.write(JSON.stringify(state));
}

/**
 * Undo the most recent rate-card change (one generation back), restoring whatever was live
 * immediately before it. One-shot: the undo buffer is cleared after use, so rolling back
 * twice in a row is a no-op rather than reintroducing the just-undone state. Returns false
 * when there's nothing to undo (no mutation yet this process).
 */
export function rollbackRateCard(): boolean {
  return undo.rollback();
}

/** Whether a rollback is currently available (for the admin UI to show/hide the control). */
export function canRollbackRateCard(): boolean {
  return undo.canRollback();
}

/** The current rate card (job-title hashes → label + rates), decrypted into memory. */
export function getRateCard(): RateCard {
  return ensureLoaded().card;
}
/** The hashed identity→role map (central + per-scope overrides). */
export function getIdentityMap(): IdentityMap {
  return ensureLoaded().identities;
}
/** The PMO-defined project-type list. */
export function getProjectTypes(): ProjectType[] {
  return ensureLoaded().projectTypes;
}
/** A project's chosen type id, or `"*"` (the default/any) when none is set. */
export function projectTypeFor(projectId: string): string {
  return ensureLoaded().projectTypeOf[projectId] ?? "*";
}

// Index the project types by id, memoized on the array's IDENTITY — the loaded/mutated state always
// REPLACES `projectTypes` with a fresh array, so a changed reference rebuilds the map (never stale)
// while repeated lookups against the same state skip the linear .find.
let projectTypeIndex: { arr: ProjectType[]; byId: Map<string, ProjectType> } | null = null;
function projectTypeById(typeId: string): ProjectType | undefined {
  const types = ensureLoaded().projectTypes;
  if (!projectTypeIndex || projectTypeIndex.arr !== types) {
    projectTypeIndex = { arr: types, byId: new Map(types.map((t) => [t.id, t])) };
  }
  return projectTypeIndex.byId.get(typeId);
}

/** The value model for a project — its type's declared columns, or the default cost + charge. */
export function valueModelFor(projectId: string): ValueColumn[] {
  const type = projectTypeById(projectTypeFor(projectId));
  return type?.values && type.values.length > 0 ? type.values : DEFAULT_VALUE_MODEL;
}

/** Replace the rate card (titles + rates), keyed by job-title hash. */
export function setRateCard(card: RateCard): void {
  persist({ ...ensureLoaded(), card: { titles: card.titles ?? {}, rates: card.rates ?? {} } });
}

/** The full margin/overhead config (central defaults + per-scope overrides) — for the PMO editor. */
export function getUpliftConfig(): { central: Uplift; programme: Record<string, Partial<Uplift>>; project: Record<string, Partial<Uplift>> } {
  return ensureLoaded().uplift;
}

/** The effective margin + overhead for a scope: project override → programme override → central, each
 *  field resolved independently so a project can tweak margin while inheriting central overhead. */
export function resolveUplift(scope: RateScope = {}): Uplift {
  const u = ensureLoaded().uplift;
  return {
    margin: resolveScoped(scope, u.project, u.programme, u.central, (v) => v?.margin) ?? u.central.margin,
    overhead: resolveScoped(scope, u.project, u.programme, u.central, (v) => v?.overhead) ?? u.central.overhead,
  };
}

/** Set the central uplift defaults (margin + overhead). */
export function setCentralUplift(uplift: Uplift): void {
  const cur = ensureLoaded();
  persist({ ...cur, uplift: { ...cur.uplift, central: { margin: uplift.margin, overhead: uplift.overhead } } });
}

/** Override (or clear, with an empty object) the uplift for one programme/project scope. */
export function setScopeUplift(level: "programme" | "project", scopeId: string, override: Partial<Uplift>): void {
  // A caller-supplied scopeId is used as an object key below; refuse reserved names so it can't
  // pollute the map's prototype (consistent with the reviver guard used on parsed bodies).
  if (isForbiddenKey(scopeId)) throw new Error(`invalid scopeId: ${scopeId}`);
  const cur = ensureLoaded();
  const map = { ...cur.uplift[level] };
  if (override.margin === undefined && override.overhead === undefined) delete map[scopeId];
  else map[scopeId] = override;
  persist({ ...cur, uplift: { ...cur.uplift, [level]: map } });
}

/** Replace the PMO's project-type list. */
export function setProjectTypes(types: ProjectType[]): void {
  persist({ ...ensureLoaded(), projectTypes: types });
}

/** The PMO-authored general cost rules (predicate → uplift override). */
export function getCostRules(): CostRule[] {
  return ensureLoaded().costRules;
}

/** Replace the cost-rule set. */
export function setCostRules(rules: CostRule[]): void {
  persist({ ...ensureLoaded(), costRules: rules });
}

/** Assign a project to a project type (chosen at setup). `""`/unknown clears it. */
export function setProjectType(projectId: string, typeId: string): void {
  if (isForbiddenKey(projectId)) throw new Error(`invalid projectId: ${projectId}`);
  const cur = ensureLoaded();
  const next = { ...cur.projectTypeOf };
  if (typeId) next[projectId] = typeId;
  else delete next[projectId];
  persist({ ...cur, projectTypeOf: next });
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
  if (scopeId != null && isForbiddenKey(scopeId)) throw new Error(`invalid scopeId: ${scopeId}`);
  const cur = ensureLoaded();
  const identities: IdentityMap = {
    central: { ...cur.identities.central },
    programme: { ...cur.identities.programme },
    project: { ...cur.identities.project },
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
  persist({ ...cur, identities });
}

/**
 * BACKUP export/import (roadmap X.14). The rate card is the most sensitive config in the product (pay grades
 * ↔ hashed identities), so it rides ONLY the ENCRYPTED full backup — never the plaintext one. `exportRateCard`
 * captures the whole sealed state as-is (the identity map is already hashed, so no plaintext name travels);
 * `importRateCard` rebuilds it through the SAME shape coercion the on-disk load uses, then persists via the one
 * `persist` choke point (so a restore is undoable too). A restored backup only ever arrives inside an
 * AES-GCM-authenticated sealed bundle, so matching the trusted on-disk parse is the right validation bar.
 */
export interface RateCardExport {
  card: RateCard;
  identities: IdentityMap;
  projectTypes: ProjectType[];
  projectTypeOf: Record<string, string>;
  uplift: UpliftConfig;
  costRules: CostRule[];
}

/** Capture the whole sealed rate-card state for an encrypted backup (identities are already hashed). */
export function exportRateCard(): RateCardExport {
  const s = ensureLoaded();
  return { card: s.card, identities: s.identities, projectTypes: s.projectTypes, projectTypeOf: s.projectTypeOf, uplift: s.uplift, costRules: s.costRules };
}

/** Restore the rate-card state from a (decrypted, sealed) backup, coerced through the same shape guards the
 *  on-disk load uses and persisted via the one `persist` choke point (so the restore is undoable). */
export function importRateCard(data: unknown): void {
  const d = (data ?? {}) as Partial<RateCardExport>;
  persist({
    card: { titles: d.card?.titles ?? {}, rates: d.card?.rates ?? {} },
    identities: {
      central: d.identities?.central ?? {},
      programme: d.identities?.programme ?? {},
      project: d.identities?.project ?? {},
    },
    projectTypes: Array.isArray(d.projectTypes) ? d.projectTypes : [],
    projectTypeOf: d.projectTypeOf ?? {},
    uplift: {
      central: { margin: d.uplift?.central?.margin ?? 0, overhead: d.uplift?.central?.overhead ?? 0 },
      programme: d.uplift?.programme ?? {},
      project: d.uplift?.project ?? {},
    },
    costRules: Array.isArray(d.costRules) ? d.costRules : [],
  });
}

/** Test-only: drop the in-memory cache (and reset to empty when RAM-only). */
export function __resetRateCardCache(): void {
  state = empty();
  undo.reset();
  store.reset();
}

export type { RoleRates };
