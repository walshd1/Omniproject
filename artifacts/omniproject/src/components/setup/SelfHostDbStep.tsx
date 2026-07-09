import { useEffect, useState } from "react";
import { AlertTriangle, Database, Info } from "lucide-react";
import { Step } from "./shared";
import {
  useSelfHost,
  useSaveSelfHost,
  guardrails,
  canComplete,
  holdsOnlyCopy,
  type SelfHostMode,
} from "../../lib/selfhost";

/**
 * Setup step — adopt OmniProject's own database. The NON-preferred path: for first-time users with
 * no existing PM tool to connect. The whole step embodies "disclose, don't insure" — the one thing
 * that BLOCKS completion is the data-responsibility acknowledgement; everything else is a warning
 * that informs the choice. Admin-only; the editor lives here and in Settings → Self-host capabilities.
 */
const MODES: { value: SelfHostMode; label: string; blurb: string }[] = [
  { value: "off", label: "Off (connect a tool instead)", blurb: "Recommended. Your existing tool stays the source of truth; OmniProject holds nothing." },
  { value: "augmenting", label: "Augmenting", blurb: "Your database only holds fields no connected backend can — it fills gaps, backends stay authoritative." },
  { value: "system-of-record", label: "System of record", blurb: "Your database becomes the authoritative source for the adopted domains — it holds the only copy." },
];

export function SelfHostDbStep({ n, isAdmin }: { n: number; isAdmin: boolean }) {
  const { data: state } = useSelfHost({}, isAdmin);
  const save = useSaveSelfHost();

  const [mode, setMode] = useState<SelfHostMode>("off");
  const [adopted, setAdopted] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Seed local edit state from the server once it loads.
  useEffect(() => {
    if (state?.config) {
      setMode(state.config.mode);
      setAdopted(state.config.adopted);
      setAck(state.config.acknowledgedDataResponsibility);
    }
  }, [state]);

  if (!isAdmin) return null;

  const gated = (state?.domains ?? []).filter((d) => !d.core);
  const rails = guardrails(mode, ack);
  const activeWarnings = rails.filter((g) => g.active && g.level === "warn");
  const blocker = rails.find((g) => g.active && g.level === "block");
  const complete = canComplete(mode, ack);

  function toggleDomain(id: string) {
    setAdopted((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function apply() {
    setMsg(null);
    try {
      await save.mutateAsync({ mode, adopted, acknowledgedDataResponsibility: ack });
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    }
  }

  return (
    <Step n={n} title="Self-host database (optional)">
      <div className="border border-blue-500/40 bg-blue-500/10 p-3 text-xs flex gap-2 items-start">
        <Info className="w-4 h-4 shrink-0 text-blue-500 mt-0.5" aria-hidden="true" />
        <div className="text-blue-900 dark:text-blue-200">
          <strong>Prefer connecting your existing tool.</strong> OmniProject is a stateless overlay — its value is
          that your real PM tool stays the source of truth and nothing migrates. Only adopt our database if you
          have <em>no</em> existing tool to connect.
        </div>
      </div>

      <fieldset className="space-y-2" data-testid="selfhost-modes">
        <legend className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">How much should your database hold?</legend>
        {MODES.map((m) => (
          <label key={m.value} className={`flex items-start gap-3 border p-3 cursor-pointer ${mode === m.value ? "border-primary bg-primary/10" : "border-border"}`}>
            <input type="radio" name="selfhost-mode" value={m.value} checked={mode === m.value}
              onChange={() => setMode(m.value)} className="mt-1" data-testid={`selfhost-mode-${m.value}`} />
            <span>
              <span className="font-bold text-sm flex items-center gap-1.5"><Database className="w-3.5 h-3.5" aria-hidden="true" />{m.label}</span>
              <span className="block text-xs text-muted-foreground">{m.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {mode !== "off" && (
        <fieldset className="space-y-2" data-testid="selfhost-domains">
          <legend className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Which domains? (work items are always held)</legend>
          {gated.map((d) => (
            <label key={d.id} className="flex items-start gap-3 border border-border p-2.5 cursor-pointer">
              <input type="checkbox" checked={adopted.includes(d.id)} onChange={() => toggleDomain(d.id)}
                className="mt-1" data-testid={`selfhost-domain-${d.id}`} />
              <span>
                <span className="font-bold text-sm">{d.label}</span>
                <span className="block text-xs text-muted-foreground">{d.unlocks}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {activeWarnings.map((g) => (
        <div key={g.id} className="border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex gap-2 items-start" data-testid={`selfhost-warn-${g.id}`}>
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" aria-hidden="true" />
          <span className="text-amber-900 dark:text-amber-200">{g.message}</span>
        </div>
      ))}

      {holdsOnlyCopy(mode) && (
        <label className="flex items-start gap-3 border-2 border-foreground p-3 cursor-pointer" data-testid="selfhost-ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" data-testid="selfhost-ack-input" />
          <span className="text-xs">
            <strong>I acknowledge my data responsibility.</strong> Data held in my database is mine to own, secure,
            back up and warrant. OmniProject does not operate, back up, or insure it — it discloses this boundary,
            it does not cover it.
          </span>
        </label>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={apply} disabled={!complete || save.isPending}
          data-testid="selfhost-save"
          className="border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {blocker && <span className="text-xs text-amber-600" data-testid="selfhost-blocked">Acknowledge data responsibility to continue.</span>}
        {msg && <span className="text-xs text-muted-foreground" data-testid="selfhost-step-msg">{msg}</span>}
      </div>
    </Step>
  );
}
