/**
 * safeParseJson — native JSON.parse hardened against prototype pollution, for UNTRUSTED input (uploaded
 * files, imported config/definitions). The native parser is already the fastest and most-audited JSON
 * parser and can't execute code; the only real risk is that a payload like `{"__proto__": {...}}` or
 * `{"constructor": {"prototype": {...}}}` becomes dangerous when the parsed object is later merged into
 * another object (e.g. settings). The reviver strips those dangerous keys at every depth, so the result
 * is safe to merge. No dependency — just JSON.parse plus a guard.
 *
 * Throws (like JSON.parse) on invalid JSON; callers catch and surface a friendly error.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True when `key` is a prototype-pollution-dangerous property name. Use before assigning a
 *  caller/remote-supplied string as an object KEY (`obj[key] = …`), where the reviver doesn't help. */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

export function safeParseJson<T = unknown>(text: string): T {
  return JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value)) as T;
}
