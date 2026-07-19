import { useState } from "react";
import { Building2, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "../../lib/branding";

/**
 * "Name your organisation" — the first thing a new instance should ask. Writes the org/app name (branding
 * `appName`) shown across the app. Branding is a premium capability, so when the instance isn't entitled the
 * step shows a compact upsell rather than a broken input. Admin-gated (the server re-checks). Reuses the
 * `/api/branding` write path that the Branding admin uses, so there's one source of truth for the name.
 */
export function OrgIdentityStep({ isAdmin = true }: { isAdmin?: boolean }) {
  const brand = useBranding();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? (brand.appName ?? "");

  const save = async (): Promise<void> => {
    if (!isAdmin || !brand.entitled || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/branding", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: value.trim() || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await qc.invalidateQueries({ queryKey: ["branding"] });
      toast({ title: "ORGANISATION NAMED", description: value.trim() || "Reset to the default name" });
    } catch {
      toast({ title: "COULD NOT SAVE", description: "Check your permissions and plan, then try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="org-identity-step">
      <div className="flex items-center gap-3">
        <Building2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-bold">Name your organisation</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">The name shown across the app — in the browser title and the header.</p>

      {brand.entitled ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-muted-foreground mb-1">Organisation name</span>
            <input
              data-testid="org-name-input"
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Acme Inc."
              disabled={!isAdmin}
              className="border border-border bg-background px-2 py-1.5 text-sm min-w-56"
            />
          </label>
          <button
            type="button"
            data-testid="org-name-save"
            disabled={!isAdmin || saving}
            onClick={() => void save()}
            className="border border-primary bg-primary px-3 py-1.5 text-xs font-black uppercase tracking-widest text-primary-foreground disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save name"}
          </button>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="org-name-locked">
          <Lock className="w-3 h-3" />Your organisation's name and logo are part of <strong>Branding</strong>, available on a paid plan.
        </p>
      )}
    </section>
  );
}
