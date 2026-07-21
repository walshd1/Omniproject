import { useEffect, useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../../lib/auth";
import {
  useAiProviderAllowlist, useSaveAiProviderAllowlist,
  useSttProviderAllowlist, useSaveSttProviderAllowlist,
  useAiModelAllowlist, useSaveAiModelAllowlist,
} from "../../lib/ai-allowlist-api";

const PROVIDERS = [
  { id: "ollama", label: "Local — Ollama" },
  { id: "openrouter", label: "Public — OpenRouter" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];
const STT_ENGINES = [
  { id: "browser", label: "On-device — Browser" },
  { id: "whisper", label: "AI-assisted — Whisper" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SaveMutation = UseMutationResult<any, unknown, string[] | null, unknown>;

/** A "restrict to a ticked set" allowlist section (providers, STT engines). `null` = unrestricted. */
function ChecklistAllowlist({ title, testid, options, allowlist, save }: {
  title: string; testid: string; options: ReadonlyArray<{ id: string; label: string }>; allowlist: string[] | null; save: SaveMutation;
}) {
  const { toast } = useToast();
  const restricted = allowlist != null;
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected(allowlist ?? []); }, [allowlist?.join(",")]);
  const persist = (value: string[] | null) => save.mutate(value, { onError: () => toast({ title: "COULD NOT SAVE", description: "Please try again.", variant: "destructive" }) });
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-2" data-testid={`allowlist-${testid}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{title}</h3>
        <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${restricted ? "border-blue-500/40 text-blue-500 bg-blue-500/10" : "border-border text-muted-foreground"}`}>
          {restricted ? "Restricted" : "Unrestricted"}
        </span>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input type="checkbox" checked={restricted} data-testid={`${testid}-restrict`} onChange={(e) => persist(e.target.checked ? [] : null)} />
        <span>Restrict to an allowlist</span>
      </label>
      {restricted && (
        <>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={selected.includes(o.id)} data-testid={`${testid}-${o.id}`} onChange={() => toggle(o.id)} />
                <span className="font-mono">{o.label}</span>
              </label>
            ))}
          </div>
          <button type="button" data-testid={`${testid}-save`} onClick={() => persist(selected)} disabled={save.isPending}
            className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring">
            {save.isPending ? "SAVING…" : "Save"}
          </button>
        </>
      )}
    </div>
  );
}

/** The MODEL allowlist section — a free-text list (model ids are arbitrary strings). `null` = unrestricted. */
function ModelAllowlist({ allowlist, save }: { allowlist: string[] | null; save: SaveMutation }) {
  const { toast } = useToast();
  const restricted = allowlist != null;
  const models = allowlist ?? [];
  const [draft, setDraft] = useState("");
  const persist = (value: string[] | null) => save.mutate(value, { onError: () => toast({ title: "COULD NOT SAVE", description: "Please try again.", variant: "destructive" }) });
  const add = () => { const m = draft.trim(); if (m && !models.includes(m)) persist([...models, m]); setDraft(""); };

  return (
    <div className="space-y-2" data-testid="allowlist-model">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">AI models</h3>
        <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${restricted ? "border-blue-500/40 text-blue-500 bg-blue-500/10" : "border-border text-muted-foreground"}`}>
          {restricted ? "Restricted" : "Unrestricted"}
        </span>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input type="checkbox" checked={restricted} data-testid="model-restrict" onChange={(e) => persist(e.target.checked ? [] : null)} />
        <span>Restrict to specific model ids (the empty / default model is always allowed)</span>
      </label>
      {restricted && (
        <>
          {models.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 pt-1">
              {models.map((m) => (
                <li key={m} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] font-mono">
                  {m}
                  <button type="button" aria-label={`Remove ${m}`} data-testid={`model-remove-${m}`} onClick={() => persist(models.filter((x) => x !== m))} className="text-red-500">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 pt-1">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              placeholder="model id (e.g. gpt-4o)" data-testid="model-add-input" className="h-8 flex-1 rounded border border-border bg-background px-2 font-mono text-xs" />
            <button type="button" data-testid="model-add" onClick={add} disabled={!draft.trim() || save.isPending} className="h-8 rounded bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40">Add</button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Admin control for the AI selection allowlists — the org's governance FLOORS over which AI providers, models
 * and STT engines may be selected (roadmap Phase C). Each is unrestricted by default. A lower scope
 * (programme/project) may narrow these further but never widen them; "None" (off) and the default model are
 * always available. The server enforces the same floors on every selection.
 */
export function AiAllowlistsAdmin() {
  const { data: auth } = useAuth();
  const provider = useAiProviderAllowlist();
  const stt = useSttProviderAllowlist();
  const model = useAiModelAllowlist();
  const saveProvider = useSaveAiProviderAllowlist();
  const saveStt = useSaveSttProviderAllowlist();
  const saveModel = useSaveAiModelAllowlist();

  if (!roleAtLeast(auth?.role, "admin")) return null;

  return (
    <section data-testid="ai-allowlists-admin">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">AI allowlists (governance)</h2>
      </div>
      <div className="bg-card border border-border p-4 space-y-5">
        <p className="text-xs text-muted-foreground">
          Restrict which AI providers, models and speech-to-text engines may be selected across the org. A lower
          scope can narrow each further but never add something you forbid; <strong>None</strong> (off) and the
          default model are always available. Unrestricted by default.
        </p>
        <ChecklistAllowlist title="AI providers" testid="provider" options={PROVIDERS} allowlist={provider.data} save={saveProvider} />
        <div className="border-t border-border" />
        <ModelAllowlist allowlist={model.data} save={saveModel} />
        <div className="border-t border-border" />
        <ChecklistAllowlist title="Speech-to-text engines" testid="stt" options={STT_ENGINES} allowlist={stt.data} save={saveStt} />
      </div>
    </section>
  );
}
