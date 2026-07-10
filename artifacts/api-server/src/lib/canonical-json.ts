/**
 * The one canonical-JSON serializer. Deterministic output with object keys sorted recursively, so a
 * value hashes/MACs identically regardless of the order its properties happen to be built in.
 *
 * This is security-critical and MUST stay reproducible: snapshot content hashes (SHA-256), the
 * provenance HMAC chain and the audit-chain MAC all serialise through it, and the same bytes must
 * come out on every replica and across restarts or those integrity checks break. It used to exist
 * as two independently-maintained copies (snapshot's `canonicalJson` and provenance's `canonical`);
 * they were byte-identical but nothing enforced that, so a well-meaning tweak to one could silently
 * diverge the other's hashes. Consolidating removes that drift risk — see canonical-json.test.ts,
 * which pins the exact output shape.
 *
 * Semantics (kept identical to both former copies):
 *  - object keys are sorted; nested objects/arrays are canonicalised recursively;
 *  - `undefined` object properties are dropped (as `JSON.stringify` does);
 *  - everything else (strings, numbers, booleans, null) is encoded by `JSON.stringify`, so string
 *    escaping and number formatting match standard JSON.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
