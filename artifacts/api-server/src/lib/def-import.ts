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
import { listArtifacts, getArtifact, putArtifact, deleteArtifact, type ArtifactScope } from "./artifact-store";
import { validateScreenDefs } from "./screen-def";
import { validateForms } from "./form-def";
import { validatePrimitiveDef } from "@workspace/backend-catalogue";

/** A user-definable JSON kind the importer accepts. */
export type DefKind = "primitive" | "screen" | "form" | "report" | "dashboard" | "jsonDef";
export const DEF_KINDS: readonly DefKind[] = ["primitive", "screen", "form", "report", "dashboard", "jsonDef"];

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
    case "dashboard": return structural(payload, ["id"]);
    case "jsonDef": return structural(payload, []);
  }
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
