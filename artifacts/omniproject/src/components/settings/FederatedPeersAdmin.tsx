import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useFederatedPeers, useSaveFederatedPeers, type FederatedPeerDraft } from "../../lib/federated-peers";

/**
 * Federated-peer registry (backlog #135) — the other OmniProject instances (typically one per
 * region/subsidiary under data residency) this deployment fans out to for the Federated Portfolio
 * report. Each peer is a base URL + a bearer token that must already be one of THAT peer's own
 * API_TOKENS (read-only API-token auth — no new cross-instance auth scheme). Config only, never
 * project data — same trust class as an outbound webhook target. Admin-gated, mirroring the server.
 */
export function FederatedPeersAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useFederatedPeers();
  const save = useSaveFederatedPeers();
  const [draft, setDraft] = useState<FederatedPeerDraft[] | null>(null);

  useEffect(() => {
    if (server) setDraft(server.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, region: p.region, active: p.active, token: p.tokenSet ? "********" : "" })));
  }, [server]);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!draft) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(
    (server ?? []).map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, region: p.region, active: p.active, token: p.tokenSet ? "********" : "" })),
  );

  const patch = (i: number, p: FederatedPeerDraft) => setDraft(draft.map((x, j) => (j === i ? p : x)));

  function addPeer() {
    setDraft([...draft!, { id: crypto.randomUUID(), label: `Peer ${draft!.length + 1}`, baseUrl: "", token: "", region: "", active: true }]);
  }
  function removePeer(i: number) {
    setDraft(draft!.filter((_, j) => j !== i));
  }

  return (
    <section className="space-y-4" data-testid="federated-peers-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Federated peers</h2>
        <p className="text-xs text-muted-foreground">
          Other OmniProject instances (e.g. one per region under data residency) this deployment queries for the
          Federated Portfolio report. Only a pre-aggregated summary ever crosses the boundary — never raw project
          data. The token must be one of the PEER's own API_TOKENS (its read-only API-token auth).
        </p>
      </div>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="federated-peers-empty">No federated peers yet — add one.</p>
      )}

      {draft.map((p, i) => (
        <div key={p.id} className="border-2 border-foreground p-3 space-y-2" data-testid={`federated-peer-edit-${i}`}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={p.active} onChange={(e) => patch(i, { ...p, active: e.target.checked })} aria-label={`Peer ${i + 1} active`} />
              Active
            </label>
            <Input aria-label={`Peer ${i + 1} label`} placeholder="Label (e.g. EU)" className="flex-1 min-w-32 rounded-none border-2 border-foreground"
              value={p.label} onChange={(e) => patch(i, { ...p, label: e.target.value })} />
            <Input aria-label={`Peer ${i + 1} region`} placeholder="Region (e.g. eu)" className="w-32 rounded-none border-2 border-foreground"
              value={p.region ?? ""} onChange={(e) => patch(i, { ...p, region: e.target.value || null })} />
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => removePeer(i)}>Remove</Button>
          </div>
          <Input aria-label={`Peer ${i + 1} base URL`} placeholder="https://eu.omniproject.example" className="rounded-none border-2 border-foreground"
            value={p.baseUrl} onChange={(e) => patch(i, { ...p, baseUrl: e.target.value })} />
          <Input aria-label={`Peer ${i + 1} token`} placeholder="Bearer token (one of the peer's API_TOKENS)" type="password" className="rounded-none border-2 border-foreground"
            value={p.token} onChange={(e) => patch(i, { ...p, token: e.target.value })} />
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={addPeer}>+ peer</Button>
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save federated peers"}
        </Button>
        {dirty && (
          <Button variant="ghost" className="rounded-none text-xs" onClick={() => server && setDraft(server.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, region: p.region, active: p.active, token: p.tokenSet ? "********" : "" })))}>
            Reset
          </Button>
        )}
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
