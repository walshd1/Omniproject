import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Small presentational primitives shared by the premium admin panels (branding / labels /
 * webhooks). Kept here so each panel lives in its own file without re-declaring them.
 */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6 p-6 border border-border bg-card">
      <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

export function LockNotice({ feature }: { feature: string }) {
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

export function Field({ label, hint, ...rest }: { label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground block">{label}</label>
      <Input className="rounded-none border-border font-mono h-12" {...rest} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
