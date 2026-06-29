import { useState, useEffect } from "react";
import {
  useGetProjectIssues,
  useUpdateIssue,
  useListActivity,
  getGetProjectIssuesQueryKey,
  getListActivityQueryKey,
  type Issue,
  type IssueUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useSidePanel } from "../../lib/side-panel";
import { useFeatures, featureEnabled } from "../../lib/features";
import { useAvailability, fieldVisible } from "../../lib/availability";
import { useInvalidateIssueQueries } from "../../hooks/use-invalidate-issue-queries";
import { STATUS_ORDER, PRIORITY_ORDER, statusLabel, priorityLabel } from "../../lib/constants";

/**
 * Rich side-panel (the "sidePanel" feature module). A slide-over detail view for a single work item:
 * a quick read-out of its fields (availability-gated), inline edit of the common fields through the
 * existing issue-update endpoint with the optimistic-concurrency token (a concurrent change → 409 →
 * refresh, never clobber), and the item's recent activity when the backend surfaces it. Opened from
 * anywhere via the side-panel store; rendered once at the app shell and gated by `useFeatures`.
 */

/** Build the single-field update payload, binding the optimistic-concurrency token when known. */
export function buildFieldUpdate(field: keyof IssueUpdate & string, value: unknown, version: number | null | undefined): IssueUpdate {
  return { [field]: value, ...(version != null ? { expectedVersion: version } : {}) } as IssueUpdate;
}

function EditableRow({
  label, value, type, options, onCommit,
}: {
  label: string;
  value: string;
  type: "text" | "date" | "select";
  options?: { value: string; label: string }[];
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
      <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</span>
      {type === "select" ? (
        <select
          aria-label={label}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); onCommit(e.target.value); }}
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
          onBlur={commit}
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
  const { data: availability } = useAvailability();
  const { data: issues } = useGetProjectIssues(projectId ?? "", {
    query: { enabled: enabled && open && !!projectId, queryKey: getGetProjectIssuesQueryKey(projectId ?? "") },
  });
  const { data: activity } = useListActivity({ query: { enabled: enabled && open, queryKey: getListActivityQueryKey() } });
  const updateIssue = useUpdateIssue();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateIssueQueries();
  const { toast } = useToast();

  if (!enabled) return null;

  const issue = (issues ?? []).find((i) => i.id === issueId) ?? null;
  const show = (key: string) => fieldVisible(availability, key);

  function commit(field: keyof IssueUpdate & string, raw: string, coerce: (v: string) => unknown = (v) => v) {
    if (!issue || !projectId) return;
    const pid: string = projectId; // narrowed; keep a string-typed local for the deferred callbacks
    const iss = issue;
    const value = coerce(raw);
    const data = buildFieldUpdate(field, value, iss.version);
    const key = getGetProjectIssuesQueryKey(pid);
    const prev = queryClient.getQueryData<Issue[]>(key);
    queryClient.setQueryData<Issue[]>(key, (old) => (old ?? []).map((i) => (i.id === iss.id ? { ...i, [field]: value } : i)));
    updateIssue.mutate(
      { projectId: pid, issueId: iss.id, data },
      {
        onSuccess: () => invalidate(pid),
        onError: (err) => {
          if (prev) queryClient.setQueryData(key, prev);
          const conflict = (err as { status?: number }).status === 409;
          invalidate(pid);
          toast({
            title: conflict ? "EDIT CONFLICT" : "ERROR",
            description: conflict ? "This item changed elsewhere — the panel has been refreshed." : "Couldn't save the change.",
            variant: "destructive",
          });
        },
      },
    );
  }

  const issueActivity = (activity ?? []).filter((a) => a.issueId === issueId).slice(0, 8);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="issue-side-panel">
        {!issue ? (
          <div className="p-2 text-sm text-muted-foreground" data-testid="side-panel-empty">
            {open ? "Loading work item…" : ""}
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-left">{issue.title}</SheetTitle>
              <SheetDescription className="text-left font-mono text-xs">{issue.id}</SheetDescription>
            </SheetHeader>

            <div className="mt-4" data-testid="side-panel-fields">
              {show("status") && (
                <EditableRow label="Status" type="select" value={issue.status}
                  options={STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) }))}
                  onCommit={(v) => commit("status", v)} />
              )}
              {show("priority") && (
                <EditableRow label="Priority" type="select" value={issue.priority}
                  options={PRIORITY_ORDER.map((p) => ({ value: p, label: priorityLabel(p) }))}
                  onCommit={(v) => commit("priority", v)} />
              )}
              {show("assignee") && (
                <EditableRow label="Assignee" type="text" value={issue.assignee ?? ""}
                  onCommit={(v) => commit("assignee", v, (s) => (s.trim() === "" ? null : s.trim()))} />
              )}
              {show("dueDate") && (
                <EditableRow label="Due" type="date" value={(issue.dueDate ?? "").slice(0, 10)}
                  onCommit={(v) => commit("dueDate", v, (s) => (s.trim() === "" ? null : s.trim()))} />
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
