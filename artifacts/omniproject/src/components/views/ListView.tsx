import { useMemo, useState } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { STATUS_LABELS, PRIORITY_LABELS, STATUS_ORDER, PRIORITY_ORDER } from "../../lib/constants";
import { isOverdue } from "../../lib/methodology";
import { IssueDialog } from "../IssueDialog";
import { DataState } from "../DataState";
import { StatusDot, PriorityDot } from "../StatusDot";

type SortKey = "title" | "status" | "priority" | "assignee" | "dueDate";

export function ListView({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);
  const [editing, setEditing] = useState<Issue | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "status", dir: 1 });

  const rows = useMemo(() => {
    const arr = [...(issues ?? [])];
    const rank = (i: Issue): number | string => {
      switch (sort.key) {
        case "status": return STATUS_ORDER.indexOf(i.status as (typeof STATUS_ORDER)[number]);
        case "priority": return PRIORITY_ORDER.indexOf(i.priority as (typeof PRIORITY_ORDER)[number]);
        case "dueDate": return i.dueDate ?? "9999";
        case "assignee": return i.assignee ?? "~";
        default: return i.title.toLowerCase();
      }
    };
    arr.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0) * sort.dir);
    return arr;
  }, [issues, sort]);

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => {
    const active = sort.key === k;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
        className="text-left px-3 py-2 select-none"
      >
        <button
          type="button"
          onClick={() => toggle(k)}
          className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {children}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()}>
      <div className="h-full overflow-auto bg-card border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b border-border text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th k="title">Title</Th>
              <Th k="status">Status</Th>
              <Th k="priority">Priority</Th>
              <Th k="assignee">Assignee</Th>
              <Th k="dueDate">Due</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((issue) => (
              <tr
                key={issue.id}
                onClick={() => setEditing(issue)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditing(issue);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open work item: ${issue.title}`}
                className="border-b border-border hover:bg-muted/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset"
              >
                <td className="px-3 py-2 font-semibold">{issue.title}</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><StatusDot status={issue.status} />{STATUS_LABELS[issue.status]}</span></td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><PriorityDot priority={issue.priority} />{PRIORITY_LABELS[issue.priority]}</span></td>
                <td className="px-3 py-2 text-muted-foreground">{issue.assignee ?? "—"}</td>
                <td className={`px-3 py-2 font-mono ${isOverdue(issue) ? "text-red-500 font-bold" : "text-muted-foreground"}`}>{issue.dueDate ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No work items.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <IssueDialog projectId={projectId} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} issue={editing} />
    </DataState>
  );
}
