import { useRef, useState } from "react";
import { Building2, Lock, ImageUp, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "../../lib/branding";
import { useOrgIdentity, ORG_IDENTITY_QUERY_KEY } from "../../lib/org-identity";

/**
 * "Name your organisation" — the first thing a new instance should ask, and it is UNGATED: the name AND the
 * org's own logo are written to the canonical org-identity record (`/api/org-identity`), the org id + name +
 * logo that sit at the top of the org-level JSON. Every deployment can name and badge itself, licence or none.
 *
 * The logo is the ORG's asset for THEIR deliverables — surfaced on screens/reports/exports when they opt in
 * (`showLogo`). It is distinct from the premium `branding` feature, which white-labels the PRODUCT chrome
 * (header/login): when entitled we ALSO mirror the name into branding so the header matches; when not, naming +
 * the logo still work, and only the product white-label is flagged as a paid add-on.
 */

/** Raster image types we accept for a logo (SVG is excluded server-side — it can carry script). */
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** ~192 KB decoded — the server caps the stored (base64) string at 256 KB. */
const MAX_LOGO_BYTES = 192 * 1024;

export function OrgIdentityStep({ isAdmin = true }: { isAdmin?: boolean }) {
  const brand = useBranding();
  const org = useOrgIdentity();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [logoDraft, setLogoDraft] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const name = nameDraft ?? org?.name ?? "";
  const logo = logoDraft ?? org?.logo ?? "";
  const showLogo = showDraft ?? org?.showLogo ?? false;

  const pickLogo = (file: File | undefined): void => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      toast({ title: "UNSUPPORTED IMAGE", description: "Use a PNG, JPEG, WebP or GIF (SVG isn't allowed).", variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({ title: "IMAGE TOO LARGE", description: "Keep the logo under ~190 KB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") { setLogoDraft(reader.result); if (showDraft === null) setShowDraft(true); } };
    reader.readAsDataURL(file);
  };

  const save = async (): Promise<void> => {
    if (!isAdmin || saving) return;
    const trimmed = name.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/org-identity", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, logo, showLogo }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Premium mirror: when entitled, also update the white-label header/title. Best-effort — a failure here
      // never fails the (ungated) identity save above.
      if (brand.entitled) {
        try {
          await fetch("/api/branding", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appName: trimmed || null }),
          });
          await qc.invalidateQueries({ queryKey: ["branding"] });
        } catch { /* header stays on the default; the org is still named */ }
      }
      setNameDraft(null); setLogoDraft(null); setShowDraft(null);
      await qc.invalidateQueries({ queryKey: ORG_IDENTITY_QUERY_KEY });
      toast({ title: "ORGANISATION SAVED", description: trimmed || "Reset to the default name" });
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
      <p className="mt-1 text-sm text-muted-foreground">Your organisation's name and logo — the canonical identity for this deployment.</p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-muted-foreground mb-1">Organisation name</span>
          <input
            data-testid="org-name-input"
            value={name}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Acme Inc."
            disabled={!isAdmin}
            className="border border-border bg-background px-2 py-1.5 text-sm min-w-56"
          />
        </label>
      </div>

      {/* Org logo (ungated) — the org's own asset, optionally shown on screens/reports/exports. */}
      <div className="mt-4">
        <span className="block text-xs text-muted-foreground mb-1">Organisation logo</span>
        <div className="flex flex-wrap items-center gap-3">
          {logo ? (
            <span className="inline-flex items-center gap-2 rounded border border-border bg-background px-2 py-1">
              <img src={logo} alt="Organisation logo preview" data-testid="org-logo-preview" style={{ maxHeight: 28, width: "auto" }} />
              <button type="button" data-testid="org-logo-clear" disabled={!isAdmin} onClick={() => setLogoDraft("")} className="text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Remove logo">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No logo yet.</span>
          )}
          <input ref={fileRef} type="file" accept={LOGO_TYPES.join(",")} data-testid="org-logo-input" className="hidden" onChange={(e) => pickLogo(e.target.files?.[0])} />
          <button
            type="button"
            disabled={!isAdmin}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 border border-border bg-background px-3 py-1.5 text-xs font-bold uppercase tracking-widest disabled:opacity-40"
          >
            <ImageUp className="w-3.5 h-3.5" />{logo ? "Replace" : "Upload logo"}
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" data-testid="org-logo-show" checked={showLogo} disabled={!isAdmin || !logo} onChange={(e) => setShowDraft(e.target.checked)} />
          Show this logo on screens, reports &amp; exports
        </label>
      </div>

      <div className="mt-4">
        <button
          type="button"
          data-testid="org-name-save"
          disabled={!isAdmin || saving}
          onClick={() => void save()}
          className="border border-primary bg-primary px-3 py-1.5 text-xs font-black uppercase tracking-widest text-primary-foreground disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save organisation"}
        </button>
      </div>

      {!brand.entitled && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="org-name-branding-note">
          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            This names <em>your&nbsp;organisation on OmniProject</em> — free on every plan. The paid <strong>Branding</strong> add-on is a full <strong>whitebox</strong>: the product name itself becomes yours (e.g. “Acme&nbsp;Ltd PPM&nbsp;&amp; Resource Management System”), with no OmniProject shown anywhere.
          </span>
        </p>
      )}
    </section>
  );
}
