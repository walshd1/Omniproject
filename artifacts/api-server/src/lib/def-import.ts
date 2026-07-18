/**
 * THE DEFINITION IMPORTER — the single validated write-path for ANY user-defined JSON DEFINITION into the
 * scoped encrypted stores. Everything a user can define in JSON (a primitive, a screen, a form, a report, a
 * dashboard, or a raw jsonDef) enters the system HERE: it is validated by its kind against the real product
 * validators, then written to the AES-256-GCM sealed artifact store at the scope the author chose — their
 * private `user` area, a `project` area, or the `org` area. One choke point, so no user-defined JSON ever
 * reaches an encrypted store without passing the sanitiser + the per-kind validator first.
 *
 * (Distinct from `routes/import` — that is the TABULAR data importer: spreadsheet/SQL rows → work items via
 * the broker. This is DEFINITIONS → the sealed def stores.)
 *
 * PURE: validate + build the row. The route applies RBAC + the shared storage-target authorization and does
 * the sealed write via `artifact-store`.
 */
import type { ActorContext } from "../broker/types";
import { listArtifacts, getArtifact, putArtifact, deleteArtifact, replaceArtifacts, listAllArtifactCollections, SYSTEM_SCOPE, type ArtifactScope } from "./artifact-store";
import { readDefIndex, ensureDefIndex, defHasChildren, defIndexAddEdge, invalidateDefIndex } from "./def-index";
import { validateScreenDefs } from "./screen-def";
import { sanitizeMapping } from "./mapping";
import { validateCustomFieldDef } from "./custom-fields";
import { validatePrimitiveDef, shippedDefRefs, shippedDefs, extendsLineage, composeExtends, composedConstraintErrors, kindRootConstraints, kindElementErrors, validateFormFields } from "@workspace/backend-catalogue";

/** A user-definable JSON kind the importer accepts. */
export type DefKind = "primitive" | "screen" | "form" | "report" | "dashboard" | "businessRule" | "methodology" | "mapping" | "customField" | "theme" | "font" | "jsonDef";
export const DEF_KINDS: readonly DefKind[] = ["primitive", "screen", "form", "report", "dashboard", "businessRule", "methodology", "mapping", "customField", "theme", "font", "jsonDef"];

/** The artifact-store type key: one sealed collection per scope holds every stored def. */
export const DEF_ARTIFACT = "def";

export const DEF_LIMITS = {
  maxName: 200,
  maxPayloadBytes: 512 * 1024,
} as const;

/** A rejected import (maps to 400). */
export class DefError extends Error {
  constructor(message: string) { super(message); this.name = "DefError"; }
}

const KIND_SET = new Set<string>(DEF_KINDS);
const isDefKind = (k: unknown): k is DefKind => typeof k === "string" && KIND_SET.has(k);

/** The result of validating one payload by kind: every problem (never throws), and the normalised value. */
export interface DefValidation {
  ok: boolean;
  errors: string[];
  value?: unknown;
}

/** A minimal structural check for kinds without a bespoke validator yet — a JSON object with required keys. */
function structural(payload: unknown, requiredStringKeys: string[]): DefValidation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, errors: ["payload must be a JSON object"] };
  const o = payload as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of requiredStringKeys) {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) errors.push(`${k} is required`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], value: payload };
}

/** Run a throwing def-validator and turn it into a {@link DefValidation}. */
function fromThrowing(run: () => unknown): DefValidation {
  try { return { ok: true, errors: [], value: run() }; }
  catch (e) { return { ok: false, errors: [e instanceof Error ? e.message : "invalid definition"] }; }
}

/**
 * Validate a payload against its kind using the REAL product validators — the same ones the individual def
 * routes enforce — so a stored def can never be a shape the product would reject. Never throws.
 */
export function validateDef(kind: DefKind, payload: unknown): DefValidation {
  switch (kind) {
    case "primitive": {
      const r = validatePrimitiveDef(payload);
      return { ok: r.ok, errors: r.errors, ...(r.def ? { value: r.def } : {}) };
    }
    case "screen": return fromThrowing(() => validateScreenDefs([payload])[0]);
    case "form": {
      // Forms are validated by the engine, not a monolithic validator: fragment-time we check the id is present
      // and every DECLARED field is a valid field-primitive instance (type known, required params, the inherited
      // `mapTo` allow-list floor, choice options) — the checks that hold for a partial fork. The CONTAINER floors
      // (>=1 field, exactly one title, unique targets/keys, target.kind) are enforced on the COMPOSED whole in
      // `composedValidity`, so a thin fork that inherits fields/title/target still validates once composed.
      const base = structural(payload, ["id"]);
      if (!base.ok) return base;
      const fieldErrors = validateFormFields((payload as Record<string, unknown>)["fields"]);
      return fieldErrors.length ? { ok: false, errors: fieldErrors } : { ok: true, errors: [], value: payload };
    }
    case "report": return structural(payload, ["id"]);
    case "dashboard": return validateDashboardDef(payload);
    case "businessRule": return structural(payload, ["id"]);
    case "methodology": return structural(payload, ["id", "label"]);
    case "mapping": return fromThrowing(() => sanitizeMapping(payload));
    case "customField": return fromThrowing(() => validateCustomFieldDef(payload));
    case "theme": return validateTheme(payload);
    case "font": return structural(payload, ["id", "family"]);
    case "jsonDef": return structural(payload, []);
  }
}

/** A dashboard def: `id` + `name` + a `widgets` array, each widget an `{ id, type }` (span/title optional) —
 *  the real `Dashboard` shape, so a stored dashboard can actually render (X.10). Unknown widget `type`s are
 *  tolerated (the renderer placeholders them), matching the live dashboards' forward-compatibility. */
function validateDashboardDef(payload: unknown): DefValidation {
  const base = structural(payload, ["id", "name"]);
  if (!base.ok) return base;
  const widgets = (payload as Record<string, unknown>)["widgets"];
  if (!Array.isArray(widgets)) return { ok: false, errors: ["widgets must be an array"] };
  const errors: string[] = [];
  widgets.forEach((w, i) => {
    if (!w || typeof w !== "object" || Array.isArray(w)) { errors.push(`widgets[${i}] must be an object`); return; }
    const o = w as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !o["id"].trim()) errors.push(`widgets[${i}].id is required`);
    if (typeof o["type"] !== "string" || !o["type"].trim()) errors.push(`widgets[${i}].type is required`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], value: payload };
}

/** A colour theme: an id + a `colors` map of string colour values (checked so a theme can't smuggle a
 *  non-string / executable value into the styling layer). */
function validateTheme(payload: unknown): DefValidation {
  const base = structural(payload, ["id"]);
  if (!base.ok) return base;
  const colors = (payload as Record<string, unknown>)["colors"];
  if (colors !== undefined) {
    if (typeof colors !== "object" || colors === null || Array.isArray(colors)) return { ok: false, errors: ["colors must be an object of colour values"] };
    if (Object.values(colors as Record<string, unknown>).some((v) => typeof v !== "string")) return { ok: false, errors: ["every colors value must be a string"] };
  }
  return { ok: true, errors: [], value: payload };
}

export interface SanitizedDef {
  kind: DefKind;
  name: string;
  payload: unknown;
  /** The normalised value from the kind validator. */
  value: unknown;
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    const printable = c === 9 || (c >= 32 && c !== 127 && !(c >= 128 && c <= 159));
    if (printable) out += ch;
    if (out.length >= DEF_LIMITS.maxName) break;
  }
  return out.trim().slice(0, DEF_LIMITS.maxName);
}

/**
 * The single choke point: validate the whole import request (kind, name, payload size + shape). Throws
 * {@link DefError} (→ 400) on any problem, aggregating the kind-validator errors into the message.
 */
export function sanitizeDef(raw: unknown): SanitizedDef {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (!isDefKind(obj["kind"])) throw new DefError(`kind must be one of ${DEF_KINDS.join(", ")}`);
  const name = cleanName(obj["name"]);
  if (!name) throw new DefError("a definition needs a name");
  const payload = obj["payload"];
  if (payload === undefined || payload === null || typeof payload !== "object") throw new DefError("payload must be a JSON object");
  if (JSON.stringify(payload).length > DEF_LIMITS.maxPayloadBytes) throw new DefError("the payload is too large");
  const check = validateDef(obj["kind"], payload);
  if (!check.ok) throw new DefError(`invalid ${obj["kind"]}: ${check.errors.join("; ")}`);
  return { kind: obj["kind"], name, payload, value: check.value };
}

/** A stored definition. Its `id` is self-describing (`<storage>~…~<localId>`) so a read/write routes to the
 *  right scoped store without a lookup. */
export interface StoredDef {
  id: string;
  kind: DefKind;
  name: string;
  payload: unknown;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

/** The list projection (payload dropped). `storage` is derived from the id. */
export interface StoredDefMeta {
  id: string;
  kind: DefKind;
  name: string;
  storage: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const actorLabel = (ctx: ActorContext): string | null => ctx.email ?? ctx.name ?? ctx.sub ?? null;

/** Validate an EDIT to an existing def: the kind is fixed (can't change on edit), the payload is re-validated,
 *  and the name is optional (kept when omitted). Throws {@link DefError} (→ 400). */
export function sanitizeDefUpdate(kind: DefKind, raw: unknown): { name?: string; payload: unknown; value: unknown } {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const payload = obj["payload"];
  if (payload === undefined || payload === null || typeof payload !== "object") throw new DefError("payload must be a JSON object");
  if (JSON.stringify(payload).length > DEF_LIMITS.maxPayloadBytes) throw new DefError("the payload is too large");
  const check = validateDef(kind, payload);
  if (!check.ok) throw new DefError(`invalid ${kind}: ${check.errors.join("; ")}`);
  const name = cleanName(obj["name"]);
  return { ...(name ? { name } : {}), payload, value: check.value };
}

/** Apply a validated edit to an existing def — payload replaced, name updated when given, rowVersion bumped. */
export function updateStoredDef(existing: StoredDef, input: { name?: string; payload: unknown }, now: string): StoredDef {
  return {
    ...existing,
    name: input.name ?? existing.name,
    payload: input.payload,
    updatedAt: now,
    rowVersion: (existing.rowVersion ?? 1) + 1,
  };
}

/** Build the row for a newly stored def (identity + timestamps stamped server-side). */
export function newStoredDef(id: string, input: SanitizedDef, ctx: ActorContext, now: string): StoredDef {
  return {
    id, kind: input.kind, name: input.name, payload: input.payload,
    createdBy: actorLabel(ctx), createdAt: now, updatedAt: now, rowVersion: 1,
  };
}

/** The metadata view of a stored def (payload dropped). `storage` is the id's leading token. */
export function storedDefMeta(a: StoredDef): StoredDefMeta {
  return {
    id: a.id, kind: a.kind, name: a.name, storage: a.id.split("~")[0] ?? "user",
    createdBy: a.createdBy ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

// ── Scoped store helpers ─────────────────────────────────────────────────────────────────────────────────
export const listDefs = (scope: ArtifactScope): StoredDef[] => listArtifacts<StoredDef>(DEF_ARTIFACT, scope);
export const getDef = (scope: ArtifactScope, id: string): StoredDef | null => getArtifact<StoredDef>(DEF_ARTIFACT, scope, id);

// ── COMPOSITION ancestry check (the `extends` model) ─────────────────────────────────────────────────────────
// A def can be a THIN child that `extends` a parent def of the SAME kind (see def-compose). The importer is the
// choke point, so it must reject a def whose `extends` parent is MISSING ("broken ancestor") or would CYCLE —
// checked against the shipped catalogue PLUS every scoped def the author can see (system + org + programme +
// project + user). Logical ids (`payload.id` / slot / report id / …), not storage ids, form the graph.

/** The `{ id, extends }` of a StoredDef, from its payload (the logical id the graph is keyed on). */
function defRefOf(d: StoredDef): { id: string; extends?: string } | null {
  const p = (d.payload ?? {}) as Record<string, unknown>;
  const id = typeof p["id"] === "string" ? p["id"] : "";
  if (!id) return null;
  return typeof p["extends"] === "string" && p["extends"] ? { id, extends: p["extends"] } : { id };
}

/** Which programme/project/user scopes to consult for visible ancestors when importing. */
export interface AncestryScopes { projectId?: string; programmeId?: string; sub?: string }

/**
 * Reject an import whose `extends` chain is broken. Returns an error MESSAGE (for a 400) or null when the def
 * has no `extends` or its chain resolves. Fail-closed: a missing parent or a cycle is an error, never a
 * silently-partial def. Considers the shipped catalogue + all scoped defs the author can see + the def itself.
 */
export function checkImportAncestry(kind: DefKind, payload: unknown, scopes: AncestryScopes): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const ext = typeof p["extends"] === "string" ? p["extends"] : "";
  if (!ext) return null;                                   // not a child → nothing to trace
  const selfId = typeof p["id"] === "string" ? p["id"] : "";
  if (!selfId) return null;                                // no logical id → the per-kind validator handles it
  const byId = new Map<string, { id: string; extends?: string }>();
  for (const r of shippedDefRefs(kind)) byId.set(r.id, r);
  const addStored = (rows: StoredDef[]) => { for (const d of rows) if (d.kind === kind) { const r = defRefOf(d); if (r) byId.set(r.id, r); } };
  addStored(listSystemDefs());
  addStored(listDefs({ kind: "org" }));
  if (scopes.programmeId) addStored(listDefs({ kind: "programme", programmeId: scopes.programmeId }));
  if (scopes.projectId) addStored(listDefs({ kind: "project", projectId: scopes.projectId }));
  if (scopes.sub) addStored(listDefs({ kind: "user", sub: scopes.sub }));
  byId.set(selfId, { id: selfId, extends: ext });          // the def being imported (may override a lower scope)
  try { extendsLineage(selfId, (k) => byId.get(k)); return null; }
  catch (e) { return e instanceof Error ? e.message : "broken extends ancestry"; }
}

// ── BIDIRECTIONAL COMPOSITION integrity (the cascade check) ────────────────────────────────────────────────
// `checkImportAncestry` above proves the edited def's OWN `extends` chain resolves (upward). But a def built by
// COPYING + ALTERING a core def sits in a web of dependants: a change to a ROOT can cascade FAILURE down the
// chain. So on every write we also (down) compose the edited def over its ancestors and validate the flattened
// WHOLE — it must hold against WHAT THE ANCESTOR PROVIDES — and (cascade) re-compose + re-validate every
// DESCENDANT, rejecting a change that would break one that was previously fine. A delete is guarded the same
// way: removing a def that others are built on is blocked. Fail-closed, regression-based (never punishes
// pre-existing breakage), keyed on LOGICAL ids exactly like the ancestry graph.

/** The scope-chain precedence of a stored collection (base → nearest): shipped defaults sit beneath, then the
 *  customer's own defs override by id up the chain. Deployment-scoped defs (org / programme / project / user)
 *  are all just BRANCHES off the shipped core — a copied ancestor whose chain continues at that scope — so the
 *  integrity graph must include EVERY one of them, not only the scopes named in the request. */
const SCOPE_RANK: Record<string, number> = { system: 0, org: 1, programme: 2, project: 3, user: 4 };
const scopeRank = (s: ArtifactScope): number => SCOPE_RANK[s.kind] ?? 5;

/** One decrypt of the whole def store: every stored collection across the deployment, sorted base → nearest by
 *  scope precedence. This is the EXPENSIVE step (AES-decrypt + JSON.parse of every sealed collection), so a
 *  single write reads it ONCE and folds it into as many graph views as it needs (before/after) in memory —
 *  `defGraphFrom` does the cheap folds. Kept separate so the costly I/O is never repeated per fold. */
type DefCollections = { scope: ArtifactScope; items: StoredDef[] }[];
function collectDefCollections(): DefCollections {
  return listAllArtifactCollections<StoredDef>(DEF_ARTIFACT).sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));
}

/** Fold pre-read collections into the composition graph for a kind — logical id → the payload that supplies it —
 *  with the shipped catalogue beneath every deployment scope, folded by override precedence (nearest wins on an
 *  id clash). `extends` edges are kept intact. An `overlay` replaces one id with an in-flight edit; an
 *  `excludeStorageId` simulates a delete (that stored row is skipped, so the id falls back to any lower scope).
 *  PURE + in-memory over the already-decrypted `collections`, so the SAME read feeds `before` and `after`. */
function defGraphFrom(collections: DefCollections, kind: DefKind, opts: { overlay?: Record<string, unknown>; excludeStorageId?: string } = {}): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const d of shippedDefs(kind)) {
    const id = typeof d["id"] === "string" ? d["id"] : "";
    if (id) byId.set(id, d);
  }
  for (const { items } of collections) {
    for (const d of items) {
      if (d.kind !== kind) continue;
      if (opts.excludeStorageId && d.id === opts.excludeStorageId) continue;
      const p = (d.payload ?? {}) as Record<string, unknown>;
      const id = typeof p["id"] === "string" ? p["id"] : "";
      if (id) byId.set(id, p);
    }
  }
  if (opts.overlay) { const id = typeof opts.overlay["id"] === "string" ? opts.overlay["id"] : ""; if (id) byId.set(id, opts.overlay); }
  return byId;
}

/** Every id whose `extends` chain passes THROUGH `rootId` (its transitive dependants), by walking child edges.
 *  Excludes `rootId` itself. */
function descendantsOf(rootId: string, byId: Map<string, Record<string, unknown>>): string[] {
  const children = new Map<string, string[]>();
  for (const [id, p] of byId) {
    const ext = typeof p["extends"] === "string" ? p["extends"] : "";
    if (ext) { const arr = children.get(ext) ?? []; arr.push(id); children.set(ext, arr); }
  }
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [...(children.get(rootId) ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur); out.push(cur);
    for (const c of children.get(cur) ?? []) if (!seen.has(c)) queue.push(c);
  }
  return out;
}

/** Compose `id` over its ancestors in `byId` and validate the flattened WHOLE — against its kind AND against the
 *  declarative CONSTRAINTS inherited down its lineage (policy child-wins, floors conjoin tighten-only; see
 *  def-constraints). Returns an error message, or null when it composes, validates AND satisfies its constraints.
 *  A broken chain (missing parent / cycle) is an error. */
function composedValidity(kind: DefKind, id: string, byId: Map<string, Record<string, unknown>>): string | null {
  let composed: (Record<string, unknown> & { lineage: string[] }) | undefined;
  try { composed = composeExtends(id, (k) => byId.get(k) as (Record<string, unknown> & { id: string; extends?: string }) | undefined); }
  catch (e) { return e instanceof Error ? e.message : `def "${id}": broken extends chain`; }
  if (!composed) return `def "${id}" not found`;
  const { lineage: _l, ...flat } = composed;
  const errors: string[] = [];
  const check = validateDef(kind, flat);
  if (!check.ok) errors.push(...check.errors);
  // The constraints binding this def, ROOT → leaf: the kind's implicit container floors (bind the whole kind),
  // then those introduced at each node of its extends lineage. Evaluated against the composed whole.
  const perNode: unknown[][] = [kindRootConstraints(kind)];
  for (const cid of [...composed.lineage].reverse()) {
    const p = byId.get(cid);
    perNode.push(p && Array.isArray(p["constraints"]) ? (p["constraints"] as unknown[]) : []);
  }
  errors.push(...composedConstraintErrors(flat, perNode));
  // Per-element validation: each primitive-instance child (a form's fields) validated against its own primitive
  // — type known, required params present, the inherited `mapTo` allow-list floor, choice options.
  errors.push(...kindElementErrors(kind, flat));
  return errors.length ? errors.join("; ") : null;
}

/** On EDIT, the identity of the row being rewritten: its storage id (so the STALE stored payload is excluded
 *  from the simulated after-world) and its prior LOGICAL id (so a RENAME — which orphans everything built on the
 *  old id — is caught). Omitted for a fresh import. */
export interface EditContext { storageId: string; priorId: string }

/**
 * BIDIRECTIONAL integrity for an import/edit. Returns an error MESSAGE (→ 400) or null. Two directions:
 *  - DOWN: the edited def, composed over its ancestors, must validate as a WHOLE — a child extending a parent
 *    has to hold against what the ancestor provides (not just be a well-formed fragment).
 *  - CASCADE: every DESCENDANT that was valid before this change must STILL be valid after it — so an edit to a
 *    root (its content, or a RENAME of its id) that would break a def downstream is rejected here, before it is
 *    stored. Regression-based: a descendant already broken (for its own reasons) is not blamed on this change.
 */
export function checkImportIntegrity(kind: DefKind, payload: unknown, edit?: EditContext): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const selfId = typeof p["id"] === "string" ? p["id"] : "";
  if (!selfId) return null;                                 // no logical id → per-kind validator already ran
  const ext = typeof p["extends"] === "string" && p["extends"] ? p["extends"] : "";
  // FAST PATH — a ROOTLESS def that NOTHING extends can neither need ancestors nor cascade into descendants, so
  // its integrity check is just "does it validate against the shipped catalogue alone?". The child index answers
  // "does anything extend it?" without decrypting the whole store. Gated hard: only when the index is present
  // (absent → full path rebuilds it) and neither this id NOR (on a rename) the prior id has any children.
  if (!ext) {
    const ix = readDefIndex();
    const priorHasKids = !!(edit && edit.priorId && edit.priorId !== selfId && ix && defHasChildren(ix, kind, edit.priorId));
    if (ix && !defHasChildren(ix, kind, selfId) && !priorHasKids) {
      const g = new Map<string, Record<string, unknown>>();
      for (const d of shippedDefs(kind)) { const id = typeof d["id"] === "string" ? d["id"] : ""; if (id) g.set(id, d); }
      g.set(selfId, p);
      const own = composedValidity(kind, selfId, g);
      return own ? `this definition does not hold against its ancestors: ${own}` : null;
    }
  }
  const cols = collectDefCollections();                     // ONE decrypt of the store; both folds reuse it
  ensureDefIndex(cols);                                     // refresh/persist the index so future inert writes go fast
  const before = defGraphFrom(cols, kind);                  // the world as it is (deployment-wide)
  // The world with this change applied: overlay the new payload and, on edit, drop the row's stale stored copy
  // so a rename doesn't leave the old logical id behind.
  const after = defGraphFrom(cols, kind, { overlay: p, ...(edit ? { excludeStorageId: edit.storageId } : {}) });
  const own = composedValidity(kind, selfId, after);
  if (own) return `this definition does not hold against its ancestors: ${own}`;
  // Descendants of the def under its NEW id, plus — on a rename — those still built on its OLD id (now orphaned).
  const targets = new Set<string>(descendantsOf(selfId, after));
  if (edit && edit.priorId && edit.priorId !== selfId) for (const d of descendantsOf(edit.priorId, before)) targets.add(d);
  for (const child of targets) {
    if (child === selfId) continue;
    const wasOk = composedValidity(kind, child, before) === null;
    const nowErr = composedValidity(kind, child, after);
    if (wasOk && nowErr) return `this change would break downstream definition "${child}": ${nowErr}`;
  }
  return null;
}

/**
 * Guard a DELETE: removing a def that others are BUILT ON orphans them. Returns an error MESSAGE (→ 409) or null.
 * Regression-based — a descendant that was valid only because this def existed, and breaks once it is gone, blocks
 * the delete; one that still resolves from a lower scope (or was already broken) does not.
 */
export function checkDeleteIntegrity(kind: DefKind, storageId: string, logicalId: string): string | null {
  if (!logicalId) return null;
  // FAST PATH — if NOTHING extends this id (per the child index), deleting it can't orphan anything, so no scan
  // is needed. Absent index → full path (which rebuilds it).
  const ix = readDefIndex();
  if (ix && !defHasChildren(ix, kind, logicalId)) return null;
  const cols = collectDefCollections();                     // ONE decrypt; before/after both fold it in memory
  ensureDefIndex(cols);
  const before = defGraphFrom(cols, kind);
  const after = defGraphFrom(cols, kind, { excludeStorageId: storageId });
  for (const child of descendantsOf(logicalId, before)) {
    const wasOk = composedValidity(kind, child, before) === null;
    const nowErr = composedValidity(kind, child, after);
    if (wasOk && nowErr) return `cannot delete "${logicalId}": downstream definition "${child}" is built on it (${nowErr})`;
  }
  return null;
}
export const putDef = (scope: ArtifactScope, a: StoredDef): void => {
  putArtifact(DEF_ARTIFACT, scope, a);
  // Keep the child-edge index current write-through (additive → only ever over-reports, which is safe). Any
  // failure invalidates the whole index so it is rebuilt from a full scan on next use (rebuild-on-doubt).
  try {
    const pl = (a.payload ?? {}) as Record<string, unknown>;
    const child = typeof pl["id"] === "string" ? pl["id"] : "";
    const parent = typeof pl["extends"] === "string" ? pl["extends"] : "";
    if (child && parent) defIndexAddEdge(a.kind, child, parent);
  } catch { invalidateDefIndex(); }
};
export const deleteDef = (scope: ArtifactScope, id: string): boolean => deleteArtifact(DEF_ARTIFACT, scope, id);

// ── System (shipped defaults) store ──────────────────────────────────────────────────────────────────────
// The system scope is one encrypted blob of OUR shipped defaults (default screens/reports/rulesets/dashboards/…).
// It is READ-ONLY to users — not a StorageTarget, so the importer/editor never writes it. Only the product's own
// seeder populates it; renderers read it as the default layer beneath a customer's own defs.

/** A system def id: `system~<localId>`. Used only by the defaults seeder, never the user importer. */
export const makeSystemDefId = (localId: string): string => `system~${localId}`;

/** The shipped-default defs (read-only). */
export const listSystemDefs = (): StoredDef[] => listArtifacts<StoredDef>(DEF_ARTIFACT, SYSTEM_SCOPE);

/** Build (validate + stamp) one shipped-default row WITHOUT writing — the row for the read-only system store.
 *  Throws {@link DefError} on an invalid payload. */
export function buildSystemDefRow(kind: DefKind, name: string, payload: unknown, now: string): StoredDef {
  const check = validateDef(kind, payload);
  if (!check.ok) throw new DefError(`invalid system ${kind}: ${check.errors.join("; ")}`);
  const localId = typeof (payload as { id?: unknown })?.id === "string" ? String((payload as { id: string }).id) : cleanName(name) || "default";
  return {
    id: makeSystemDefId(localId), kind, name: cleanName(name) || localId, payload,
    createdBy: "system", createdAt: now, updatedAt: now, rowVersion: 1,
  };
}

/** Seed one shipped default into the read-only system store. PRIVILEGED — the product's own defaults installer,
 *  NOT reachable through the user importer (which only ever targets the customer scopes user/project/org). */
export function seedSystemDef(kind: DefKind, name: string, payload: unknown, now: string): StoredDef {
  const row = buildSystemDefRow(kind, name, payload, now);
  putArtifact(DEF_ARTIFACT, SYSTEM_SCOPE, row);
  return row;
}

/** Replace the ENTIRE system store in ONE sealed write (decrypt→replace→re-encrypt) — the one-shot update the
 *  shipped-defaults installer / the admin-gated approved-update route use. Never per-item. */
export function replaceSystemDefs(rows: StoredDef[]): void {
  replaceArtifacts(DEF_ARTIFACT, SYSTEM_SCOPE, rows);
  invalidateDefIndex(); // shipped-default edges changed → rebuild the child index on next use
}
