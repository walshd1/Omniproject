import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { planNlAction, executePlannedAction, type ActionPlan } from "../../lib/nl-action";
import { ContainmentBadge } from "../ContainmentBadge";

/**
 * Natural-language command. Type an instruction; the gateway PLANS it into one canonical
 * action (read or write) and shows it for review. Reads run on confirm; a WRITE is clearly
 * flagged and runs only after an explicit second confirm. Nothing auto-executes — the
 * planner proposes, the human decides (autonomous execution goes through the write-scope
 * guard server-side instead).
 */
export function NlCommand() {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const surface = typeof window !== "undefined" ? window.location.pathname : undefined;

  const onPlan = async (): Promise<void> => {
    setBusy(true); setError(null); setResult(null); setPlan(null);
    try { setPlan(await planNlAction(text, surface)); }
    catch (e) { setError(e instanceof Error ? e.message : "Planning failed"); }
    finally { setBusy(false); }
  };

  const onRun = async (p: Extract<ActionPlan, { kind: "action" }>): Promise<void> => {
    if (p.write && !window.confirm(`This will MODIFY data (${p.action}). Run it?`)) return;
    setBusy(true); setError(null);
    try {
      const r = await executePlannedAction(p.tool, p.args);
      setResult(typeof r === "string" ? r : JSON.stringify(r, null, 2));
      setPlan(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card data-testid="nl-command">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Command (natural language)
          <ContainmentBadge />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Describe what you want (e.g. “list my projects”, “show issues in Apollo”). It’s
          mapped to a known action and shown for review — nothing runs until you confirm.
        </p>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void onPlan(); }}
            placeholder="Type an instruction…"
            aria-label="Natural-language instruction"
            className="h-9 flex-1 rounded-md border border-border bg-transparent px-2 text-sm"
          />
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void onPlan()} data-testid="nl-plan">Plan</Button>
        </div>

        {error && <p className="text-sm text-red-600" data-testid="nl-error">{error}</p>}

        {plan?.kind === "action" && (
          <div className="rounded border border-border p-2 text-sm" data-testid="nl-plan-action">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono font-medium">{plan.action}</span>
              {plan.write
                ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">write</span>
                : <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">read</span>}
            </div>
            {Object.keys(plan.args).length > 0 && (
              <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(plan.args, null, 2)}</pre>
            )}
            <Button size="sm" variant={plan.write ? "destructive" : "default"} disabled={busy} onClick={() => void onRun(plan)} data-testid="nl-run">
              {plan.write ? "Confirm & run (write)" : "Run"}
            </Button>
          </div>
        )}

        {plan?.kind === "clarify" && <p className="text-sm" data-testid="nl-clarify">{plan.question}</p>}
        {plan?.kind === "none" && <p className="text-sm text-muted-foreground" data-testid="nl-none">No matching action: {plan.reason}</p>}

        {result && <pre className="overflow-x-auto rounded bg-muted p-2 text-xs" data-testid="nl-result">{result}</pre>}
      </CardContent>
    </Card>
  );
}
