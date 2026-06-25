import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchConfigExport, type ExportFormat } from "../../lib/setup";
import { Step } from "./shared";

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
      toast({ title: "COPIED", description: `${format} config copied to clipboard.` });
    } catch {
      toast({ title: "COPY FAILED", description: "Select and copy manually.", variant: "destructive" });
    }
  };

  return (
    /* Step 3 — persist config */
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
  );
}
