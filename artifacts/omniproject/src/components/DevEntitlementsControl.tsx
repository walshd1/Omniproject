import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Dev-mode entitlement toggle — force premium features on/off to preview the
 * licensed vs unlicensed UX without a real licence. Dev-instance only (gated by
 * `/api/dev-mode`); every change is admin-gated + audited server-side and is
 * ephemeral (cleared on restart).
 */
interface DevStatus { devMode: boolean }
interface Entitlements { catalog: string[]; overrides: Record<string, boolean>; effective: string[] }

async function getJson<T>(url: string): Promise<T> {
  return (await fetch(url, { credentials: "same-origin" })).json();
}

export function DevEntitlementsControl() {
  const qc = useQueryClient();
  const { data: dev } = useQuery<DevStatus>({ queryKey: ["dev-mode"], queryFn: () => getJson("/api/dev-mode"), staleTime: 60_000, retry: false });
  const { data: ent } = useQuery<Entitlements>({
    queryKey: ["dev-entitlements"],
    queryFn: () => getJson("/api/dev-mode/entitlements"),
    enabled: !!dev?.devMode,
    retry: false,
  });
  const [open, setOpen] = useState(false);

  if (!dev?.devMode || !ent) return null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["dev-entitlements"] });

  const set = async (feature: string, enabled: boolean | null) => {
    await fetch("/api/dev-mode/entitlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ feature, enabled }),
    });
    refresh();
  };

  const reset = async () => {
    await fetch("/api/dev-mode/entitlements", { method: "DELETE", credentials: "same-origin" });
    refresh();
  };

  return (
    <div className="pointer-events-auto fixed bottom-16 left-2 z-[9999]">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-6 px-2 py-0 text-xs" data-testid="entitlements-open">Entitlements…</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Paid features (dev)</DialogTitle>
            <DialogDescription>
              Force premium features on or off to preview the licensed vs unlicensed experience. Ephemeral and recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2" data-testid="entitlements-list">
            {ent.catalog.map((feature) => {
              const on = ent.effective.includes(feature);
              const overridden = feature in ent.overrides;
              return (
                <li key={feature} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono">
                    {feature}
                    {overridden && <span className="ml-1 text-xs text-amber-600">(forced)</span>}
                  </span>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={on}
                      data-testid={`entitlement-${feature}`}
                      onChange={(e) => set(feature, e.target.checked)}
                    />
                    <span className="text-xs text-muted-foreground">{on ? "granted" : "revoked"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={reset} data-testid="entitlements-reset">Reset all</Button>
            <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
