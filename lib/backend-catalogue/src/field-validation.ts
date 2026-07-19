/**
 * FIELD VALIDATION + SANITISATION — the single policy engine every field instance runs through. The rule is
 * a security floor of the taxonomy: EVERY field that captures input (i.e. every field whose type is NOT a
 * display-only `label`) MUST have a sanitise policy AND a validation spec. A `label` field renders no control,
 * so it is exempt; anything the user can type/pick into is not.
 *
 * The guarantee is built in, not left to authors: {@link resolveFieldPolicy} returns SECURE DEFAULTS by type
 * (trim + HTML-escape for free text, an email/url/number/date shape check, an options allow-list for choices),
 * and an author's `validation`/`sanitise` overrides tighten — never remove — that floor. So a non-label field
 * ALWAYS sanitises and ALWAYS validates. `assertFieldHasPolicy` is the contract check the def validators call
 * to prove a field can never be instantiated without a policy.
 *
 * SANITISE vs ESCAPE — two different jobs:
 *   - STORAGE sanitisation ({@link sanitiseForStore}) NORMALISES a value for storage: strips control chars, trims,
 *     collapses whitespace, narrows a number, lower-cases an email. It is round-trip safe (re-editing a stored
 *     value never mangles it) and it NEVER escapes — legitimate characters like `<`/`>` are kept as typed.
 *   - OUTPUT escaping ({@link escapeForOutput}, the `escape-html` step) is applied at the RENDER/PARSE boundary.
 * The security invariant is UNESCAPED CHARACTERS ARE NEVER PARSED: a value is escaped at every point it would be
 * fed to a parser (HTML/SVG string building, etc.), so it can be stored raw-but-clean and stay editable. React
 * text nodes escape by default; non-React parse contexts must call {@link escapeForOutput} / {@link sanitiseValue}.
 *
 * Live typing: {@link sanitiseKeystroke} drops only never-valid characters per keystroke (control chars; a number
 * narrows to numerics); the whole string is storage-sanitised + validated on commit (Enter/blur).
 *
 * Shared by the backend field-primitive validator (import-time) and the SPA `FieldControl` (runtime), so the
 * same rules apply whether a field is checked on import or typed into live — one source, no drift.
 */

/** A single sanitisation step applied to a raw field value, in order. */
export type SanitiseStep =
  | "trim" // strip leading/trailing whitespace
  | "collapse-whitespace" // fold internal runs of whitespace to a single space
  | "strip-html" // remove any tags outright
  | "escape-html" // neutralise tags (&lt; &gt; &amp; &quot; &#39;)
  | "lowercase" // fold to lower-case (emails)
  | "numeric"; // keep only a valid number's characters

/** The ordered sanitise policy a field runs its value through before validating/emitting. */
export type SanitisePolicy = SanitiseStep[];

/** The declarative validation floor for a field value. Every bound is optional; a non-label field always has
 *  at least a sanitise policy, and usually one or more of these too. */
export interface FieldValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** A regex source the (sanitised) value must match. */
  pattern?: string;
  /** Human message when `pattern` fails. */
  patternMessage?: string;
  /** The allowed values for a choice field (the value, or each of a multi-value set, must be one of these). */
  options?: string[];
  /** A multi-value (comma-joined) choice field, so each member is checked against `options`. */
  multi?: boolean;
}

/** The resolved policy for one field: how to clean its value, and how to validate it. */
export interface FieldPolicy {
  sanitise: SanitisePolicy;
  validation: FieldValidation;
}

/** A field `type` that renders as display-only (no control) — the one exemption from the policy floor. */
export const LABEL_FIELD_TYPES = new Set(["label", "heading", "static", "display"]);
export const isLabelType = (type: string): boolean => LABEL_FIELD_TYPES.has(type);

const EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
const URL_PATTERN = "^https?://[^\\s]+$";
const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/** The default free-text length ceiling when an author doesn't set one (bounds an unbounded text write). */
export const DEFAULT_TEXT_MAXLENGTH = 500;
export const DEFAULT_TEXTAREA_MAXLENGTH = 4000;

/** Secure DEFAULT policy per field type — the floor every field of that type gets for free. Choice types get
 *  their allow-list from the instance's `options`; free text gets trim + HTML-escape + a length ceiling. */
function defaultPolicy(type: string, options: string[]): FieldPolicy {
  switch (type) {
    case "text":
      return { sanitise: ["trim", "escape-html"], validation: { maxLength: DEFAULT_TEXT_MAXLENGTH } };
    case "textarea":
    case "address":
      return { sanitise: ["trim", "escape-html"], validation: { maxLength: DEFAULT_TEXTAREA_MAXLENGTH } };
    case "email":
      return { sanitise: ["trim", "lowercase"], validation: { pattern: EMAIL_PATTERN, patternMessage: "must be a valid email address", maxLength: DEFAULT_TEXT_MAXLENGTH } };
    case "url":
      return { sanitise: ["trim"], validation: { pattern: URL_PATTERN, patternMessage: "must be a valid http(s) URL", maxLength: DEFAULT_TEXT_MAXLENGTH } };
    case "number":
      return { sanitise: ["trim", "numeric"], validation: {} };
    case "date":
      return { sanitise: ["trim"], validation: { pattern: DATE_PATTERN, patternMessage: "must be a date (YYYY-MM-DD)" } };
    // Single-choice families — the value must be one of the field's options.
    case "select":
    case "radio":
    case "single-choice":
      return { sanitise: ["trim"], validation: { options } };
    case "yesno":
    case "boolean":
    case "checkbox":
      return { sanitise: ["trim", "lowercase"], validation: { options: options.length ? options : ["on", "off"] } };
    // Multi-choice families — a comma-joined set, each member one of the options.
    case "multiselect":
    case "multi-choice":
      return { sanitise: ["trim"], validation: { options, multi: true } };
    case "likert":
      return { sanitise: ["trim"], validation: { options } };
    default:
      // Unknown-but-non-label input: still never leave it unsanitised.
      return { sanitise: ["trim", "escape-html"], validation: {} };
  }
}

/** Merge an author's overrides ONTO the type default — overrides tighten the floor (a longer maxLength than the
 *  default is allowed; the sanitise steps are the union so an author can add but not drop a step). */
export function resolveFieldPolicy(
  type: string,
  overrides?: { validation?: FieldValidation | undefined; sanitise?: SanitisePolicy | undefined; options?: unknown },
): FieldPolicy {
  if (isLabelType(type)) return { sanitise: [], validation: {} }; // display-only — the one exemption
  const options = Array.isArray(overrides?.options) ? (overrides!.options as unknown[]).map(String) : [];
  const base = defaultPolicy(type, options);
  const validation: FieldValidation = { ...base.validation, ...(overrides?.validation ?? {}) };
  // Author sanitise steps are ADDED to the secure default (union, default order first), never a replacement.
  const extra = (overrides?.sanitise ?? []).filter((s) => !base.sanitise.includes(s));
  return { sanitise: [...base.sanitise, ...extra], validation };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Escape a value for a PARSE/OUTPUT boundary (HTML/SVG string building) — the canonical enforcer of the
 *  "unescaped characters are never parsed" invariant. Apply this at any point a value is fed to a parser. */
export const escapeForOutput = escapeHtml;

/** The sanitise steps that NORMALISE for storage (round-trip safe, never escape). The rest (`escape-html`,
 *  `strip-html`) are OUTPUT-time transforms applied at a parse boundary, not baked into the stored value. */
const STORAGE_STEPS: ReadonlySet<SanitiseStep> = new Set(["trim", "collapse-whitespace", "lowercase", "numeric"]);

/** Control characters are never valid or safe in a field value — stripped from every keystroke. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * The PER-KEYSTROKE character filter — drops characters that can NEVER be valid for the field type, so the
 * in-progress value stays clean as it is typed (or pasted). It removes control characters always, and narrows a
 * number to numeric characters / an email/url to no-whitespace. It does NOT strip legitimate free-text
 * characters like `<`/`>` — those are kept so text stays natural to type; the security guarantee is that they
 * are ESCAPED (never stripped) before anything parses them: the invariant is UNESCAPED CHARS ARE NEVER PARSED,
 * enforced by the `escape-html` step in {@link sanitiseValue} on commit and by escaping at any render/output.
 */
export function sanitiseKeystroke(raw: string, type: string): string {
  const v = raw.replace(CONTROL_CHARS, "");
  if (isLabelType(type)) return v;
  switch (type) {
    case "number": return v.replace(/[^0-9.\-]/g, "");
    case "email":
    case "url": return v.replace(/\s/g, "");
    default: return v; // free text — legitimate characters kept; escaped (not stripped) before any parse
  }
}

/** Apply a sanitise policy to a raw string value, steps in order. Pure; safe on the client and the server. */
export function sanitiseValue(raw: string, policy: SanitisePolicy): string {
  let v = raw;
  for (const step of policy) {
    switch (step) {
      case "trim": v = v.trim(); break;
      case "collapse-whitespace": v = v.replace(/\s+/g, " "); break;
      case "strip-html": v = v.replace(/<[^>]*>/g, ""); break;
      case "escape-html": v = escapeHtml(v); break;
      case "lowercase": v = v.toLowerCase(); break;
      case "numeric": { const m = v.match(/-?\d*\.?\d+/); v = m ? m[0] : ""; break; }
    }
  }
  return v;
}

/** STORAGE sanitisation — apply only the normalising steps (never escaping), so the result is round-trip safe:
 *  the value stored/emitted stays editable and un-mangled. Escaping happens at output ({@link escapeForOutput}). */
export function sanitiseForStore(raw: string, policy: SanitisePolicy): string {
  return sanitiseValue(raw, policy.filter((s) => STORAGE_STEPS.has(s)));
}

/** Validate an already-sanitised value against its validation spec. Returns human-readable errors (empty = ok). */
export function validateValue(value: string, validation: FieldValidation, label = "This field"): string[] {
  const errors: string[] = [];
  const empty = value === "";
  if (validation.required && empty) errors.push(`${label} is required`);
  if (empty) return errors; // no further checks on an (allowed) empty value
  if (validation.minLength != null && value.length < validation.minLength) errors.push(`${label} must be at least ${validation.minLength} characters`);
  if (validation.maxLength != null && value.length > validation.maxLength) errors.push(`${label} must be at most ${validation.maxLength} characters`);
  if (validation.min != null || validation.max != null) {
    const n = Number(value);
    if (Number.isNaN(n)) errors.push(`${label} must be a number`);
    else {
      if (validation.min != null && n < validation.min) errors.push(`${label} must be at least ${validation.min}`);
      if (validation.max != null && n > validation.max) errors.push(`${label} must be at most ${validation.max}`);
    }
  }
  if (validation.pattern) {
    let re: RegExp | null = null;
    try { re = new RegExp(validation.pattern); } catch { re = null; }
    if (re && !re.test(value)) errors.push(`${label} ${validation.patternMessage ?? "is not in the expected format"}`);
  }
  if (validation.options && validation.options.length) {
    const allowed = new Set(validation.options);
    const members = validation.multi ? value.split(",").map((s) => s.trim()).filter(Boolean) : [value];
    for (const m of members) if (!allowed.has(m)) errors.push(`${label}: "${m}" is not an allowed option`);
  }
  return errors;
}

/** Sanitise THEN validate a raw value in one call — the runtime entry point. */
export function applyFieldPolicy(raw: string, policy: FieldPolicy, label?: string): { value: string; errors: string[] } {
  const value = sanitiseValue(raw, policy.sanitise);
  return { value, errors: validateValue(value, policy.validation, label) };
}

/**
 * The CONTRACT CHECK the def validators call: a non-label field MUST resolve to a non-empty sanitise policy.
 * Because {@link resolveFieldPolicy} guarantees that for every known input type, this only fails if a field
 * declared a label-exempt type it isn't, or (defensively) a type with no policy — i.e. it proves no input
 * field can be instantiated without sanitisation. Returns an error string, or null when the field is compliant.
 */
export function assertFieldHasPolicy(
  type: string,
  overrides?: { validation?: FieldValidation | undefined; sanitise?: SanitisePolicy | undefined; options?: unknown },
  label = "a field",
): string | null {
  if (isLabelType(type)) return null; // display-only fields are exempt
  const policy = resolveFieldPolicy(type, overrides);
  if (policy.sanitise.length === 0) return `"${label}" (type "${type}") must include sanitisation but resolves to none`;
  return null;
}
