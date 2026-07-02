import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { backendCatalogue } from "@workspace/backend-catalogue";
import {
  CONTRACT_ACTIONS,
  CAPABILITY_DOMAINS,
  KEY_SCHEMES,
  BACKEND_KINDS,
  ACTION_KINDS,
  HTTP_METHODS,
  emptyBackendDraft,
  cloneFromCatalogue,
  parseBackendFile,
  evaluateDraft,
  downloadBackendManifest,
  type BackendDraft,
  type ActionDraft,
} from "../../lib/backend-authoring";

/** A contract action's label, for the editor headings — "list_issues" → "List issues". */
function actionLabel(action: string): string {
  return action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** One contract action's inline editor — collapsed to a checkbox until enabled. */
function ActionEditor({ action, value, onChange }: { action: string; value: ActionDraft; onChange: (next: ActionDraft) => void }) {
  const patch = (p: Partial<ActionDraft>) => onChange({ ...value, ...p });
  return (
    <div className="border border-border p-2 space-y-2" data-testid={`backend-action-${action}`}>
      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
        <input type="checkbox" aria-label={`Map ${actionLabel(action)}`} checked={value.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        {actionLabel(action)}
      </label>
      {value.enabled && (
        <div className="pl-2 border-l-2 border-border space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Transport</span>
              <select aria-label={`${actionLabel(action)} transport`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                value={value.kind} onChange={(e) => patch({ kind: e.target.value as ActionDraft["kind"] })}>
                <option value="">http (default)</option>
                {ACTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {value.kind !== ACTION_KINDS[1] && (
              <label className="text-xs flex items-center gap-1">
                <span className="text-muted-foreground">Method</span>
                <select aria-label={`${actionLabel(action)} method`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                  value={value.method} onChange={(e) => patch({ method: e.target.value as ActionDraft["method"] })}>
                  <option value="">(none)</option>
                  {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}
          </div>
          {value.kind !== ACTION_KINDS[1] && (
            <>
              <Input aria-label={`${actionLabel(action)} URL`} placeholder="broker expression for the request URL, e.g. ={{ $env.MY_API_URL }}/issues"
                className="w-full rounded-none border border-border font-mono text-xs" value={value.url} onChange={(e) => patch({ url: e.target.value })} />
              <textarea aria-label={`${actionLabel(action)} body`} placeholder="broker expression for the JSON request body (writes only)"
                className="w-full rounded-none border border-border bg-background p-1.5 font-mono text-xs" rows={2}
                value={value.body} onChange={(e) => patch({ body: e.target.value })} />
            </>
          )}
          {value.kind === ACTION_KINDS[1] && (
            <>
              <Input aria-label={`${actionLabel(action)} node type`} placeholder="broker node type, e.g. (base package).asana"
                className="w-full rounded-none border border-border font-mono text-xs" value={value.node} onChange={(e) => patch({ node: e.target.value })} />
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs flex items-center gap-1">
                  <span className="text-muted-foreground">Type version</span>
                  <Input aria-label={`${actionLabel(action)} type version`} type="number" className="w-20 rounded-none border border-border text-xs"
                    value={value.typeVersion} onChange={(e) => patch({ typeVersion: e.target.value })} />
                </label>
              </div>
              <textarea aria-label={`${actionLabel(action)} parameters`} placeholder="node parameters, as JSON (resource/operation/etc.)"
                className="w-full rounded-none border border-border bg-background p-1.5 font-mono text-xs" rows={3}
                value={value.parameters} onChange={(e) => patch({ parameters: e.target.value })} />
            </>
          )}
          <Input aria-label={`${actionLabel(action)} credential type`} placeholder="broker-managed credential type override (optional)"
            className="w-full rounded-none border border-border font-mono text-xs" value={value.credentialType} onChange={(e) => patch({ credentialType: e.target.value })} />
          <Input aria-label={`${actionLabel(action)} note`} placeholder="Note for whoever imports this into the broker (optional)"
            className="w-full rounded-none border border-border text-xs" value={value.note} onChange={(e) => patch({ note: e.target.value })} />
        </div>
      )}
    </div>
  );
}

/**
 * Self-service backend/vendor authoring (backlog #137) — a guided form that builds a valid
 * `BackendManifest & N8nBinding` JSON document (the shape of `lib/backend-catalogue/vendors/
 * backends/<id>.json`) without touching TypeScript. OmniProject already lets a deployment add
 * or override backends without a rebuild by dropping validated JSON into
 * `$OMNI_CONFIG_DIR/vendors/backends/*.json` (`artifacts/api-server/src/lib/config-dir.ts`); this
 * form is the missing piece — authoring + the SAME validation the loader runs, ending in an
 * export because writing to the server's filesystem from the SPA has no place in a
 * stateless/zero-at-rest gateway. Admin-gated — wiring an integration (env vars, auth headers,
 * webhook targets) is technical config, the same bar as the raw-SQL/Mongo backends.
 */
export function CustomBackendAdmin() {
  const { data: auth } = useAuth();
  const [draft, setDraft] = useState<BackendDraft>(emptyBackendDraft());
  const [cloneId, setCloneId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!roleAtLeast(auth?.role, "admin")) return null;

  const catalogue = backendCatalogue();
  const { manifest, errors, warnings } = evaluateDraft(draft);
  const preview = JSON.stringify(manifest, null, 2);

  const patch = (p: Partial<BackendDraft>) => setDraft({ ...draft, ...p });
  const patchAction = (action: string, next: ActionDraft) => setDraft({ ...draft, actions: { ...draft.actions, [action]: next } });
  const toggleCapability = (id: string) => setDraft({ ...draft, capabilities: { ...draft.capabilities, [id]: !draft.capabilities[id] } });

  function startFromClone() {
    if (!cloneId) return;
    const cloned = cloneFromCatalogue(cloneId);
    if (cloned) setDraft(cloned);
  }

  async function importFile(file: File | undefined) {
    setImportError(null);
    if (!file) return;
    try {
      setDraft(parseBackendFile(await file.text()));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import that file.");
    }
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the export button still works */
    }
  }

  return (
    <section className="space-y-4" data-testid="custom-backend-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Custom backend / vendor authoring</h2>
        <p className="text-xs text-muted-foreground">
          Build a new backend definition — the same shape as
          every shipped vendor under <code>lib/backend-catalogue/vendors/backends/</code> — without writing
          JSON by hand. Validation here is the exact schema the deployment config loader enforces.
          <strong> Exporting does not activate it</strong>: download the file, save it as{" "}
          <code>$OMNI_CONFIG_DIR/vendors/backends/&lt;id&gt;.json</code> in your deployment&apos;s config
          directory, then reload/restart the gateway — it will be merged into the catalogue alongside the
          shipped backends (or override one with the same id), no rebuild required.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border border-dashed border-border p-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Start from</span>
        <select aria-label="Clone an existing backend" className="rounded-none border border-border bg-background px-2 py-1 text-xs"
          value={cloneId} onChange={(e) => setCloneId(e.target.value)}>
          <option value="">(choose a backend to copy)</option>
          {catalogue.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <Button variant="outline" className="rounded-none border border-border text-xs" disabled={!cloneId} onClick={startFromClone}>Clone</Button>
        <Button variant="outline" className="rounded-none border border-border text-xs" onClick={() => setDraft(emptyBackendDraft())}>Start blank</Button>
        <Button variant="outline" className="rounded-none border border-border text-xs" onClick={() => fileRef.current?.click()}>Import file…</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import backend definition"
          onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        {importError && <span role="alert" className="text-xs font-bold text-red-500">{importError}</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input aria-label="Backend id" placeholder="id (lowercase, letters/digits/hyphens)" className="rounded-none border-2 border-foreground font-mono text-xs"
              value={draft.id} onChange={(e) => patch({ id: e.target.value })} />
            <Input aria-label="Backend label" placeholder="Display name" className="rounded-none border-2 border-foreground text-xs"
              value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
            <Input aria-label="Backend docs URL" placeholder="Docs URL" className="rounded-none border border-border text-xs sm:col-span-2"
              value={draft.docsUrl} onChange={(e) => patch({ docsUrl: e.target.value })} />
            <Input aria-label="Backend via" placeholder="How it authenticates (human-readable, e.g. HTTP + bearer token)" className="rounded-none border border-border text-xs sm:col-span-2"
              value={draft.via} onChange={(e) => patch({ via: e.target.value })} />
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Source kind</span>
              <select aria-label="Backend kind" className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                value={draft.kind} onChange={(e) => patch({ kind: e.target.value as BackendDraft["kind"] })}>
                <option value="">live (default)</option>
                {BACKEND_KINDS.filter((k) => k !== "live").map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" aria-label="Admin only" checked={draft.adminOnly} onChange={(e) => patch({ adminOnly: e.target.checked })} />
              Admin-only (technical/arbitrary-query backend)
            </label>
            <Input aria-label="Required env vars (comma-separated)" placeholder="Required env vars, comma-separated (e.g. MY_API_URL, MY_API_TOKEN)"
              className="rounded-none border border-border font-mono text-xs sm:col-span-2"
              value={draft.requiredEnv.join(", ")} onChange={(e) => patch({ requiredEnv: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Capabilities — data domains this backend can populate</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {CAPABILITY_DOMAINS.map((c) => (
                <label key={c} className="text-xs flex items-center gap-1" data-testid={`backend-capability-${c}`}>
                  <input type="checkbox" aria-label={`Capability ${c}`} checked={!!draft.capabilities[c]} onChange={() => toggleCapability(c)} />
                  {c}
                </label>
              ))}
            </div>
          </div>

          <div className="border border-border p-2 space-y-2">
            <label className="text-xs flex items-center gap-2 font-bold uppercase tracking-widest">
              <input type="checkbox" aria-label="This backend needs a credential" checked={draft.keyFormat.enabled}
                onChange={(e) => patch({ keyFormat: { ...draft.keyFormat, enabled: e.target.checked } })} />
              Key format
            </label>
            {draft.keyFormat.enabled && (
              <div className="pl-2 border-l-2 border-border space-y-2">
                <label className="text-xs flex items-center gap-1">
                  <span className="text-muted-foreground">Scheme</span>
                  <select aria-label="Key scheme" className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                    value={draft.keyFormat.scheme} onChange={(e) => patch({ keyFormat: { ...draft.keyFormat, scheme: e.target.value as BackendDraft["keyFormat"]["scheme"] } })}>
                    <option value="">(choose)</option>
                    {KEY_SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <Input aria-label="Key env vars (comma-separated)" placeholder="Env var(s) the key lives in, comma-separated"
                  className="w-full rounded-none border border-border font-mono text-xs"
                  value={draft.keyFormat.env.join(", ")} onChange={(e) => patch({ keyFormat: { ...draft.keyFormat, env: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} />
                <Input aria-label="Key header" placeholder="HTTP header the key is presented in (optional)"
                  className="w-full rounded-none border border-border text-xs"
                  value={draft.keyFormat.header} onChange={(e) => patch({ keyFormat: { ...draft.keyFormat, header: e.target.value } })} />
                <Input aria-label="Key pattern" placeholder="Regex the key value must match (optional)"
                  className="w-full rounded-none border border-border font-mono text-xs"
                  value={draft.keyFormat.pattern} onChange={(e) => patch({ keyFormat: { ...draft.keyFormat, pattern: e.target.value } })} />
              </div>
            )}
          </div>

          <div className="border border-border p-2 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Broker binding — per-user auth expression</p>
            <Input aria-label="Auth header expression" placeholder="broker expression for the Authorization header, e.g. ={{ 'Bearer ' + $env.MY_API_TOKEN }}"
              className="w-full rounded-none border-2 border-foreground font-mono text-xs" value={draft.authHeader} onChange={(e) => patch({ authHeader: e.target.value })} />
            <Input aria-label="Credential type" placeholder="broker-managed credential type override (optional)"
              className="w-full rounded-none border border-border font-mono text-xs" value={draft.credentialType} onChange={(e) => patch({ credentialType: e.target.value })} />
          </div>

          <textarea aria-label="Notes" placeholder="Notes for whoever configures/imports this backend (optional)"
            className="w-full rounded-none border border-border bg-background p-1.5 text-xs" rows={2}
            value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />

          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Actions — how each contract action reaches this backend</p>
            <div className="space-y-2">
              {CONTRACT_ACTIONS.map((action) => (
                <ActionEditor key={action} action={action} value={draft.actions[action]} onChange={(next) => patchAction(action, next)} />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Live JSON preview</p>
            <Button variant="ghost" className="rounded-none text-[11px] px-2" onClick={() => void copyPreview()}>{copied ? "Copied!" : "Copy"}</Button>
          </div>
          <pre className="max-h-96 overflow-auto border border-border bg-muted/30 p-2 text-[11px] font-mono" data-testid="backend-json-preview">{preview}</pre>

          {errors.length > 0 && (
            <div className="border border-red-400 bg-red-50 p-2 space-y-1" data-testid="backend-errors">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-700">Fix before exporting</p>
              <ul className="text-xs text-red-700 list-disc pl-4">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="border border-amber-400 bg-amber-50 p-2 space-y-1" data-testid="backend-warnings">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800">Advisories (not blocking)</p>
              <ul className="text-xs text-amber-800 list-disc pl-4">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" disabled={errors.length > 0}
            onClick={() => downloadBackendManifest(manifest)}>
            Export {draft.id ? `${draft.id}.json` : "definition"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Save the download as <code>vendors/backends/{draft.id || "&lt;id&gt;"}.json</code> inside your{" "}
            <code>OMNI_CONFIG_DIR</code>, then reload/restart the gateway. <code>GET /api/setup/config-dir</code>{" "}
            (admin) reports whether it loaded.
          </p>
        </div>
      </div>
    </section>
  );
}
