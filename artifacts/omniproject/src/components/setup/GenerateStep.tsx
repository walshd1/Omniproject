import { useEffect, useState } from "react";
import { Loader2, Download, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchBackends, downloadWorkflow, type BackendInfo, type SetupStatus } from "../../lib/setup";
import { Dot, Step } from "./shared";

export function GenerateStep({
  url,
  isAdmin,
  status,
}: {
  url: string;
  isAdmin: boolean;
  status: SetupStatus | undefined;
}) {
  const { toast } = useToast();

  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [backendId, setBackendId] = useState("");
  const [generating, setGenerating] = useState(false);

  const selectedBackend = backends.find((b) => b.id === backendId);
  const enterpriseEntitled = !!status?.licensing?.features.includes("enterprise_workflows");
  const enterpriseLocked = selectedBackend?.tier === "enterprise" && !enterpriseEntitled;

  useEffect(() => {
    fetchBackends().then((b) => { setBackends(b); setBackendId((id) => id || b[0]?.id || ""); }).catch(() => setBackends([]));
  }, []);

  const generate = async () => {
    if (!backendId) return;
    setGenerating(true);
    try {
      await downloadWorkflow(backendId, url.trim() ? new URL(url.trim()).pathname.split("/").pop() : undefined);
      toast({ title: "WORKFLOW DOWNLOADED", description: `Import omniproject-${backendId}.json into n8n.` });
    } catch (e) {
      toast({ title: "ERROR", description: e instanceof Error ? e.message : "Could not generate (admin only).", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    /* Step 4 — generate workflow */
    <Step n={4} title="Generate an n8n workflow">
      <p className="text-xs text-muted-foreground">
        Pick your backend and download a ready-to-import n8n workflow that implements the OmniProject contract.
        Backend wiring lives in the workflow (in your n8n) — OmniProject stays decoupled.
      </p>
      {enterpriseLocked && (
        <div className="flex items-center gap-2 text-xs font-mono text-amber-600 dark:text-amber-400 border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>
            <span className="font-bold uppercase">Enterprise integration</span> — generating the {selectedBackend?.label} workflow
            (SAP, Primavera, Dynamics 365, MS Project, …) requires a licence with the <code>enterprise_workflows</code> feature.
            The standard backends (Jira, OpenProject, GitHub, …) stay free.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={backendId}
          onChange={(e) => setBackendId(e.target.value)}
          className="bg-background border border-border px-3 py-2 text-sm font-mono uppercase"
        >
          {backends.map((b) => (
            <option key={b.id} value={b.id}>{b.label}{b.tier === "enterprise" ? "  ★ Enterprise" : ""}</option>
          ))}
        </select>
        <button
          onClick={generate}
          disabled={generating || !backendId || !isAdmin || enterpriseLocked}
          className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : enterpriseLocked ? <Lock className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
          {enterpriseLocked ? "Licensed feature" : "Download workflow"}
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
  );
}
