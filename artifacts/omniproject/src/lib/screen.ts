/**
 * Screen + panel model — the data shape behind the generic ScreenRenderer.
 *
 * A SCREEN is a layout of PANELS; a panel is a leaf widget with a `kind`. Screens,
 * views and reports are all "a screen of panels" rendered through one renderer, so
 * each widget kind is written once (components/screen/registry). Panels are
 * individually selectable; a methodology is a preset that activates the panels
 * sharing its tag ("*" = always) — per-context or set throughout, never a locked
 * mode. Capability gating hides a panel whose backend domain isn't available.
 */

export type PanelKind = "metric" | "text" | "table" | "list" | "view" | "board" | "chart" | "timeline" | "register" | "graph" | "map" | "component" | "widget" | "form";

export interface Panel {
  id: string;
  kind: PanelKind;
  title?: string;
  /** Methodology tags — a methodology preset activates panels sharing a tag ("*" = always). */
  methodologies?: string[];
  /** Backend capability domain this panel needs (or omitted = always available). */
  needs?: string;
  /** Grid columns to span (1–12; defaults to full width). */
  span?: number;
  /** Panel-kind-specific configuration (data + display). */
  config?: Record<string, unknown>;
  /**
   * Optional per-panel data binding. When set, this panel fetches its OWN data from
   * `source.url` under its own query key, so it loads, revalidates and REFRESHES
   * INDEPENDENTLY of every other panel on the screen — "refresh just this graph".
   * The fetched object is merged into `config`. Omit it for a static panel whose
   * data is inlined in `config`.
   */
  source?: PanelSource;
}

export interface PanelSource {
  /** The read endpoint for this panel's data (returns a config-shaped object). */
  url: string;
  /** Opt in to LIVE refresh: revalidate this panel (only) when a notification
   *  arrives over the shared event stream. Off ⇒ refresh on demand / staleTime. */
  live?: boolean;
  /** Restrict live refresh to these notification kinds (omitted ⇒ any change). */
  liveOn?: string[];
}

export interface ScreenDef {
  id: string;
  label: string;
  /** Methodology tags for the screen as a whole. */
  methodologies?: string[];
  requiresRole?: "viewer" | "contributor" | "manager" | "admin";
  panels: Panel[];
  /** The customer's saved arrangement (drag order / spans / hidden), FOLDED INTO the def (roadmap X.10):
   *  a saved layout rides on the screen def artifact in the def store rather than a separate `screenLayouts`
   *  settings map. Applied at render by `applyLayout`; absent for a def that ships no customised arrangement. */
  layout?: ScreenLayout;
}

/** A saved arrangement for one screen (drag-customised, persisted to config JSON). */
export interface ScreenLayout {
  /** Panel ids in display order; panels not listed keep their order, appended after. */
  order?: string[];
  /** Per-panel grid span override (1–12). */
  spans?: Record<string, number>;
  /** Panel ids hidden from this screen. */
  hidden?: string[];
}

/**
 * Apply a saved layout to a screen: hide, re-span, then reorder its panels. Pure —
 * returns a new ScreenDef; an absent layout returns the screen unchanged. Unknown
 * panel ids in the layout are ignored, and panels missing from `order` keep their
 * original relative order after the listed ones (so a new panel never disappears).
 */
export function applyLayout(screen: ScreenDef, layout?: ScreenLayout | null): ScreenDef {
  if (!layout) return screen;
  let panels = screen.panels;
  if (layout.hidden?.length) {
    const hide = new Set(layout.hidden);
    panels = panels.filter((p) => !hide.has(p.id));
  }
  if (layout.spans) {
    const spans = layout.spans;
    panels = panels.map((p) => {
      const span = spans[p.id];
      return typeof span === "number" ? { ...p, span } : p;
    });
  }
  if (layout.order?.length) {
    const rank = new Map(layout.order.map((id, i) => [id, i]));
    panels = panels
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (rank.get(a.p.id) ?? Infinity) - (rank.get(b.p.id) ?? Infinity) || a.i - b.i)
      .map(({ p }) => p);
  }
  return { ...screen, panels };
}

/** The panel order after a drag that moves `dragId` to just before `targetId`. */
export function reorderPanels(ids: string[], dragId: string, targetId: string): string[] {
  if (dragId === targetId) return ids;
  const without = ids.filter((id) => id !== dragId);
  const at = without.indexOf(targetId);
  if (at < 0) return ids;
  return [...without.slice(0, at), dragId, ...without.slice(at)];
}

/**
 * Panels that apply to a methodology — those tagged with it, the neutral ("*")
 * ones, and untagged panels (which are methodology-neutral). Drives the "set
 * throughout" preset; à-la-carte selection toggles panels directly instead.
 */
export function panelsForMethodology(panels: Panel[], methodology: string): Panel[] {
  return panels.filter(
    (p) => !p.methodologies || p.methodologies.length === 0 || p.methodologies.includes("*") || p.methodologies.includes(methodology),
  );
}

/**
 * Panels visible given the active backend capabilities. A panel needing a domain
 * the backend can't feed is hidden — the hard "don't show what no backend
 * supports" rule. With no caps known, nothing is hidden.
 */
export function visiblePanels(panels: Panel[], caps?: Record<string, boolean>): Panel[] {
  return panels.filter((p) => !p.needs || !caps || caps[p.needs] !== false);
}
