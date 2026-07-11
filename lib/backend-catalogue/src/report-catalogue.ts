/**
 * REPORT registry — the report / visualisation types OmniProject can render. Same
 * principle: a neutral manifest (capabilities) separate from its tools (the
 * metrics / series it produces), linked.
 *
 * A report's `requiresCapability` links it to the BACKEND plane: a report only
 * lights up when the active backend declares the capability it needs (EVM needs
 * `financials`, burndown needs `history`). That keeps the planes separate but
 * linked — no neutering, no false promises.
 */
import { isCapabilityMet } from "./compatibility";
import { matchesMethodology } from "./methodology-match";
import { REPORTS_DATA } from "./reports.generated";
import type { DrillTo } from "./drill-to";

export type ReportKind = "schedule" | "progress" | "financial" | "resource" | "quality" | "portfolio";

export interface ReportCapabilities {
  /** The backend capability domain this report needs (or null = always available). */
  requiresCapability: string | null;
  /** Renders a time series (history)? */
  timeSeries: boolean;
  /** Export formats it supports. */
  exports: string[];
}

/**
 * How a report is realised. Every report is a JSON definition bound to a registered renderer, so the
 * only report logic left in code is the reusable renderer components + the no-code engine/editor:
 *  - engine "builtin" → a registered bespoke React component (named by `component`), OR a `surfacedVia`
 *    exception when the report is reached through another plane (e.g. a board view).
 *  - engine "custom"  → the generic no-code engine, driven entirely by `definition` (fully editable).
 */
export interface ReportRenderer {
  engine: "builtin" | "custom";
  /** For engine=builtin: the registered renderer component name. */
  component?: string;
  /** The report is surfaced through another plane, not a Reports-page card. */
  surfacedVia?: string;
  reason?: string;
  /** For engine=custom: the declarative pipeline (scope, groupBy, metrics, filter, viz). */
  definition?: Record<string, unknown>;
}

export interface ReportManifest {
  id: string;
  label: string;
  docsUrl: string;
  kind: ReportKind;
  capabilities: ReportCapabilities;
  notes?: string;
}

export interface ReportDefinition extends ReportManifest {
  /** The metrics / columns / series this report produces. */
  tools: string[];
  /** Methodology tags — "*"/omitted = neutral (all). */
  methodologies?: string[];
  /** Display order in the report picker. */
  order: number;
  /** How the report is realised (registered renderer or surfaced-via exception). */
  renderer: ReportRenderer;
  /** Auto-refresh interval in seconds when rendered as a library component (dashboard/content/export
   *  surfaces) — declarative polling instead of each renderer hardcoding its own. Omitted = no auto-refresh. */
  refresh?: number;
  /** Declarative drill-down: turns a clicked figure on this report into a navigation + predicate
   *  against the work-item grid (see drill-to.ts). Omitted = no drill-through. */
  drillTo?: DrillTo;
}

/** Every shipped report, in display order. Authored as JSON under
 *  assets/reports/<id>.json and embedded by gen-reports (drift-guarded in CI). */
export const REPORTS: ReportDefinition[] = [...REPORTS_DATA].sort((a, b) => a.order - b.order);

/** One report definition by id, or undefined. */
export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

/** All report definitions (a defensive copy). */
export function reportCatalogue(): ReportDefinition[] {
  return REPORTS.map((r) => ({ ...r }));
}

/**
 * The HARD capability rule: a report is AVAILABLE only if at least one connected
 * backend supports the capability it needs (or it needs none). `caps` is the
 * RESOLVED capability set — already the UNION across every connected backend — so
 * "none of the connected backends support it ⇒ it's not in this list, don't show
 * it." This is the single gate; surface only what it returns.
 */
export function availableReports(caps: Record<string, boolean>): ReportDefinition[] {
  return reportCatalogue().filter((r) => isCapabilityMet(r.capabilities.requiresCapability, caps));
}

/** Reports tagged with a methodology — those carrying its tag, plus the neutral
 *  ("*"/untagged) ones. The report-plane analogue of `viewsForMethodology`. */
export function reportsForMethodology(methodology: string): ReportDefinition[] {
  return REPORTS.filter((r) => matchesMethodology(r.methodologies, methodology));
}
