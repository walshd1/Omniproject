import type { BuiltinArtifactDef } from "../../definitions/builtin-defs";
import type { ChartViewSpec } from "../charts/ChartView";
import { ChartView } from "../charts/ChartView";
import { CustomReport } from "../reports/CustomReport";
import { parseReportDef } from "../../lib/custom-report-file";
import type { Row } from "../../lib/custom-report";

/**
 * ArtifactRenderer — draws a JSON artifact definition through the engines already defined, so a shipped
 * (or dropped-in) artifact def renders with no bespoke code:
 *   - kind "chart"  → the common ChartView renderer (the spec is a self-contained ChartViewSpec);
 *   - kind "report" → the no-code report engine (CustomReport), over the rows the surface supplies;
 *   - kind "view"   → rendered by its entity view surface (needs a descriptor + records), not here.
 * A malformed spec degrades to an inline note rather than throwing, so one bad drop-in can't break a page.
 */
export function ArtifactRenderer({ def, rows = [] }: { def: BuiltinArtifactDef; rows?: readonly Row[] }) {
  if (def.kind === "chart") {
    return <ChartView {...(def.spec as unknown as ChartViewSpec)} />;
  }

  if (def.kind === "report") {
    let reportDef;
    try {
      reportDef = parseReportDef({ ...def.spec, id: def.id, label: def.label });
    } catch {
      return <p className="text-xs text-red-500" data-testid={`artifact-error-${def.id}`}>“{def.label}” has an invalid report definition.</p>;
    }
    return <CustomReport def={reportDef} rows={rows} />;
  }

  return <p className="text-xs text-muted-foreground" data-testid={`artifact-view-${def.id}`}>“{def.label}” renders in its entity view.</p>;
}
