import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { askCopilot, type CopilotMode } from "../../lib/copilot";
import { ContainmentBadge } from "../ContainmentBadge";
import { DictateButton } from "../DictateButton";

/**
 * Portfolio copilot — ask questions about the portfolio in plain language. Read-only: it
 * summarises a minimal, scoped snapshot (RAG, variances, blockers) and never takes an
 * action or writes. The containment badge shows how exposed the AI is.
 */
export function Copilot() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [persona, setPersona] = useState<string | null>(null);
  const [mode, setMode] = useState<CopilotMode>("rag");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surface = typeof window !== "undefined" ? window.location.pathname : undefined;

  const onAsk = async (): Promise<void> => {
    setBusy(true); setError(null); setAnswer(null); setPersona(null);
    try { const r = await askCopilot(question, surface, mode); setAnswer(r.answer); setPersona(r.persona?.title ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "Copilot failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card data-testid="copilot">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Portfolio copilot <ContainmentBadge /></CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ask about portfolio health (“which projects are at risk?”, “summarise schedule slippage”).
          Read-only — it only describes a scoped snapshot and never changes anything.
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
        {error && <p className="text-sm text-red-600" data-testid="copilot-error">{error}</p>}
        {answer && (
          <div className="space-y-1">
            {persona && <p className="text-xs text-muted-foreground" data-testid="copilot-persona">Answered as a <span className="font-medium">{persona}</span></p>}
            <div className="whitespace-pre-wrap rounded border border-border p-2 text-sm" data-testid="copilot-answer">{answer}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
