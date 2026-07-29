import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/ConfirmButton";
import { toast } from "@/hooks/use-toast";
import { fetchPendingBatches, type PendingBatch } from "../../lib/agentic";
import { decideProposal, passkeySupported } from "../../lib/approvals";

const PENDING_KEY = ["agentic", "pending-batches"] as const;

/**
 * Supervised agentic execution (D1) — the APPROVE / ABORT surface. Lists the batches awaiting THIS user's
 * sign-off, each with its exact planned actions + a fresh dry-run preview, and lets the approver APPROVE
 * (execute under the just-in-time grant) or ABORT (signed rejection) — both bound to their passkey, so an
 * abort is as auditable as an approval. The proposer never sees their own batch here (self-approval is
 * refused server-side).
 */
export function SupervisedBatchApprovals() {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: PENDING_KEY, queryFn: fetchPendingBatches });

  const decide = useMutation({
    mutationFn: ({ proposalId, decision }: { proposalId: string; decision: "approve" | "reject" }) =>
      decideProposal(proposalId, decision),
    onSuccess: (_r, vars) => {
      toast({
        title: vars.decision === "approve" ? "Batch approved" : "Batch aborted",
        description: vars.decision === "approve" ? "The batch is executing under a just-in-time grant." : "The batch was rejected and will not run.",
      });
      void qc.invalidateQueries({ queryKey: PENDING_KEY });
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not record the decision", description: (err as Error).message }),
  });

  const busyId = decide.isPending ? decide.variables?.proposalId : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Supervised batches — approvals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Batches of low-risk agent actions awaiting your sign-off. Review the exact actions, then approve
          (executes once, under a just-in-time grant torn down afterwards) or abort. Both are signed with your
          passkey.
        </p>

        {!passkeySupported() && (
          <Alert variant="destructive">
            <AlertDescription>This browser can’t sign approvals — a passkey-capable browser is required.</AlertDescription>
          </Alert>
        )}
        {pending.isError && (
          <Alert variant="destructive">
            <AlertDescription>{(pending.error as Error).message}</AlertDescription>
          </Alert>
        )}

        {pending.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (pending.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No batches are awaiting your approval.</p>
        ) : (
          <ul className="space-y-3">
            {pending.data!.map((b) => (
              <BatchRow key={b.proposalId} batch={b} busy={busyId === b.proposalId} onDecide={(decision) => decide.mutate({ proposalId: b.proposalId, decision })} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BatchRow({ batch, busy, onDecide }: { batch: PendingBatch; busy: boolean; onDecide: (d: "approve" | "reject") => void }) {
  const scope = batch.plan.scope.kind === "project" ? `project ${batch.plan.scope.projectId}` : "org-wide";
  const blocked = batch.preview.some((s) => !s.allowed);
  return (
    <li className="rounded-md border p-3 space-y-2" data-testid={`batch-${batch.proposalId}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{batch.plan.actions.length} action{batch.plan.actions.length === 1 ? "" : "s"}</span>
          <span className="text-muted-foreground"> · {scope}</span>
        </div>
        <div className="flex items-center gap-2">
          <ConfirmButton
            className="text-red-600"
            title="Abort this batch?"
            description="The batch is rejected and will not run. You’ll sign the rejection with your passkey."
            confirmLabel="Abort"
            disabled={busy}
            testId={`abort-${batch.proposalId}`}
            onConfirm={() => onDecide("reject")}
          >
            Abort
          </ConfirmButton>
          <Button disabled={busy || blocked} onClick={() => onDecide("approve")} data-testid={`approve-${batch.proposalId}`}>
            {busy ? "Signing…" : "Approve"}
          </Button>
        </div>
      </div>
      {blocked && (
        <Alert variant="destructive">
          <AlertDescription>One or more actions would be denied at execution — resolve before approving.</AlertDescription>
        </Alert>
      )}
      <ul className="space-y-1 text-sm">
        {batch.preview.map((step, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className={step.allowed ? "text-green-600" : "text-red-600"}>{step.allowed ? "✓" : "✕"}</span>
            <span className="font-mono">{step.kind}</span>
            {step.reason && <span className="text-muted-foreground">— {step.reason}</span>}
          </li>
        ))}
      </ul>
    </li>
  );
}
