/**
 * safeParseJson — native JSON.parse hardened against prototype pollution, for UNTRUSTED input (uploaded
 * files, imported config/definitions, operator-mounted config directories). The native parser is already
 * the fastest and most-audited JSON parser and can't execute code; the only real risk is that a payload
 * like `{"__proto__": {...}}` or `{"constructor": {"prototype": {...}}}` becomes dangerous when the parsed
 * object is later merged into another object (e.g. settings). The reviver strips those dangerous keys at
 * every depth, so the result is safe to merge. No dependency — just JSON.parse plus a guard.
 *
 * Throws (like JSON.parse) on invalid JSON; callers catch and surface a friendly error.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True when `key` is a prototype-pollution-dangerous property name. Use before assigning a
 *  caller-supplied string as an object KEY (`obj[key] = …`), where the JSON reviver doesn't help. */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

/** The stripping reviver itself — exported so it can also be handed straight to a JSON.parse-
 *  compatible option elsewhere (e.g. body-parser's `reviver` option for express.json()). */
export function stripDangerousKeys(key: string, value: unknown): unknown {
  return FORBIDDEN_KEYS.has(key) ? undefined : value;
}

export function safeParseJson<T = unknown>(text: string): T {
  return JSON.parse(text, stripDangerousKeys) as T;
}

/**
 * Return a deep copy of `value` with every prototype-pollution-dangerous OWN key removed at every depth.
 * Use for an ALREADY-PARSED value that did NOT come through {@link safeParseJson} — e.g. an object handed
 * to a settings write from a config-snapshot restore or an internal call, where the express.json reviver
 * never ran. Non-plain values (primitives, arrays' elements) pass through untouched; arrays are mapped.
 * Pure — never mutates the input.
 */
export function stripDangerousKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripDangerousKeysDeep(v)) as unknown as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k)) continue; // drop __proto__/constructor/prototype own keys at every depth
    out[k] = stripDangerousKeysDeep(v);
  }
  return out as unknown as T;
}
