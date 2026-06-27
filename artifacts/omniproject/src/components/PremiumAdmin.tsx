import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLicense } from "../lib/branding";
import { Lock, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/**
 * Admin panels for the licensed overlay features: white-label branding,
 * company nomenclature (label overrides), and outbound webhooks. Each panel is
 * gated by the licence entitlement returned from /api/license — when a feature
 * is locked the editor is disabled and a paywall hint is shown.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6 p-6 border border-border bg-card">
      <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function LockNotice({ feature }: { feature: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono text-amber-600 dark:text-amber-400 border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <Lock className="w-3.5 h-3.5" />
      <span>
        <span className="font-bold uppercase">Licensed feature</span> — “{feature}” requires a valid LICENSE_KEY. Editing is
        disabled until a licence is configured.
      </span>
    </div>
  );
}

function Field({ label, hint, ...rest }: { label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">{label}</label>
      <Input className="rounded-none border-border font-mono h-12" {...rest} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Branding ────────────────────────────────────────────────────────────────────
interface BrandingForm {
  appName: string; shortName: string; logoUrl: string; primaryColor: string;
  loginHeading: string; footerText: string; supportUrl: string;
  fontFamily: string;
}
const EMPTY_BRAND: BrandingForm = { appName: "", shortName: "", logoUrl: "", primaryColor: "", loginHeading: "", footerText: "", supportUrl: "", fontFamily: "" };

function BrandingPanel({ entitled }: { entitled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<BrandingForm>(EMPTY_BRAND);
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["branding", "admin"],
    queryFn: async () => (await fetch("/api/branding", { credentials: "same-origin" })).json(),
    staleTime: 0,
  });
  useEffect(() => {
    if (data) setForm({
      appName: data.appName === "OmniProject" ? "" : data.appName ?? "",
      shortName: data.shortName === "OP" ? "" : data.shortName ?? "",
      logoUrl: data.logoUrl ?? "", primaryColor: data.primaryColor ?? "",
      loginHeading: data.loginHeading === "Orchestration Shell" ? "" : data.loginHeading ?? "",
      footerText: data.footerText ?? "", supportUrl: data.supportUrl ?? "",
      fontFamily: data.fontFamily ?? "",
    });
  }, [data]);

  const set = (k: keyof BrandingForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/branding", {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      toast({ title: "BRANDING SAVED", description: "Reloading to apply the new brand…" });
      qc.invalidateQueries({ queryKey: ["branding"] });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast({ title: "ERROR", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const reset = async () => {
    await fetch("/api/branding", { method: "DELETE", credentials: "same-origin" });
    qc.invalidateQueries({ queryKey: ["branding"] });
    toast({ title: "BRANDING CLEARED", description: "Reverting to product defaults…" });
    setTimeout(() => window.location.reload(), 800);
  };

  return (
    <Section title="White-label branding">
      {!entitled && <LockNotice feature="branding" />}
      <fieldset disabled={!entitled} className="space-y-6 disabled:opacity-50">
        <Field label="App name" value={form.appName} onChange={set("appName")} placeholder="OmniProject" hint="Shown in the sidebar, login screen and browser tab." />
        <Field label="Short badge" value={form.shortName} onChange={set("shortName")} placeholder="OP" maxLength={6} hint="1–6 characters used in the square logo badge when no logo URL is set." />
        <Field label="Logo URL" value={form.logoUrl} onChange={set("logoUrl")} placeholder="https://cdn.acme.com/logo.svg" hint="Optional. An absolute https URL; replaces the badge." />
        <Field label="Primary colour" value={form.primaryColor} onChange={set("primaryColor")} placeholder="#2563eb" hint="Hex accent colour, e.g. #2563eb." />
        <Field label="Login heading" value={form.loginHeading} onChange={set("loginHeading")} placeholder="Orchestration Shell" />
        <Field label="Footer text" value={form.footerText} onChange={set("footerText")} placeholder="© Acme Corp" />
        <Field label="Support URL" value={form.supportUrl} onChange={set("supportUrl")} placeholder="https://support.acme.com" />
        <Field label="Font family" value={form.fontFamily} onChange={set("fontFamily")} placeholder="Inter, system-ui, sans-serif" hint="Brand font applied on all screens. (Text size + background colour are per-user, in Settings → Accessibility.)" />
        <div className="flex gap-3">
          <Button type="button" onClick={save} disabled={saving} className="rounded-none uppercase font-bold tracking-wider">{saving ? "Saving…" : "Save branding"}</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="rounded-none border-border uppercase font-bold tracking-wider">Reset to default</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset branding to default?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears all white-label branding (app name, logo, colours, footer) and reverts to the product
                  defaults. The page will reload immediately to apply the change.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={reset} className="bg-red-500 text-background hover:bg-red-600">Reset & reload</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </fieldset>
    </Section>
  );
}

// ── Nomenclature (labels) ─────────────────────────────────────────────────────
interface LabelCatalogItem { key: string; default: string; }

function LabelsPanel({ entitled }: { entitled: boolean }) {
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

// ── Webhooks ───────────────────────────────────────────────────────────────────
interface Webhook { id: string; url: string; events: string[]; active: boolean; description?: string; secretSet: boolean; }

function WebhooksPanel({ entitled }: { entitled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("*");
  const [description, setDescription] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);

  const { data } = useQuery<{ entitled: boolean; events: string[]; webhooks: Webhook[] }>({
    queryKey: ["webhooks"],
    queryFn: async () => (await fetch("/api/webhooks", { credentials: "same-origin" })).json(),
    staleTime: 0,
  });
  const hooks = data?.webhooks ?? [];

  const add = async () => {
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events: events.split(",").map((s) => s.trim()).filter(Boolean), description }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRevealed({ id: json.webhook.id, secret: json.webhook.secret });
      setUrl(""); setDescription(""); setEvents("*");
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast({ title: "WEBHOOK ADDED", description: "Copy the signing secret now — it won't be shown again." });
    } catch (e) {
      toast({ title: "ERROR", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast({ title: "WEBHOOK DELETED", description: "Deliveries to this endpoint have stopped." });
    } catch (e) {
      toast({ title: "ERROR", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    }
  };

  const test = async (id: string) => {
    const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST", credentials: "same-origin" });
    const json = await res.json();
    const r = json.result;
    toast({
      title: r?.ok ? "TEST DELIVERED" : "TEST FAILED",
      description: r ? `HTTP ${r.status} in ${r.ms}ms${r.error ? ` — ${r.error}` : ""}` : json.error,
      variant: r?.ok ? undefined : "destructive",
    });
  };

  return (
    <Section title="Outbound webhooks">
      {!entitled && <LockNotice feature="webhooks" />}
      <p className="text-xs text-muted-foreground">Push events (notifications, audit, config changes) to a customer endpoint, SIEM, Slack or an n8n webhook node. Each delivery is HMAC-signed with the subscription secret (header <code>X-OmniProject-Signature</code>).</p>

      {hooks.length > 0 && (
        <div className="space-y-2">
          {hooks.map((h) => (
            <div key={h.id} className="flex items-center gap-3 border border-border p-3 text-xs font-mono">
              <span className={`w-2 h-2 rounded-full ${h.active ? "bg-green-500" : "bg-muted-foreground"}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate">{h.url}</div>
                <div className="text-muted-foreground">{h.events.join(", ")}{h.description ? ` · ${h.description}` : ""}</div>
              </div>
              <Button type="button" variant="outline" disabled={!entitled} onClick={() => test(h.id)} className="rounded-none border-border h-8 text-xs uppercase">Test</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Delete webhook"><Trash2 className="w-4 h-4" /></button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Deliveries to <span className="font-mono break-all">{h.url}</span> will stop immediately and the
                      signing secret is destroyed. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove(h.id)} className="bg-red-500 text-background hover:bg-red-600">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}

      {revealed && (
        <div className="border border-green-500/40 bg-green-500/10 p-3 text-xs font-mono space-y-1">
          <div className="font-bold uppercase">Signing secret (shown once)</div>
          <code className="break-all">{revealed.secret}</code>
        </div>
      )}

      <fieldset disabled={!entitled} className="space-y-3 disabled:opacity-50">
        <Field label="Endpoint URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.acme.com/omni" />
        <Field label="Events" value={events} onChange={(e) => setEvents(e.target.value)} placeholder="*" hint={`Comma-separated, or * for all. Known: ${(data?.events ?? []).join(", ")}`} />
        <Field label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="SIEM forwarder" />
        <Button type="button" onClick={add} disabled={!entitled || !url} className="rounded-none uppercase font-bold tracking-wider">Add webhook</Button>
      </fieldset>
    </Section>
  );
}

// ── Container ──────────────────────────────────────────────────────────────────
export function PremiumAdmin() {
  const { data: license } = useLicense();
  const has = (f: string) => !!license?.features.includes(f);

  return (
    <div className="space-y-8 mt-8">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <h1 className="text-2xl font-black uppercase tracking-tighter">Premium overlay</h1>
        {license && (
          <span className="text-xs font-mono uppercase tracking-widest border border-border px-2 py-1 text-muted-foreground">
            {license.valid ? `${license.tier}${license.expiresInDays != null ? ` · ${license.expiresInDays}d left` : ""}` : "Unlicensed"}
          </span>
        )}
      </div>
      <BrandingPanel entitled={has("branding")} />
      <LabelsPanel entitled={has("labels")} />
      <WebhooksPanel entitled={has("webhooks")} />
    </div>
  );
}
