import { useState } from "react";
import { Link } from "wouter";
import { useGetCapabilities } from "@workspace/api-client-react";
import { History, Lock } from "lucide-react";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { loadSnapshots, portfolioCompletion } from "../../lib/snapshots";

/**
 * Time-travel surface. LOCKED unless the operator opted into the logging-server
 * egress (capabilities.timeTravel). When locked, it points the user to Settings.
 * When unlocked, increment 1 scrubs the LOCAL captured snapshots (back across
 * your own points); dense `replayed` history from the logging server and a
 * `projected` forward segment arrive with the replay broker action (increment 2).
 */
export function TimeTravel() {
  const { data: caps } = useGetCapabilities();
  const enabled = caps?.timeTravel === true;
  const snaps = loadSnapshots();
  const [idx, setIdx] = useState(0);

  if (!enabled) {
    return (
      <section data-testid="time-travel-locked">
        <div className="flex items-center gap-3 mb-4">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Time-Travel</h2>
          <span className="text-[10px] font-bold uppercase tracking-widest border border-border text-muted-foreground px-1.5 py-0.5">Locked</span>
        </div>
        <div className="bg-card border border-dashed border-border p-6 text-sm text-muted-foreground">
          Time-travel is locked. It needs durable history, which OmniProject doesn't keep — enable the{" "}
          <Link href="/settings" className="text-primary underline">logging server</Link> (opt-in egress to a store you own)
          to retain history and unlock scrubbing back and forward in time.
        </div>
      </section>
    );
  }

  const selected = snaps.length ? snaps[Math.min(idx, snaps.length - 1)] : null;

  return (
    <section data-testid="time-travel">
      <div className="flex items-center gap-3 mb-4">
        <History className="w-4 h-4 text-blue-500" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Time-Travel</h2>
        <ProvenanceBadge provenance="captured" />
      </div>

      <div className="bg-card border border-border p-4 space-y-3">
        {snaps.length < 1 ? (
          <p className="text-sm text-muted-foreground" data-testid="time-travel-empty">
            Enabled — but no points to scrub yet. Capture snapshots, or dense server replay (next increment) will populate
            history from your logging server.
          </p>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={snaps.length - 1}
              value={Math.min(idx, snaps.length - 1)}
              onChange={(e) => setIdx(Number(e.target.value))}
              aria-label="Scrub through captured points in time"
              className="w-full"
              data-testid="time-travel-scrubber"
            />
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">
                {selected ? new Date(selected.capturedAt).toLocaleString() : ""}
                {selected?.label ? ` · ${selected.label}` : ""}
              </span>
              <span className="font-bold">{selected ? portfolioCompletion(selected) : 0}% complete</span>
            </div>
          </>
        )}
        <p className="text-[11px] text-muted-foreground">
          Reading point-in-time state. Dense <strong>replayed</strong> history and a <strong>projected</strong> forward view
          come from your logging server — OmniProject stays a stateless lens over it.
        </p>
      </div>
    </section>
  );
}
