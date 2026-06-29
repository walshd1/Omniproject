import { useState, useEffect } from "react";
import {
  useGetProjectIssues,
  useListActivity,
  getGetProjectIssuesQueryKey,
  getListActivityQueryKey,
  type IssueUpdate,
} from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useSidePanel } from "../../lib/side-panel";
import { useRecentItems } from "../../lib/recent-items";
import { useSwipe } from "../../lib/use-swipe";
import { usePresence } from "../../lib/presence";
import { PresenceAvatars } from "../presence/PresenceAvatars";
import { useFeatures, featureEnabled } from "../../lib/features";
import { useAvailability, fieldVisible } from "../../lib/availability";
import { useIssueFieldWrite } from "../../lib/use-issue-field-write";
import { STATUS_ORDER, PRIORITY_ORDER, statusLabel, priorityLabel } from "../../lib/constants";

/**
 * Rich side-panel (the "sidePanel" feature module). A slide-over detail view for a single work item:
 * a quick read-out of its fields (availability-gated), inline edit of the common fields via the
 * shared issue-field writer (optimistic + `expectedVersion` + undo; a concurrent change → 409 →
 * refresh, never clobber), and the item's recent activity when the backend surfaces it. Opened from
 * anywhere via the side-panel store; rendered once at the app shell and gated by `useFeatures`.
 */

// buildFieldUpdate now lives with the shared writer; re-exported for back-compat with callers/tests.
export { buildFieldUpdate } from "../../lib/use-issue-field-write";

function EditableRow({
  label, value, type, options, onCommit, lockedBy, onFocus, onBlur,
}: {
  label: string;
  value: string;
  type: "text" | "date" | "select";
  options?: { value: string; label: string }[];
  onCommit: (v: string) => void;
  /** Name of another collaborator currently editing this field (advisory hint), if any. */
  lockedBy?: string | undefined;
  /** Focus enters/leaves this field — used to advertise our editing claim to other collaborators. */
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  const release = () => { onBlur?.(); };
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
      <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        {label}
        {lockedBy && (
          <span className="ml-2 normal-case font-normal text-[10px] text-amber-600 dark:text-amber-500" data-testid={`lock-${label}`}>
            {lockedBy} editing…
          </span>
        )}
      </span>
      {type === "select" ? (
        <select
          aria-label={label}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); onCommit(e.target.value); }}
          onFocus={onFocus}
          onBlur={release}
          className="border border-foreground bg-background px-1 py-0.5 text-sm"
        >
          {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          aria-label={label}
          type={type === "date" ? "date" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={onFocus}
          onBlur={() => { commit(); release(); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className="border border-foreground bg-background px-1 py-0.5 text-sm"
        />
      )}
    </div>
  );
}

export function IssueSidePanel() {
  const { data: features } = useFeatures();
  const enabled = featureEnabled(features, "sidePanel");
  const { open, projectId, issueId, close } = useSidePanel();
  // Touch affordance: swipe the panel towards its edge (right) to dismiss. Additive only — the close
  // button (mouse) and Escape (keyboard) still close it, and touch events never fire on a non-touch
  // device, so binding unconditionally is inert there and the both-ways rule still holds.
  const swipe = useSwipe({ right: close });
  const { data: availability } = useAvailability();
  const { data: issues } = useGetProjectIssues(projectId ?? "", {
    query: { enabled: enabled && open && !!projectId, queryKey: getGetProjectIssuesQueryKey(projectId ?? "") },
  });
  const { data: activity } = useListActivity({ query: { enabled: enabled && open, queryKey: getListActivityQueryKey() } });
  const { write } = useIssueFieldWrite();

  // Live collaboration: join a presence room scoped to this work item so collaborators see each
  // other and (advisorily) which field is being edited. Gated by the "presence" feature module.
  const presenceOn = featureEnabled(features, "presence");
  const room = open && projectId && issueId ? `issue:${projectId}:${issueId}` : null;
  const { peers, setEditing } = usePresence(room, presenceOn && open);
  // Map a field → the first collaborator advertising they're editing it (advisory hint only).
  const editorOf = (field: string): string | undefined =>
    peers.find((p) => p.editing === field)?.label;

  // Remember an opened work item for the "Recent" quick-find list (findability).
  const recordRecent = useRecentItems((s) => s.record);
  const openedIssue = (issues ?? []).find((i) => i.id === issueId) ?? null;
  useEffect(() => {
    if (open && openedIssue && projectId) {
      recordRecent({ type: "issue", id: openedIssue.id, label: openedIssue.title, projectId });
    }
  }, [open, openedIssue, projectId, recordRecent]);

  if (!enabled) return null;

  const issue = openedIssue;
  const show = (key: string) => fieldVisible(availability, key);

  // Edit one field, optimistic + concurrency-safe, with a one-click Undo (shared writer).
  function commit(field: keyof IssueUpdate & string, raw: string, coerce: (v: string) => unknown = (v) => v) {
    if (!issue || !projectId) return;
    write(projectId, issue, field, coerce(raw), { undoable: true, label: `Updated ${field}` });
  }

  const issueActivity = (activity ?? []).filter((a) => a.issueId === issueId).slice(0, 8);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="issue-side-panel" {...swipe}>
        {!issue ? (
          <div className="p-2 text-sm text-muted-foreground" data-testid="side-panel-empty">
            {open ? "Loading work item…" : ""}
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-left">{issue.title}</SheetTitle>
              <SheetDescription className="text-left font-mono text-xs">{issue.id}</SheetDescription>
              {presenceOn && peers.length > 0 && (
                <div className="pt-2"><PresenceAvatars peers={peers} /></div>
              )}
            </SheetHeader>

            <div className="mt-4" data-testid="side-panel-fields">
              {show("status") && (
                <EditableRow label="Status" type="select" value={issue.status}
                  options={STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) }))}
                  onCommit={(v) => commit("status", v)}
                  lockedBy={editorOf("status")} onFocus={() => setEditing("status")} onBlur={() => setEditing(null)} />
              )}
              {show("priority") && (
                <EditableRow label="Priority" type="select" value={issue.priority}
                  options={PRIORITY_ORDER.map((p) => ({ value: p, label: priorityLabel(p) }))}
                  onCommit={(v) => commit("priority", v)}
                  lockedBy={editorOf("priority")} onFocus={() => setEditing("priority")} onBlur={() => setEditing(null)} />
              )}
              {show("assignee") && (
                <EditableRow label="Assignee" type="text" value={issue.assignee ?? ""}
                  onCommit={(v) => commit("assignee", v, (s) => (s.trim() === "" ? null : s.trim()))}
                  lockedBy={editorOf("assignee")} onFocus={() => setEditing("assignee")} onBlur={() => setEditing(null)} />
              )}
              {show("dueDate") && (
                <EditableRow label="Due" type="date" value={(issue.dueDate ?? "").slice(0, 10)}
                  onCommit={(v) => commit("dueDate", v, (s) => (s.trim() === "" ? null : s.trim()))}
                  lockedBy={editorOf("dueDate")} onFocus={() => setEditing("dueDate")} onBlur={() => setEditing(null)} />
              )}
            </div>

            <div className="mt-6">
              <h3 className="mb-2 text-xs font-black uppercase tracking-widest text-muted-foreground">Activity</h3>
              {issueActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="side-panel-no-activity">No recent activity.</p>
              ) : (
                <ul className="space-y-2" data-testid="side-panel-activity">
                  {issueActivity.map((a) => (
                    <li key={a.id} className="text-sm border-l-2 border-primary pl-3">
                      <span className="font-bold">{a.actor}</span> {a.action.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
