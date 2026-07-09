import { useMemo } from "react";
import { buildStrategyCascade, type CascadeItem } from "../../lib/strategy-cascade";

/**
 * OKR cascade — the theme → objective → key-result → initiative tree, with contribution-weighted
 * progress rolled up and unaligned investment surfaced. Presentational (takes the mapped initiative
 * items), so it renders the same way wherever the strategy data comes from. See lib/strategy-cascade.
 */
function bar(pct: number | null): string {
  if (pct == null) return "bg-muted";
  if (pct >= 70) return "bg-green-500";
  if (pct >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export function StrategyCascade({ items }: { items: CascadeItem[] }) {
  const cascade = useMemo(() => buildStrategyCascade(items), [items]);

  if (cascade.themes.length === 0 && cascade.unaligned.length === 0) return null;

  return (
    <section className="space-y-3 border-t border-border pt-4" data-testid="strategy-cascade">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">OKR cascade</h3>
        <span className="text-xs text-muted-foreground" data-testid="strategy-cascade-coverage">
          {cascade.objectiveCount} objective(s) · {cascade.coveragePct}% of initiatives aligned
        </span>
      </div>

      <div className="space-y-3">
        {cascade.themes.map((t) => (
          <div key={t.theme} className="border border-border" data-testid={`cascade-theme-${t.theme}`}>
            <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5">
              <span className="font-bold text-sm">{t.theme}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{t.progressPct == null ? "—" : `${t.progressPct}%`}</span>
            </div>
            <ul className="divide-y divide-border/60">
              {t.objectives.map((o) => (
                <li key={o.objective} className="p-3 space-y-1.5" data-testid={`cascade-objective-${o.objective}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-sm">{o.objective}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{o.progressPct == null ? "—" : `${o.progressPct}%`}</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted overflow-hidden">
                    <div className={`h-full ${bar(o.progressPct)}`} style={{ width: `${o.progressPct ?? 0}%` }} />
                  </div>
                  {o.keyResults.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 pt-0.5">
                      {o.keyResults.map((kr) => (
                        <li key={kr.label} className="text-[11px] border border-border px-1.5 py-0.5 text-muted-foreground">
                          {kr.label}{kr.attainmentPct != null ? ` · ${kr.attainmentPct}%` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {o.initiatives.length} initiative(s): {o.initiatives.map((i) => i.name).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {cascade.unaligned.length > 0 && (
        <p className="text-xs text-amber-600 border border-amber-500/40 bg-amber-500/10 px-3 py-2" data-testid="strategy-cascade-unaligned">
          {cascade.unaligned.length} initiative(s) cite no objective — unaligned investment: {cascade.unaligned.map((u) => u.name).join(", ")}.
        </p>
      )}
    </section>
  );
}
