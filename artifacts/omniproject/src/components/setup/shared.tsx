import { useQueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, getGetSettingsQueryKey, type Capabilities } from "@workspace/api-client-react";
import { CheckCircle2, XCircle, Circle } from "lucide-react";

export const CAP_DOMAINS: (keyof Capabilities)[] = [
  "issues", "scheduling", "resources", "financials", "portfolio", "baseline", "blockers", "history", "raid",
];

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
