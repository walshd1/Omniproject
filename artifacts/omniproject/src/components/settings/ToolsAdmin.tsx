import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useTools, saveToolPolicy, EGRESS_INFO, type EgressClass, type ToolPolicy, type ResolvedTool } from "../../lib/tools";

/**
 * Admin governance for the tools plane: which data-egress classes are permitted, and
 * which tools are switched off. Locked to on-device by default; relaxing to
 * self-hosted or third-party egress is a deliberate, audited choice here. Users then
 * still give per-tool consent before a non-local tool runs. Admin-only (the gateway
 * also enforces the role); hidden for everyone else.
 */
const RELAXABLE: EgressClass[] = ["self-hosted", "third-party"];

export function ToolsAdmin() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useTools();

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data) return null;
  const { policy, tools } = data;

  const apply = async (next: ToolPolicy): Promise<void> => {
    await saveToolPolicy(next);
    await qc.invalidateQueries({ queryKey: ["tools"] });
  };

  const toggleEgress = (cls: EgressClass, on: boolean): Promise<void> =>
    apply({ ...policy, allowedEgress: on ? [...policy.allowedEgress, cls] : policy.allowedEgress.filter((e) => e !== cls) });

  const toggleTool = (id: string, enabled: boolean): Promise<void> =>
    apply({ ...policy, disabled: enabled ? policy.disabled.filter((d) => d !== id) : [...policy.disabled, id] });

  return (
    <Card data-testid="tools-admin">
      <CardHeader>
        <CardTitle>Tools &amp; AI — data governance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permit where the optional AI tools may send data. On-device is always allowed;
            relax the others only as your data policy allows. Users still consent per tool.
          </p>
          {RELAXABLE.map((cls) => (
            <div key={cls} className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`egress-${cls}`}>{EGRESS_INFO[cls].label}</Label>
                <p className="text-xs text-muted-foreground">{EGRESS_INFO[cls].blurb}</p>
              </div>
              <Switch
                id={`egress-${cls}`}
                checked={policy.allowedEgress.includes(cls)}
                onCheckedChange={(on) => toggleEgress(cls, on)}
              />
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} disabled={policy.disabled.includes(tool.id)} onToggle={toggleTool} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ToolRow({ tool, disabled, onToggle }: { tool: ResolvedTool; disabled: boolean; onToggle: (id: string, enabled: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{tool.label}</span>
          <StatusChip tool={tool} />
        </div>
        <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
      </div>
      <Switch
        aria-label={`Enable ${tool.label}`}
        checked={!disabled}
        onCheckedChange={(on) => onToggle(tool.id, on)}
      />
    </div>
  );
}

function StatusChip({ tool }: { tool: ResolvedTool }) {
  if (!tool.available) return <span className="rounded border border-border px-1.5 text-[10px] text-muted-foreground">{tool.reason}</span>;
  const egress = tool.effectiveEgress ?? "none";
  return <span className="rounded border border-border px-1.5 text-[10px] text-muted-foreground">{EGRESS_INFO[egress].label}</span>;
}
