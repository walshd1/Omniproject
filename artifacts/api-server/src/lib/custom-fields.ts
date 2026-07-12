import { CANONICAL_FIELD_KEYS } from "./field-registry";
import type { FieldRoute } from "./field-routing";

/**
 * Admin-defined CUSTOM FIELDS — extend the reference superset when a field an org needs isn't in the
 * catalogue. Definitions live in settings (sealed at rest via config-store → the encrypted JSON).
 *
 * THE SOURCE RULE (the thing that keeps a custom field from being a dangling label): a custom field
 * MUST have somewhere to get its value —
 *   · it is MAPPED in the routing matrix (its key is a `uiElement` → a vendor·broker·sourceField), OR
 *   · it falls to the BUILT-IN backend (BUILTIN_BROKER), whose Row/JSON store holds arbitrary fields,
 *     so the "schema" simply grows to carry it.
 * A custom field that is neither mapped nor built-in-backed is rejected — you can't add a field with
 * no data source. Enforced in `updateSettings` (a bad PUT is a 400, nothing persists).
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
 * The SOURCE RULE: every custom field must be reachable — mapped in the routing matrix, or held by the
 * built-in backend. Throws `CustomFieldError` (→ 400) naming the first offender.
 */
export function validateCustomFieldSources(customFields: CustomField[], routing: FieldRoute[], builtinActive: boolean): void {
  const routed = new Set(routing.map((r) => r.uiElement));
  for (const f of customFields) {
    if (!routed.has(f.key) && !builtinActive) {
      throw new CustomFieldError(
        `custom field "${f.key}" has no data source — map it in the routing matrix, or enable the built-in backend (BUILTIN_BROKER) to store it`,
      );
    }
  }
}
