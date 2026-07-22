import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Panel } from "../../../lib/screen";
import { useAuth, roleAtLeast, type Role } from "../../../lib/auth";
import { useSettingsSlice, settingsQueryKey } from "../../../lib/settings-query";
import { useDraftAdmin } from "../../../hooks/use-draft-admin";
import { sendJson } from "../../../lib/api";
import { useToast } from "@/hooks/use-toast";
import { EditableRowTable } from "../../settings/EditableRowTable";
import { useStore } from "../../../store/useStore";
import { useSlotRows, slotRowsQueryKey, type SlotRow } from "../../../lib/data-slot";

/**
 * Register panel — an EDITABLE data grid on the screen itself. Unlike the read-only `table`, this lets an
 * authorised user (contributor+) complete and update the underlying register right here — add / edit / delete
 * rows and Save. Viewers see the same data read-only. It has TWO sources, chosen in JSON:
 *
 *  - SETTINGS collection (`collection` + `endpoint`): rows read from the shared /api/settings slice, saved as a
 *    whole array to that collection's PUT endpoint (RACI, stakeholders, budget lines, …).
 *  - GENERIC SLOT (`slot`): rows read from `/api/projects/{active}/mapping/:slot/rows`, saved by RECONCILING the
 *    draft against the server through the generic mapping surface (per-row PUT + DELETE of removed rows). This
 *    is the SAME editable grid, just slot-backed — so a register/board over ANY mapping slot (epics, sprints,
 *    raid, milestones, …) is a pure JSON screen def with no new primitive or endpoint.
 *
 * config: {
 *   // settings-collection source:
 *   collection?, endpoint?, responseKey?, idPrefix?, addLabel?, defaultEditRole?,
 *   // OR slot source:
 *   slot?,
 *   columns: [{ field, label, type?: "text"|"number"|"select"|"date", options?: string[] }]
 * }
 */
type Row = Record<string, unknown> & { id: string };
interface Column { field: string; label: string; type?: "text" | "number" | "select" | "date"; options?: string[] }

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export function RegisterPanel({ panel }: { panel: Panel }) {
  const c = (panel.config ?? {}) as Record<string, unknown>;
  const collection = str(c["collection"]);
  const endpoint = str(c["endpoint"]);
  const responseKey = str(c["responseKey"]) || collection;
  const slot = str(c["slot"]);
  const projectId = useStore((s) => s.activeProjectId) ?? "";
  const idPrefix = str(c["idPrefix"]) || collection || slot || "row";
  const addLabel = str(c["addLabel"]) || "Add entry";
  const columns: Column[] = Array.isArray(c["columns"]) ? (c["columns"] as Column[]) : [];

  const { data: auth } = useAuth();
  // Edit policy: default USER-EDITABLE (contributor+); an admin/PMO can raise the bar per collection or set
  // it read-only via collectionEditRoles. A panel may set its own `defaultEditRole` fallback in JSON.
  const { data: policy } = useSettingsSlice((s) => {
    const map = (s["collectionEditRoles"] ?? {}) as Record<string, string>;
    return typeof map[collection] === "string" ? map[collection] : undefined;
  });
  const fallbackRole = (str(c["defaultEditRole"]) || "contributor") as Role;
  const effective = policy ?? fallbackRole;
  // Both sources are always subscribed (hooks are enabled-gated by their key), only the chosen one is used.
  const { data: settingsRows } = useSettingsSlice((s) => (Array.isArray(s[collection]) ? (s[collection] as Row[]) : []));
  const { data: slotRows } = useSlotRows(slot ? projectId : undefined, slot);
  const serverRows = useMemo<Row[]>(() => (slot ? (slotRows as Row[] | undefined) : settingsRows) ?? [], [slot, slotRows, settingsRows]);
  // Slot mode writes through the generic surface (contributor+, server-enforced); settings mode needs an endpoint.
  const canEdit = (slot ? !!projectId : !!endpoint) && effective !== "readonly" && roleAtLeast(auth?.role, effective as Role);
  const { draft, setDraft, dirty, reset } = useDraftAdmin<Row[], Row[]>(serverRows);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Reconcile the draft against the server through the generic slot surface: upsert every draft row (id keys it,
  // not a written value), then delete any server row the draft dropped. The server re-validates each write.
  const saveSlot = async (rows: Row[]) => {
    const base = `/api/projects/${encodeURIComponent(projectId)}/mapping/${encodeURIComponent(slot)}`;
    const draftIds = new Set(rows.map((r) => str(r.id)).filter(Boolean));
    for (const r of rows) {
      const rowId = str(r.id);
      if (!rowId) continue;
      const fields: SlotRow = {};
      for (const [k, v] of Object.entries(r)) if (k !== "id") fields[k] = v;
      await sendJson(`${base}/${encodeURIComponent(rowId)}`, { fields }, "PUT", "Failed to save");
    }
    for (const r of serverRows) {
      const rowId = str(r.id);
      if (rowId && !draftIds.has(rowId)) await sendJson<void>(`${base}/${encodeURIComponent(rowId)}`, undefined, "DELETE", "Failed to delete");
    }
  };

  const save = useMutation({
    mutationFn: async (rows: Row[]) => (slot ? saveSlot(rows) : sendJson<unknown>(endpoint, { [responseKey]: rows }, "PUT", "Failed to save")),
    onSuccess: () => {
      if (slot) qc.invalidateQueries({ queryKey: slotRowsQueryKey(projectId, slot) });
      else qc.invalidateQueries({ queryKey: settingsQueryKey });
      qc.invalidateQueries({ queryKey: ["panel-data"] });
      toast({ title: "SAVED", description: panel.title ?? collection ?? slot });
    },
    onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });

  const rows = (canEdit ? draft : serverRows) ?? [];

  const header = panel.title && (
    <CardHeader className="pb-1"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle></CardHeader>
  );

  // Read-only view for non-editors (or a panel with no endpoint).
  if (!canEdit) {
    return (
      <Card>
        {header}
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">{columns.map((col) => <th key={col.field} className="py-1 pr-4 font-bold">{col.label}</th>)}</tr></thead>
            <tbody data-testid="register-readonly-body">
              {rows.map((r) => <tr key={r.id} className="border-b border-border/50">{columns.map((col) => <td key={col.field} className="py-1 pr-4">{str(r[col.field])}</td>)}</tr>)}
            </tbody>
          </table>
          {rows.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No entries yet.</p>}
        </CardContent>
      </Card>
    );
  }

  const set = (i: number, field: string, value: unknown) => setDraft(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const newRow = (): Row => {
    const r: Row = { id: `${idPrefix}-${rows.length + 1}-${Math.floor(performance.now())}` };
    for (const col of columns) r[col.field] = col.type === "number" ? 0 : col.type === "select" ? (col.options?.[0] ?? "") : "";
    return r;
  };

  return (
    <Card>
      {header}
      <CardContent className="space-y-2">
        <EditableRowTable
          rows={rows}
          rowKey={(_, i) => i}
          rowTestId={(_, i) => `register-row-${i}`}
          onRemove={(i) => setDraft(rows.filter((_, j) => j !== i))}
          removeLabel={(i) => `Remove row ${i + 1}`}
          emptyText="No entries yet."
          columns={columns.map((col) => ({
            header: col.label,
            cell: (r: Row, i: number) => col.type === "select" ? (
              <select aria-label={`Row ${i + 1} ${col.label}`} value={str(r[col.field])} onChange={(e) => set(i, col.field, e.target.value)} className="h-8 border border-foreground bg-background px-1 text-xs">
                {(col.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <Input aria-label={`Row ${i + 1} ${col.label}`} type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                value={col.type === "number" ? (typeof r[col.field] === "number" ? (r[col.field] as number) : "") : str(r[col.field])}
                onChange={(e) => set(i, col.field, col.type === "number" ? (e.target.value === "" ? 0 : Number(e.target.value)) : e.target.value)}
                className="h-8 max-w-44" />
            ),
          }))}
        />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, newRow()])} data-testid="register-add">{addLabel}</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={() => save.mutate(rows)} disabled={!dirty || save.isPending} data-testid="register-save">{save.isPending ? "SAVING…" : "Save"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
