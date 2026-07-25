import { useState } from "react";
import type { Issue } from "@workspace/api-client-react";
import { EntityViews } from "../view-engine/EntityViews";
import { issueDescriptor } from "../../lib/view-engine/issue-descriptor";
import { IssueDialog } from "../IssueDialog";

/**
 * The issue "Flow" view — issues rendered through the shared generic view engine (the exact same
 * list/board components tasks use), proving tasks and issues are treated identically. Opening a card
 * hands the raw issue to the standard {@link IssueDialog}; the board's per-column "+" / "+ Add"
 * opens the same dialog seeded with that column's status. `lockView` renders a single view without
 * the switcher — how the `kanban` / `list` methodology renderers reuse this engine (retiring the old
 * bespoke AgileBoard / ListView), while the default (unlocked) is the full multi-view flow.
 */
export function IssueEngineView({ projectId, lockView }: { projectId: string; lockView?: string }) {
  const [editing, setEditing] = useState<Issue | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const dialogOpen = editing != null || creating != null;
  return (
    <div className="h-full overflow-auto p-4">
      <EntityViews
        descriptor={issueDescriptor}
        scope={{ projectId }}
        onOpen={(r) => { setCreating(null); setEditing(r.raw); }}
        onCreate={({ status }) => { setEditing(null); setCreating(status ?? "backlog"); }}
        {...(lockView ? { lockView } : {})}
      />
      <IssueDialog
        projectId={projectId}
        open={dialogOpen}
        issue={editing}
        {...(creating != null ? { defaultStatus: creating } : {})}
        onOpenChange={(o) => { if (!o) { setEditing(null); setCreating(null); } }}
      />
    </div>
  );
}

/**
 * The `kanban` methodology renderer — the generic engine locked to the issue board (retires the old
 * bespoke AgileBoard). Columns/labels/colours come from the org's resolved vocabulary; drag / the
 * per-card selector move with optimistic update + undo + conflict handling; the per-column "+" and
 * empty "+ Add" create in that column.
 */
export function IssueBoardView({ projectId }: { projectId: string }) {
  return <IssueEngineView projectId={projectId} lockView="issue:board" />;
}

/**
 * The `list` methodology renderer — the generic engine locked to the sortable issue table (retires
 * the old bespoke ListView). Same data, one shared table primitive.
 */
export function IssueListView({ projectId }: { projectId: string }) {
  return <IssueEngineView projectId={projectId} lockView="issue:table" />;
}
