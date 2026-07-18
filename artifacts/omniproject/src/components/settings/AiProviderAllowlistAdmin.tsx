import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useAiProviderAllowlist, useSaveAiProviderAllowlist } from "../../lib/ai-allowlist-api";

/** The selectable AI providers this deployment ships (minus `none`, which is always permitted). */
const KNOWN_PROVIDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "ollama", label: "Local — Ollama" },
  { id: "openrouter", label: "Public — OpenRouter" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];

/**
 * Admin control for the AI-provider allowlist — the org's governance FLOOR over which providers may be selected
 * (roadmap Phase C). Unrestricted by default (every provider selectable). When restricted, only the ticked
 * providers may be chosen anywhere in the org; a lower scope (programme/project) may narrow this further but
 * never widen it. "None" (AI off) is always available. The server enforces the same floor on every selection.
 */
export function AiProviderAllowlistAdmin() {
  const { data: auth } = useAuth();
  const { data: allowlist } = useAiProviderAllowlist();
  const save = useSaveAiProviderAllowlist();
  const { toast } = useToast();

  const restricted = allowlist != null;
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected(allowlist ?? []); }, [allowlist?.join(",")]);

  if (!roleAtLeast(auth?.role, "admin")) return null;

  const persist = (value: string[] | null) =>
    save.mutate(value, {
      onSuccess: () => toast({ title: value == null ? "AI PROVIDERS UNRESTRICTED" : "AI PROVIDER ALLOWLIST SAVED", description: value == null ? "Every provider is selectable again." : `Only ${value.length} provider(s) may be selected.` }),
      onError: () => toast({ title: "COULD NOT SAVE", description: "Please try again.", variant: "destructive" }),
    });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <section data-testid="ai-provider-allowlist-admin">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">AI provider allowlist (governance)</h2>
        <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${restricted ? "border-blue-500/40 text-blue-500 bg-blue-500/10" : "border-border text-muted-foreground"}`}>
          {restricted ? "Restricted" : "Unrestricted"}
        </span>
      </div>

      <div className="bg-card border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Restrict which AI providers may be selected across the org. A lower scope (programme/project) can narrow
          this further but never add a provider you forbid; <strong>None</strong> (AI off) is always available.
          Unrestricted by default.
        </p>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={restricted}
            data-testid="ai-allowlist-restrict"
            onChange={(e) => persist(e.target.checked ? [] : null)}
          />
          <span>Restrict to an allowlist</span>
        </label>

        {restricted && (
          <>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {KNOWN_PROVIDERS.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={selected.includes(p.id)} data-testid={`ai-allowlist-${p.id}`} onChange={() => toggle(p.id)} />
                  <span className="font-mono">{p.label}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => persist(selected)}
              disabled={save.isPending}
              data-testid="ai-allowlist-save"
              className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {save.isPending ? "SAVING…" : "Save allowlist"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
