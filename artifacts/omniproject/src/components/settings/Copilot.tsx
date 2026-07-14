import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { askCopilot, type CopilotMode } from "../../lib/copilot";
import { planNlAction, executePlannedAction, type ActionPlan } from "../../lib/nl-action";
import { ActionPlanCard } from "../ActionPlanCard";
import { ContainmentBadge } from "../ContainmentBadge";
import { DictateButton } from "../DictateButton";

/**
 * Portfolio copilot — ask questions about the portfolio in plain language, or tell it to DO
 * something ("mark issue 42 done"). Q&A stays the default and the fallback: every message is
 * first offered to the SAME NL→action planner the command palette uses (`lib/nl-action`,
 * backlog #59) against the SAME governed, approved-actions-filtered tool catalogue. Only when
 * that planner recognises a known action (or needs one clarifying detail) does the chat
 * switch into action mode — showing the identical confirm-before-execute plan card the
 * command palette shows (`ActionPlanCard`) and executing through the identical MCP
 * `tools/call` write path on confirm (same RBAC/governance/write-scope re-enforcement).
 * A "none" verdict falls straight through to the unchanged read-only Q&A path below — the
 * copilot never invents its own action-matching or its own write path; it is just another
 * entry point into the existing one. `answerCopilot` itself is still read-only/no-tool-surface,
 * exactly as before.
 */
export function Copilot() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [persona, setPersona] = useState<string | null>(null);
  const [mode, setMode] = useState<CopilotMode>("rag");
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surface = typeof window !== "undefined" ? window.location.pathname : undefined;

  const onAsk = async (): Promise<void> => {
    setBusy(true); setError(null); setAnswer(null); setPersona(null); setPlan(null); setResult(null);
    try {
      // Try the shared action planner first — same registry, same governance, same
      // approved-actions ceiling as the command palette. A recognised action (or a
      // clarify) takes over the turn; "none" falls through to the plain Q&A answer.
      const p = await planNlAction(question, surface);
      if (p.kind !== "none") { setPlan(p); return; }
      const r = await askCopilot(question, surface, mode);
      setAnswer(r.answer); setPersona(r.persona?.title ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Copilot failed"); }
    finally { setBusy(false); }
  };

  const onRun = async (p: Extract<ActionPlan, { kind: "action" }>): Promise<void> => {
    // The second confirm for a write lives in ActionPlanCard itself (an AlertDialog,
    // shared with the command palette) — onRun only fires after that's accepted.
    setBusy(true); setError(null);
    try {
      const r = await executePlannedAction(p.tool, p.args);
      setResult(typeof r === "string" ? r : JSON.stringify(r, null, 2));
      setPlan(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card data-testid="copilot">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Portfolio copilot <ContainmentBadge /></CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ask about portfolio health (“which projects are at risk?”, “summarise schedule slippage”),
          or tell it to do something (“mark issue 42 done”). A recognised action is shown for
          review — nothing runs until you confirm.
        </p>
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && question.trim()) void onAsk(); }}
            placeholder="Ask a question…"
            aria-label="Portfolio question"
            className="h-9 flex-1 rounded-md border border-border bg-transparent px-2 text-sm"
          />
          <DictateButton onText={(t) => setQuestion((prev) => (prev ? `${prev} ${t}` : t))} />
          <Button size="sm" disabled={busy || !question.trim()} onClick={() => void onAsk()} data-testid="copilot-ask">{busy ? "Thinking…" : "Ask"}</Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground" role="radiogroup" aria-label="Answer mode">
          <span>Answer mode:</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="copilot-mode" checked={mode === "rag"} onChange={() => setMode("rag")} data-testid="copilot-mode-rag" />
            RAG (methodology lens)
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="copilot-mode" checked={mode === "freeform"} onChange={() => setMode("freeform")} data-testid="copilot-mode-freeform" />
            Freeform
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-red-600" data-testid="copilot-error">{error}</p>}
        {plan && <ActionPlanCard plan={plan} busy={busy} onRun={(p) => void onRun(p)} testIdPrefix="copilot" />}
        {answer && (
          <div className="space-y-1">
            {persona && <p className="text-xs text-muted-foreground" data-testid="copilot-persona">Answered as a <span className="font-medium">{persona}</span></p>}
            <div className="whitespace-pre-wrap rounded border border-border p-2 text-sm" data-testid="copilot-answer">{answer}</div>
          </div>
        )}
        {result && <pre className="overflow-x-auto rounded bg-muted p-2 text-xs" data-testid="copilot-result">{result}</pre>}
      </CardContent>
    </Card>
  );
}
