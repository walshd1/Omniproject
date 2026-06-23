import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSettings,
  getGetCapabilitiesQueryKey,
  getGetSettingsQueryKey,
  type Capabilities,
} from "@workspace/api-client-react";
import { CheckCircle2, XCircle, Circle, Copy, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useSetupStatus,
  testN8nConnection,
  fetchConfigExport,
  type N8nTestResult,
  type ExportFormat,
} from "../lib/setup";
import { roleAtLeast } from "../lib/auth";

const CAP_DOMAINS: (keyof Capabilities)[] = [
  "issues", "scheduling", "resources", "financials", "portfolio", "baseline", "blockers", "history", "raid",
];

function Dot({ on }: { on: boolean | undefined }) {
  if (on === undefined) return <Circle className="w-4 h-4 text-muted-foreground/40" />;
  return on ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
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

export function Setup() {
  const { data: status, isLoading } = useSetupStatus();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<N8nTestResult | null>(null);
  const [format, setFormat] = useState<ExportFormat>("env");
  const [snippet, setSnippet] = useState("");

  const isAdmin = roleAtLeast(status?.role, "admin");
  const caps = status?.capabilities ?? undefined;

  useEffect(() => {
    fetchConfigExport(format).then(setSnippet).catch(() => setSnippet("# could not load config (admin only)"));
  }, [format, status?.n8n.webhookUrlSet]);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testN8nConnection(url.trim()));
    } catch {
      setResult({ reachable: false, error: "Test request failed" });
    } finally {
      setTesting(false);
    }
  };

  const applyForSession = () => {
    updateSettings.mutate(
      { data: { n8nWebhookUrl: url.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["setup", "status"] });
          queryClient.invalidateQueries({ queryKey: getGetCapabilitiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          toast({ title: "APPLIED FOR THIS SESSION", description: "Persist the config below to make it durable." });
        },
        onError: () => toast({ title: "ERROR", description: "Could not apply (admin only).", variant: "destructive" }),
      },
    );
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast({ title: "COPIED", description: `${format} config copied to clipboard.` });
    } catch {
      toast({ title: "COPY FAILED", description: "Select and copy manually.", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="p-8 text-center font-bold tracking-widest text-muted-foreground animate-pulse">LOADING…</div>;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="pb-4 border-b border-border">
          <h1 className="text-3xl font-black uppercase tracking-tighter">CONNECTION CENTER</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Wire OmniProject to your n8n + backend. OmniProject stays stateless — this wizard applies settings for the
            current session and emits durable config for you to keep in your environment.
          </p>
        </div>

        {/* Step 1 — current status */}
        <Step n={1} title="Status">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-border p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">n8n broker</div>
              <div className="flex items-center gap-2 font-bold text-sm">
                <Dot on={status?.n8n.configured} />
                {status?.n8n.configured ? "Connected" : "Demo (sample data)"}
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
              Greyed = unknown (not probed yet). These come from your n8n workflow's <span className="font-mono">get_capabilities</span>.
            </p>
          </div>
        </Step>

        {/* Step 2 — connect n8n */}
        <Step n={2} title="Connect n8n">
          {!isAdmin && (
            <div className="text-xs text-amber-500 border border-amber-500/40 bg-amber-500/10 p-3">
              Testing and applying require the <span className="font-mono">admin</span> role.
            </div>
          )}
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">n8n webhook URL</label>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://n8n.example.com/webhook/omniproject"
              className="flex-1 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
            <button
              onClick={runTest}
              disabled={testing || !url.trim() || !isAdmin}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Test
            </button>
          </div>

          {result && (
            <div className={`border p-3 text-sm ${result.reachable && result.ok ? "border-green-500/40 bg-green-500/10" : "border-red-500/40 bg-red-500/10"}`}>
              <div className="flex items-center gap-2 font-bold">
                <Dot on={!!(result.reachable && result.ok)} />
                {result.reachable
                  ? result.ok
                    ? "Reachable — webhook responded"
                    : `Reachable, but responded ${result.status}`
                  : `Unreachable — ${result.error ?? "no response"}`}
              </div>
              {result.reachable && (
                <div className="text-xs text-muted-foreground mt-1">
                  {result.implementsCapabilities
                    ? "Workflow implements get_capabilities ✓ — apply below to use it this session."
                    : "Tip: add a get_capabilities branch to your workflow so OmniProject can label available reports."}
                </div>
              )}
              {result.reachable && result.ok && isAdmin && (
                <button
                  onClick={applyForSession}
                  disabled={updateSettings.isPending}
                  className="mt-3 px-3 py-1.5 text-xs font-black uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {updateSettings.isPending ? "Applying…" : "Apply for this session"}
                </button>
              )}
            </div>
          )}
        </Step>

        {/* Step 3 — persist config */}
        <Step n={3} title="Persist config (keep it in your environment)">
          <p className="text-xs text-muted-foreground">
            OmniProject never stores this for you. Copy it into your <span className="font-mono">.env</span>, compose file
            or k8s manifest so the configuration survives restarts.
          </p>
          <div className="flex gap-1">
            {(["env", "compose", "k8s"] as ExportFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1.5 text-xs font-black uppercase tracking-widest border ${format === f ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
              >
                {f === "env" ? ".env" : f === "compose" ? "docker-compose" : "k8s"}
              </button>
            ))}
            <button onClick={copySnippet} className="ml-auto px-3 py-1.5 text-xs font-black uppercase tracking-widest border border-border hover:border-primary flex items-center gap-2">
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
          <pre className="bg-background border border-border p-4 text-xs font-mono overflow-x-auto whitespace-pre">{snippet}</pre>
        </Step>

        {/* Step 4 — verify */}
        <Step n={4} title="Verify your workflow">
          <p className="text-sm text-muted-foreground">
            Validate your live n8n against the action contract before go-live:
          </p>
          <pre className="bg-background border border-border p-3 text-xs font-mono overflow-x-auto">OMNI_API_BASE=https://your-omni pnpm --filter @workspace/scripts run verify-n8n</pre>
          <p className="text-xs text-muted-foreground">
            See <span className="font-mono">docs/DATA-REQUIREMENTS.md</span> for the full action/capability contract your
            workflow must implement.
          </p>
        </Step>
      </div>
    </div>
  );
}
