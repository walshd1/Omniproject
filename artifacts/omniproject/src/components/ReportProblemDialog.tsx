import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePublicSetupStatus } from "../lib/setup";

const REPO = "walshd1/Omniproject";

/**
 * Everything here is computed client-side from things already visible to the user
 * (current page, connected/demo mode, browser) — nothing is sent anywhere unless
 * *they* click through to GitHub or paste it somewhere themselves. No network call,
 * no telemetry: matches the app's stateless/zero-at-rest posture.
 */
function diagnostics(mode: "demo" | "connected" | "unknown"): string {
  const lines = [
    `Page: ${window.location.pathname}`,
    `Mode: ${mode === "connected" ? "Connected (n8n + backend)" : mode === "demo" ? "Demo mode (no n8n / no SSO)" : "Not sure"}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}×${window.innerHeight}`,
    `When: ${new Date().toISOString()}`,
  ];
  return lines.join("\n");
}

export function ReportProblemDialog({
  open,
  onOpenChange,
  /** Pre-fill for when this opens from a crash — the error message, never user data. */
  errorMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errorMessage?: string | undefined;
}) {
  const { data: status } = usePublicSetupStatus();
  const { toast } = useToast();
  const [whatHappened, setWhatHappened] = useState("");

  const mode: "demo" | "connected" | "unknown" = status ? (status.broker.configured ? "connected" : "demo") : "unknown";
  const diag = useMemo(() => diagnostics(mode), [mode]);

  const githubUrl = useMemo(() => {
    const params = new URLSearchParams({
      template: "bug_report.yml",
      "what-happened": errorMessage ? `The app crashed: ${errorMessage}\n\n${whatHappened}`.trim() : whatHappened,
      mode: mode === "connected" ? "Connected (n8n + backend)" : mode === "demo" ? "Demo mode (no n8n / no SSO)" : "Not sure",
      env: diag,
    });
    return `https://github.com/${REPO}/issues/new?${params.toString()}`;
  }, [errorMessage, whatHappened, mode, diag]);

  const copyDiagnostics = async () => {
    const text = `${whatHappened ? `${whatHappened}\n\n` : ""}${errorMessage ? `Error: ${errorMessage}\n\n` : ""}${diag}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Paste this into an email, a Discussions post, or wherever you're sending it." });
    } catch {
      toast({ title: "Couldn't copy", description: "Select and copy the text below by hand.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-2 border-foreground bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tighter">Report a problem</DialogTitle>
          <DialogDescription>
            Nothing here is sent anywhere automatically — you choose where it goes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="report-what-happened" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              What were you doing, and what happened instead?
            </label>
            <textarea
              id="report-what-happened"
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
              rows={4}
              placeholder="e.g. I clicked Save on the budget field and the page went blank."
              className="w-full bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Included automatically (no personal data — just this):
            </p>
            <pre className="bg-background border border-border p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
              {errorMessage ? `Error: ${errorMessage}\n` : ""}{diag}
            </pre>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground flex items-center gap-2"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open a GitHub issue
            </a>
            <button
              type="button"
              onClick={copyDiagnostics}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-border hover:border-primary flex items-center gap-2"
            >
              <Copy className="w-3.5 h-3.5" /> Copy instead
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            No GitHub account, or reporting somewhere else instead? Use "Copy instead" and paste it into
            an email or your own support channel.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
