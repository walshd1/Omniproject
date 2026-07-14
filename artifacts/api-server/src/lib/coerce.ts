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
