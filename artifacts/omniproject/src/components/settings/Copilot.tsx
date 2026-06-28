import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { askCopilot } from "../../lib/copilot";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surface = typeof window !== "undefined" ? window.location.pathname : undefined;

  const onAsk = async (): Promise<void> => {
    setBusy(true); setError(null); setAnswer(null);
    try { setAnswer((await askCopilot(question, surface)).answer); }
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
        {error && <p className="text-sm text-red-600" data-testid="copilot-error">{error}</p>}
        {answer && <div className="whitespace-pre-wrap rounded border border-border p-2 text-sm" data-testid="copilot-answer">{answer}</div>}
      </CardContent>
    </Card>
  );
}
