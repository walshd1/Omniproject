import { useMemo } from "react";
import { useGetProjectRaid, type RaidEntry } from "@workspace/api-client-react";
import {
  analyzeRiskRegister,
  CANONICAL_LIKELIHOOD,
  CANONICAL_IMPACT,
  LIKELIHOOD_LABEL,
  IMPACT_LABEL,
  SEVERITY_LABEL,
  type RegisterEntry,
  type CanonicalSeverity,
} from "@workspace/backend-catalogue";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportEmpty } from "./ReportEmpty";

/**
 * Risk exposure heatmap — the likelihood x impact grid + top risks a RAID summary doesn't show. Scores each
 * RAID entry's P x I exposure via the shared `analyzeRiskRegister` catalogue engine (the same maths every
 * plane uses) over the live RAID log. Derive-only — nothing is stored.
 */
const BAND_BG: Record<CanonicalSeverity, string> = {
  low: "bg-green-500/20",
  medium: "bg-amber-500/25",
  high: "bg-red-500/30",
  critical: "bg-red-700/45",
};
const BAND_TEXT: Record<CanonicalSeverity, string> = {
  low: "text-green-700",
  medium: "text-amber-700",
  high: "text-red-700",
  critical: "text-red-800",
};

/** Coerce a RAID entry's ISO due date to epoch-ms (or undefined) for the engine. */
function dueMs(due: unknown): number | undefined {
  if (typeof due !== "string" || !due) return undefined;
  const t = Date.parse(due);
  return Number.isFinite(t) ? t : undefined;
}

export function RiskRegister({ projectId, now }: { projectId: string; now?: number }) {
  const { data: entries, isLoading, isError, error, refetch } = useGetProjectRaid(projectId);
  const asOf = now ?? Date.now();

  const result = useMemo(() => {
    const rows: RegisterEntry[] = ((entries ?? []) as RaidEntry[]).map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      severity: e.severity,
      likelihood: e.likelihood ?? null,
      impact: e.impact ?? null,
      owner: e.owner ?? null,
      dueDate: dueMs((e as { dueDate?: unknown }).dueDate) ?? null,
    }));
    return analyzeRiskRegister(rows, { now: asOf });
  }, [entries, asOf]);

  // Index the heatmap cells by "likelihood|impact" so the grid can be laid out likelihood(rows) x impact(cols).
  const cellByKey = useMemo(() => {
    const m = new Map<string, (typeof result.heatmap)[number]>();
    for (const c of result.heatmap) m.set(`${c.likelihood}|${c.impact}`, c);
    return m;
  }, [result]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {result.summary.total === 0 ? (
        <ReportEmpty testId="risk-register-empty">
          No RAID entries — log risks with a likelihood and impact to populate the exposure heatmap.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="risk-register">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Open" value={String(result.summary.open)} />
            <StatCard label="Scored" value={String(result.summary.scored)} />
            <StatCard label="Overdue mitigations" value={String(result.summary.overdueMitigations)} />
            <StatCard label="Highest exposure" value={String(result.summary.highestExposure)} />
          </div>

          {/* Likelihood (rows, high → low) x Impact (cols, low → high) exposure grid. */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-center text-xs" data-testid="risk-heatmap">
              <thead>
                <tr>
                  <th className="p-1" />
                  {CANONICAL_IMPACT.map((imp) => (
                    <th key={imp} className="p-1 font-bold uppercase tracking-wide text-muted-foreground">{IMPACT_LABEL[imp]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...CANONICAL_LIKELIHOOD].reverse().map((lik) => (
                  <tr key={lik}>
                    <th className="p-1 text-right font-bold uppercase tracking-wide text-muted-foreground">{LIKELIHOOD_LABEL[lik]}</th>
                    {CANONICAL_IMPACT.map((imp) => {
                      const cell = cellByKey.get(`${lik}|${imp}`);
                      const band = cell?.band ?? "low";
                      return (
                        <td
                          key={imp}
                          data-testid={`risk-cell-${lik}-${imp}`}
                          className={`border border-border p-2 tabular-nums font-bold ${BAND_BG[band]} ${BAND_TEXT[band]}`}
                          title={`${LIKELIHOOD_LABEL[lik]} likelihood x ${IMPACT_LABEL[imp]} impact — ${SEVERITY_LABEL[band]} (exposure ${cell?.exposure ?? 0})`}
                        >
                          {cell?.count ?? 0}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.topRisks.length > 0 && (
            <div className="space-y-1" data-testid="risk-top">
              <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">Top risks</div>
              {result.topRisks.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between border border-border bg-card px-3 py-1.5 text-sm" data-testid={`risk-top-${r.id}`}>
                  <span className="font-mono text-xs">{r.id}</span>
                  <span className="flex items-center gap-3">
                    {r.band && <span className={`text-xs font-bold uppercase ${BAND_TEXT[r.band]}`}>{SEVERITY_LABEL[r.band]}</span>}
                    <span className="tabular-nums text-muted-foreground">{r.exposure ?? "—"}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DataState>
  );
}
