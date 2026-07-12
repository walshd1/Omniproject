/**
 * Methodology composition — the model behind "turn artifacts / outputs / rulesets on and off, starting
 * from a methodology preset, and mix pieces of several". A PMO/admin picks what is visible; a preset is a
 * one-click starting point (all of Scrum, all of PRINCE2, …) that they then refine per item, so a house
 * style that is "some Scrum + some PRINCE2" is just a curated set.
 *
 * Pure + data-only (no React, no catalogue import) so it is unit-tested and reusable. The caller builds
 * the CompositionItem list from whatever catalogues it wants to expose (views, reports, screens, outputs,
 * rulesets), each carrying the methodology tags it already has.
 */
export type CompositionKind = "view" | "report" | "screen" | "output" | "ruleset";

export interface CompositionItem {
  id: string;
  kind: CompositionKind;
  label: string;
  /** Methodology ids this item belongs to. Empty or ["*"] = neutral: it belongs to every preset. */
  methodologies: string[];
}

export interface MethodologyPreset {
  methodology: string;
  label: string;
  /** The item ids this methodology's one-click preset turns on (its tagged items + the neutral ones). */
  itemIds: string[];
}

/**
 * The saved composition: an explicit set of enabled item ids, or `null` = uncurated (everything visible).
 * Null is the backwards-compatible default — nothing is hidden until a PMO curates.
 */
export type Composition = string[] | null;

/** Whether an item belongs to a methodology (its own tag, or neutral = belongs to all). */
export function itemInMethodology(item: CompositionItem, methodology: string): boolean {
  return item.methodologies.length === 0 || item.methodologies.includes("*") || item.methodologies.includes(methodology);
}

/** One preset per methodology present in the items, each turning on that methodology's items + the
 *  neutral ones. `labelFor` names the methodology for the button; falls back to the id. */
export function derivePresets(items: readonly CompositionItem[], labelFor: (id: string) => string | undefined = () => undefined): MethodologyPreset[] {
  const methodologies = new Set<string>();
  for (const it of items) for (const m of it.methodologies) if (m !== "*") methodologies.add(m);
  return [...methodologies].sort().map((m) => ({
    methodology: m,
    label: labelFor(m) ?? m,
    itemIds: items.filter((it) => itemInMethodology(it, m)).map((it) => it.id),
  }));
}

/** Materialise the current enabled set as concrete ids (uncurated ⇒ every item is on). */
function materialise(enabled: Composition, items: readonly CompositionItem[]): string[] {
  return enabled === null ? items.map((i) => i.id) : [...enabled];
}

/** Is an item visible under a composition? `null` = all visible. */
export function isEnabled(enabled: Composition, id: string): boolean {
  return enabled === null || enabled.includes(id);
}

/** Is a catalogue item (identified by its kind + raw id) visible under a composition? Builds the
 *  kind-namespaced id the composition stores (e.g. "report:evm") so surfaces can filter without knowing
 *  the id convention. `null` = all visible. */
export function isItemVisible(enabled: Composition, kind: CompositionKind, rawId: string): boolean {
  return isEnabled(enabled, `${kind}:${rawId}`);
}

/** The visible items under a composition. */
export function visibleItems(items: readonly CompositionItem[], enabled: Composition): CompositionItem[] {
  return enabled === null ? [...items] : items.filter((i) => enabled.includes(i.id));
}

/**
 * Apply a preset. From uncurated, this curates down to exactly the preset (one-click "just Scrum"); from
 * an already-curated set it unions the preset in, so clicking Scrum then PRINCE2 gives you both to trim.
 */
export function applyPreset(enabled: Composition, preset: MethodologyPreset): string[] {
  if (enabled === null) return [...new Set(preset.itemIds)];
  return [...new Set([...enabled, ...preset.itemIds])];
}

/** Remove a methodology's items from the enabled set (curating from uncurated first). Only items strictly
 *  tagged with the methodology are dropped — neutral items are universal, so they survive. */
export function removePreset(enabled: Composition, items: readonly CompositionItem[], preset: MethodologyPreset): string[] {
  const drop = new Set(items.filter((it) => it.methodologies.includes(preset.methodology)).map((it) => it.id));
  return materialise(enabled, items).filter((id) => !drop.has(id));
}

/** Toggle one item on/off (curating from uncurated first). */
export function toggleItem(enabled: Composition, items: readonly CompositionItem[], id: string): string[] {
  const set = new Set(materialise(enabled, items));
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}
