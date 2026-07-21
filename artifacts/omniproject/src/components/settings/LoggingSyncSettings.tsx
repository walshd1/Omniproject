import { useEffect, useState } from "react";
import { ServerCog, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { urlFormatError } from "../../lib/validation";
import { useLoggingSync, useSaveLoggingSync } from "../../lib/logging-sync-api";

/**
 * Admin control for the opt-in state-history egress (the "logging server").
 * OFF by default; the single deliberate relaxation of the stateless posture and
 * the same trust class as the OData/Power-BI feeds. Enabling it requires a
 * destination URL AND an explicit acknowledgement that egressed data leaves
 * OmniProject's warranty — the server enforces both. Turning it on unlocks
 * historical time-travel.
 *
 * It's a SECURITY-classified `logging-sync` config def (roadmap Phase C): enabling (or redirecting the
 * destination) reduces the posture, so the save may be HELD for a signed sign-off (the response carries
 * `pending`) rather than applied at once — the toast reflects which happened.
 */
export function LoggingSyncSettings() {
  const { data: sync } = useLoggingSync();
  const update = useSaveLoggingSync();
  const { toast } = useToast();

  const enabled = !!sync?.enabled;
  const [url, setUrl] = useState("");
  const [ack, setAck] = useState(false);

  useEffect(() => {
    if (sync) {
      setUrl(sync.url ?? "");
      setAck(sync.acknowledgedWarranty);
    }
  }, [sync?.url, sync?.acknowledgedWarranty]);

  const urlError = urlFormatError(url);
  const canEnable = !!url.trim() && !urlError && ack && !update.isPending;

  const save = (nextEnabled: boolean) => {
    update.mutate(
      { enabled: nextEnabled, url: url.trim() || null, acknowledgedWarranty: ack },
      {
        onSuccess: (res) => {
          if (res?.pending) {
            toast({
              title: "SIGN-OFF REQUIRED",
              description: "Enabling egress reduces the security posture — it's held for a signed sign-off. See Approvals.",
            });
            return;
          }
          toast({
            title: nextEnabled ? "LOGGING SYNC ENABLED" : "LOGGING SYNC DISABLED",
            description: nextEnabled ? "Historical time-travel is now unlocked." : "Egress stopped; time-travel locked.",
          });
        },
        onError: () => toast({ title: "COULD NOT SAVE", description: "Check the URL and the acknowledgement.", variant: "destructive" }),
      },
    );
  };

  return (
    <section data-testid="logging-sync-settings">
      <div className="flex items-center gap-3 mb-4">
        <ServerCog className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Logging server (history & time-travel)</h2>
        <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${enabled ? "border-blue-500/40 text-blue-500 bg-blue-500/10" : "border-border text-muted-foreground"}`}>
          {enabled ? "Enabled" : "Off"}
        </span>
      </div>

      <div className="bg-card border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Opt-in: stream point-in-time state to a logging server you own (the same trust class as the OData / Power BI feeds),
          to retain durable history and unlock back/forward time-travel. OmniProject still stores nothing itself.
        </p>

        <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground" htmlFor="logging-sync-url">
          Logging server URL
        </label>
        <input
          id="logging-sync-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://logs.internal:9200/omni-history"
          aria-invalid={!!urlError}
          aria-describedby={urlError ? "logging-sync-url-error" : undefined}
          className="w-full px-3 py-2 text-sm bg-background border border-border outline-none focus:border-primary font-mono"
        />
        {urlError && (
          <p id="logging-sync-url-error" role="alert" className="text-xs font-bold text-red-500">{urlError}</p>
        )}

        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            aria-label="Acknowledge that egressed data is outside OmniProject's warranty"
            className="mt-0.5"
          />
          <span className="flex items-start gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            I acknowledge that data sent to this server leaves OmniProject's control and <strong>warranty</strong> — my
            organisation is responsible for its security, retention and residency.
          </span>
        </label>

        <div className="flex items-center gap-2 pt-1">
          {enabled ? (
            <button
              type="button"
              onClick={() => save(false)}
              disabled={update.isPending}
              data-testid="logging-sync-disable"
              className="inline-flex items-center gap-2 border border-red-500/50 text-red-500 px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-red-500/10 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Disable egress
            </button>
          ) : (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={!canEnable}
              data-testid="logging-sync-enable"
              className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {update.isPending ? "SAVING…" : "Enable egress & unlock time-travel"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
