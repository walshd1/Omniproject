/**
 * History retention — the durable time-series layer behind tracking + trend analysis. The gateway
 * holds nothing; a retention source (the self-host DB, below the seam) owns the journal + snapshots.
 * Pure engine (journal → snapshot → trend) + an injectable source seam. See docs/HISTORY-RETENTION.md.
 */
export * from "./types";
export * from "./journal";
export * from "./snapshot";
export * from "./cadence";
export * from "./trends";
export * from "./retention";
