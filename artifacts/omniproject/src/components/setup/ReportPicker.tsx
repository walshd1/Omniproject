import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { fetchReports } from "../../lib/setup";
import { Dot, PickerGrid, TechDetails } from "./shared";

/**
 * Browse the reports this instance's governance allows. Read-only awareness, not a
 * governance editor — an admin who wants to actually require/forbid a report for a
 * team does that in Settings → Feature governance; this is just "what's on offer."
 */
export function ReportPicker() {
  const { data: reports = [] } = useQuery({ queryKey: ["setup-reports"], queryFn: fetchReports, staleTime: 60_000 });
  const [reportId, setReportId] = useState("");
  const selected = reports.find((r) => r.id === reportId);

  if (reports.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        Which reports are on offer?
      </p>
      <PickerGrid
        items={reports}
        getKey={(r) => r.id}
        isSelected={(r) => r.id === reportId}
        onSelect={(r) => setReportId((id) => (id === r.id ? "" : r.id))}
        ariaLabel="Browse reports"
        renderTile={(r) => (
          <>
            <div className="font-black uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {r.label}
            </div>
            <div className="text-muted-foreground mt-1">
              {r.capabilities.requiresCapability ? `needs ${r.capabilities.requiresCapability}` : "always available"}
            </div>
          </>
        )}
      />
      {selected && (
        <TechDetails label={`Technical details for ${selected.label}`}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.timeSeries} /> shows a trend over time</span>
            {selected.capabilities.exports.length > 0 && (
              <span className="text-muted-foreground">exports: <span className="font-mono">{selected.capabilities.exports.join(", ")}</span></span>
            )}
          </div>
          {selected.notes && <p className="text-muted-foreground">{selected.notes}</p>}
          <p className="text-muted-foreground">
            Want to require or hide this for a team? That's in Settings → Feature governance.
          </p>
        </TechDetails>
      )}
    </div>
  );
}
