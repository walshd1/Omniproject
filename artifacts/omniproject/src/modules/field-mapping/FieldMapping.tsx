import { useMemo, useState } from "react";
import { Link2, Trash2, Save, AlertTriangle, Database } from "lucide-react";
import { DataState } from "../../components/DataState";
import { useLiveSuperset, useResolvedMapping, refFromSuperset, type SupersetField, type FieldRef } from "./field-mapping";
import { useImportDef } from "../../lib/defs";
import { useToast } from "@/hooks/use-toast";

/**
 * Field-mapping admin (roadmap §4.6) — map a UI element onto a LIVE superset field. The admin only ever sees
 * fields an active backend (or the sidecar) can serve; picking one carries its origin, type and length across,
 * and the UI element's validation is inherited from that home. The mapping is saved as a first-class `mapping`
 * def in the org store (the backend↔superset↔UI triple), through the one importer.
 */

/** A short human description of what a field can hold, from its advertised constraints. */
function limits(f: SupersetField): string {
  const parts: string[] = [];
  if (typeof f.maxLength === "number") parts.push(`≤ ${f.maxLength} chars`);
  if (typeof f.precision === "number") parts.push(`${f.precision} dp`);
  if (f.options?.length) parts.push(`one of ${f.options.length}`);
  if (f.nullable) parts.push("optional");
  return parts.join(" · ") || "—";
}

/** One pending UI-element → superset-field link the admin is composing. */
interface Entry { ui: string; field: SupersetField }

export function FieldMapping() {
  const superset = useLiveSuperset();
  const importDef = useImportDef();
  const { toast } = useToast();

  const [slot, setSlot] = useState("issue");
  const [ui, setUi] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState("");
  const [previewProject, setPreviewProject] = useState("");

  const fields = superset.data ?? [];
  // Fold `?? []` inside and depend on the react-query-stable `superset.data` — a `fields` intermediate
  // is a fresh `[]` while loading, which would re-run this filter every render.
  const visible = useMemo(
    () => (superset.data ?? []).filter((f) => `${f.label} ${f.canonicalKey} ${f.system} ${f.nativeField}`.toLowerCase().includes(filter.toLowerCase())),
    [superset.data, filter],
  );
  const selected = fields.find((f) => f.id === selectedId);
  const preview = useResolvedMapping(previewProject || undefined, slot);

  function addEntry() {
    if (!ui.trim() || !selected) return;
    setEntries((e) => [...e.filter((x) => x.ui !== ui.trim()), { ui: ui.trim(), field: selected }]);
    setUi("");
    setSelectedId("");
  }

  async function save() {
    if (!slot.trim() || !entries.length) return;
    const mapFields: Record<string, FieldRef> = {};
    for (const e of entries) mapFields[e.ui] = refFromSuperset(e.field);
    try {
      await importDef.mutateAsync({ kind: "mapping", storage: "org", name: `Mapping: ${slot}`, payload: { id: slot.trim(), fields: mapFields } });
      toast({ title: "Mapping saved", description: `${entries.length} field(s) mapped for “${slot}”, org-wide.` });
      setEntries([]);
    } catch (err) {
      toast({ variant: "destructive", title: "Could not save", description: err instanceof Error ? err.message : "Import failed" });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Link2 className="h-6 w-6" /> Field mapping</h1>
        <p className="text-sm text-muted-foreground">
          Map a UI element onto a live backend field. You only see fields a connected backend (or the sidecar) can
          serve — each carries its origin, type and length, and the UI field inherits that validation.
        </p>
      </header>

      {/* Live superset — the only fields you can map onto. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Available fields ({fields.length})</h2>
          <input
            value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…"
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <DataState isLoading={superset.isLoading} isError={superset.isError} error={superset.error} onRetry={() => void superset.refetch()}>
          {fields.length === 0
            ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">No backend is connected — nothing is mappable yet. Connect a backend or turn on the sidecar.</p>
            : <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Field</th><th className="px-3 py-2">Origin</th>
                  <th className="px-3 py-2">Type</th><th className="px-3 py-2">Accepts</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.id} className={`border-t ${selectedId === f.id ? "bg-primary/10" : ""}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{f.label}</div>
                      <div className="text-xs text-muted-foreground">{f.canonicalKey}{f.canonical ? "" : " (custom)"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs"><Database className="h-3 w-3" />{f.system}</span>
                      <div className="text-xs text-muted-foreground">{f.nativeField}</div>
                    </td>
                    <td className="px-3 py-2">{f.type}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{limits(f)}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setSelectedId(f.id)} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Pick</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </DataState>
      </section>

      {/* Compose the mapping. */}
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-medium">Compose mapping</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Slot
            <input value={slot} onChange={(e) => setSlot(e.target.value)} className="mt-1 block rounded-md border bg-background px-3 py-1.5" />
          </label>
          <label className="text-sm">UI element name
            <input value={ui} onChange={(e) => setUi(e.target.value)} placeholder="e.g. Title" className="mt-1 block rounded-md border bg-background px-3 py-1.5" />
          </label>
          <div className="text-sm">
            <div className="text-muted-foreground">Picked field</div>
            <div className="mt-1 rounded-md border px-3 py-1.5">{selected ? `${selected.label} ← ${selected.system}:${selected.nativeField}` : "— pick above —"}</div>
          </div>
          <button onClick={addEntry} disabled={!ui.trim() || !selected} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Add link</button>
        </div>

        {entries.length > 0 && (
          <ul className="divide-y rounded-md border">
            {entries.map((e) => (
              <li key={e.ui} className="flex items-center justify-between px-3 py-2 text-sm">
                <span><strong>{e.ui}</strong> ← {e.field.canonicalKey} ← <span className="text-muted-foreground">{e.field.system}:{e.field.nativeField}</span></span>
                <button onClick={() => setEntries((xs) => xs.filter((x) => x.ui !== e.ui))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={save} disabled={!entries.length || importDef.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          <Save className="h-4 w-4" /> Save mapping (org-wide)
        </button>
      </section>

      {/* Effective mapping — homeless + inherited validation. */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Effective mapping</h2>
        <label className="text-sm">Preview in project
          <input value={previewProject} onChange={(e) => setPreviewProject(e.target.value)} placeholder="project id" className="ml-2 rounded-md border bg-background px-3 py-1.5" />
        </label>
        {previewProject && (
          <DataState isLoading={preview.isLoading} isError={preview.isError} error={preview.error} onRetry={() => void preview.refetch()}>
            {preview.data && (
              <div className="space-y-3 rounded-lg border p-4 text-sm">
                {preview.data.homeless.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <span>Homeless fields (give each a home or remove it): {preview.data.homeless.join(", ")}</span>
                  </div>
                )}
                <div>
                  <div className="mb-1 font-medium">Fields</div>
                  <ul className="space-y-1">
                    {Object.entries(preview.data.fields).map(([k, ref]) => (
                      <li key={k} className="text-muted-foreground">
                        <strong className="text-foreground">{k}</strong> ← {typeof ref === "string" ? ref : `${ref.superset ?? ref.field} @ ${ref.backend ?? "—"}`}
                      </li>
                    ))}
                  </ul>
                </div>
                {preview.data.validation.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium">Inherited validation</div>
                    <ul className="space-y-1 text-muted-foreground">
                      {preview.data.validation.map((v) => (
                        <li key={v.field}>{v.field}: {[v.required ? "required" : "", v.max != null ? `max ${v.max}` : "", v.options ? `one of [${v.options.join(", ")}]` : ""].filter(Boolean).join(", ")}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </DataState>
        )}
      </section>
    </div>
  );
}
