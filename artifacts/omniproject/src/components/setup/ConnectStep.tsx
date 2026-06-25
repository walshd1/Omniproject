import { useState } from "react";
import { useUpdateSettings } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { testN8nConnection, type N8nTestResult } from "../../lib/setup";
import { urlFormatError } from "../../lib/validation";
import { Dot, Step, useRefreshAndSettings } from "./shared";

export function ConnectStep({
  url,
  setUrl,
  isAdmin,
}: {
  url: string;
  setUrl: (url: string) => void;
  isAdmin: boolean;
}) {
  const updateSettings = useUpdateSettings();
  const refreshAndSettings = useRefreshAndSettings();
  const { toast } = useToast();

  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<N8nTestResult | null>(null);
  const urlError = urlFormatError(url);

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
      { data: { brokerUrl: url.trim() || null } },
      {
        onSuccess: () => {
          refreshAndSettings();
          toast({ title: "APPLIED FOR THIS SESSION", description: "Persist the config below to make it durable." });
        },
        onError: () => toast({ title: "ERROR", description: "Could not apply (admin only).", variant: "destructive" }),
      },
    );
  };

  return (
    /* Step 2 — connect n8n */
    <Step n={2} title="Connect n8n">
      {!isAdmin && (
        <div className="text-xs text-amber-500 border border-amber-500/40 bg-amber-500/10 p-3">
          Testing and applying require the <span className="font-mono">admin</span> role.
        </div>
      )}
      <label htmlFor="n8n-webhook-url" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
        n8n webhook URL <span className="text-red-500" aria-hidden="true">*</span>
      </label>
      <div className="flex gap-2">
        <input
          id="n8n-webhook-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://n8n.example.com/webhook/omniproject"
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? "n8n-webhook-url-error" : undefined}
          className={`flex-1 bg-background border px-3 py-2 text-sm font-mono outline-none focus:border-primary ${urlError ? "border-red-500" : "border-border"}`}
        />
        <button
          onClick={runTest}
          disabled={testing || !url.trim() || !!urlError || !isAdmin}
          className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Test
        </button>
      </div>
      {urlError && (
        <p id="n8n-webhook-url-error" role="alert" className="text-xs font-bold text-red-500">{urlError}</p>
      )}

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
  );
}
