import { type SetupStatus } from "../../lib/setup";
import { CAP_DOMAINS, Dot, Step } from "./shared";

export function StatusStep({ status }: { status: SetupStatus | undefined }) {
  const caps = status?.capabilities ?? undefined;

  return (
    /* Step 1 — current status */
    <Step n={1} title="Status">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="border border-border p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">broker</div>
          <div className="flex items-center gap-2 font-bold text-sm">
            <Dot on={status?.broker.configured} />
            {status?.broker.configured ? "Connected" : "Demo (sample data)"}
          </div>
        </div>
        <div className="border border-border p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Identity</div>
          <div className="flex items-center gap-2 font-bold text-sm">
            <Dot on={status?.auth.mode === "oidc"} />
            {status?.auth.mode === "oidc" ? "OIDC (SSO)" : "Demo login"}
          </div>
        </div>
        <div className="border border-border p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Your role</div>
          <div className="font-bold text-sm uppercase">{status?.role}</div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Capabilities (mode: {caps?.mode ?? "—"})</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
          {CAP_DOMAINS.map((d) => (
            <div key={d} className="flex items-center gap-2 text-sm font-mono">
              <Dot on={caps ? (caps[d] as boolean) : undefined} />
              {d}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Greyed = unknown (not probed yet). These come from your broker workflow's <span className="font-mono">get_capabilities</span>.
        </p>
      </div>

      {status?.realtime && (
        <div className="flex items-center gap-2 text-xs border-t border-border pt-3">
          <Dot on={status.realtime.enabled} />
          <span className="font-bold uppercase tracking-widest text-muted-foreground">Real-time:</span>
          <span>{status.realtime.enabled ? "enabled" : "disabled (set NOTIFY_INGEST_SECRET)"}</span>
          <span className="font-mono text-muted-foreground">· fan-out: {status.realtime.bus}{status.realtime.bus === "in-process" ? " (single replica — set REDIS_URL for HA)" : ""}</span>
        </div>
      )}

      {status?.audit && (
        <div className="flex items-center gap-2 text-xs">
          <Dot on={status.audit.level !== "off"} />
          <span className="font-bold uppercase tracking-widest text-muted-foreground">Audit:</span>
          <span className="font-mono uppercase">{status.audit.level}</span>
          <span className="font-mono text-muted-foreground">
            · sink: {status.audit.sink ? "logging server" : "stdout only (set AUDIT_HTTP_URL to ship)"}
          </span>
        </div>
      )}
    </Step>
  );
}
