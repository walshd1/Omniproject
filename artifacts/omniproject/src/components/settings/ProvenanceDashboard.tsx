import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useProvenanceChain, shortMac, type ProvenanceEntry, type ProvenanceHop } from "../../lib/provenance";

/**
 * Admin broker-call provenance dashboard. Surfaces the keyed, hash-chained record of
 * every broker call: its live integrity verdict, and — per call — the hops and the
 * INITIATING SESSION each is cryptographically bound to (sessionMac), so an admin can
 * see which session drove a call, not just the actor's name. Read-only; admin-only.
 */
const HOP_STYLE: Record<ProvenanceHop, { label: string; cls: string }> = {
  invoke: { label: "invoke", cls: "text-sky-600" },
  result: { label: "result", cls: "text-emerald-600" },
  error: { label: "error", cls: "text-red-600" },
};

/** Group a flat oldest→newest entry list into per-call buckets, newest call first. */
function groupByCall(entries: ProvenanceEntry[]): { callId: string; hops: ProvenanceEntry[] }[] {
  const order: string[] = [];
  const byCall = new Map<string, ProvenanceEntry[]>();
  for (const e of entries) {
    if (!byCall.has(e.callId)) { byCall.set(e.callId, []); order.push(e.callId); }
    byCall.get(e.callId)!.push(e);
  }
  return order.map((callId) => ({ callId, hops: byCall.get(callId)! })).reverse();
}

function SessionBadge({ entry }: { entry: ProvenanceEntry }) {
  if (entry.sessionMac) {
    return (
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700" title={`session fingerprint ${entry.sessionMac}`}>
        session {shortMac(entry.sessionMac)}…
      </span>
    );
  }
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title="no session — system/unauthenticated call">system</span>;
}

export function ProvenanceDashboard() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useProvenanceChain();

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data) return null;

  const { entries, chain } = data;
  const calls = groupByCall(entries);
  const sessionBound = new Set(entries.filter((e) => e.sessionMac).map((e) => e.callId)).size;

  return (
    <Card data-testid="provenance-dashboard">
      <CardHeader>
        <CardTitle>Broker-call provenance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A keyed, hash-chained fingerprint of every broker call — content-free and
          tamper-evident. Each hop is bound to the initiating <strong>session</strong>
          (not just the actor name), so forging history needs both the provenance key and
          the broker master.
        </p>

        {/* Live integrity verdict. */}
        <div
          data-testid="chain-verdict"
          className={`rounded border p-2 text-sm ${chain.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
        >
          {chain.ok ? (
            <>Chain intact · {chain.length} entr{chain.length === 1 ? "y" : "ies"} · {sessionBound} of {calls.length} call{calls.length === 1 ? "" : "s"} session-bound</>
          ) : (
            <>Chain BROKEN at seq {chain.brokenAt} — {chain.reason}</>
          )}
          {chain.revokedKeyVersions?.length ? (
            <p className="mt-1 text-xs text-amber-700">
              ⚠ entries under revoked key version(s) {chain.revokedKeyVersions.join(", ")} — integrity checks, but a leaked key could have forged them (untrusted).
            </p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" data-testid="provenance-refresh" onClick={() => void qc.invalidateQueries({ queryKey: ["provenance-chain"] })}>
            Refresh
          </Button>
        </div>

        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No broker calls recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {calls.map(({ callId, hops }) => (
              <li key={callId} className="rounded border border-border p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{hops[0]?.action}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">call {callId.slice(0, 8)}</span>
                </div>
                <ul className="space-y-1">
                  {hops.map((e) => {
                    const hop = HOP_STYLE[e.hop];
                    return (
                      <li key={`${e.seq}`} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">#{e.seq}</span>
                        <span className={`font-medium ${hop.cls}`}>{hop.label}</span>
                        <span className="text-muted-foreground">{e.actor ?? "—"}</span>
                        <SessionBadge entry={e} />
                        <span className="ml-auto font-mono text-muted-foreground">+{e.elapsedMs}ms</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
