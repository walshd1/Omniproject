import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useSavedViews, useSaveViews, type SavedView } from "../../lib/saved-views";
import { taskDescriptor } from "../../lib/view-engine/task-descriptor";
import { issueDescriptor } from "../../lib/view-engine/issue-descriptor";
import type { EntityField } from "../../lib/view-engine/types";

/**
 * View builder (PMO/admin) — author named, shared custom views for the generic view engine. Pick the
 * entity (task/issue), the view kind (list/board), optional filters, a sort and a group-by, then
 * save. Saved views appear in that entity's view switcher for everyone. Writes go through /api/views
 * (PMO-gated, config-bundle config) alongside the grid's saved views.
 */
type Entity = "task" | "issue";
const DESCRIPTORS: Record<Entity, { noun: string; fields: EntityField[] }> = {
  task: { noun: "task", fields: taskDescriptor.fields as EntityField[] },
  issue: { noun: "issue", fields: issueDescriptor.fields as EntityField[] },
};

interface FilterRow { field: string; value: string }

export function ViewBuilder() {
  const { data: auth } = useAuth();
  const { data: all } = useSavedViews();
  const save = useSaveViews();
  const { toast } = useToast();

  const [entity, setEntity] = useState<Entity>("task");
  const [viewKind, setViewKind] = useState<"list" | "board" | "table" | "timeline">("list");
  const [name, setName] = useState("");
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [groupBy, setGroupBy] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [dateField, setDateField] = useState("");

  const fields = DESCRIPTORS[entity].fields;
  const dateFields = fields.filter((f) => f.isDate);
  const existing = useMemo(() => (all ?? []).filter((v) => v.entity === "task" || v.entity === "issue"), [all]);

  if (!isPmoOrAdmin(auth?.role)) return null;

  const reset = () => { setName(""); setFilters([]); setSortField(""); setSortDir("asc"); setGroupBy(""); setColumns([]); setDateField(""); };
  const toggleColumn = (k: string) => setColumns((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  const submit = () => {
    if (!name.trim()) { toast({ title: "NAME REQUIRED", description: "Give the view a name.", variant: "destructive" }); return; }
    const view: SavedView = {
      id: crypto.randomUUID(),
      name: name.trim(),
      entity,
      viewKind,
      scope: `engine:${entity}`,
      ...(filters.filter((f) => f.field && f.value).length ? { filters: filters.filter((f) => f.field && f.value) } : {}),
      ...(sortField ? { sort: { field: sortField, dir: sortDir } } : {}),
      ...(groupBy ? { groupBy } : {}),
      ...(viewKind === "table" && columns.length ? { columns } : {}),
      ...(viewKind === "timeline" && dateField ? { dateField } : {}),
    };
    save.mutate([...(all ?? []), view], {
      onSuccess: () => { toast({ title: "VIEW SAVED", description: `“${view.name}” is now available in the ${entity} views.` }); reset(); },
      onError: (e) => toast({ title: "COULDN'T SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  const remove = (id: string) => {
    const v = existing.find((x) => x.id === id);
    if (typeof window !== "undefined" && !window.confirm(`Delete the shared view “${v?.name ?? id}”? This removes it for everyone.`)) return;
    save.mutate((all ?? []).filter((x) => x.id !== id), { onError: (e) => toast({ title: "COULDN'T DELETE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }) });
  };

  const inputCls = "w-full rounded-none border border-border bg-card px-2 py-2 text-sm";

  return (
    <Card className="rounded-none border-border">
      <CardHeader><CardTitle className="text-sm font-bold uppercase tracking-wider">Custom views</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">Author named, shared views over your tasks and issues — pick what to show and how to slice it. Everyone sees them in the view switcher.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="vb-entity" className="text-xs uppercase tracking-widest text-muted-foreground">Entity</Label>
            <select id="vb-entity" className={inputCls} value={entity} onChange={(e) => { setEntity(e.target.value as Entity); setSortField(""); setGroupBy(""); setFilters([]); setColumns([]); setDateField(""); }}>
              <option value="task">Tasks</option>
              <option value="issue">Issues</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vb-kind" className="text-xs uppercase tracking-widest text-muted-foreground">View kind</Label>
            <select id="vb-kind" className={inputCls} value={viewKind} onChange={(e) => setViewKind(e.target.value as "list" | "board" | "table" | "timeline")}>
              <option value="list">List</option>
              <option value="board">Board</option>
              <option value="table">Table</option>
              {dateFields.length > 0 && <option value="timeline">Timeline</option>}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="vb-name" className="text-xs uppercase tracking-widest text-muted-foreground">Name</Label>
          <input id="vb-name" className={inputCls} placeholder="e.g. My high-priority actions" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>

        {/* Date field (timeline kind only) */}
        {viewKind === "timeline" && (
          <div className="space-y-1">
            <Label htmlFor="vb-datefield" className="text-xs uppercase tracking-widest text-muted-foreground">Date field (timeline axis)</Label>
            <select id="vb-datefield" className={inputCls} value={dateField} onChange={(e) => setDateField(e.target.value)}>
              <option value="">(first date field)</option>
              {dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
        )}

        {/* Columns (table kind only) */}
        {viewKind === "table" && (
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Columns</span>
            <div className="flex flex-wrap gap-3">
              {fields.map((f) => (
                <label key={f.key} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={columns.includes(f.key)} onChange={() => toggleColumn(f.key)} aria-label={`Column ${f.label}`} />
                  {f.label}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">None selected = show every field.</p>
          </div>
        )}

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Filters</span>
            <Button type="button" variant="outline" className="rounded-none h-7 text-xs" onClick={() => setFilters((f) => [...f, { field: fields[0]?.key ?? "", value: "" }])}>Add filter</Button>
          </div>
          {filters.map((f, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select aria-label={`Filter field ${i + 1}`} className={inputCls} value={f.field} onChange={(e) => setFilters((rows) => rows.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))}>
                {fields.map((fl) => <option key={fl.key} value={fl.key}>{fl.label}</option>)}
              </select>
              <input aria-label={`Filter value ${i + 1}`} className={inputCls} placeholder="equals…" value={f.value} onChange={(e) => setFilters((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
              <Button type="button" variant="ghost" className="rounded-none h-8 px-2 text-xs" onClick={() => setFilters((rows) => rows.filter((_, j) => j !== i))} aria-label={`Remove filter ${i + 1}`}>✕</Button>
            </div>
          ))}
        </div>

        {/* Sort + group (list slicing) */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="vb-sort" className="text-xs uppercase tracking-widest text-muted-foreground">Sort by</Label>
            <select id="vb-sort" className={inputCls} value={sortField} onChange={(e) => setSortField(e.target.value)}>
              <option value="">—</option>
              {fields.map((fl) => <option key={fl.key} value={fl.key}>{fl.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vb-dir" className="text-xs uppercase tracking-widest text-muted-foreground">Direction</Label>
            <select id="vb-dir" className={inputCls} value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")} disabled={!sortField}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vb-group" className="text-xs uppercase tracking-widest text-muted-foreground">Group by</Label>
            <select id="vb-group" className={inputCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} disabled={viewKind !== "list"}>
              <option value="">—</option>
              {fields.map((fl) => <option key={fl.key} value={fl.key}>{fl.label}</option>)}
            </select>
          </div>
        </div>

        <Button className="rounded-none" onClick={submit} disabled={save.isPending || !name.trim()}>Save view</Button>

        {existing.length > 0 && (
          <div className="pt-2 border-t border-border space-y-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Existing custom views</span>
            <ul className="divide-y divide-border border border-border">
              {existing.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span><span className="font-semibold">{v.name}</span> <span className="text-[11px] uppercase tracking-wider text-muted-foreground">· {v.entity} · {v.viewKind ?? "list"}</span></span>
                  <Button type="button" variant="ghost" className="rounded-none h-7 px-2 text-xs" onClick={() => remove(v.id)}>Delete</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
