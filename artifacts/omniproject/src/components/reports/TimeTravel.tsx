import { useState } from "react";
import { Link } from "wouter";
import {
  useGetCapabilities,
  useReplayHistory,
  getReplayHistoryQueryKey,
  type HistoryState,
} from "@workspace/api-client-react";
import { History, Lock } from "lucide-react";
import { ProvenanceBadge, type Provenance } from "../ProvenanceBadge";
import { loadSnapshots, portfolioCompletion } from "../../lib/snapshots";

/**
 * Time-travel surface. LOCKED unless the operator opted into the logging-server
 * egress (capabilities.timeTravel). When unlocked it scrubs RECORDED states
 * replayed from the logging server (via GET /history/replay); if the server has
 * no points yet it falls back to scrubbing the local captured snapshots. Each
 * point keeps its own provenance (`replayed` real history, `sample` demo) so it
 * is never mistaken for live fact.
 */
export function TimeTravel() {
  const { data: caps } = useGetCapabilities();
  const enabled = caps?.timeTravel === true;
  const { data: replay } = useReplayHistory(undefined, {
    query: { enabled, queryKey: getReplayHistoryQueryKey(undefined) },
  });
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

  // Prefer real replayed states from the logging server; else fall back to local captures.
  const serverPoints = (replay ?? []).map((s: HistoryState) => ({
    at: s.at,
    completion: Math.round(s.completionPct),
    provenance: s.provenance as Provenance,
  }));
  const localPoints = loadSnapshots().map((s) => ({
    at: s.capturedAt,
    completion: portfolioCompletion(s),
    provenance: "captured" as Provenance,
  }));
  const points = serverPoints.length ? serverPoints : localPoints;
  const selected = points.length ? points[Math.min(idx, points.length - 1)] : null;

  return (
    <section data-testid="time-travel">
      <div className="flex items-center gap-3 mb-4">
        <History className="w-4 h-4 text-blue-500" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Time-Travel</h2>
        {selected && <ProvenanceBadge provenance={selected.provenance} />}
      </div>

      <div className="bg-card border border-border p-4 space-y-3">
        {points.length < 1 ? (
          <p className="text-sm text-muted-foreground" data-testid="time-travel-empty">
            Enabled — but no recorded points yet. The logging server's history will populate here once it has captured state;
            meanwhile you can capture snapshots above to scrub locally.
          </p>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={Math.min(idx, points.length - 1)}
              onChange={(e) => setIdx(Number(e.target.value))}
              aria-label="Scrub through points in time"
              className="w-full"
              data-testid="time-travel-scrubber"
            />
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">{selected ? new Date(selected.at).toLocaleString() : ""}</span>
              <span className="font-bold">{selected ? selected.completion : 0}% complete</span>
            </div>
          </>
        )}
        <p className="text-[11px] text-muted-foreground">
          Reading point-in-time state from your logging server — OmniProject stays a stateless lens over it. A
          <strong> projected</strong> forward view comes from the what-if engine.
        </p>
      </div>
    </section>
  );
}
