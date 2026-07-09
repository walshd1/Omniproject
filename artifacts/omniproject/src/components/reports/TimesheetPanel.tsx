import { availableActions, timesheetHours, type Timesheet, type TimesheetAction } from "../../lib/timesheet";

/**
 * Weekly timesheet panel — entries + total + the submit/approve/reject/reopen controls the workflow
 * state machine allows (lib/timesheet). Presentational + controlled: it renders the sheet it's given
 * and emits actions; persistence is the caller's (brokered to the backend, per the overlay posture).
 */
const STATUS_TONE: Record<Timesheet["status"], string> = {
  draft: "text-muted-foreground",
  submitted: "text-amber-600",
  approved: "text-green-600",
  rejected: "text-red-500",
};

const ACTION_LABEL: Record<TimesheetAction["type"], string> = {
  submit: "Submit", approve: "Approve", reject: "Reject", reopen: "Reopen",
};

export function TimesheetPanel({
  sheet,
  currentUserId,
  onAction,
}: {
  sheet: Timesheet;
  /** The signed-in user — used to hide approve/reject on your own sheet (segregation of duties). */
  currentUserId?: string;
  onAction?: (action: TimesheetAction["type"]) => void;
}) {
  const actions = availableActions(sheet).filter((a) => {
    if ((a === "approve" || a === "reject") && currentUserId && currentUserId === sheet.resourceId) return false;
    return true;
  });

  return (
    <section className="space-y-3 border border-border" data-testid="timesheet-panel">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
        <span className="font-bold text-sm">Week of {sheet.weekStart}</span>
        <span className={`text-xs font-black uppercase tracking-widest ${STATUS_TONE[sheet.status]}`} data-testid="timesheet-status">{sheet.status}</span>
      </div>

      <table className="w-full text-xs border-collapse px-3">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
            <th className="py-1.5 px-3 font-bold">Date</th>
            <th className="py-1.5 px-2 font-bold">Project</th>
            <th className="py-1.5 px-2 font-bold text-right">Hours</th>
          </tr>
        </thead>
        <tbody>
          {sheet.entries.map((e) => (
            <tr key={e.id} className="border-b border-border/50">
              <td className="py-1.5 px-3 tabular-nums text-muted-foreground">{e.date}</td>
              <td className="py-1.5 px-2">{e.projectId}{e.issueId ? ` · ${e.issueId}` : ""}</td>
              <td className="py-1.5 px-2 text-right tabular-nums font-bold">{e.hours}h</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-1.5 px-3 text-[10px] uppercase tracking-widest text-muted-foreground" colSpan={2}>Total</td>
            <td className="py-1.5 px-2 text-right tabular-nums font-black" data-testid="timesheet-total">{timesheetHours(sheet)}h</td>
          </tr>
        </tfoot>
      </table>

      {sheet.note && <p className="px-3 text-[11px] text-red-500" data-testid="timesheet-note">Reviewer: {sheet.note}</p>}

      <div className="flex gap-2 px-3 pb-3">
        {actions.length === 0 && <span className="text-[11px] text-muted-foreground">No actions available.</span>}
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            data-testid={`timesheet-action-${a}`}
            onClick={() => onAction?.(a)}
            className="border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
    </section>
  );
}
