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
import { listArtifacts, getArtifact, putArtifact, deleteArtifact, SYSTEM_SCOPE, type ArtifactScope } from "./artifact-store";
import { validateScreenDefs } from "./screen-def";
import { validateForms } from "./form-def";
import { validatePrimitiveDef } from "@workspace/backend-catalogue";

/** A user-definable JSON kind the importer accepts. */
export type DefKind = "primitive" | "screen" | "form" | "report" | "dashboard" | "businessRule" | "theme" | "font" | "jsonDef";
export const DEF_KINDS: readonly DefKind[] = ["primitive", "screen", "form", "report", "dashboard", "businessRule", "theme", "font", "jsonDef"];

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
    case "form": return fromThrowing(() => validateForms([payload])[0]);
    case "report": return structural(payload, ["id"]);
    case "dashboard": return validateDashboardDef(payload);
    case "businessRule": return structural(payload, ["id"]);
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
export const putDef = (scope: ArtifactScope, a: StoredDef): void => putArtifact(DEF_ARTIFACT, scope, a);
export const deleteDef = (scope: ArtifactScope, id: string): boolean => deleteArtifact(DEF_ARTIFACT, scope, id);

// ── System (shipped defaults) store ──────────────────────────────────────────────────────────────────────
// The system scope is one encrypted blob of OUR shipped defaults (default screens/reports/rulesets/dashboards/…).
// It is READ-ONLY to users — not a StorageTarget, so the importer/editor never writes it. Only the product's own
// seeder populates it; renderers read it as the default layer beneath a customer's own defs.

/** A system def id: `system~<localId>`. Used only by the defaults seeder, never the user importer. */
export const makeSystemDefId = (localId: string): string => `system~${localId}`;

/** The shipped-default defs (read-only). */
export const listSystemDefs = (): StoredDef[] => listArtifacts<StoredDef>(DEF_ARTIFACT, SYSTEM_SCOPE);

/** Seed one shipped default into the read-only system store. PRIVILEGED — the product's own defaults installer,
 *  NOT reachable through the user importer (which only ever targets the customer scopes user/project/org). */
export function seedSystemDef(kind: DefKind, name: string, payload: unknown, now: string): StoredDef {
  const check = validateDef(kind, payload);
  if (!check.ok) throw new DefError(`invalid system ${kind}: ${check.errors.join("; ")}`);
  const localId = typeof (payload as { id?: unknown })?.id === "string" ? String((payload as { id: string }).id) : cleanName(name) || "default";
  const row: StoredDef = {
    id: makeSystemDefId(localId), kind, name: cleanName(name) || localId, payload,
    createdBy: "system", createdAt: now, updatedAt: now, rowVersion: 1,
  };
  putArtifact(DEF_ARTIFACT, SYSTEM_SCOPE, row);
  return row;
}
