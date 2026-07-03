import { useState } from "react";
import { useUpdateSettings } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { testBrokerConnection, type BrokerTestResult } from "../../lib/setup";
import { urlFormatError } from "../../lib/validation";
import { Dot, Step, NeedsHelp, TechDetails, useRefreshAndSettings } from "./shared";

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
  const [result, setResult] = useState<BrokerTestResult | null>(null);
  const urlError = urlFormatError(url);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testBrokerConnection(url.trim()));
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
          toast({ title: "Connected for this session", description: "Make it permanent in step 3 below, so it survives a restart." });
        },
        onError: () => toast({ title: "Couldn't apply that", description: "You may need admin access.", variant: "destructive" }),
      },
    );
  };

  return (
    /* Step 2 — connect the broker */
    <Step n={2} title="Connect your project tool">
      <p className="text-xs text-muted-foreground">
        This is the one address that lets OmniProject talk to your project tool (Jira, OpenProject,
        SAP, or whatever you use) through your automation system. If you don't have it yet, it's
        usually something your IT person or whoever manages your automation tool (often called
        “n8n”) can give you.
      </p>
      <NeedsHelp>
        Don't have this address? Ask whoever manages your automation tool for the <strong>webhook
        URL</strong> of the OmniProject workflow. Nobody set one up yet? See the{" "}
        <a href="https://github.com/walshd1/Omniproject/blob/main/docs/QUICKSTART.md" target="_blank" rel="noreferrer" className="underline">Quickstart guide</a>.
      </NeedsHelp>
      {!isAdmin && (
        <div className="text-xs text-amber-500 border border-amber-500/40 bg-amber-500/10 p-3">
          Only an admin can test or apply this connection — ask your admin if this is greyed out.
        </div>
      )}
      <label htmlFor="broker-webhook-url" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
        Connection address <span className="text-red-500" aria-hidden="true">*</span>
      </label>
      <div className="flex gap-2">
        <input
          id="broker-webhook-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://broker.example.com/webhook/omniproject"
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? "broker-webhook-url-error" : undefined}
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
        <p id="broker-webhook-url-error" role="alert" className="text-xs font-bold text-red-500">{urlError}</p>
      )}

      {result && (
        <div className={`border p-3 text-sm ${result.reachable && result.ok ? "border-green-500/40 bg-green-500/10" : "border-red-500/40 bg-red-500/10"}`}>
          <div className="flex items-center gap-2 font-bold">
            <Dot on={!!(result.reachable && result.ok)} />
            {result.reachable
              ? result.ok
                ? "Connected — it's responding correctly"
                : `Found it, but it answered oddly (code ${result.status}) — worth checking with whoever set it up`
              : `Couldn't reach it${result.error ? ` — ${result.error}` : ""}. Double-check the address, or ask whoever manages it to confirm it's running.`}
          </div>
          {result.reachable && (
            <div className="text-xs text-muted-foreground mt-1">
              {result.implementsCapabilities
                ? "It told us what it can do — apply below to start using it this session."
                : "It's connected, but doesn't yet report what it can do — everyday use still works fine."}
            </div>
          )}
          {result.reachable && !result.implementsCapabilities && (
            <TechDetails label="Tip for whoever built the workflow">
              <p className="text-muted-foreground">
                Add a <span className="font-mono">get_capabilities</span> branch to the workflow so
                OmniProject can label which reports/views are available.
              </p>
            </TechDetails>
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
