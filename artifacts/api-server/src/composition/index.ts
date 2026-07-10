/**
 * Composition tier — the stateless, role-aware brain between the broker (north seam) and the store
 * adapters (south seam). Read = combine fragments; write = scatter a patch to each field's single owner.
 * It holds nothing. See docs/COMPOSITION-TIER.md.
 */
export * from "./types";
export { resolveOwnership } from "./ownership";
export { combine, isPartial } from "./combine";
export { scatter } from "./scatter";
export { Compositor } from "./compositor";
