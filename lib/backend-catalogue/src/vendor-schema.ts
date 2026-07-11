/**
 * Minimal, dependency-free JSON-Schema validator — the subset the vendor schemas
 * use (type, enum, required, properties, additionalProperties, items, pattern).
 *
 * Shared by the build-time generator (scripts/gen-vendors, which validates the
 * authored JSON before embedding it) and the runtime config-directory loader
 * (which validates a deployment's own vendor JSON at boot). One algorithm, two
 * callers — the validation a vendor file passes is identical in CI and at runtime.
 */

export type JsonSchema = Record<string, unknown>;

/** Validate a value against a schema; returns a list of human-readable error paths (empty = valid). */
export function validate(schema: JsonSchema, value: unknown, at = "$"): string[] {
  const errs: string[] = [];
  const type = schema["type"] as string | undefined;

  if (type && !typeMatches(type, value)) {
    errs.push(`${at}: expected ${type}, got ${jsTypeOf(value)}`);
    return errs; // type mismatch — deeper checks would be noise
  }
  if (schema["enum"] && !(schema["enum"] as unknown[]).includes(value)) {
    errs.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema["enum"])}`);
  }
  if (typeof value === "string" && schema["pattern"] && !new RegExp(schema["pattern"] as string).test(value)) {
    errs.push(`${at}: "${value}" does not match /${schema["pattern"]}/`);
  }

  if (type === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const props = (schema["properties"] as Record<string, JsonSchema>) ?? {};
    for (const req of (schema["required"] as string[]) ?? []) {
      // Object.hasOwn, not `in`: a required prop named "constructor"/"toString" must NOT be
      // satisfied by an inherited Object.prototype member on an untrusted `obj`.
      if (!Object.hasOwn(obj, req)) errs.push(`${at}: missing required property "${req}"`);
    }
    const additional = schema["additionalProperties"];
    for (const [k, v] of Object.entries(obj)) {
      // Object.hasOwn, not truthy index: a key named "constructor"/"toString" on `obj` must not
      // resolve to an inherited member of `props` and thereby bypass additionalProperties:false.
      if (Object.hasOwn(props, k)) errs.push(...validate(props[k] as JsonSchema, v, `${at}.${k}`));
      else if (additional === false) errs.push(`${at}: unexpected property "${k}"`);
      else if (additional && typeof additional === "object") errs.push(...validate(additional as JsonSchema, v, `${at}.${k}`));
    }
  }
  if (type === "array" && Array.isArray(value) && schema["items"]) {
    value.forEach((v, i) => errs.push(...validate(schema["items"] as JsonSchema, v, `${at}[${i}]`)));
  }
  return errs;
}

/** Does a value satisfy a JSON-Schema `type` keyword? */
export function typeMatches(type: string, v: unknown): boolean {
  switch (type) {
    case "object": return !!v && typeof v === "object" && !Array.isArray(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "number": return typeof v === "number";
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    default: return true;
  }
}

/** A readable JS type label for error messages. */
export function jsTypeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
