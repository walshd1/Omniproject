import { useState } from "react";
import { Blocks, Trash2, Power } from "lucide-react";
import { DataState } from "../components/DataState";
import {
  useExtensions, useInstallExtension, useSetExtensionStatus, useUninstallExtension,
  contributionKindLabel, type ExtensionMeta,
} from "../lib/marketplace";
import { safeParseJson } from "../lib/safe-json";
import { useToast } from "@/hooks/use-toast";

/**
 * Plugin marketplace (roadmap 3.4). Browse installed extensions and (for admins) install one from a JSON
 * manifest, enable/disable it, or remove it. An extension contributes only pure-JSON config (reports, pages,
 * dashboards, screens) — no code — so installing is a governance decision. Behind the default-off
 * `marketplace` module; nothing is listed until an admin installs a plugin.
 */

function StatusBadge({ status }: { status: ExtensionMeta["status"] }) {
  const tone = status === "installed" ? "text-green-600 border-green-500/40 bg-green-500/10" : "text-muted-foreground border-border";
  return <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${tone}`}>{status}</span>;
}

function InstallForm({ onDone }: { onDone: () => void }) {
  const install = useInstallExtension();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    let manifest: unknown;
    try { manifest = safeParseJson(text); } catch { setError("That isn't valid JSON."); return; }
    setError(null);
    install.mutate(manifest, {
      onSuccess: (e) => { toast({ title: "EXTENSION INSTALLED", description: `${e.name} by ${e.publisher}` }); onDone(); },
      onError: () => setError("The manifest was rejected — check the name, publisher and contributions."),
    });
  };

  return (
    <div className="bg-card border border-border p-4 space-y-2" data-testid="extension-install-form">
      <p className="text-xs text-muted-foreground">Paste an extension manifest (JSON): a <code>name</code>, <code>publisher</code>, <code>version</code>, and a <code>contributions</code> array (each a <code>kind</code> + <code>name</code> + a pure-JSON <code>def</code>). Extensions carry no code.</p>
      <textarea
        data-testid="extension-manifest"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'{\n  "name": "Reports Pack",\n  "publisher": "Acme",\n  "version": "1.0.0",\n  "contributions": [\n    { "kind": "report", "name": "Burn rate", "def": { "id": "burn-rate" } }\n  ]\n}'}
        className="w-full border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="text-xs text-red-600" data-testid="extension-error">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!text.trim() || install.isPending} data-testid="extension-install-submit" className="border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40">{install.isPending ? "Installing…" : "Install"}</button>
        <button type="button" onClick={onDone} className="border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40">Cancel</button>
      </div>
    </div>
  );
}

export function Marketplace() {
  const { data: extensions, isLoading, isError, error, refetch } = useExtensions();
  const setStatus = useSetExtensionStatus();
  const uninstall = useUninstallExtension();
  const [installing, setInstalling] = useState(false);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2"><Blocks className="w-5 h-5" />Marketplace</h1>
          <p className="text-xs text-muted-foreground">Install org-wide extensions — pure-JSON reports, pages, dashboards and screens. No code runs.</p>
        </div>
        <button type="button" onClick={() => setInstalling((v) => !v)} data-testid="extension-install" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest">Install extension</button>
      </div>

      {installing && <InstallForm onDone={() => setInstalling(false)} />}

      <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
        <div className="space-y-2" data-testid="extension-list">
          {(extensions ?? []).length === 0 && !installing && (
            <p className="text-sm text-muted-foreground">No extensions installed. Install one from a manifest to add reports, pages, dashboards or screens.</p>
          )}
          {(extensions ?? []).map((ext) => (
            <div key={ext.id} data-testid={`extension-row-${ext.id}`} className="border border-border p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{ext.name}</span>
                  <span className="text-xs text-muted-foreground">v{ext.version} · {ext.publisher}</span>
                  <StatusBadge status={ext.status} />
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {ext.contributionCount} contribution{ext.contributionCount === 1 ? "" : "s"}: {ext.contributionKinds.map(contributionKindLabel).join(", ")}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setStatus.mutate({ id: ext.id, status: ext.status === "installed" ? "disabled" : "installed" })} data-testid={`extension-toggle-${ext.id}`} aria-label={ext.status === "installed" ? "Disable" : "Enable"} className="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs font-black uppercase tracking-widest hover:bg-muted/40"><Power className="w-3 h-3" />{ext.status === "installed" ? "Disable" : "Enable"}</button>
                <button type="button" onClick={() => uninstall.mutate(ext.id)} data-testid={`extension-remove-${ext.id}`} aria-label="Uninstall" className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </DataState>
    </div>
  );
}
