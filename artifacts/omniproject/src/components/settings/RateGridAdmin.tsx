import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useRateCard, useSaveRateCard, type RateCardConfig, type Role, type Facing } from "../../lib/rate-card";

/**
 * PMO rate grid — a rate per job title × project type × facing (client / internal). Titles are authored
 * in plaintext; on Save the server hashes each title (keyed HMAC) so no clear role name persists as a
 * key. The project types come from the rate-card config (defined in the project-types editor); the
 * untouched project types + central uplift are round-tripped on Save. PMO-gated, mirroring the server.
 */

const FACINGS: Facing[] = ["client", "internal"];

/** A draft role row, derived from the hashed card for editing then re-hashed (idempotently) on Save. */
interface DraftRole {
  title: string;
  rates: Record<string, Partial<Record<Facing, number>>>;
}

/** Flatten the hashed card into editable plaintext role rows (label is the plaintext title). */
function rolesFromConfig(cfg: RateCardConfig): DraftRole[] {
  return Object.entries(cfg.titles).map(([hash, title]) => ({ title, rates: structuredClone(cfg.rates[hash] ?? {}) }));
}

export function RateGridAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useRateCard();
  const save = useSaveRateCard();
  const [roles, setRoles] = useState<DraftRole[] | null>(null);

  useEffect(() => { if (server) setRoles(rolesFromConfig(server)); }, [server]);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!server || !roles) return null;

  const types = server.projectTypes;
  const dirty = JSON.stringify(roles) !== JSON.stringify(rolesFromConfig(server));

  function setRate(ri: number, typeId: string, facing: Facing, raw: string) {
    setRoles(roles!.map((r, i) => {
      if (i !== ri) return r;
      const cell = { ...(r.rates[typeId] ?? {}) };
      const n = Number(raw.trim());
      if (raw.trim() === "" || !isFinite(n) || n < 0) delete cell[facing];
      else cell[facing] = n;
      const rates = { ...r.rates };
      if (Object.keys(cell).length) rates[typeId] = cell; else delete rates[typeId];
      return { ...r, rates };
    }));
  }

  function onSave() {
    const clean: Role[] = roles!.filter((r) => r.title.trim()).map((r) => ({ title: r.title.trim(), rates: r.rates }));
    save.mutate({ roles: clean, projectTypes: server!.projectTypes, uplift: server!.uplift.central });
  }

  return (
    <section className="space-y-3" data-testid="rate-grid-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Rate card — rates by role</h2>
        <p className="text-xs text-muted-foreground">
          A rate per job title × project type × client/internal facing. Titles are hashed on save — the clear
          name is never stored as a key. Define project types first in the editor above.
        </p>
      </div>

      {types.length === 0 ? (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="rate-grid-no-types">
          No project types yet — add one in “Rate card — project types &amp; cost model” before setting rates.
        </p>
      ) : (
        <div className="overflow-x-auto border-2 border-foreground">
          <table className="text-xs border-collapse min-w-full">
            <thead>
              <tr className="border-b-2 border-foreground bg-muted/40">
                <th className="text-left p-2 font-bold sticky left-0 bg-muted/40">Job title</th>
                {types.map((t) => FACINGS.map((f) => (
                  <th key={`${t.id}-${f}`} className="p-2 font-bold text-right whitespace-nowrap">
                    {t.label}<span className="block text-[9px] font-normal text-muted-foreground uppercase">{f}</span>
                  </th>
                )))}
                <th className="p-1"></th>
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 && (
                <tr><td colSpan={types.length * 2 + 2} className="p-3 text-center text-muted-foreground" data-testid="rate-grid-empty">No roles yet — add one below.</td></tr>
              )}
              {roles.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50" data-testid={`rate-grid-row-${ri}`}>
                  <td className="p-1 sticky left-0 bg-background">
                    <Input aria-label={`Role ${ri + 1} title`} placeholder="Job title" className="w-44 rounded-none border border-border"
                      value={r.title} onChange={(e) => setRoles(roles.map((x, i) => (i === ri ? { ...x, title: e.target.value } : x)))} />
                  </td>
                  {types.map((t) => FACINGS.map((f) => (
                    <td key={`${t.id}-${f}`} className="p-1">
                      <Input type="number" min={0} inputMode="decimal" aria-label={`${r.title || `Role ${ri + 1}`} ${t.label} ${f} rate`}
                        className="w-20 rounded-none border border-border tabular-nums text-right"
                        value={r.rates[t.id]?.[f] ?? ""} onChange={(e) => setRate(ri, t.id, f, e.target.value)} />
                    </td>
                  )))}
                  <td className="p-1">
                    <Button variant="ghost" className="rounded-none text-xs px-2" aria-label={`Remove role ${ri + 1}`}
                      onClick={() => setRoles(roles.filter((_, i) => i !== ri))}>✕</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs"
          onClick={() => setRoles([...roles, { title: "", rates: {} }])} disabled={types.length === 0}>+ role</Button>
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={onSave} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save rates"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={() => setRoles(rolesFromConfig(server))}>Reset</Button>}
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
