import {
  useGetFederatedPortfolio,
  type PortfolioSummary,
  type PeerPortfolioResult,
  type FederatedPortfolioLocal,
} from "@workspace/api-client-react";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";

/**
 * Federated Portfolio (backlog #135) — the consolidated global view for a multinational running one
 * OmniProject instance per region/subsidiary (the shape per-country data residency, backlog #97,
 * pushes them toward). Fans out live to every configured peer (settings.federatedPeers) and merges
 * each peer's OWN pre-aggregated `PortfolioSummary` with this instance's — NEVER raw project/issue
 * records, and every contribution stays separately labeled by peer/region rather than being blended
 * into one number, so a reader always knows which region contributed what. An unreachable/
 * misconfigured peer renders as "unavailable", not a fatal error for the whole view. Stateless:
 * nothing is cached beyond the peer config itself — every render re-fans-out. See
 * docs/DATA-RESIDENCY.md for exactly what does/doesn't cross an instance boundary.
 */

const STATUS_LABEL: Record<PeerPortfolioResult["status"], string> = {
  ok: "Online",
  unreachable: "Unreachable",
  unauthorized: "Unauthorized",
  error: "Error",
};

const STATUS_DOT: Record<PeerPortfolioResult["status"], string> = {
  ok: "bg-green-500",
  unreachable: "bg-red-500",
  unauthorized: "bg-amber-500",
  error: "bg-amber-500",
};

function SummaryStats({ summary, money }: { summary: PortfolioSummary; money: (n: number, ccy: string) => string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="Projects" value={String(summary.projects)} />
      <StatCard
        label="RAG (G/A/R)"
        value={summary.health ? `${summary.health.rag.green}/${summary.health.rag.amber}/${summary.health.rag.red}` : "—"}
        hint={summary.health ? `${summary.health.totalActiveBlockers} blocker(s)` : "no portfolio data"}
      />
      <StatCard
        label="Budget variance"
        value={summary.finance ? money(summary.finance.variance, summary.finance.currency) : "—"}
        hint={summary.finance ? (summary.finance.variance < 0 ? "projected overspend" : "within budget") : "no financials"}
      />
      <StatCard
        label="Utilisation"
        value={summary.capacity?.utilisation != null ? `${summary.capacity.utilisation}%` : "—"}
        hint={summary.capacity ? `${summary.capacity.overAllocated} over-allocated` : "no capacity data"}
      />
    </div>
  );
}

function LocalCard({ local, money }: { local: FederatedPortfolioLocal; money: (n: number, ccy: string) => string }) {
  return (
    <div className="border-2 border-foreground p-4 space-y-3" data-testid="federated-portfolio-local">
      <div className="flex items-center justify-between">
        <h3 className="font-black uppercase tracking-widest text-sm">{local.label}</h3>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {local.region ?? "region unset"} · this instance
        </span>
      </div>
      <SummaryStats summary={local.summary} money={money} />
    </div>
  );
}

function PeerCard({ peer, money }: { peer: PeerPortfolioResult; money: (n: number, ccy: string) => string }) {
  return (
    <div className="border border-border p-4 space-y-3" data-testid={`federated-portfolio-peer-${peer.id}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">{peer.label}</h3>
        <span className="shrink-0 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[peer.status]}`} />
          {STATUS_LABEL[peer.status]}
        </span>
      </div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{peer.region ?? "region unset"}</div>
      {peer.summary ? (
        <SummaryStats summary={peer.summary} money={money} />
      ) : (
        <div className="bg-card border border-dashed border-border p-3 text-xs text-muted-foreground" data-testid={`federated-portfolio-peer-${peer.id}-unavailable`}>
          Unavailable{peer.error ? ` — ${peer.error}` : ""}. Excluded from any combined figure; retry on next refresh.
        </div>
      )}
    </div>
  );
}

export function FederatedPortfolio() {
  const { formatCurrency } = useT();
  const { data, isLoading, isError, error, refetch } = useGetFederatedPortfolio();
  const money = (n: number, ccy: string) => formatCurrency(n, ccy);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {data && (
        <div className="space-y-4" data-testid="federated-portfolio">
          <LocalCard local={data.local} money={money} />

          {data.peers.length === 0 ? (
            <div className="bg-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="federated-portfolio-no-peers">
              No federated peers configured — this view shows only this instance. Add a peer under Settings to see a
              consolidated cross-region rollup.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.peers.map((p) => <PeerCard key={p.id} peer={p} money={money} />)}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Each region's contribution is a pre-aggregated total ONLY — never a raw project or issue record crosses
            an instance boundary. An unreachable or misconfigured peer shows as unavailable rather than breaking the
            view. Fetched live on every load; nothing is cached. Generated {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </div>
      )}
    </DataState>
  );
}
