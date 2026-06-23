import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSettings,
  getGetCapabilitiesQueryKey,
  getGetSettingsQueryKey,
  type Capabilities,
} from "@workspace/api-client-react";
import { CheckCircle2, XCircle, Circle, Copy, Loader2, Download, Save, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useSetupStatus,
  testN8nConnection,
  fetchConfigExport,
  fetchBackends,
  downloadWorkflow,
  verifyWorkflow,
  downloadSnapshot,
  restoreSnapshot,
  type N8nTestResult,
  type ExportFormat,
  type BackendInfo,
  type VerifyResult,
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

  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [backendId, setBackendId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const isAdmin = roleAtLeast(status?.role, "admin");
  const caps = status?.capabilities ?? undefined;
  const selectedBackend = backends.find((b) => b.id === backendId);

  useEffect(() => {
    fetchConfigExport(format).then(setSnippet).catch(() => setSnippet("# could not load config (admin only)"));
  }, [format, status?.n8n.webhookUrlSet]);

  useEffect(() => {
    fetchBackends().then((b) => { setBackends(b); setBackendId((id) => id || b[0]?.id || ""); }).catch(() => setBackends([]));
  }, []);

  const generate = async () => {
    if (!backendId) return;
    setGenerating(true);
    try {
      await downloadWorkflow(backendId, url.trim() ? new URL(url.trim()).pathname.split("/").pop() : undefined);
      toast({ title: "WORKFLOW DOWNLOADED", description: `Import omniproject-${backendId}.json into n8n.` });
    } catch {
      toast({ title: "ERROR", description: "Could not generate (admin only).", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      setVerifyResult(await verifyWorkflow());
    } catch (e) {
      toast({ title: "VERIFY FAILED", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  const onRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text());
      const result = await restoreSnapshot(snapshot);
      queryClient.invalidateQueries({ queryKey: ["setup", "status"] });
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCapabilitiesQueryKey() });
      toast({
        title: "CONFIG RESTORED",
        description: result.warnings?.length ? `${result.warnings.length} warning(s) — check the console.` : "Settings restored from snapshot.",
      });
      if (result.warnings?.length) console.warn("Restore warnings:", result.warnings);
    } catch (e) {
      toast({ title: "RESTORE FAILED", description: e instanceof Error ? e.message : "Invalid snapshot file.", variant: "destructive" });
    }
  };

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

          {status?.realtime && (
            <div className="flex items-center gap-2 text-xs border-t border-border pt-3">
              <Dot on={status.realtime.enabled} />
              <span className="font-bold uppercase tracking-widest text-muted-foreground">Real-time:</span>
              <span>{status.realtime.enabled ? "enabled" : "disabled (set NOTIFY_INGEST_SECRET)"}</span>
              <span className="font-mono text-muted-foreground">· fan-out: {status.realtime.bus}{status.realtime.bus === "in-process" ? " (single replica — set REDIS_URL for HA)" : ""}</span>
            </div>
          )}
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

        {/* Step 4 — generate workflow */}
        <Step n={4} title="Generate an n8n workflow">
          <p className="text-xs text-muted-foreground">
            Pick your backend and download a ready-to-import n8n workflow that implements the OmniProject contract.
            Backend wiring lives in the workflow (in your n8n) — OmniProject stays decoupled.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={backendId}
              onChange={(e) => setBackendId(e.target.value)}
              className="bg-background border border-border px-3 py-2 text-sm font-mono uppercase"
            >
              {backends.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            <button
              onClick={generate}
              disabled={generating || !backendId || !isAdmin}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download workflow
            </button>
            {selectedBackend && (
              <a href={selectedBackend.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline">
                {selectedBackend.label} API docs ↗
              </a>
            )}
          </div>
          {selectedBackend && (
            <div className="border border-border bg-background p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground uppercase tracking-widest">Integration:</span>
                <span className="font-bold border border-primary/40 text-primary px-1.5 py-0.5">{selectedBackend.via}</span>
                {selectedBackend.credentialType && (
                  <span className="font-mono text-muted-foreground">credential: {selectedBackend.credentialType}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground uppercase tracking-widest">Required env in n8n: </span>
                {selectedBackend.requiredEnv.length === 0
                  ? <span className="text-muted-foreground">none (auth via n8n credential)</span>
                  : selectedBackend.requiredEnv.map((e) => <span key={e} className="font-mono mr-2 border border-border px-1">{e}</span>)}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(selectedBackend.capabilities).map(([d, on]) => (
                  <span key={d} className="flex items-center gap-1.5 font-mono"><Dot on={on} /> {d}</span>
                ))}
              </div>
              {selectedBackend.notes && <p className="text-muted-foreground">{selectedBackend.notes}</p>}
            </div>
          )}
        </Step>

        {/* Step 5 — verify workflow */}
        <Step n={5} title="Verify your workflow">
          <p className="text-xs text-muted-foreground">
            Probe your connected n8n for each read action. Sends <span className="font-mono">{`{ verify: true }`}</span> so a
            generated workflow short-circuits and nothing touches your backend. Write actions are never probed.
          </p>
          <button
            onClick={runVerify}
            disabled={verifying || !isAdmin || !status?.n8n.configured}
            className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
          >
            {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Run verification
          </button>
          {!status?.n8n.configured && (
            <p className="text-xs text-amber-500">Connect n8n first (step 2) to verify.</p>
          )}
          {verifyResult && (
            <div className="border border-border bg-background">
              <div className="p-3 border-b border-border flex items-center justify-between text-sm">
                <span className="font-black uppercase tracking-widest">
                  {verifyResult.summary.passed}/{verifyResult.summary.total} actions responding
                </span>
                {verifyResult.summary.verifyAware && <span className="text-[10px] text-green-500 uppercase tracking-widest">verify-aware ✓</span>}
              </div>
              <div className="divide-y divide-border">
                {verifyResult.results.map((r) => (
                  <div key={r.action} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <Dot on={r.ok} />
                    <span className="font-mono flex-1">{r.action}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{r.status || "—"} · {r.ms}ms</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground p-3 border-t border-border">{verifyResult.note}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            For a full CLI contract test: <span className="font-mono">OMNI_API_BASE=https://your-omni pnpm --filter @workspace/scripts run verify-n8n</span>
          </p>
        </Step>

        {/* Step 6 — backup & restore */}
        <Step n={6} title="Backup & restore">
          <p className="text-xs text-muted-foreground">
            Take a JSON snapshot of the gateway config before a risky change or a port — and restore it if setup goes
            wrong. Secrets stay in your environment (use the config export above for those); this captures the runtime
            settings.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => downloadSnapshot().catch(() => toast({ title: "ERROR", description: "Could not download (admin only).", variant: "destructive" }))}
              disabled={!isAdmin}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
            >
              <Save className="w-3.5 h-3.5" /> Download backup
            </button>
            <label className={`px-4 py-2 text-xs font-black uppercase tracking-widest border border-border flex items-center gap-2 cursor-pointer hover:border-primary ${!isAdmin ? "opacity-40 pointer-events-none" : ""}`}>
              <Upload className="w-3.5 h-3.5" /> Restore from file
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { onRestoreFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
          </div>
          {!isAdmin && <p className="text-xs text-amber-500">Backup & restore require the admin role.</p>}
        </Step>
      </div>
    </div>
  );
}
