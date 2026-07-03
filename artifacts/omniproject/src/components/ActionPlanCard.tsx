import { Button } from "@/components/ui/button";
import { ConfirmButton } from "./ConfirmButton";
import type { ActionPlan } from "../lib/nl-action";

/**
 * Renders one NL→action plan for review — the SAME confirm-before-execute card for every
 * entry point that offers action-invocation (the command palette `NlCommand`, and the
 * portfolio copilot chat). One renderer, not a fork per surface: a write always shows the
 * plan (action + args) AND requires an explicit AlertDialog confirmation (the same
 * accessible, styleable pattern used for every other consequential action in the app,
 * rather than a native `window.confirm`) before `onRun` fires; a read still requires a
 * click, never auto-executes.
 *
 * `testIdPrefix` namespaces the `data-testid`s so two instances (e.g. the command palette
 * and the copilot) can render on the same page/settings screen without colliding.
 */
export function ActionPlanCard({
  plan,
  busy,
  onRun,
  testIdPrefix = "nl",
}: {
  plan: ActionPlan;
  busy: boolean;
  onRun: (p: Extract<ActionPlan, { kind: "action" }>) => void;
  testIdPrefix?: string;
}) {
  if (plan.kind === "action") {
    return (
      <div className="rounded border border-border p-2 text-sm" data-testid={`${testIdPrefix}-plan-action`}>
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono font-medium">{plan.action}</span>
          {plan.write
            ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">write</span>
            : <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">read</span>}
        </div>
        {Object.keys(plan.args).length > 0 && (
          <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(plan.args, null, 2)}</pre>
        )}
        {plan.write ? (
          <ConfirmButton
            testId={`${testIdPrefix}-run`}
            disabled={busy}
            className="inline-flex min-h-8 items-center justify-center rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground shadow-sm disabled:pointer-events-none disabled:opacity-50"
            title="Run this write action?"
            description={`This will modify data via "${plan.action}". Review the arguments above before confirming — it's still gated by role + write-grants, but this is the last review step.`}
            confirmLabel="Confirm & run"
            onConfirm={() => onRun(plan)}
          >
            Confirm &amp; run (write)
          </ConfirmButton>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => onRun(plan)} data-testid={`${testIdPrefix}-run`}>
            Run
          </Button>
        )}
      </div>
    );
  }

  if (plan.kind === "clarify") {
    return <p className="text-sm" data-testid={`${testIdPrefix}-clarify`}>{plan.question}</p>;
  }

  return <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}-none`}>No matching action: {plan.reason}</p>;
}
