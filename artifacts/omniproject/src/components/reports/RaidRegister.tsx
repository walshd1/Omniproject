import { useMemo } from "react";
import { useGetProjectRaid, type RaidEntry } from "@workspace/api-client-react";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { summariseRaid } from "../../lib/raid-register";

/**
 * RAID register — a roll-up of the project's Risks, Assumptions, Issues and Dependencies by type and
 * severity, with the live (open) exposure. Derive-only over the backend's RAID log; nothing stored.
 */
const SEVERITY_STYLE: Record<string, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
  other: "text-muted-foreground",
};

export function RaidRegister({ projectId }: { projectId: string }) {
  const { data: entries, isLoading, isError, error, refetch } = useGetProjectRaid(projectId);
  const summary = useMemo(() => summariseRaid((entries ?? []) as RaidEntry[]), [entries]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {summary.total === 0 ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="raid-register-empty">
          No RAID entries — log risks, assumptions, issues or dependencies to populate the register.
        </div>
      ) : (
        <div className="space-y-4" data-testid="raid-register">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Risks" value={String(summary.byType.risk)} />
            <StatCard label="Assumptions" value={String(summary.byType.assumption)} />
            <StatCard label="Issues" value={String(summary.byType.issue)} />
            <StatCard label="Dependencies" value={String(summary.byType.dependency)} />
          </div>
          <div className="flex items-center justify-between border border-border bg-card p-3 text-sm">
            <span className="font-bold">{summary.openItems} open</span>
            <span className="text-muted-foreground">of {summary.total} total</span>
            <span className="flex gap-4 font-mono text-xs" data-testid="raid-severity">
              {(["high", "medium", "low"] as const).map((s) => (
                <span key={s} className={SEVERITY_STYLE[s]}>{s}: {summary.bySeverity[s]}</span>
              ))}
            </span>
          </div>
        </div>
      )}
    </DataState>
  );
}
