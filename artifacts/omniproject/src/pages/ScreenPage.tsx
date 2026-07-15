import { getScreenDef, canonicalLayoutFor } from "../lib/screen-catalogue";
import type { ScreenDef } from "../lib/screen";
import { EditableScreen } from "../components/screen/EditableScreen";

/**
 * ScreenPage — the ONE generic builder page behind every editable screen. Given a screen `id`, it loads
 * that screen's JSON definition from the catalogue and renders it through the EditableScreen canvas: the
 * renderer imports the panel primitives, configures each from the JSON (columns, span, data `source`,
 * methodology tags), and each primitive then loads its own data. Adding or changing a screen is therefore a
 * JSON edit plus a route pointing here at its id — no bespoke page code.
 *
 * `bare` screens (a single hosted full-page component) render full-bleed, without ScreenPage's own header,
 * so a migrated page looks exactly as it did. `params` (route params) are threaded onto every panel's
 * config, so a `component`-hosted detail page receives its projectId / programmeId.
 *
 * Capability gating (hiding a panel whose backend domain isn't fed) is threaded per-panel via each panel's
 * `needs` tag; the current screens declare none, so caps aren't wired here yet — that adapter lands with the
 * first screen that needs it.
 */
export function ScreenPage({ id, methodology, params }: { id: string; methodology?: string; params?: Record<string, string> }) {
  const def = getScreenDef(id);

  if (!def) {
    return (
      <div className="p-8 text-sm text-muted-foreground" data-testid={`screen-unknown-${id}`}>
        Unknown screen “{id}”. It may have been removed or renamed.
      </div>
    );
  }

  // Thread route params (projectId / programmeId / …) onto every panel's config so a hosted component
  // receives them. The JSON stays param-free; the router supplies the live value.
  const screen: ScreenDef = params
    ? { ...def, panels: def.panels.map((p) => ({ ...p, config: { ...(p.config ?? {}), ...params } })) }
    : def;

  // A methodology-tagged screen (e.g. the Kanban board) renders with ITS OWN methodology by default — so
  // its content is filtered and its canonical layout applies without a caller having to pass one. An
  // explicit `methodology` prop still wins. Neutral ("*") tags don't select a methodology.
  const activeMethodology = methodology ?? def.methodologies?.find((m) => m !== "*");

  // The methodology's canonical arrangement (if it ships one) becomes the layout fallback beneath any
  // customer-saved layout; content is filtered by the same methodology inside the renderer.
  const fallbackLayout = canonicalLayoutFor(def, activeMethodology);

  if (def.bare) {
    return (
      <div className="h-full" data-testid={`screen-${id}`}>
        <EditableScreen screen={screen} bare fallbackLayout={fallbackLayout} {...(activeMethodology ? { methodology: activeMethodology } : {})} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid={`screen-${id}`}>
      <div className="px-8 py-4 border-b border-border bg-card shrink-0 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black uppercase tracking-tighter">{def.label}</h1>
        {def.hint && <span className="text-xs text-muted-foreground">{def.hint}</span>}
      </div>
      <div className="flex-1 p-8 overflow-auto">
        <EditableScreen screen={screen} fallbackLayout={fallbackLayout} {...(activeMethodology ? { methodology: activeMethodology } : {})} />
      </div>
    </div>
  );
}
