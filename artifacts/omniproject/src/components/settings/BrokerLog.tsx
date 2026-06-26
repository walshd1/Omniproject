import { useEffect, useRef, useState } from "react";
import { useGetBrokerLog, getGetBrokerLogQueryKey, type BrokerLogEntry } from "@workspace/api-client-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { toCsv, downloadText, type FieldSpec } from "../../lib/data-lineage";
import { Button } from "@/components/ui/button";

const COLS: FieldSpec[] = [
  { key: "ts", label: "ts" }, { key: "action", label: "action" }, { key: "result", label: "result" },
  { key: "status", label: "status" }, { key: "ms", label: "ms" }, { key: "actor", label: "actor" },
  { key: "projectId", label: "projectId" }, { key: "note", label: "note" },
];

/**
 * Admin-only live broker log — tails the gateway → broker → backend traffic in
 * session (initial snapshot + an SSE stream), highlights failures, and exports.
 * Hidden for non-admins; the gateway also enforces the admin gate.
 */
export function BrokerLog() {
  const { data: auth } = useAuth();
  const isAdmin = roleAtLeast(auth?.role, "admin");
  const { data: initial } = useGetBrokerLog({ query: { enabled: isAdmin, queryKey: getGetBrokerLogQueryKey() } });
  const [live, setLive] = useState<BrokerLogEntry[]>([]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!isAdmin || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/admin/broker-log/stream", { withCredentials: true });
    es.addEventListener("entry", (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as BrokerLogEntry;
        setLive((l) => [...l.slice(-499), entry]);
      } catch { /* ignore a malformed frame */ }
    });
    esRef.current = es;
    return () => es.close();
  }, [isAdmin]);

  if (!isAdmin) return null;

  const all = [...(initial ?? []), ...live];
  const errorCount = all.filter((e) => e.result === "error").length;
  const visible = (errorsOnly ? all.filter((e) => e.result === "error") : all).slice().reverse(); // newest first

  const exportCsv = () => downloadText("broker-log.csv", "text/csv", toCsv(all as unknown as Record<string, unknown>[], COLS));
  const exportJson = () => downloadText("broker-log.json", "application/json", JSON.stringify(all, null, 2));

  return (
    <section data-testid="broker-log" className="border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest">
            Broker log
            <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-widest text-amber-500 border border-amber-500/40 px-1.5 py-0.5">admin · live</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Live gateway → broker → backend traffic ({all.length} recent ·{" "}
            <span className={errorCount > 0 ? "text-red-500 font-bold" : ""} data-testid="broker-log-errors">{errorCount} failed</span>).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} aria-label="Only failures" className="accent-primary" />
            Only failures
          </label>
          <Button type="button" variant="outline" onClick={exportCsv} className="rounded-none border-border uppercase font-bold tracking-wider text-xs h-9">CSV</Button>
          <Button type="button" variant="outline" onClick={exportJson} className="rounded-none border-border uppercase font-bold tracking-wider text-xs h-9">JSON</Button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Time</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Result</th>
              <th className="px-3 py-2 text-right">Status</th><th className="px-3 py-2 text-right">ms</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No brokered actions yet — traffic appears here live.</td></tr>
            )}
            {visible.map((e, i) => (
              <tr key={`${e.ts}-${i}`} className={`border-b border-border ${e.result === "error" ? "bg-red-500/5" : ""}`} data-testid={`broker-log-row-${e.result}`}>
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{new Date(e.ts).toLocaleTimeString()}</td>
                <td className="px-3 py-1.5 font-semibold">{e.action}</td>
                <td className={`px-3 py-1.5 font-bold uppercase ${e.result === "error" ? "text-red-500" : "text-green-500"}`}>{e.result}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{e.status || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{e.ms}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{e.actor ?? "—"}</td>
                <td className="px-3 py-1.5 text-red-500/80 truncate max-w-xs" title={e.note ?? ""}>{e.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
