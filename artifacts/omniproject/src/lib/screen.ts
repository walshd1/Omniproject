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

export type PanelKind = "metric" | "text" | "table" | "list" | "view" | "board" | "chart" | "timeline" | "register" | "graph" | "map";

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
}

export interface ScreenDef {
  id: string;
  label: string;
  /** Methodology tags for the screen as a whole. */
  methodologies?: string[];
  requiresRole?: "viewer" | "contributor" | "manager" | "admin";
  panels: Panel[];
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
