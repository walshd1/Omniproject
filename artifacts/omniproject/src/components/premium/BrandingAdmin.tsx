import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
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
import { Section, LockNotice, Field } from "./shared";

/**
 * White-label branding panel — edit the app name, logo, colours and footer that re-skin the
 * shell. Gated by the `branding` licence entitlement. Part of the premium overlay admin.
 */

interface BrandingForm {
  appName: string; shortName: string; logoUrl: string; primaryColor: string;
  loginHeading: string; footerText: string; supportUrl: string;
  fontFamily: string;
}
const EMPTY_BRAND: BrandingForm = { appName: "", shortName: "", logoUrl: "", primaryColor: "", loginHeading: "", footerText: "", supportUrl: "", fontFamily: "" };

export function BrandingAdmin({ entitled }: { entitled: boolean }) {
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
