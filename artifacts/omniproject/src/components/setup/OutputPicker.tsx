import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { fetchOutputs } from "../../lib/setup";
import { Dot, PickerGrid, TechDetails } from "./shared";

const OUTPUT_LABELS: Record<string, string> = {
  "read-api": "A structured read feed",
  "bi-feed": "A spreadsheet/BI feed",
  "agent-api": "A tool surface for AI agents",
  export: "A file you download",
  metrics: "A monitoring scrape",
  "events-out": "Events pushed out to you",
  "events-in": "Events pushed in to us",
  "batch-egress": "A scheduled data hand-off",
  calendar: "Published to your calendar",
};

const TRANSPORT_LABELS: Record<string, string> = {
  api: "REST API",
  mcp: "MCP server",
  "ical-feed": "iCal feed",
};

/**
 * Browse what OmniProject can already hand OTHER systems — BI tools, agents, exports,
 * monitoring. Purely informational: nothing here is a switch to flip, just what's
 * already available given how this instance is set up.
 */
export function OutputPicker() {
  const { data: outputs = [] } = useQuery({ queryKey: ["setup-outputs"], queryFn: fetchOutputs, staleTime: 60_000 });
  const [outputId, setOutputId] = useState("");
  const selected = outputs.find((o) => o.id === outputId);

  if (outputs.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        What can other systems get from OmniProject?
      </p>
      <PickerGrid
        items={outputs}
        getKey={(o) => o.id}
        isSelected={(o) => o.id === outputId}
        onSelect={(o) => setOutputId((id) => (id === o.id ? "" : o.id))}
        ariaLabel="Browse output interfaces"
        renderTile={(o) => (
          <>
            <div className="font-black uppercase tracking-wider flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {o.label}
            </div>
            <div className="text-muted-foreground mt-1">{OUTPUT_LABELS[o.kind] ?? o.kind}</div>
          </>
        )}
      />
      {selected && (
        <TechDetails label={`Technical details for ${selected.label}`}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.readOnly} /> read-only</span>
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.streaming} /> streaming/long-lived</span>
            <span className="text-muted-foreground">auth: <span className="font-mono">{selected.capabilities.auth}</span></span>
            {selected.transports && selected.transports.length > 0 && (
              <span className="text-muted-foreground">
                connect via: <span className="font-mono">{selected.transports.map((t) => TRANSPORT_LABELS[t] ?? t).join(" · ")}</span>
              </span>
            )}
          </div>
          {selected.notes && <p className="text-muted-foreground">{selected.notes}</p>}
          <p className="font-mono text-muted-foreground">{selected.route}</p>
        </TechDetails>
      )}
    </div>
  );
}
