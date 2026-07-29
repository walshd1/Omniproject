import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { safeParseJson } from "../../lib/safe-json";
import { proposeBatch, type AgenticBatchPlan, type ProposedBatch } from "../../lib/agentic";

const EXAMPLE = JSON.stringify(
  {
    scope: { kind: "project", projectId: "PROJ-1" },
    actions: [
      { kind: "notify", params: { to: "pm@example.com", message: "Triage complete" } },
      { kind: "set-status", params: { issueId: "ISSUE-1", status: "in-progress" } },
    ],
  },
  null,
  2,
);

/**
 * Supervised agentic execution (D1) — submit a planned batch of low-risk actions for a SINGLE human approval
 * ("approve-the-batch"). The agent (or an operator) provides the plan; the gateway validates it against the
 * executable allowlist and raises one approval proposal. Structural, bulk and financial actions stay
 * propose-only. Nothing runs until a human signs it off in the approvals inbox — and then only under a
 * just-in-time grant that is torn down after the run.
 */
export function SupervisedBatchAdmin() {
  const [text, setText] = useState(EXAMPLE);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ProposedBatch | null>(null);

  const propose = useMutation({
    mutationFn: (plan: AgenticBatchPlan) => proposeBatch(plan),
    onSuccess: (r) => setResult(r),
  });

  function submit() {
    setParseError(null);
    setResult(null);
    let plan: AgenticBatchPlan;
    try {
      // Untrusted, user-typed JSON — parse via the prototype-pollution-safe reviver (the server re-validates
      // and strips dangerous keys again, but the SPA deserialization-boundary gate wants this here too).
      plan = safeParseJson<AgenticBatchPlan>(text);
    } catch {
      setParseError("The plan is not valid JSON.");
      return;
    }
    propose.mutate(plan);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Supervised agentic execution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Submit a batch of low-risk actions (notify, set-field, set-status, assign, add-label) for a single
          human approval. Structural, bulk and financial actions stay propose-only. Nothing runs until it is
          approved in the approvals inbox — then only under a just-in-time grant that is torn down afterwards.
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          aria-label="Batch plan (JSON)"
          className="font-mono text-xs"
        />
        <Button onClick={submit} disabled={propose.isPending}>
          {propose.isPending ? "Submitting…" : "Preview & request approval"}
        </Button>

        {parseError && (
          <Alert variant="destructive">
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}
        {propose.isError && (
          <Alert variant="destructive">
            <AlertDescription>{(propose.error as Error).message}</AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="space-y-2">
            <Alert>
              <AlertDescription>
                Submitted — pending approval (proposal <code>{result.proposalId}</code>). Ask an approver to
                sign it off in the approvals inbox; it executes only once approved.
              </AlertDescription>
            </Alert>
            <ul className="space-y-1 text-sm">
              {result.preview.map((step, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={step.allowed ? "text-green-600" : "text-red-600"}>{step.allowed ? "✓" : "✕"}</span>
                  <span className="font-mono">{step.kind}</span>
                  {step.reason && <span className="text-muted-foreground">— {step.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
