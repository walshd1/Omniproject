import { TimesheetPanel } from "./TimesheetPanel";
import { useAuth } from "../../lib/auth";
import { useTimesheetSources, useTimesheets, useTimesheetAction } from "../../lib/timesheets-api";

/**
 * Timesheet review — lists the caller's sheets (managers also see a submitted-approval queue) and
 * wires each `TimesheetPanel` to the workflow API. When no timesheet source is enabled it explains how
 * to turn one on (adopt self-host / enable a backend source), rather than pretending. Persistence is
 * below the seam; this is just the client of /api/timesheets.
 */
export function TimesheetReview() {
  const { data: auth } = useAuth();
  const { data: sources } = useTimesheetSources();
  const enabled = !!sources?.available;
  const { data: sheets } = useTimesheets(undefined, enabled);
  const action = useTimesheetAction();

  if (sources && !sources.available) {
    return (
      <section className="border border-dashed border-border p-4" data-testid="timesheets-disabled">
        <p className="text-sm text-muted-foreground">
          Timesheets aren't enabled. They persist below the seam — <strong>adopt the self-host database</strong> (Settings →
          Self-host capabilities) or enable a backend timesheet source. The gateway itself stores nothing.
        </p>
      </section>
    );
  }

  const list = sheets ?? [];
  return (
    <section className="space-y-3" data-testid="timesheet-review">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Timesheets</h2>
        {sources?.source && <span className="text-[11px] text-muted-foreground">stored in {sources.source}</span>}
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="timesheet-review-empty">No timesheets yet.</p>
      ) : (
        list.map((sheet) => (
          <TimesheetPanel
            key={sheet.id}
            sheet={sheet}
            {...(auth?.user?.sub ? { currentUserId: auth.user.sub } : {})}
            onAction={(type) => action.mutate({ id: sheet.id, type })}
          />
        ))
      )}
    </section>
  );
}
