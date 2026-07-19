import type { PrimitiveDefShape } from "./primitive-schema";

/**
 * PRIMITIVE SAFETY — the extra guardrails a CUSTOMER-authored primitive must clear on top of the shape check
 * ({@link validatePrimitiveDef}). Shipped (vendor) primitives are trusted; an org-authored one is not, so before
 * it is activated it must also be BOUNDED (no pathological def that bloats the store or the composition graph)
 * and RENDER-SAFE (no injection vector in any text a renderer will surface).
 *
 * This is NOT an immutability check: an org MAY override or extend a system primitive — its def resolves only
 * within that org's scope (a scoped shadow), never mutating the canonical system primitive. Scope confinement
 * (the resolver folds system → org nearest-wins per caller) is what keeps an override safe; these checks keep
 * the def itself well-formed and injection-free.
 */

export const PRIMITIVE_LIMITS = {
  /** A primitive is a small building block — a huge param list is pathological. */
  maxParams: 32,
  maxLabel: 80,
  maxDescription: 600,
  /** Enum/items option lists. */
  maxOptions: 64,
  maxOption: 120,
} as const;

// Text a renderer surfaces (labels, descriptions, option strings) must never carry markup or a script/data URL.
// The renderer escapes at output anyway (the field-sanitisation invariant), but a customer-authored primitive is
// rejected outright if it embeds one — defence in depth, and it keeps the shipped-looking catalogue clean.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[<>]|javascript:|data:text\/html|[\u0000-\u001F]/i;

const textUnsafe = (s: unknown): boolean => typeof s === "string" && UNSAFE_TEXT.test(s);

/**
 * The safety violations for a CUSTOMER-authored primitive def (empty = safe to activate). Assumes the def has
 * already passed {@link validatePrimitiveDef} for shape; this adds the customer-only bounds + render-safety.
 */
export function primitiveSafetyErrors(def: PrimitiveDefShape): string[] {
  const errors: string[] = [];
  const label = def.label || def.id || "a primitive";

  if (textUnsafe(def.label)) errors.push(`"${label}" label contains an unsafe character or scheme`);
  if (textUnsafe(def.description)) errors.push(`"${label}" description contains an unsafe character or scheme`);
  if (typeof def.label === "string" && def.label.length > PRIMITIVE_LIMITS.maxLabel) errors.push(`"${label}" label is too long (max ${PRIMITIVE_LIMITS.maxLabel})`);
  if (typeof def.description === "string" && def.description.length > PRIMITIVE_LIMITS.maxDescription) errors.push(`"${label}" description is too long (max ${PRIMITIVE_LIMITS.maxDescription})`);

  const params = Array.isArray(def.params) ? def.params : [];
  if (params.length > PRIMITIVE_LIMITS.maxParams) errors.push(`"${label}" has too many params (max ${PRIMITIVE_LIMITS.maxParams})`);
  for (const p of params) {
    const pk = p?.key || "a param";
    if (textUnsafe(p?.label)) errors.push(`"${label}" param "${pk}" label is unsafe`);
    if (textUnsafe(p?.description)) errors.push(`"${label}" param "${pk}" description is unsafe`);
    if (typeof p?.label === "string" && p.label.length > PRIMITIVE_LIMITS.maxLabel) errors.push(`"${label}" param "${pk}" label is too long`);
    const options = Array.isArray((p as { options?: unknown }).options) ? (p as { options: unknown[] }).options : [];
    if (options.length > PRIMITIVE_LIMITS.maxOptions) errors.push(`"${label}" param "${pk}" has too many options (max ${PRIMITIVE_LIMITS.maxOptions})`);
    for (const o of options) {
      if (textUnsafe(o)) { errors.push(`"${label}" param "${pk}" has an unsafe option`); break; }
      if (typeof o === "string" && o.length > PRIMITIVE_LIMITS.maxOption) { errors.push(`"${label}" param "${pk}" has an over-long option`); break; }
    }
  }
  return errors;
}

/** Convenience: safe ⇔ no violations. */
export const isPrimitiveSafe = (def: PrimitiveDefShape): boolean => primitiveSafetyErrors(def).length === 0;
