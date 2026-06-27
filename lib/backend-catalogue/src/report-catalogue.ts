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
import { REPORTS_DATA } from "./reports.generated";

export type ReportKind = "schedule" | "progress" | "financial" | "resource" | "quality" | "portfolio";

export interface ReportCapabilities {
  /** The backend capability domain this report needs (or null = always available). */
  requiresCapability: string | null;
  /** Renders a time series (history)? */
  timeSeries: boolean;
  /** Export formats it supports. */
  exports: string[];
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
  return REPORTS.filter((r) => !r.methodologies || r.methodologies.includes("*") || r.methodologies.includes(methodology));
}
