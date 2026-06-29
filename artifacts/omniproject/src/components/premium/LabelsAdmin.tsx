import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Section, LockNotice } from "./shared";

/**
 * Company nomenclature panel — override the terms the UI shows (e.g. "Projects" → "Engagements")
 * to match house style. Gated by the `labels` licence entitlement. Part of the premium overlay.
 */

interface LabelCatalogItem { key: string; default: string; }

export function LabelsAdmin({ entitled }: { entitled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data } = useQuery<{ overrides: Record<string, string>; catalog: LabelCatalogItem[] }>({
    queryKey: ["labels", "admin"],
    queryFn: async () => (await fetch("/api/labels", { credentials: "same-origin" })).json(),
    staleTime: 0,
  });
  useEffect(() => { if (data?.overrides) setOverrides(data.overrides); }, [data]);
  const catalog = data?.catalog ?? [];

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/labels", {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      toast({ title: "LABELS SAVED", description: "Reloading to apply your nomenclature…" });
      qc.invalidateQueries({ queryKey: ["labels"] });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast({ title: "ERROR", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Section title="Company nomenclature">
      {!entitled && <LockNotice feature="labels" />}
      <p className="text-xs text-muted-foreground">Rename the terms the UI shows to match your house style — e.g. “Projects” → “Engagements”. Leave blank to keep the default.</p>
      <fieldset disabled={!entitled} className="space-y-4 disabled:opacity-50">
        {catalog.map((t) => (
          <div key={t.key} className="grid grid-cols-[1fr_2fr] items-center gap-3">
            <code className="text-xs text-muted-foreground">{t.key}</code>
            <Input
              className="rounded-none border-border font-mono h-10"
              value={overrides[t.key] ?? ""}
              placeholder={t.default}
              onChange={(e) => setOverrides((p) => ({ ...p, [t.key]: e.target.value }))}
            />
          </div>
        ))}
        <Button type="button" onClick={save} disabled={saving} className="rounded-none uppercase font-bold tracking-wider">{saving ? "Saving…" : "Save nomenclature"}</Button>
      </fieldset>
    </Section>
  );
}
