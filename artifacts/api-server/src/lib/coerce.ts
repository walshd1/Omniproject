/**
 * Shared input-coercion guards for untrusted values (request bodies, external JSON, config maps). ONE
 * validated implementation of each, instead of the same `typeof x === "string"` guard hand-rolled at
 * 18+ sites. Pure and policy-free — each caller still owns its own shape/schema on top of these; this
 * only removes the copy-pasted primitive. New code should reuse these rather than re-inline the check.
 */

/** Narrow to a string. */
export const isStr = (v: unknown): v is string => typeof v === "string";

/** Narrow to a finite number (rejects NaN/Infinity). */
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Keep only the string members of an array (empty array for a non-array). */
export const stringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

/**
 * Strip control characters and cap length on a free-text value before storage, so authored text can
 * never carry a control-char payload or blow a limit. Keeps tab (9) and — by default — newline (10);
 * drops other C0 controls (<32), DEL (127) and C1 controls (128–159). `opts.newlines: false` also drops
 * newline (single-line fields like names); `opts.trim: true` trims the capped result. The ONE
 * implementation behind the per-feature `cleanText`/`cleanName` sanitizers.
 */
export function sanitizeText(value: unknown, max: number, opts?: { newlines?: boolean; trim?: boolean }): string {
  if (typeof value !== "string") return "";
  const allowNewline = opts?.newlines ?? true;
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    const printable = c === 9 || (allowNewline && c === 10) || (c >= 32 && c !== 127 && !(c >= 128 && c <= 159));
    if (printable) out += ch;
    if (out.length >= max) break;
  }
  const capped = out.slice(0, max);
  return opts?.trim ? capped.trim() : capped;
}
