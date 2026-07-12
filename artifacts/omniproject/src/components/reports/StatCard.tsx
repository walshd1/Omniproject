import { StatTile } from "../tiles/StatTile";

/** A small labelled stat card used across the report panels (pre-formatted value + optional hint).
 *  A thin adapter over the shared {@link StatTile} primitive — new code should use StatTile directly. */
export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <StatTile label={label} value={value} {...(hint ? { hint } : {})} />;
}
