import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useRateCard, useSetScopeUplift, type Uplift } from "../../lib/rate-card";
import { PercentInput } from "./PercentInput";

/**
 * Per-scope uplift overrides — a programme or project can override the central margin / overhead (each
 * field independently; an omitted field inherits central). The effective uplift resolves project →
 * programme → central. Each override is written through the per-scope endpoint; an empty body clears it.
 * PMO-gated, mirroring the server.
 */

type Level = "programme" | "project";

const pct = (v: number | undefined): string => (v === undefined ? "—" : `${Math.round(v * 1000) / 10}%`);

export function ScopeUpliftAdmin() {
  const { data: auth } = useAuth();
  const { data: card } = useRateCard();
  const setScope = useSetScopeUplift();
  const [level, setLevel] = useState<Level>("programme");
  const [scopeId, setScopeId] = useState("");
  const [margin, setMargin] = useState<number | undefined>(undefined);
  const [overhead, setOverhead] = useState<number | undefined>(undefined);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!card?.uplift) return null;

  const central = card.uplift.central;
  // Flatten both override maps into displayable rows.
  const rows: { level: Level; scopeId: string; uplift: Partial<Uplift> }[] = [
    ...Object.entries(card.uplift.programme).map(([id, u]) => ({ level: "programme" as const, scopeId: id, uplift: u })),
    ...Object.entries(card.uplift.project).map(([id, u]) => ({ level: "project" as const, scopeId: id, uplift: u })),
  ];

  function apply() {
    if (!scopeId.trim()) return;
    const uplift: Partial<Uplift> = {};
    if (margin !== undefined) uplift.margin = margin;
    if (overhead !== undefined) uplift.overhead = overhead;
    setScope.mutate({ level, scopeId: scopeId.trim(), uplift }, { onSuccess: () => { setScopeId(""); setMargin(undefined); setOverhead(undefined); } });
  }

  return (
    <section className="space-y-3" data-testid="scope-uplift-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Margin / overhead overrides (per scope)</h2>
        <p className="text-xs text-muted-foreground">
          Central is margin <span className="font-mono">{pct(central.margin)}</span> · overhead <span className="font-mono">{pct(central.overhead)}</span>.
          Override either for one programme or project — a blank field inherits central. The effective uplift
          resolves project → programme → central.
        </p>
      </div>

      <div className="border-2 border-foreground p-3 flex flex-wrap items-end gap-3" data-testid="scope-uplift-form">
        <label className="text-xs flex items-center gap-1">
          <span className="text-muted-foreground">Scope</span>
          <select aria-label="Override scope level" className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs"
            value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            <option value="programme">Programme</option>
            <option value="project">Project</option>
          </select>
        </label>
        <Input aria-label="Override scope id" placeholder={`${level} id`} className="w-44 rounded-none border-2 border-foreground font-mono text-xs"
          value={scopeId} onChange={(e) => setScopeId(e.target.value)} />
        <PercentInput label="Margin" ariaLabel="Override margin %" value={margin} onChange={setMargin} />
        <PercentInput label="Overhead" ariaLabel="Override overhead %" value={overhead} onChange={setOverhead} />
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider"
          onClick={apply} disabled={!scopeId.trim() || (margin === undefined && overhead === undefined) || setScope.isPending}>
          {setScope.isPending ? "Saving…" : "Apply override"}
        </Button>
        {setScope.isError && <span role="alert" className="text-xs font-bold text-red-500">{(setScope.error as Error).message}</span>}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="scope-uplift-none">No overrides — every scope uses the central uplift.</p>
      ) : (
        <table className="w-full text-xs border-collapse" data-testid="scope-uplift-table">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-3 font-bold">Scope</th>
              <th className="py-1.5 px-2 font-bold">Id</th>
              <th className="py-1.5 px-2 font-bold text-right">Margin</th>
              <th className="py-1.5 px-2 font-bold text-right">Overhead</th>
              <th className="py-1.5 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.level}:${r.scopeId}`} className="border-b border-border/50" data-testid={`scope-uplift-row-${r.level}-${r.scopeId}`}>
                <td className="py-1.5 pr-3 capitalize">{r.level}</td>
                <td className="py-1.5 px-2 font-mono">{r.scopeId}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{r.uplift.margin === undefined ? <span className="text-muted-foreground">central</span> : pct(r.uplift.margin)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{r.uplift.overhead === undefined ? <span className="text-muted-foreground">central</span> : pct(r.uplift.overhead)}</td>
                <td className="py-1.5 px-2 text-right">
                  <Button variant="ghost" className="rounded-none text-xs px-2" aria-label={`Clear ${r.level} ${r.scopeId} override`}
                    onClick={() => setScope.mutate({ level: r.level, scopeId: r.scopeId, uplift: {} })}>Clear</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
