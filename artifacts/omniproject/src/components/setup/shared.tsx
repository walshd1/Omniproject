import { useQueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, getGetSettingsQueryKey, type Capabilities } from "@workspace/api-client-react";
import { CheckCircle2, XCircle, Circle, ChevronRight, HelpCircle } from "lucide-react";

export const CAP_DOMAINS = [
  "issues", "scheduling", "resources", "financials", "portfolio", "baseline", "blockers", "history", "raid",
] as const satisfies readonly (keyof Capabilities)[];

/** Plain-English label for each capability domain, shown instead of the raw field name. */
export const CAP_LABELS: Record<(typeof CAP_DOMAINS)[number], string> = {
  issues: "Tasks & issues",
  scheduling: "Timelines & schedule",
  resources: "People & workload",
  financials: "Budgets & costs",
  portfolio: "Programme rollup",
  baseline: "Baselines",
  blockers: "Blockers",
  history: "Activity history",
  raid: "Risks & issues log",
};

export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function Dot({ on }: { on: boolean | undefined }) {
  if (on === undefined)
    return <Circle role="img" aria-label="unknown" className="w-4 h-4 text-muted-foreground/40" />;
  return on ? (
    <CheckCircle2 role="img" aria-label="available" className="w-4 h-4 text-green-500" />
  ) : (
    <XCircle role="img" aria-label="unavailable" className="w-4 h-4 text-red-500" />
  );
}

/**
 * Collapsed-by-default technical detail (raw env vars, CLI commands, internal field
 * names). Everyone sees the plain-English copy around it; anyone who wants the exact
 * technical wording — to do it themselves or to hand to whoever manages hosting/IT —
 * expands this. Nothing is removed, just not shown by default.
 */
export function TechDetails({ label = "Show the technical details", children }: { label?: string; children: React.ReactNode }) {
  return (
    <details className="group text-xs border border-border/60 bg-background/40 rounded">
      <summary className="cursor-pointer select-none px-3 py-2 text-muted-foreground hover:text-foreground font-bold uppercase tracking-widest flex items-center gap-1.5">
        <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" aria-hidden="true" />
        {label}
      </summary>
      <div className="px-3 pb-3 space-y-2">{children}</div>
    </details>
  );
}

/** A callout for the handful of steps that genuinely need a technical/hosting person — says so plainly instead of pretending. */
export function NeedsHelp({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-blue-500/40 bg-blue-500/10 p-3 text-xs flex gap-2 items-start">
      <HelpCircle className="w-4 h-4 shrink-0 text-blue-500 mt-0.5" aria-hidden="true" />
      <div className="text-blue-900 dark:text-blue-200">{children}</div>
    </div>
  );
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-background">
        <span className="w-7 h-7 shrink-0 bg-foreground text-background flex items-center justify-center font-black">{n}</span>
        <h2 className="text-sm font-black uppercase tracking-widest">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Invalidate the setup status, settings and capabilities queries together so the
 * UI re-reads everything that a config change can affect. Used wherever a step
 * mutates gateway config (apply, restore, environment switch, rollback).
 */
export function useRefreshAndSettings() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["setup", "status"] });
    queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCapabilitiesQueryKey() });
  };
}
