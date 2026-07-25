import { useEffect, useRef, useState } from "react";
import {
  useListProjects,
  useGetPortfolioHealth,
  useGetCapabilities,
} from "@workspace/api-client-react";
import { ChartView } from "../charts/ChartView";
import { Camera, Download, Upload, Trash2 } from "lucide-react";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  loadSnapshots,
  addSnapshots,
  removeSnapshot,
  createSnapshot,
  exportSnapshots,
  parseSnapshotFile,
  buildTrend,
  TREND_METRICS,
  loadSchedule,
  saveSchedule,
  scheduleActive,
  captureDue,
  type AutoSchedule,
  type TrendMetric,
  type PortfolioSnapshot,
} from "../../lib/snapshots";
import { useToast } from "@/hooks/use-toast";

/**
 * Portfolio trends from point-in-time snapshots — captured in the browser
 * (volatile sessionStorage), exportable to disk for durable multi-month trends.
 * No broker call, no gateway state: OmniProject stays stateless. The data is
 * badged `captured` so it is never mistaken for backend-recorded history.
 */
export function PortfolioTrends() {
  const { data: projects } = useListProjects();
  const { data: portfolio } = useGetPortfolioHealth();
  const { data: caps } = useGetCapabilities();
  const { toast } = useToast();

  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>(() => loadSnapshots());
  const [metric, setMetric] = useState<TrendMetric>("completion");
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-capture schedule (volatile, in-tab only).
  const [schedule, setSchedule] = useState<AutoSchedule | null>(() => loadSchedule());
  const [intervalMin, setIntervalMin] = useState(30);
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const lastCaptureRef = useRef<number | null>(null);

  const metricMeta = TREND_METRICS.find((m) => m.key === metric)!;
  const trend = buildTrend(snapshots, metric);

  const doCapture = (overrideLabel?: string) => {
    const snap = createSnapshot({
      projects,
      portfolio,
      mode: caps?.mode,
      label: (overrideLabel ?? label).trim() || undefined,
    });
    setSnapshots((prev) => addSnapshots(prev, [snap]));
    return snap;
  };

  const capture = () => {
    const snap = doCapture();
    setLabel("");
    toast({ title: "SNAPSHOT CAPTURED", description: `${snap.projects.length} projects at ${new Date(snap.capturedAt).toLocaleTimeString()}` });
  };

  // Keep the freshest capture fn for the ticker (avoids stale-closure data).
  const captureRef = useRef(doCapture);
  captureRef.current = doCapture;

  const startSchedule = () => {
    const endsAt = endsAtLocal ? new Date(endsAtLocal) : null;
    if (intervalMin <= 0 || !endsAt || Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
      toast({ title: "INVALID SCHEDULE", description: "Set an interval and a future end time.", variant: "destructive" });
      return;
    }
    const s: AutoSchedule = { intervalMinutes: intervalMin, endsAt: endsAt.toISOString(), startedAt: new Date().toISOString() };
    lastCaptureRef.current = null; // capture immediately on the first tick
    saveSchedule(s);
    setSchedule(s);
  };

  const stopSchedule = () => {
    saveSchedule(null);
    setSchedule(null);
  };

  // The ticker: while a schedule is active, capture when due; auto-stop at the end.
  useEffect(() => {
    if (!schedule) return;
    const tickMs = Math.min(schedule.intervalMinutes * 60_000, 30_000);
    const tick = () => {
      const now = Date.now();
      if (!scheduleActive(schedule, now)) {
        stopSchedule();
        return;
      }
      if (captureDue(schedule, lastCaptureRef.current, now)) {
        captureRef.current(`auto · ${new Date(now).toLocaleTimeString()}`);
        lastCaptureRef.current = now;
      }
    };
    tick(); // fire once immediately so "capture now" is honoured at start
    const id = window.setInterval(tick, tickMs);
    return () => window.clearInterval(id);
  }, [schedule]);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const imported = parseSnapshotFile(text);
    if (imported.length === 0) {
      toast({ title: "IMPORT FAILED", description: "No valid snapshots in that file.", variant: "destructive" });
      return;
    }
    // Functional update (like capture()): addSnapshots also persists to sessionStorage, so merging
    // against the closed-over `snapshots` would drop any snapshot the auto-capture ticker added
    // concurrently — from both state AND storage.
    setSnapshots((prev) => addSnapshots(prev, imported));
    toast({ title: "SNAPSHOTS IMPORTED", description: `${imported.length} point(s) added.` });
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Portfolio Trends</h2>
          <ProvenanceBadge provenance="captured" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={metric} onValueChange={(v) => setMetric(v as TrendMetric)}>
            <SelectTrigger aria-label="Trend metric" className="w-auto rounded-none bg-background border-border px-3 py-2 text-xs font-bold uppercase gap-2" data-testid="trend-metric-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border font-bold uppercase">
              {TREND_METRICS.map((m) => (
                <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card border border-border p-4 space-y-4">
        {/* Capture controls */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional label (e.g. Sprint 12 close)"
            aria-label="Snapshot label"
            className="flex-1 min-w-[12rem] px-3 py-2 text-xs bg-background border border-border outline-none focus:border-primary font-mono"
          />
          <button
            type="button"
            onClick={capture}
            className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="capture-snapshot"
          >
            <Camera className="w-4 h-4" /> Capture now
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <Upload className="w-4 h-4" /> Import
          </button>
          <button
            type="button"
            onClick={() => exportSnapshots(snapshots)}
            disabled={snapshots.length === 0}
            className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-black uppercase tracking-widest hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <Download className="w-4 h-4" /> Export all
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {/* Auto-capture schedule (volatile — runs only while this tab is open). */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3" data-testid="auto-capture">
          <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Auto-capture</span>
          {schedule ? (
            <>
              <span className="text-xs font-mono text-blue-500" data-testid="auto-status">
                Every {schedule.intervalMinutes} min until {new Date(schedule.endsAt).toLocaleString()}
              </span>
              <button
                type="button"
                onClick={stopSchedule}
                data-testid="auto-toggle"
                className="inline-flex items-center gap-2 border border-red-500/50 text-red-500 px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Stop
              </button>
            </>
          ) : (
            <>
              <label className="text-xs text-muted-foreground">
                every
                <input
                  type="number"
                  min={1}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                  aria-label="Auto-capture interval in minutes"
                  className="mx-1 w-16 px-2 py-1 bg-background border border-border outline-none focus:border-primary font-mono text-xs"
                />
                min until
              </label>
              <input
                type="datetime-local"
                value={endsAtLocal}
                onChange={(e) => setEndsAtLocal(e.target.value)}
                aria-label="Auto-capture end date and time"
                className="px-2 py-1 bg-background border border-border outline-none focus:border-primary font-mono text-xs"
              />
              <button
                type="button"
                onClick={startSchedule}
                data-testid="auto-toggle"
                className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Start
              </button>
            </>
          )}
        </div>

        {/* Trend chart */}
        {trend.length >= 2 ? (
          <div className="h-56" data-testid="trend-chart">
            <ChartView
              type="line"
              height="100%"
              legend={false}
              xKey="date"
              data={trend.map((t) => ({ date: t.date, value: t.value }))}
              palette={["#3b82f6"]}
              valueFormatter={(v) => `${v}${metricMeta.unit}`}
              series={[{ key: "value", label: metricMeta.label }]}
            />
          </div>
        ) : (
          <div className="h-56 flex items-center justify-center text-center text-sm text-muted-foreground" data-testid="trend-empty">
            Capture at least two snapshots (or import a saved set) to see a {metricMeta.label.toLowerCase()} trend over time.
          </div>
        )}

        {/* Snapshot list */}
        {snapshots.length > 0 && (
          <ul className="divide-y divide-border border-t border-border" aria-label="Captured snapshots">
            {snapshots.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-xs font-mono">
                <span className="truncate">
                  <span className="font-bold">{s.label || new Date(s.capturedAt).toLocaleString()}</span>
                  <span className="text-muted-foreground"> · {s.projects.length} projects{s.mode === "demo" ? " · sample" : ""}</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => exportSnapshots([s])}
                    aria-label={`Export snapshot ${s.label || s.capturedAt}`}
                    title="Export this snapshot"
                    className="p-1 text-muted-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnapshots(removeSnapshot(snapshots, s.id))}
                    aria-label={`Delete snapshot ${s.label || s.capturedAt}`}
                    title="Delete this snapshot"
                    className="p-1 text-muted-foreground hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground">
          Snapshots (manual or auto) are held in this browser session only and auto-capture runs only while this tab is open
          — OmniProject stores nothing on the server. Use <strong>Export</strong> to keep them across sessions; for unattended
          overnight cadence, use the broker snapshot-historian.
        </p>
      </div>
    </section>
  );
}
