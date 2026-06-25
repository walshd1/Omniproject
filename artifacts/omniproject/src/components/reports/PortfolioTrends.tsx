import { useRef, useState } from "react";
import {
  useListProjects,
  useGetPortfolioHealth,
  useGetCapabilities,
} from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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

  const metricMeta = TREND_METRICS.find((m) => m.key === metric)!;
  const trend = buildTrend(snapshots, metric);

  const capture = () => {
    const snap = createSnapshot({
      projects,
      portfolio,
      mode: caps?.mode,
      label: label.trim() || undefined,
    });
    setSnapshots(addSnapshots(snapshots, [snap]));
    setLabel("");
    toast({ title: "SNAPSHOT CAPTURED", description: `${snap.projects.length} projects at ${new Date(snap.capturedAt).toLocaleTimeString()}` });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const imported = parseSnapshotFile(text);
    if (imported.length === 0) {
      toast({ title: "IMPORT FAILED", description: "No valid snapshots in that file.", variant: "destructive" });
      return;
    }
    setSnapshots(addSnapshots(snapshots, imported));
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

        {/* Trend chart */}
        {trend.length >= 2 ? (
          <div className="h-56" data-testid="trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                <XAxis dataKey="date" stroke="currentColor" className="text-muted-foreground" fontSize={10} />
                <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} unit={metricMeta.unit} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} name={metricMeta.label} dot />
              </LineChart>
            </ResponsiveContainer>
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
          Snapshots are held in this browser session only (cleared when the tab closes). Use <strong>Export</strong> to keep
          them across sessions — OmniProject stores nothing on the server.
        </p>
      </div>
    </section>
  );
}
