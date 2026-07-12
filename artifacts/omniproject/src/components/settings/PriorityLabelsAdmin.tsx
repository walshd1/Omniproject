import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { usePriorityLabels, useSavePriorityLabels } from "../../lib/priority-labels";

/**
 * Admin/PMO editor for the priority-level display names. Relabel the canonical levels (e.g. urgent →
 * "P0"); a blank field falls back to the canonical name. `none` is the absence of a priority and isn't
 * relabelled here.
 */
export function PriorityLabelsAdmin() {
  const { data: auth } = useAuth();
  const { canonical, labels } = usePriorityLabels();
  const save = useSavePriorityLabels();
  const { toast } = useToast();
  const editable = canonical.filter((p) => p !== "none");
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => { setDraft(Object.fromEntries(editable.map((p) => [p, labels[p] ?? ""])) ); // sync when loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(labels), JSON.stringify(editable)]);

  if (!isPmoOrAdmin(auth?.role)) return null;

  const submit = () => {
    const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    save.mutate(clean, {
      onSuccess: () => toast({ title: "PRIORITY LABELS SAVED" }),
      onError: (e) => toast({ title: "COULDN'T SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <Card className="rounded-none border-border">
      <CardHeader><CardTitle className="text-sm font-bold uppercase tracking-wider">Priority level labels</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Rename the priority levels for your org (e.g. Urgent → “P0”). Blank uses the default name.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {editable.map((p) => (
            <div key={p} className="space-y-1">
              <Label htmlFor={`prio-${p}`} className="text-xs uppercase tracking-widest text-muted-foreground">{p}</Label>
              <input
                id={`prio-${p}`}
                className="w-full rounded-none border border-border bg-card px-2 py-2 text-sm"
                placeholder={p}
                maxLength={40}
                value={draft[p] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [p]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <Button className="rounded-none" onClick={submit} disabled={save.isPending}>Save labels</Button>
      </CardContent>
    </Card>
  );
}
