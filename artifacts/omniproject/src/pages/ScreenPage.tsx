import { getScreenDef } from "../lib/screen-catalogue";
import { EditableScreen } from "../components/screen/EditableScreen";

/**
 * ScreenPage — the ONE generic builder page behind every editable screen. Given a screen `id`, it loads
 * that screen's JSON definition from the catalogue and renders it through the EditableScreen canvas: the
 * renderer imports the panel primitives, configures each from the JSON (columns, span, data `source`,
 * methodology tags), and each primitive then loads its own data. Adding or changing a screen is therefore a
 * JSON edit plus a route pointing here at its id — no bespoke page code. Budgets, and (as the sweep lands)
 * reports/resources/… all resolve to exactly this.
 *
 * Capability gating (hiding a panel whose backend domain isn't fed) is threaded per-panel via each panel's
 * `needs` tag; the current screens declare none, so caps aren't wired here yet — that adapter lands with the
 * first screen that needs it.
 */
export function ScreenPage({ id, methodology }: { id: string; methodology?: string }) {
  const def = getScreenDef(id);

  if (!def) {
    return (
      <div className="p-8 text-sm text-muted-foreground" data-testid={`screen-unknown-${id}`}>
        Unknown screen “{id}”. It may have been removed or renamed.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black uppercase tracking-tighter">{def.label}</h1>
        {def.hint && <span className="text-xs text-muted-foreground">{def.hint}</span>}
      </div>
      <div className="flex-1 p-8 overflow-auto">
        <EditableScreen
          screen={def}
          {...(methodology ? { methodology } : {})}
        />
      </div>
    </div>
  );
}
