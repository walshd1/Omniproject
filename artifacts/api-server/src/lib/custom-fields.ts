import { CANONICAL_FIELD_KEYS, type EnumeratedField } from "./field-registry";
import type { FieldRoute } from "./field-routing";
import { isForbiddenKey } from "./safe-json";
import { isSafePattern } from "./safe-regex";
import { BUILTIN_BROKER, SIDECAR_BACKEND } from "./field-target";

/**
 * Admin-defined CUSTOM FIELDS — extend the reference superset when a field an org needs isn't in the
 * catalogue. Definitions live in settings (sealed at rest via config-store → the encrypted JSON).
 *
 * THE SOURCE RULE (the thing that keeps a custom field from being a dangling label): a custom field
 * MUST be MAPPED in the routing matrix — its key is a `uiElement` routed to a vendor·broker·sourceField.
 * If the org has no external system that carries the field, they route it to the Postgres backend (the
 * `sql` sidecar vendor below the seam, a backend like any other): its Row/JSON store holds arbitrary
 * fields, so the "schema" simply grows to carry it. Either way it's a routing entry — there is no
 * special "built-in backend" bypass. A custom field with no route is rejected (you can't add a field
 * with no data source). Enforced in `updateSettings` (a bad PUT is a 400, nothing persists).
 */

export const CUSTOM_FIELD_TYPES = ["string", "number", "boolean", "date"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomField {
  /** The field key — must be new (not shadow a canonical superset field). */
  key: string;
  /** The default display label (org nomenclature renaming stays in the Labels panel). */
  label: string;
  type: CustomFieldType;
}

export class CustomFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomFieldError";
  }
}

/** The richer types a custom-field DEF may take (the superset vocabulary — a superset field can hold any of
 *  these). Broader than the legacy settings `CustomField` set. */
export const CUSTOM_FIELD_DEF_TYPES = ["string", "text", "number", "date", "enum", "boolean", "currency", "percent", "duration"] as const;

/**
 * A custom field authored through the IMPORTER into org/programme JSON (roadmap §4.6) — the org's own extension
 * of the superset. It carries the same data constraints a backend advertises (so a linked UI field inherits
 * them) plus its HOME: which broker + backend it lives in, defaulting to the built-in broker + sidecar (the org
 * adds a field to the sidecar and advertises it through the broker). The DEFINITION lives in the superset (org
 * JSON); the DATA lives at the home. This is distinct from the sidecar, which is only ever a storage home.
 */
export interface CustomFieldDef {
  key: string;
  label: string;
  type: string;
  maxLength?: number;
  precision?: number;
  options?: string[];
  pattern?: string;
  nullable?: boolean;
  /** The home this custom field's data lives in — defaults to the built-in broker + sidecar backend. */
  broker?: string;
  backend?: string;
  /** The native field id at the home (defaults to the key). */
  sourceField?: string;
}

const safeId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && !isForbiddenKey(v);

/**
 * Validate + normalise a custom-field def payload (the `customField` importer choke point). The key must be new
 * (not shadow a canonical superset field) and safe; the type must be a superset type; constraints are shape-
 * checked (a `pattern` must be a SAFE regex). Throws {@link CustomFieldError}.
 */
export function validateCustomFieldDef(payload: unknown): CustomFieldDef {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CustomFieldError("a custom field must be a JSON object");
  const r = payload as Record<string, unknown>;
  const key = str(r["key"]);
  const label = str(r["label"]);
  const type = str(r["type"]);
  if (!KEY_RE.test(key)) throw new CustomFieldError(`custom field key "${key}" is invalid (letters, digits, _ and . only)`);
  if (CANONICAL_FIELD_KEYS.has(key)) throw new CustomFieldError(`"${key}" is already a superset field — custom fields must be NEW`);
  if (!label) throw new CustomFieldError(`custom field "${key}" needs a label`);
  if (!(CUSTOM_FIELD_DEF_TYPES as readonly string[]).includes(type)) throw new CustomFieldError(`custom field "${key}" has an invalid type`);
  const out: CustomFieldDef = { key, label, type };
  if (typeof r["maxLength"] === "number") out.maxLength = r["maxLength"];
  if (typeof r["precision"] === "number") out.precision = r["precision"];
  if (Array.isArray(r["options"])) out.options = r["options"].filter((o): o is string => typeof o === "string");
  if (typeof r["pattern"] === "string" && r["pattern"]) {
    if (!isSafePattern(r["pattern"])) throw new CustomFieldError(`custom field "${key}" has an unsafe pattern`);
    out.pattern = r["pattern"];
  }
  if (typeof r["nullable"] === "boolean") out.nullable = r["nullable"];
  if (r["broker"] !== undefined) { if (!safeId(r["broker"])) throw new CustomFieldError("broker must be a safe id"); out.broker = str(r["broker"]); }
  if (r["backend"] !== undefined) { if (!safeId(r["backend"])) throw new CustomFieldError("backend must be a safe id"); out.backend = str(r["backend"]); }
  if (r["sourceField"] !== undefined) { if (!safeId(r["sourceField"])) throw new CustomFieldError("sourceField must be a safe id"); out.sourceField = str(r["sourceField"]); }
  return out;
}

/** A custom-field def as an {@link EnumeratedField} for the live superset, tagged with the broker hop that
 *  fronts its home (defaults to the built-in broker over the sidecar). */
export function customFieldToEnumerated(cf: CustomFieldDef): { broker: string; system: string; field: EnumeratedField } {
  const backend = cf.backend || SIDECAR_BACKEND;
  const field: EnumeratedField = { key: cf.key, label: cf.label, type: cf.type, surface: true, store: true, sourceSystem: backend, sourceField: cf.sourceField || cf.key };
  if (cf.maxLength !== undefined) field.maxLength = cf.maxLength;
  if (cf.precision !== undefined) field.precision = cf.precision;
  if (cf.options !== undefined) field.options = cf.options;
  if (cf.pattern !== undefined) field.pattern = cf.pattern;
  if (cf.nullable !== undefined) field.nullable = cf.nullable;
  return { broker: cf.broker || BUILTIN_BROKER, system: backend, field };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
/** A key an admin may safely coin: letters/digits/_/. , not colliding with a canonical field. */
const KEY_RE = /^[A-Za-z][\w.]{0,63}$/;

/** Validate + normalise the custom-field definitions (shape only; the source rule is separate so it
 *  can be re-checked whenever EITHER customFields or the routing map changes). */
export function validateCustomFields(value: unknown): CustomField[] {
  if (!Array.isArray(value)) throw new CustomFieldError("customFields must be an array");
  const out: CustomField[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new CustomFieldError("each custom field must be an object");
    const r = raw as Record<string, unknown>;
    const key = str(r["key"]);
    const label = str(r["label"]);
    const type = str(r["type"]) as CustomFieldType;
    if (!KEY_RE.test(key)) throw new CustomFieldError(`custom field key "${key}" is invalid (letters, digits, _ and . only)`);
    if (CANONICAL_FIELD_KEYS.has(key)) throw new CustomFieldError(`"${key}" is already a superset field — custom fields must be NEW`);
    if (seen.has(key)) throw new CustomFieldError(`duplicate custom field key "${key}"`);
    if (!label) throw new CustomFieldError(`custom field "${key}" needs a label`);
    if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(type)) throw new CustomFieldError(`custom field "${key}" has an invalid type`);
    seen.add(key);
    out.push({ key, label, type });
  }
  return out;
}

/**
 * The SOURCE RULE: every custom field must be reachable — its key must be mapped to a real source in
 * the routing matrix (a fully-populated vendor·broker·sourceField route). Routing it to the Postgres
 * backend counts like any other backend. Throws `CustomFieldError` (→ 400) naming the first offender.
 */
export function validateCustomFieldSources(customFields: CustomField[], routing: FieldRoute[]): void {
  const routed = new Set(
    routing.filter((r) => r.uiElement && r.vendor && r.broker && r.sourceField).map((r) => r.uiElement),
  );
  for (const f of customFields) {
    if (!routed.has(f.key)) {
      throw new CustomFieldError(
        `custom field "${f.key}" has no data source — map it in the routing matrix (route it to the Postgres backend if it has no external source)`,
      );
    }
  }
}
