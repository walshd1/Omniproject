import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast } from "../../lib/auth";
import {
  useGovernance, saveCapability, STATE_INFO, KIND_LABEL,
  type ResolvedCapability, type DeploymentState, type CapabilityKind, type CapabilityWrite, type Surface,
} from "../../lib/tools";

/**
 * Admin governance for AI tools, the MCP, AI providers and vendors. Each is set to
 * off / user-defined / public — and only the states it supports are offered. Every
 * capability can additionally be overridden per surface (a capability × surface matrix)
 * — e.g. text-to-speech public everywhere but "user-defined" or "off" on finance, or a
 * SaaS vendor allowed generally but forced off on a sensitive screen. Admin-only (the
 * gateway also enforces it).
 */
const KIND_ORDER: CapabilityKind[] = ["ai-tool", "mcp", "ai-provider", "vendor"];

export function GovernanceAdmin() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useGovernance();

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.capabilities) return null;
  const surfaces = data.surfaces ?? [];

  const save = async (id: string, setting: CapabilityWrite): Promise<void> => {
    await saveCapability(id, setting);
    await qc.invalidateQueries({ queryKey: ["governance"] });
  };

  const groups = KIND_ORDER.map((kind) => ({ kind, items: data.capabilities.filter((c) => c.kind === kind) })).filter((g) => g.items.length);

  return (
    <Card data-testid="governance-admin">
      <CardHeader>
        <CardTitle>Tools, AI &amp; vendors — data governance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Set where each capability runs. <strong>User-defined</strong> means you control it
          (local or your own endpoint); <strong>Public</strong> sends data to a third-party
          service. Only the states a capability supports are shown.
        </p>
        {groups.map((g) => (
          <section key={g.kind} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{KIND_LABEL[g.kind]}</h3>
            {g.items.map((cap) => <CapabilityRow key={cap.id} cap={cap} surfaces={surfaces} onSave={save} />)}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function CapabilityRow({ cap, surfaces, onSave }: { cap: ResolvedCapability; surfaces: Surface[]; onSave: (id: string, s: CapabilityWrite) => void }) {
  // Always send the full setting so state changes don't drop the endpoint/surfaces.
  const base: CapabilityWrite = { state: cap.state, endpoint: cap.endpoint, surfaces: cap.surfaces };

  return (
    <div className="rounded border border-border p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={`cap-${cap.id}`} className="font-medium">{cap.label}</Label>
          <p className="text-xs text-muted-foreground">{cap.description}</p>
        </div>
        <select
          id={`cap-${cap.id}`}
          aria-label={cap.label}
          value={cap.state}
          onChange={(e) => onSave(cap.id, { ...base, state: e.target.value as DeploymentState })}
          className="h-9 shrink-0 rounded-md border border-border bg-transparent px-2 text-sm"
        >
          {cap.options.map((s) => <option key={s} value={s}>{STATE_INFO[s].label}</option>)}
        </select>
      </div>

      {cap.state === "user-defined" && (
        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor={`cap-${cap.id}-endpoint`} className="text-xs text-muted-foreground">Your endpoint</Label>
          <input
            id={`cap-${cap.id}-endpoint`}
            type="url"
            defaultValue={cap.endpoint ?? ""}
            placeholder="http://localhost:11434"
            onBlur={(e) => { if (e.target.value !== (cap.endpoint ?? "")) onSave(cap.id, { ...base, endpoint: e.target.value }); }}
            className="h-8 flex-1 rounded border border-border bg-transparent px-2 text-sm"
          />
        </div>
      )}

      {cap.surfaceAware && <SurfaceOverrides cap={cap} base={base} surfaces={surfaces} onSave={onSave} />}
    </div>
  );
}

function SurfaceOverrides({ cap, base, surfaces, onSave }: { cap: ResolvedCapability; base: CapabilityWrite; surfaces: Surface[]; onSave: (id: string, s: CapabilityWrite) => void }) {
  const entries = Object.entries(cap.surfaces);
  const labelFor = (id: string): string => surfaces.find((s) => s.id === id)?.label ?? id;
  const setSurface = (surface: string, state: DeploymentState | null): void => {
    const next = { ...cap.surfaces };
    if (state === null) delete next[surface];
    else next[surface] = state;
    onSave(cap.id, { ...base, surfaces: next });
  };

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-2">
      <p className="text-xs text-muted-foreground">Per-screen overrides (e.g. stricter on finance):</p>
      {entries.map(([surface, state]) => (
        <div key={surface} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate text-xs">{labelFor(surface)}</span>
          <select
            aria-label={`${cap.label} on ${labelFor(surface)}`}
            value={state}
            onChange={(e) => setSurface(surface, e.target.value as DeploymentState)}
            className="h-8 rounded border border-border bg-transparent px-1 text-xs"
          >
            {cap.options.map((s) => <option key={s} value={s}>{STATE_INFO[s].label}</option>)}
          </select>
          <Button variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => setSurface(surface, null)}>remove</Button>
        </div>
      ))}
      <AddSurface
        options={cap.options}
        available={surfaces.filter((s) => !(s.id in cap.surfaces))}
        onAdd={(surface, state) => setSurface(surface, state)}
      />
    </div>
  );
}

function AddSurface({ options, available, onAdd }: { options: DeploymentState[]; available: Surface[]; onAdd: (surface: string, state: DeploymentState) => void }) {
  if (available.length === 0) return null; // every screen already has an override
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const surface = (form.elements.namedItem("surface") as HTMLSelectElement).value;
        const state = (form.elements.namedItem("state") as HTMLSelectElement).value as DeploymentState;
        if (surface) onAdd(surface, state);
      }}
    >
      {/* Screens come from the registry — pick, don't type, so an override can't be a typo. */}
      <select name="surface" aria-label="Add a screen override" className="h-8 flex-1 rounded border border-border bg-transparent px-1 text-xs">
        {available.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select name="state" defaultValue={options[options.length - 1]} className="h-8 rounded border border-border bg-transparent px-1 text-xs">
        {options.map((s) => <option key={s} value={s}>{STATE_INFO[s].label}</option>)}
      </select>
      <Button type="submit" variant="outline" size="sm" className="h-8 px-2 text-xs">Add</Button>
    </form>
  );
}
