import { useMemo, useState } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, PRIORITY_LABELS, STATUS_ORDER, PRIORITY_ORDER } from "../../lib/constants";
import { isOverdue } from "../../lib/methodology";
import { IssueDialog } from "../IssueDialog";

type SortKey = "title" | "status" | "priority" | "assignee" | "dueDate";

export function ListView({ projectId }: { projectId: string }) {
  const { data: issues, isLoading } = useGetProjectIssues(projectId);
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

  if (isLoading) return <div className="p-8 text-center font-bold tracking-widest text-muted-foreground animate-pulse">LOADING…</div>;

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="text-left px-3 py-2 cursor-pointer select-none hover:text-foreground" onClick={() => toggle(k)}>
      {children}{sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <>
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
              <tr key={issue.id} onClick={() => setEditing(issue)} className="border-b border-border hover:bg-muted/30 cursor-pointer">
                <td className="px-3 py-2 font-semibold">{issue.title}</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${STATUS_COLORS[issue.status]}`} />{STATUS_LABELS[issue.status]}</span></td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[issue.priority]}`} />{PRIORITY_LABELS[issue.priority]}</span></td>
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
    </>
  );
}
