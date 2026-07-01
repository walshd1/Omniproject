import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "../lib/api";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Messy-data control (dev only) — synthetically injects real-world imperfections
 * (nulls, mixed enum vocab, junk numbers/dates, missing provenance, id collisions…)
 * into the read model, so we can SEE how resilient our reports/derivations/screens are
 * to dirty data. Dev-instance only (gated by `/api/dev-mode`); admin-gated + audited
 * server-side; ephemeral. Toggling it resets the broker, so all live queries are
 * refetched to reflect the new setting.
 */
interface DevStatus { devMode: boolean }
interface Gremlin { id: string; label: string; description: string }
interface MessyConfig { on: boolean; seed: string; intensity: number; gremlins: string[] }
interface MessyState { config: MessyConfig; gremlins: Gremlin[] }

export function MessyDataControl() {
  const qc = useQueryClient();
  const { data: dev } = useQuery<DevStatus>({ queryKey: ["dev-mode"], queryFn: () => getJson("/api/dev-mode"), staleTime: 60_000, retry: false });
  const { data: state } = useQuery<MessyState>({
    queryKey: ["dev-messy"],
    queryFn: () => getJson("/api/dev-mode/messy"),
    enabled: !!dev?.devMode,
    retry: false,
  });
  const [open, setOpen] = useState(false);

  if (!dev?.devMode || !state) return null;

  const cfg = state.config;

  /** Push a config patch, then refetch both this panel and every active query (the
   *  broker was reset server-side, so the read model changed). */
  const patch = async (body: Partial<MessyConfig>) => {
    await fetch("/api/dev-mode/messy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    await qc.invalidateQueries({ queryKey: ["dev-messy"] });
    void qc.invalidateQueries({ refetchType: "active" });
    // Re-mark the watermark surface (messy on/off changed).
    void qc.invalidateQueries({ queryKey: ["dev-mode"] });
  };

  const toggleGremlin = (id: string, on: boolean) => {
    const next = on ? [...cfg.gremlins, id] : cfg.gremlins.filter((g) => g !== id);
    return patch({ gremlins: next });
  };

  // Empty gremlin list ⇒ "all active" (the transform's default).
  const isActive = (id: string) => cfg.gremlins.length === 0 || cfg.gremlins.includes(id);

  return (
    <div className="pointer-events-auto fixed bottom-24 left-2 z-[9999]">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-6 px-2 py-0 text-xs" data-testid="messy-open">
            Messy data{cfg.on ? " ●" : "…"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Messy data (dev)</DialogTitle>
            <DialogDescription>
              Inject synthetic real-world imperfections into the read model to stress-test how resilient reports and
              derivations are to dirty data. Deterministic per seed. Reads only — never writes back. Recorded in the audit log.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="font-bold uppercase tracking-wider">Inject imperfections</span>
              <input type="checkbox" checked={cfg.on} data-testid="messy-on" onChange={(e) => patch({ on: e.target.checked })} />
            </label>

            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Intensity <span className="text-xs text-muted-foreground">({Math.round(cfg.intensity * 100)}%)</span></span>
              <input
                type="range" min={0} max={1} step={0.1} value={cfg.intensity} data-testid="messy-intensity"
                aria-label="Intensity"
                onChange={(e) => patch({ intensity: Number(e.target.value) })}
              />
            </label>

            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Seed</span>
              <input
                type="text" defaultValue={cfg.seed} data-testid="messy-seed" aria-label="Seed"
                className="w-32 border-2 border-foreground bg-background px-2 py-0.5 text-xs"
                onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== cfg.seed) void patch({ seed: e.target.value.trim() }); }}
              />
            </label>

            <fieldset className="border-t border-border pt-2">
              <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Imperfections</legend>
              <ul className="mt-1 space-y-1" data-testid="messy-gremlins">
                {state.gremlins.map((g) => (
                  <li key={g.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox" className="mt-1" checked={isActive(g.id)} data-testid={`messy-gremlin-${g.id}`}
                      onChange={(e) => toggleGremlin(g.id, e.target.checked)}
                    />
                    <span>
                      <span className="font-medium">{g.label}</span>
                      <span className="block text-xs text-muted-foreground">{g.description}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
