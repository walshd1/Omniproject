import { useState } from "react";
import type { Issue } from "@workspace/api-client-react";
import { EntityViews } from "../view-engine/EntityViews";
import { issueDescriptor } from "../../lib/view-engine/issue-descriptor";
import { IssueDialog } from "../IssueDialog";

/**
 * The issue "Flow" view — issues rendered through the shared generic view engine (the exact same
 * list/board components tasks use), proving tasks and issues are treated identically. Opening a card
 * hands the raw issue to the standard {@link IssueDialog}. Registered like any other project view.
 */
export function IssueEngineView({ projectId }: { projectId: string }) {
  const [editing, setEditing] = useState<Issue | null>(null);
  return (
    <div className="h-full overflow-auto p-4">
      <EntityViews descriptor={issueDescriptor} scope={{ projectId }} onOpen={(r) => setEditing(r.raw)} />
      <IssueDialog projectId={projectId} open={!!editing} issue={editing} onOpenChange={(o) => { if (!o) setEditing(null); }} />
    </div>
  );
}
