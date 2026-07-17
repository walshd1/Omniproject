import { v, ValidationError } from "./validate";
import { FIELD_REGISTRY } from "./field-registry";
import { assertSafePattern, patternMatches, isSafePattern, UnsafeRegexError } from "./safe-regex";

/**
 * Per-field DATA VALIDATION RULES — the admin-declared constraints a field's value must satisfy.
 *
 * A rule is attached to a field (a canonical UI element key or a custom field key) and layered on top
 * of the field's TYPE. It reuses the gateway's existing validator combinators (`lib/validate` — the
 * same typed machinery used at the request boundary) rather than inventing a new language:
 *   · numeric fields  — `min`/`max` are VALUE bounds,
 *   · text fields     — `min`/`max` are LENGTH bounds; `pattern` is a regex the value must match
 *                       (compiled through the shared `lib/safe-regex`, never a bare `new RegExp`),
 *   · date fields     — `after`/`before` are DATE bounds ("between X and Y" via real date comparison,
 *                       NOT a hand-rolled regex),
 *   · any field       — `options` is an allowed set and `required` rejects an empty value.
 *
 * The rule DEFINITIONS are validated at the authoring boundary (`validateFieldValidation`, → a settings
 * 400 on a bad shape / uncompilable pattern) and persist in settings, sealed at rest. Enforcing a rule
 * against an actual value is the pure `checkFieldValue` / `checkFieldValues` evaluator, wired in wherever
 * a value is written (today: the projects create/update path, for the fields that flow through it).
 */

export interface FieldValidationRule {
  /** The field this constrains — a canonical field key or a custom field key. */
  field: string;
  /** Reject an empty value (undefined / null / ""). */
  required?: boolean;
  /** Numeric field: value ≥ min. Text field: length ≥ min. */
  min?: number;
  /** Numeric field: value ≤ max. Text field: length ≤ max. */
  max?: number;
  /** Text field: the value must match this regular expression (source string). */
  pattern?: string;
  /** Date field: the value must be on or after this date (ISO). */
  after?: string;
  /** Date field: the value must be on or before this date (ISO). */
  before?: string;
  /** The value must be one of these (compared as a string). */
  options?: string[];
}

export class FieldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldValidationError";
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** How a field's TYPE maps to the family of checks that apply: value bounds (number), date bounds
 *  (date), or length/pattern (everything else, treated as text). */
const NUMERIC_TYPES = new Set(["number", "currency", "percent", "duration"]);
export type FieldKind = "number" | "date" | "string";
export function fieldKind(type: string): FieldKind {
  if (NUMERIC_TYPES.has(type)) return "number";
  if (type === "date") return "date";
  return "string";
}

const CANONICAL_TYPE = new Map(FIELD_REGISTRY.map((f) => [f.key, f.type as string]));
/** Resolve a field's type: canonical catalogue first, then a custom-field definition, else "string". */
export function resolveFieldType(field: string, customFields: ReadonlyArray<{ key: string; type: string }> = []): string {
  return CANONICAL_TYPE.get(field) ?? customFields.find((c) => c.key === field)?.type ?? "string";
}

/**
 * Validate + normalise the rule DEFINITIONS (shape only — not values). Throws `FieldValidationError`
 * (→ 400) on a bad shape, a duplicate field, min > max, or a pattern that isn't a valid regex. Drops
 * absent/empty optional keys so the stored form is minimal.
 */
export function validateFieldValidation(value: unknown): FieldValidationRule[] {
  if (!Array.isArray(value)) throw new FieldValidationError("fieldValidation must be an array");
  const out: FieldValidationRule[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new FieldValidationError("each validation rule must be an object");
    const r = raw as Record<string, unknown>;
    const field = str(r["field"]);
    if (!field) throw new FieldValidationError("each validation rule needs a field");
    if (seen.has(field)) throw new FieldValidationError(`duplicate validation rule for "${field}"`);
    seen.add(field);

    const rule: FieldValidationRule = { field };

    if (r["required"] !== undefined && r["required"] !== null) {
      if (typeof r["required"] !== "boolean") throw new FieldValidationError(`"${field}": required must be a boolean`);
      if (r["required"]) rule.required = true;
    }

    for (const bound of ["min", "max"] as const) {
      const b = r[bound];
      if (b !== undefined && b !== null && b !== "") {
        const n = typeof b === "number" ? b : Number(b);
        if (!Number.isFinite(n)) throw new FieldValidationError(`"${field}": ${bound} must be a number`);
        rule[bound] = n;
      }
    }
    if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
      throw new FieldValidationError(`"${field}": min must be <= max`);
    }

    const pattern = str(r["pattern"]);
    if (pattern) {
      try {
        assertSafePattern(pattern); // shared guard: length cap + ReDoS shape + compilability
      } catch (e) {
        if (e instanceof UnsafeRegexError) throw new FieldValidationError(`"${field}": ${e.message}`);
        throw e;
      }
      rule.pattern = pattern;
    }

    for (const bound of ["after", "before"] as const) {
      const d = str(r[bound]);
      if (d) {
        if (!Number.isFinite(Date.parse(d))) throw new FieldValidationError(`"${field}": ${bound} must be a valid date`);
        rule[bound] = d;
      }
    }
    if (rule.after !== undefined && rule.before !== undefined && Date.parse(rule.after) > Date.parse(rule.before)) {
      throw new FieldValidationError(`"${field}": after must be on or before before`);
    }

    if (r["options"] !== undefined && r["options"] !== null) {
      if (!Array.isArray(r["options"])) throw new FieldValidationError(`"${field}": options must be an array`);
      const opts = [...new Set(r["options"].map((o) => str(o)).filter(Boolean))];
      if (opts.length) rule.options = opts;
    }

    out.push(rule);
  }
  return out;
}

/**
 * Enforce ONE rule against a value, given the field's type. Returns a human message on violation, or
 * null when the value is acceptable. An empty value is fine unless the rule is `required` (so an
 * optional field with no value never trips min/max/pattern).
 */
export function checkFieldValue(rule: FieldValidationRule, value: unknown, type: string): string | null {
  const empty = value === undefined || value === null || value === "";
  if (rule.required && empty) return `${rule.field} is required`;
  if (empty) return null;

  try {
    const kind = fieldKind(type);
    if (kind === "number") {
      const opts: { min?: number; max?: number } = {};
      if (rule.min !== undefined) opts.min = rule.min;
      if (rule.max !== undefined) opts.max = rule.max;
      v.number(opts)(value, rule.field);
    } else if (kind === "date") {
      const opts: { after?: string; before?: string } = {};
      if (rule.after !== undefined) opts.after = rule.after;
      if (rule.before !== undefined) opts.before = rule.before;
      v.date(opts)(value, rule.field);
    } else {
      const opts: { min?: number; max?: number } = {};
      if (rule.min !== undefined) opts.min = rule.min;
      if (rule.max !== undefined) opts.max = rule.max;
      v.string(opts)(value, rule.field); // length bounds
      // Pattern match runs through the shared RE2 engine (linear-time), not a native RegExp.
      if (rule.pattern && !patternMatches(rule.pattern, String(value))) {
        return `${rule.field} has an invalid format`;
      }
    }
  } catch (e) {
    if (e instanceof ValidationError) return e.issues.join("; ");
    throw e;
  }

  if (rule.options && rule.options.length && !rule.options.includes(String(value))) {
    return `${rule.field} must be one of: ${rule.options.join(", ")}`;
  }
  return null;
}

/**
 * Derive a {@link FieldValidationRule} for a UI element from the CONSTRAINTS its home advertises (roadmap §4.6):
 * a linked UI field inherits the backend field's own validation. `maxLength` → a text `max` (length), `options`
 * → the allowed set, `nullable === false` → `required`. `field` is the UI element key the value arrives under.
 * (Precision is display formatting, not a value bound, so it isn't a rule.)
 */
export function deriveValidationRule(
  field: string,
  c: { type: string; maxLength?: number; options?: string[]; pattern?: string; nullable?: boolean },
): FieldValidationRule {
  const rule: FieldValidationRule = { field };
  if (c.nullable === false) rule.required = true;
  if (fieldKind(c.type) === "string" && typeof c.maxLength === "number") rule.max = c.maxLength;
  if (c.options && c.options.length) rule.options = [...c.options];
  // A backend-advertised regex (postcode/email/date). Only adopt it if it's SAFE — a hostile broker can't
  // smuggle a ReDoS pattern into our enforcement path.
  if (c.pattern && isSafePattern(c.pattern)) rule.pattern = c.pattern;
  return rule;
}

/**
 * Enforce a set of rules over a record, returning every violation message. A rule for a field that is
 * absent from the record is skipped UNLESS it is `required`. `typeOf` resolves a field's type (see
 * `resolveFieldType`).
 */
export function checkFieldValues(
  rules: readonly FieldValidationRule[],
  record: Record<string, unknown>,
  typeOf: (field: string) => string,
): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    const present = Object.prototype.hasOwnProperty.call(record, rule.field);
    if (!present && !rule.required) continue;
    const msg = checkFieldValue(rule, present ? record[rule.field] : undefined, typeOf(rule.field));
    if (msg) errors.push(msg);
  }
  return errors;
}
