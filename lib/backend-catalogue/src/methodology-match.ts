/**
 * The single predicate behind `reportsForMethodology` / `screensForMethodology` /
 * `viewsForMethodology`: does an entry whose methodology tags are `tags` apply to methodology `id`?
 *
 * Neutral entries — untagged (`undefined`) or the `"*"` wildcard — apply to EVERY methodology;
 * otherwise the entry must explicitly carry `id`. The three catalogue copies had drifted (view's
 * lacked the `undefined` guard reports/screens carried, since its `methodologies` is a required
 * field while theirs is optional); this is the one place that rule now lives.
 *
 * NB the methodology-PACK filter (`taggedWith`) is deliberately NOT this — it wants only entries
 * explicitly tagged with `id`, treating neither `undefined` nor `"*"` as a match.
 */
export function matchesMethodology(tags: string[] | undefined, id: string): boolean {
  if (!tags || tags.includes("*")) return true;
  return tags.includes(id);
}
