import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const REPO = "walshd1/Omniproject";

const API_KIND_OPTIONS = [
  "REST / JSON API",
  "GraphQL",
  "OData",
  "SOAP",
  "Only a database (no API)",
  "Only a spreadsheet export",
  "Not sure",
] as const;

const ACCESS_OPTIONS = [
  "I have a sandbox/test instance I can share credentials or access for",
  "I'd be willing to test a generated workflow against my real instance, read-only",
  "I'd be willing to help build this myself",
] as const;

/**
 * The low-tech companion to CustomBackendAdmin (Settings → admin-only, JSON/schema-heavy).
 * This asks the same questions a human would ask over email — no auth headers, no field
 * mappings, no capability domains — and hands the answers to whoever builds the connector
 * (a maintainer, or the requester themselves via docs/dev/PLANE-BACKENDS.md). Mirrors
 * ReportProblemDialog's shape: prefill the matching GitHub issue form, or copy the text.
 */
export function RequestVendorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [system, setSystem] = useState("");
  const [apiKind, setApiKind] = useState<(typeof API_KIND_OPTIONS)[number]>("Not sure");
  const [docsUrl, setDocsUrl] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [auth, setAuth] = useState("");
  const [access, setAccess] = useState<Set<string>>(new Set());

  const toggleAccess = (option: string) => {
    setAccess((prev) => {
      const next = new Set(prev);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  };

  const summaryText = useMemo(() => {
    const lines = [
      `System / product: ${system || "(not given)"}`,
      `How it's reached: ${apiKind}`,
      docsUrl ? `Docs: ${docsUrl}` : null,
      `What we'd want it to read/write: ${capabilities || "(not given)"}`,
      auth ? `How we authenticate today: ${auth}` : null,
      access.size ? `Access to test against: ${[...access].join("; ")}` : null,
    ].filter((l): l is string => !!l);
    return lines.join("\n");
  }, [system, apiKind, docsUrl, capabilities, auth, access]);

  const githubUrl = useMemo(() => {
    const params = new URLSearchParams({
      template: "connector_request.yml",
      system,
      "api-kind": apiKind,
      "docs-url": docsUrl,
      capabilities,
      auth,
    });
    if (access.size) params.set("access", [...access].join(","));
    return `https://github.com/${REPO}/issues/new?${params.toString()}`;
  }, [system, apiKind, docsUrl, capabilities, auth, access]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      toast({ title: "Copied", description: "Paste this into an email or message to whoever can help build it." });
    } catch {
      toast({ title: "Couldn't copy", description: "Select and copy the text by hand.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-2 border-foreground bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tighter">Tell us what you use</DialogTitle>
          <DialogDescription>
            No technical detail required — just what it's called and what you'd want it to do.
            Someone (a maintainer, or you, if you want to) turns this into a working connector.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="vendor-system" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              What's it called? <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <input
              id="vendor-system"
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="e.g. Smartsheet, Linear, a bespoke in-house tracker"
              className="w-full bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="vendor-api-kind" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              How do you normally reach it?
            </label>
            <select
              id="vendor-api-kind"
              value={apiKind}
              onChange={(e) => setApiKind(e.target.value as (typeof API_KIND_OPTIONS)[number])}
              className="w-full bg-background border border-border px-3 py-2 text-sm"
            >
              {API_KIND_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Not sure is a fine answer — leave it as is.</p>
          </div>

          <div>
            <label htmlFor="vendor-docs-url" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Link to its docs (if you have one) — optional
            </label>
            <input
              id="vendor-docs-url"
              value={docsUrl}
              onChange={(e) => setDocsUrl(e.target.value)}
              placeholder="https://…"
              className="w-full bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="vendor-capabilities" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              What should OmniProject read/write from it? <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <textarea
              id="vendor-capabilities"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              rows={3}
              placeholder="Projects and tasks at minimum — anything else you rely on (budget, resourcing, custom fields)?"
              className="w-full bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="vendor-auth" className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              How do you log into it today? — optional
            </label>
            <textarea
              id="vendor-auth"
              value={auth}
              onChange={(e) => setAuth(e.target.value)}
              rows={2}
              placeholder="e.g. an API key from its settings page, single sign-on, a username/password"
              className="w-full bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <fieldset>
            <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              Access to test against — optional
            </legend>
            <div className="space-y-1.5">
              {ACCESS_OPTIONS.map((o) => (
                <label key={o} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={access.has(o)}
                    onChange={() => toggleAccess(o)}
                    className="mt-0.5"
                  />
                  {o}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!system || !capabilities}
              onClick={(e) => { if (!system || !capabilities) e.preventDefault(); }}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground flex items-center gap-2 aria-disabled:opacity-40 aria-disabled:pointer-events-none"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open a GitHub issue
            </a>
            <button
              type="button"
              onClick={copySummary}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-border hover:border-primary flex items-center gap-2"
            >
              <Copy className="w-3.5 h-3.5" /> Copy instead
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            No GitHub account? Use "Copy instead" and paste it into an email to whoever can help.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
