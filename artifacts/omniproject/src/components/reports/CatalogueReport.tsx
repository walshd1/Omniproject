import { useReports, findReport } from "../../lib/reports-store";
import { resolveReportRenderer } from "./report-renderers";
import { ReportEmpty } from "./ReportEmpty";

/**
 * Render a report by its catalogue id — the one place a page turns a report DEFINITION into a component. It
 * reads the per-deployment report store, resolves the definition's registered renderer, and renders it. No
 * page imports a report component directly; a page names a report id and this resolves the renderer, so a
 * report added/edited as data (a store definition bound to a registered renderer) surfaces with no page
 * change. A `surfacedVia` / custom / unknown definition has no Reports-card renderer → renders nothing.
 */
export function CatalogueReport({ id, projectId }: { id: string; projectId?: string }) {
  const reports = useReports();
  const def = findReport(reports, id);
  if (!def) return <ReportEmpty testId={`${id}-unknown`}>Unknown report “{id}”.</ReportEmpty>;
  const Renderer = resolveReportRenderer(def);
  if (!Renderer) return null; // surfaced elsewhere (board view) / custom-engine / no registered renderer
  return <Renderer projectId={projectId ?? ""} />;
}
