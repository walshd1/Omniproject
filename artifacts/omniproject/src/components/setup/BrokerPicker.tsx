import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Waypoints } from "lucide-react";
import { fetchBrokers } from "../../lib/setup";
import { Dot, PickerGrid, TechDetails } from "./shared";

/**
 * "What's running your automation?" — n8n ships as the reference broker (pre-selected
 * by default since that's what nearly everyone runs), but the platform is broker-agnostic:
 * anything implementing the same contract works underneath. Purely informational — picking
 * a tile here doesn't change anything; the connection address below is what actually wires
 * things up. It just shows the right guidance for whichever one you're actually running.
 */
export function BrokerPicker() {
  const { data: brokers = [] } = useQuery({ queryKey: ["setup-brokers"], queryFn: fetchBrokers, staleTime: 60_000 });
  const [brokerId, setBrokerId] = useState("n8n");
  const selected = brokers.find((b) => b.id === brokerId);

  if (brokers.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
        What's running your automation?
      </p>
      <PickerGrid
        items={brokers}
        getKey={(b) => b.id}
        isSelected={(b) => b.id === brokerId}
        onSelect={(b) => setBrokerId(b.id)}
        ariaLabel="Pick your automation broker"
        renderTile={(b) => (
          <>
            <div className="font-black uppercase tracking-wider flex items-center gap-1.5">
              <Waypoints className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {b.label}
              {b.id === "n8n" && <span className="text-primary" title="The shipped reference broker">•</span>}
            </div>
            <div className="text-muted-foreground mt-1">{b.hosted ? "vendor-hosted" : "self-hosted"}</div>
          </>
        )}
      />
      {selected && (
        <TechDetails label={`Technical details for ${selected.label}`}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.selfHostable} /> self-hostable</span>
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.managedAuth} /> managed auth</span>
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.eventsOutbound} /> can push events out</span>
          </div>
          {selected.notes && <p className="text-muted-foreground">{selected.notes}</p>}
          <a href={selected.docsUrl} target="_blank" rel="noreferrer" className="text-muted-foreground underline block">
            {selected.label} docs ↗
          </a>
        </TechDetails>
      )}
    </div>
  );
}
