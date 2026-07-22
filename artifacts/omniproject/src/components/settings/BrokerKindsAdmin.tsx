import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Waypoints } from "lucide-react";
import { AdminSection } from "./AdminSection";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useBrokerKinds, useSaveBrokerKinds, useAvailableBrokers } from "../../lib/broker-kinds";

/**
 * Connected brokers (admin) — the broker platforms wired below the seam beyond the active data hop.
 * Each entry is a catalogue broker id; the picker lists what the catalogue knows. Unioned with the
 * BROKER_KINDS env on the server and sealed at rest. Broker wiring is technical config, so admin-only.
 */
export function BrokerKindsAdmin() {
  const { data: auth } = useAuth();
  const isAdmin = roleAtLeast(auth?.role, "admin");
  const { data: server } = useBrokerKinds();
  const { data: available } = useAvailableBrokers(isAdmin);
  const save = useSaveBrokerKinds();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<string[], string[]>(server);

  if (!isAdmin) return null;

  const rows = draft ?? [];
  const knownIds = new Set((available ?? []).map((b) => b.id));
  const set = (i: number, value: string) => setDraft(rows.map((r, j) => (j === i ? value : r)));

  // Client feedback: a non-empty entry that isn't a known catalogue id, or a duplicate.
  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const k = r.trim().toLowerCase();
    if (k && ((available && !knownIds.has(k)) || seen.has(k))) badRows.add(i);
    if (k) seen.add(k);
  });

  const onSave = () => {
    save.mutate(rows.map((r) => r.trim().toLowerCase()).filter(Boolean), {
      onSuccess: () => toast({ title: "BROKERS SAVED", description: "Connected broker list updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Each broker must be a known catalogue id.", variant: "destructive" }),
    });
  };

  return (
    <AdminSection icon={Waypoints} title="Connected brokers" testId="broker-kinds-admin">
        <p className="text-xs text-muted-foreground">
          Extra broker platforms wired below the seam, beyond the active data hop. Add a catalogue broker
          id; the deployment's <code>BROKER_KINDS</code> env is included automatically.
        </p>

        <datalist id="broker-kind-options">
          {(available ?? []).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </datalist>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`broker-kind-row-${i}`}>
              <Input
                list="broker-kind-options"
                aria-label={`Broker ${i + 1}`}
                value={r}
                onChange={(e) => set(i, e.target.value)}
                className={`h-8 font-mono ${badRows.has(i) ? "border-red-500" : ""}`}
              />
              <button type="button" aria-label={`Remove broker ${i + 1}`} onClick={() => setDraft(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-500 px-2">×</button>
            </div>
          ))}
          {rows.length === 0 && <p className="text-xs text-center text-muted-foreground py-2">No extra brokers — only the active data hop is connected.</p>}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, ""])} data-testid="broker-kind-add">Add broker</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="broker-kind-save">
            {save.isPending ? "SAVING…" : "Save brokers"}
          </Button>
        </div>
    </AdminSection>
  );
}
