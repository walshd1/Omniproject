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
}

const CSV_PDF = ["csv", "pdf", "png"];

export const REPORTS: ReportDefinition[] = [
  { id: "gantt", label: "Gantt chart", docsUrl: "", kind: "schedule", capabilities: { requiresCapability: "scheduling", timeSeries: false, exports: CSV_PDF }, tools: ["startDate", "dueDate", "dependencies", "criticalPath", "baseline"], notes: "Schedule with dependencies + critical path." },
  { id: "burndown", label: "Sprint burndown", docsUrl: "", kind: "progress", capabilities: { requiresCapability: "history", timeSeries: true, exports: CSV_PDF }, tools: ["remainingWork", "idealLine", "scopeChange"], notes: "Remaining work vs the ideal line over a sprint." },
  { id: "burnup", label: "Burnup", docsUrl: "", kind: "progress", capabilities: { requiresCapability: "history", timeSeries: true, exports: CSV_PDF }, tools: ["completed", "scope"], notes: "Completed vs total scope (shows scope creep)." },
  { id: "cumulative-flow", label: "Cumulative flow", docsUrl: "", kind: "progress", capabilities: { requiresCapability: "history", timeSeries: true, exports: CSV_PDF }, tools: ["wipByState", "throughput", "cycleTime"], notes: "WIP per state over time (Kanban)." },
  { id: "velocity", label: "Velocity", docsUrl: "", kind: "progress", capabilities: { requiresCapability: "history", timeSeries: true, exports: CSV_PDF }, tools: ["pointsPerSprint", "rollingAverage"], notes: "Story points completed per sprint." },
  { id: "evm", label: "Earned Value (EVM)", docsUrl: "", kind: "financial", capabilities: { requiresCapability: "financials", timeSeries: true, exports: CSV_PDF }, tools: ["PV", "EV", "AC", "CPI", "SPI", "EAC", "ETC", "BAC"], notes: "Cost/schedule performance — needs financials + baseline." },
  { id: "financial-summary", label: "Financial summary", docsUrl: "", kind: "financial", capabilities: { requiresCapability: "financials", timeSeries: false, exports: CSV_PDF }, tools: ["budget", "actualCost", "committed", "variance", "margin"], notes: "Budget vs actual vs committed." },
  { id: "resource-histogram", label: "Resource histogram", docsUrl: "", kind: "resource", capabilities: { requiresCapability: "resources", timeSeries: true, exports: CSV_PDF }, tools: ["allocated", "available", "overAllocation"], notes: "Allocation vs capacity per resource." },
  { id: "portfolio-rag", label: "Portfolio RAG", docsUrl: "", kind: "portfolio", capabilities: { requiresCapability: "portfolio", timeSeries: false, exports: CSV_PDF }, tools: ["ragStatus", "scheduleVariance", "costVariance", "health"], notes: "Red/amber/green health across the portfolio." },
  { id: "raid-register", label: "RAID register", docsUrl: "", kind: "quality", capabilities: { requiresCapability: "raid", timeSeries: false, exports: CSV_PDF }, tools: ["risks", "assumptions", "issues", "dependencies"], notes: "Risks, assumptions, issues, dependencies." },
];

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function reportCatalogue(): ReportDefinition[] {
  return REPORTS.map((r) => ({ ...r }));
}
