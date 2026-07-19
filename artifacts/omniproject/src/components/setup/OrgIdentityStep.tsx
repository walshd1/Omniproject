import { useEffect, useState } from "react";
import { Building2, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "../../lib/branding";

/**
 * "Name your organisation" — the first thing a new instance should ask, and it is UNGATED: naming the org is
 * NOT the premium white-label `appName` (branding). The name is written to the canonical org-identity record
 * (`/api/org-identity`) — the org id + name that sits at the top of the org-level JSON — so every deployment can
 * name itself, licence or none.
 *
 * Branding (the white-label logo + `appName` override shown in the header/title) stays premium: when the
 * instance is entitled we ALSO mirror the name into branding so the header reflects it; when it isn't, naming
 * still works and we show a compact note that the logo/white-label override is a paid add-on (no longer a hard
 * gate on the name itself). Admin-gated (the server re-checks).
 */
export function OrgIdentityStep({ isAdmin = true }: { isAdmin?: boolean }) {
  const brand = useBranding();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed the field from the canonical org-identity record (falls back to any branding appName already set).
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/org-identity", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { identity?: { name?: string } };
        if (live && typeof body.identity?.name === "string") setCurrent(body.identity.name);
      } catch { /* leave the field empty; the placeholder guides the user */ }
    })();
    return () => { live = false; };
  }, []);

  const value = draft ?? current ?? "";

  const save = async (): Promise<void> => {
    if (!isAdmin || saving) return;
    const name = value.trim();
    setSaving(true);
    try {
      // Ungated: the canonical org name (the org-identity record). This ALWAYS works.
      const res = await fetch("/api/org-identity", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Premium mirror: when entitled, also update the white-label header/title so it matches. Best-effort —
      // a failure here never fails the (ungated) naming above.
      if (brand.entitled) {
        try {
          await fetch("/api/branding", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appName: name || null }),
          });
          await qc.invalidateQueries({ queryKey: ["branding"] });
        } catch { /* header stays on the default; the org is still named */ }
      }
      setCurrent(name);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["org-identity"] });
      toast({ title: "ORGANISATION NAMED", description: name || "Reset to the default name" });
    } catch {
      toast({ title: "COULD NOT SAVE", description: "Check your permissions, then try again.", variant: "destructive" });
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
      <p className="mt-1 text-sm text-muted-foreground">Your organisation's name — the canonical identity for this deployment.</p>

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

      {!brand.entitled && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="org-name-branding-note">
          <Lock className="w-3 h-3" />A custom logo and white-label <strong>Branding</strong> (replacing the product name in the header) are on a paid plan — naming your organisation is always free.
        </p>
      )}
    </section>
  );
}
