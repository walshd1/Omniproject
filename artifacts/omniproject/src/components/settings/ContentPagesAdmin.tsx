import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { componentsFor } from "@workspace/backend-catalogue";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useContentPages, useSaveContentPages, type ContentPageDef } from "../../lib/content-pages";
import { useMethodologyComposition } from "../../lib/methodology-composition-api";
import { isEnabled } from "../../lib/methodology-composition";
import { useDraftAdmin } from "../../hooks/use-draft-admin";

/**
 * Content-page builder (the "content pages" feature module). A content page is deliberately minimal —
 * a NAME plus a flat, ORDERED list of ids picked from the unified component library
 * (componentsFor("content"): every report + widget). No layout engine, no per-instance overrides; each
 * component renders with its own declared refresh cadence. Saved as settings.contentPages and rendered
 * on the public Content page via the generic LibraryComponentView. PMO-gated, mirroring the server —
 * same shared-config shape as the report generator (CustomReportsAdmin).
 */
export function ContentPagesAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useContentPages();
  const save = useSaveContentPages();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<ContentPageDef[], ContentPageDef[]>(server, structuredClone);
  const { data: composition } = useMethodologyComposition();

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!draft) return null;

  // The unified library ids are namespaced (report:evm, widget:…). Report components are methodology
  // composition items, so a curated composition hides those the PMO turned off; widgets and other kinds
  // aren't composition items and always stay pickable. Uncurated (default) shows everything.
  const catalogue = componentsFor("content").filter((c) => !c.id.startsWith("report:") || isEnabled(composition ?? null, c.id));

  const patch = (i: number, p: ContentPageDef) => setDraft(draft.map((x, j) => (j === i ? p : x)));

  function addPage() {
    setDraft([...draft!, { id: crypto.randomUUID(), name: `Page ${draft!.length + 1}`, componentIds: [] }]);
  }
  function removePage(i: number) {
    setDraft(draft!.filter((_, j) => j !== i));
  }
  function addComponent(i: number, componentId: string) {
    const p = draft![i]!;
    if (!componentId || p.componentIds.includes(componentId)) return;
    patch(i, { ...p, componentIds: [...p.componentIds, componentId] });
  }
  function removeComponent(i: number, componentId: string) {
    const p = draft![i]!;
    patch(i, { ...p, componentIds: p.componentIds.filter((id) => id !== componentId) });
  }
  function moveComponent(i: number, componentId: string, dir: -1 | 1) {
    const p = draft![i]!;
    const a = p.componentIds.indexOf(componentId);
    const b = a + dir;
    if (a < 0 || b < 0 || b >= p.componentIds.length) return;
    const ids = [...p.componentIds];
    [ids[a], ids[b]] = [ids[b]!, ids[a]!];
    patch(i, { ...p, componentIds: ids });
  }

  const labelFor = (id: string): string => catalogue.find((c) => c.id === id)?.label ?? id;

  return (
    <section className="space-y-4" data-testid="content-pages-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Content pages</h2>
        <p className="text-xs text-muted-foreground">
          Compose named pages from the unified component library — pick reports and widgets, in order.
          They render on the Content page for everyone. No layout engine; each component keeps its own
          refresh cadence.
        </p>
      </div>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="content-pages-empty">No content pages yet — add one.</p>
      )}

      {draft.map((p, i) => (
        <div key={p.id} className="border-2 border-foreground p-3 space-y-3" data-testid={`content-page-edit-${i}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Content page ${i + 1} name`} placeholder="Page name" className="flex-1 min-w-44 rounded-none border-2 border-foreground"
              value={p.name} onChange={(e) => patch(i, { ...p, name: e.target.value })} />
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => removePage(i)}>Remove page</Button>
          </div>

          <div className="pl-2 border-l-2 border-border space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Components (in order)</p>
            {p.componentIds.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid={`content-page-${i}-no-components`}>No components yet — add one below.</p>
            ) : (
              p.componentIds.map((id, ci) => (
                <div key={id} className="flex items-center gap-2 text-xs" data-testid={`content-page-${i}-component-${ci}`}>
                  <span className="flex-1 font-bold">{labelFor(id)}</span>
                  <button type="button" onClick={() => moveComponent(i, id, -1)} aria-label={`Move ${labelFor(id)} up`} className="px-1 border border-foreground">↑</button>
                  <button type="button" onClick={() => moveComponent(i, id, 1)} aria-label={`Move ${labelFor(id)} down`} className="px-1 border border-foreground">↓</button>
                  <button type="button" onClick={() => removeComponent(i, id)} aria-label={`Remove ${labelFor(id)} from ${p.name}`} className="px-1.5 border border-red-500 text-red-500">✕</button>
                </div>
              ))
            )}
            <select aria-label={`Add component to ${p.name}`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
              value="" onChange={(e) => { addComponent(i, e.target.value); e.target.value = ""; }}>
              <option value="">+ Add component…</option>
              {catalogue.filter((c) => !p.componentIds.includes(c.id)).map((c) => (
                <option key={c.id} value={c.id}>{c.label} ({c.source})</option>
              ))}
            </select>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={addPage}>+ page</Button>
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save content pages"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={reset}>Reset</Button>}
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
