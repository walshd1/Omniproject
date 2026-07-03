import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchConfigExport, type ExportFormat } from "../../lib/setup";
import { NeedsHelp, Step, TechDetails } from "./shared";

export function PersistStep({ brokerUrlSet }: { brokerUrlSet: boolean | undefined }) {
  const { toast } = useToast();

  const [format, setFormat] = useState<ExportFormat>("env");
  const [snippet, setSnippet] = useState("");

  useEffect(() => {
    fetchConfigExport(format).then(setSnippet).catch(() => setSnippet("# could not load config (admin only)"));
  }, [format, brokerUrlSet]);

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast({ title: "Copied", description: `${format} config copied to clipboard.` });
    } catch {
      toast({ title: "Couldn't copy", description: "Select and copy the text by hand instead.", variant: "destructive" });
    }
  };

  return (
    /* Step 3 — persist config */
    <Step n={3} title="Make it permanent">
      <p className="text-xs text-muted-foreground">
        Right now this connection only lasts until the app restarts — that's deliberate (OmniProject
        doesn't keep a database of its own, so it doesn't quietly store your settings either). To make
        it stick, someone needs to save a small settings snippet where the app is hosted.
      </p>
      <NeedsHelp>
        If that's not you, this is the one step to hand to whoever hosts OmniProject for you. Copy the
        snippet below and say: <em>"Please save this in OmniProject's environment configuration, then
        restart the app."</em> They'll know which format (below) matches how it's hosted.
      </NeedsHelp>
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
      <TechDetails label="Not sure which format you need?">
        <p className="text-muted-foreground">
          <span className="font-mono">.env</span> — a plain settings file, used when the app runs directly
          or via Docker Compose. <span className="font-mono">docker-compose</span> — paste into your
          compose file's <span className="font-mono">environment:</span> section. <span className="font-mono">k8s</span> —
          a Kubernetes Secret manifest, for a cluster deployment. If in doubt, send all three to whoever
          hosts it and they'll pick the right one.
        </p>
      </TechDetails>
    </Step>
  );
}
