import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Download, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchBackends, downloadWorkflow, type SetupStatus } from "../../lib/setup";
import { Dot, Step, TechDetails } from "./shared";

export function GenerateStep({
  url,
  isAdmin,
  status,
  backendId,
  setBackendId,
}: {
  url: string;
  isAdmin: boolean;
  status: SetupStatus | undefined;
  backendId: string;
  setBackendId: (id: string) => void;
}) {
  const { toast } = useToast();

  // Same cache key as BackendPicker (ConnectStep, above) — picking a tool there and
  // reaching this step reuses the same network round trip instead of fetching twice.
  const { data: backends = [] } = useQuery({ queryKey: ["setup-backends"], queryFn: fetchBackends, staleTime: 60_000 });
  const [generating, setGenerating] = useState(false);

  const selectedBackend = backends.find((b) => b.id === backendId);
  const enterpriseEntitled = !!status?.licensing?.features.includes("enterprise_workflows");
  const enterpriseLocked = selectedBackend?.tier === "enterprise" && !enterpriseEntitled;

  // Default to the first backend only if nothing's been picked yet (e.g. via the picker
  // in ConnectStep above) — never overrides an existing choice.
  useEffect(() => {
    if (!backendId && backends[0]) setBackendId(backends[0].id);
  }, [backends, backendId, setBackendId]);

  const generate = async () => {
    if (!backendId) return;
    setGenerating(true);
    try {
      await downloadWorkflow(backendId, url.trim() ? new URL(url.trim()).pathname.split("/").pop() : undefined);
      toast({ title: "Downloaded", description: `Send omniproject-${backendId}.json to whoever manages your automation system to import.` });
    } catch (e) {
      toast({ title: "Couldn't generate that", description: e instanceof Error ? e.message : "You may need admin access.", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    /* Step 4 — generate workflow */
    <Step n={4} title="Get the connector for your tool">
      <p className="text-xs text-muted-foreground">
        Pick the tool your team actually uses, then download a ready-made connector file. Give that
        file to whoever manages your automation system — they import it and your tool is wired up.
        You don't need to build anything yourself.
      </p>
      {enterpriseLocked && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>
            {selectedBackend?.label} needs a paid licence key to generate this connector automatically
            (this applies to the big ERPs — SAP, Primavera, Dynamics 365, MS Project). Everyday tools
            (Jira, OpenProject, GitHub, …) are always free.
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
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(selectedBackend.capabilities).map(([d, on]) => (
              <span key={d} className="flex items-center gap-1.5"><Dot on={on} /> {d}</span>
            ))}
          </div>
          {selectedBackend.notes && <p className="text-muted-foreground">{selectedBackend.notes}</p>}
          <TechDetails label="Technical details for whoever sets this up">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground uppercase tracking-widest">Integration:</span>
              <span className="font-bold border border-primary/40 text-primary px-1.5 py-0.5">{selectedBackend.via}</span>
              {selectedBackend.credentialType && (
                <span className="font-mono text-muted-foreground">credential: {selectedBackend.credentialType}</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground uppercase tracking-widest">Required env in the broker: </span>
              {selectedBackend.requiredEnv.length === 0
                ? <span className="text-muted-foreground">none (auth via a broker credential)</span>
                : selectedBackend.requiredEnv.map((e) => <span key={e} className="font-mono mr-2 border border-border px-1">{e}</span>)}
            </div>
          </TechDetails>
        </div>
      )}
    </Step>
  );
}
