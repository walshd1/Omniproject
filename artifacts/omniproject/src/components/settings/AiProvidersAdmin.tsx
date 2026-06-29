import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { stepUp } from "../../lib/step-up";
import {
  useAiProviders, upsertProvider, removeProvider, setProviderKey, clearProviderKey,
  setCapabilityProviders, type AiProviderKind, type AiProviderRow,
} from "../../lib/ai-providers";

/**
 * AI Providers admin. Providers are first-class entities; each provider's API key is entered
 * here and stored in the ENCRYPTED VAULT — keys are out of docker/env entirely and are
 * write-only (we only ever see presence + a fingerprint). Capabilities map to an ordered
 * provider list (first ready one wins). Every write is step-up gated.
 */
export function AiProvidersAdmin() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useAiProviders();
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [add, setAdd] = useState<{ id: string; kind: AiProviderKind; label: string; endpoint: string; model: string }>(
    { id: "", kind: "openai", label: "", endpoint: "", model: "" },
  );

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.providers || !data.capabilities) return null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-providers"] });
  const guarded = async (fn: () => Promise<void>): Promise<void> => {
    if (!(await stepUp())) return; // sensitive: provider/key/mapping changes
    try { await fn(); await refresh(); } catch { /* quiet; the row simply won't change */ }
  };

  const saveKey = (id: string) => guarded(async () => {
    const key = (keyDraft[id] ?? "").trim();
    if (!key) return;
    await setProviderKey(id, key);
    setKeyDraft((d) => ({ ...d, [id]: "" }));
  });

  const toggleMap = (cap: string, id: string) => guarded(async () => {
    const current = data.mapping[cap] ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    await setCapabilityProviders(cap, next);
  });

  const ProviderRow = (p: AiProviderRow) => (
    <li key={p.id} className="rounded border border-border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium">{p.label}</span>{" "}
          <span className="font-mono text-xs text-muted-foreground">{p.id} · {p.kind}</span>
          {p.endpoint && <div className="truncate text-xs text-muted-foreground">{p.endpoint}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {p.stale && p.hasKey && (
            <span data-testid={`stale-${p.id}`} title={p.ageDays != null ? `Key is ${p.ageDays} days old — rotate it` : "Key age unknown — rotate it"} className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              rotate
            </span>
          )}
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${p.ready ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
            {p.ready ? "ready" : "no key"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          placeholder={p.hasKey ? `key set · ${p.fingerprint ?? ""}` : "paste API key"}
          value={keyDraft[p.id] ?? ""}
          onChange={(e) => setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
          data-testid={`key-input-${p.id}`}
          className="h-8 flex-1 rounded border border-border bg-background px-2 font-mono text-xs"
        />
        <button type="button" data-testid={`key-save-${p.id}`} onClick={() => void saveKey(p.id)} className="h-8 rounded bg-primary px-2 text-xs font-medium text-primary-foreground">Save key</button>
        {p.hasKey && <button type="button" onClick={() => void guarded(() => clearProviderKey(p.id))} className="h-8 rounded border border-border px-2 text-xs">Clear</button>}
        <button type="button" onClick={() => void guarded(() => removeProvider(p.id))} className="h-8 rounded border border-border px-2 text-xs text-red-600">Remove</button>
      </div>
    </li>
  );

  return (
    <Card data-testid="ai-providers-admin">
      <CardHeader><CardTitle>AI providers</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Providers and their API keys live here, not in docker. Each key is stored in the
          <strong> secrets vault</strong> — write-only (we only confirm a fingerprint). Map each
          capability to one or more providers; the first <strong>ready</strong> one is used.
        </p>
        {data.vault && (
          <p className="text-xs text-muted-foreground" data-testid="vault-backend">
            Secrets backend: <span className="font-mono font-medium">{data.vault.backend}</span>
            {data.vault.backend === "local" ? " (OmniProject-owned encrypted file)" : " (external secrets manager)"}
          </p>
        )}

        <ul className="space-y-2">{data.providers.map(ProviderRow)}</ul>

        {/* Add a provider */}
        <div className="rounded border border-dashed border-border p-3 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add a provider</h3>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="id (e.g. openai-team)" value={add.id} onChange={(e) => setAdd((a) => ({ ...a, id: e.target.value }))} data-testid="add-id" className="h-8 rounded border border-border bg-background px-2 text-xs" />
            <select value={add.kind} onChange={(e) => setAdd((a) => ({ ...a, kind: e.target.value as AiProviderKind }))} data-testid="add-kind" className="h-8 rounded border border-border bg-background px-2 text-xs">
              {data.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input placeholder="label" value={add.label} onChange={(e) => setAdd((a) => ({ ...a, label: e.target.value }))} data-testid="add-label" className="h-8 rounded border border-border bg-background px-2 text-xs" />
            <input placeholder="endpoint (optional)" value={add.endpoint} onChange={(e) => setAdd((a) => ({ ...a, endpoint: e.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs" />
            <input placeholder="model (optional)" value={add.model} onChange={(e) => setAdd((a) => ({ ...a, model: e.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs" />
          </div>
          <button
            type="button"
            data-testid="add-provider"
            disabled={!add.id.trim() || !add.label.trim()}
            onClick={() => void guarded(async () => {
              await upsertProvider({ id: add.id.trim(), kind: add.kind, label: add.label.trim(), ...(add.endpoint.trim() ? { endpoint: add.endpoint.trim() } : {}), ...(add.model.trim() ? { model: add.model.trim() } : {}) });
              setAdd({ id: "", kind: "openai", label: "", endpoint: "", model: "" });
            })}
            className="h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Add provider
          </button>
        </div>

        {/* Capability → provider mapping */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Capability → providers</h3>
          {data.capabilities.map((cap) => {
            const order = data.mapping[cap.id] ?? [];
            const eligible = data.providers.filter((p) => (cap.surface === "stt" ? p.kind === "whisper" : p.kind !== "whisper"));
            return (
              <div key={cap.id} className="rounded border border-border p-2">
                <div className="mb-1 text-sm font-medium">{cap.label} {order.length > 0 && <span className="font-mono text-xs text-muted-foreground">→ {order.join(" › ")}</span>}</div>
                <div className="flex flex-wrap gap-1.5">
                  {eligible.map((p) => {
                    const idx = order.indexOf(p.id);
                    const on = idx >= 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        data-testid={`map-${cap.id}-${p.id}`}
                        onClick={() => void toggleMap(cap.id, p.id)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                      >
                        {on ? `${idx + 1}. ${p.label}` : p.label}
                      </button>
                    );
                  })}
                  {eligible.length === 0 && <span className="text-xs text-muted-foreground">No eligible providers.</span>}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">Unmapped capabilities fall back to the provider selected in System Configuration.</p>
        </div>
      </CardContent>
    </Card>
  );
}
