/**
 * Self-host DB adoption — the optional, gated feature that lets an operator with no existing PM tool
 * make OmniProject's own database a system-of-record (or an augmenting store) for a slice of the
 * work-item superset. It plugs into the composition tier as one more `StoreAdapter`; the gateway
 * still holds nothing. See docs/COMPOSITION-TIER.md and docs/SELF-HOST-DB.md.
 */
export * from "./domains";
export * from "./capability-gating";
export * from "./adapter";
export * from "./setup-wizard";
export * from "./runtime";
