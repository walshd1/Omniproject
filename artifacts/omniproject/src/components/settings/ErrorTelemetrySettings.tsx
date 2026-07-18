import { Bug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useErrorTelemetry, useSaveErrorTelemetry } from "@/lib/error-telemetry-api";

/**
 * Admin control for internal client-error telemetry. OFF by default, matching the app's
 * no-external-telemetry posture. When on, the SPA reports uncaught render errors (message +
 * component stack + page — never user or project data) to the gateway's own audit log; nothing
 * leaves the deployment. Admin-only, mirroring the other diagnostics controls.
 *
 * It's a SECURITY-classified `error-telemetry` config def (roadmap Phase C): enabling it REDUCES the
 * posture, so the save may be HELD for a signed sign-off (the response carries `pending`) rather than
 * applied at once — the toast reflects which happened.
 */
export function ErrorTelemetrySettings() {
  const { data: enabled } = useErrorTelemetry(true);
  const update = useSaveErrorTelemetry();
  const { toast } = useToast();

  const save = (next: boolean) => {
    update.mutate(next, {
      onSuccess: (res) => {
        if (res?.pending) {
          toast({
            title: "SIGN-OFF REQUIRED",
            description: "Enabling error telemetry reduces the security posture — it's held for a signed sign-off. See Approvals.",
          });
          return;
        }
        toast({
          title: next ? "ERROR TELEMETRY ENABLED" : "ERROR TELEMETRY DISABLED",
          description: next
            ? "Uncaught UI errors are now recorded to the internal audit log."
            : "Client-error reporting stopped.",
        });
      },
      onError: () => toast({ title: "COULD NOT SAVE", description: "Please try again.", variant: "destructive" }),
    });
  };

  return (
    <section data-testid="error-telemetry-settings">
      <div className="flex items-center gap-3 mb-4">
        <Bug className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Error telemetry (diagnostics)</h2>
        <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${enabled ? "border-blue-500/40 text-blue-500 bg-blue-500/10" : "border-border text-muted-foreground"}`}>
          {enabled ? "Enabled" : "Off"}
        </span>
      </div>

      <div className="bg-card border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Opt-in: when a screen hits an uncaught error, record the error message, the component
          stack and the page it happened on to this deployment's <strong>internal audit log</strong> —
          nothing is sent to any third party, and no user or project data is included. Helps you
          spot recurring UI failures. Off by default.
        </p>

        <div className="flex items-center gap-2 pt-1">
          {enabled ? (
            <button
              type="button"
              onClick={() => save(false)}
              disabled={update.isPending}
              data-testid="error-telemetry-disable"
              className="inline-flex items-center gap-2 border border-red-500/50 text-red-500 px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-red-500/10 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Disable
            </button>
          ) : (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={update.isPending}
              data-testid="error-telemetry-enable"
              className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {update.isPending ? "SAVING…" : "Enable"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
