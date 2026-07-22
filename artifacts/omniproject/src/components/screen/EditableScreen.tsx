import { useState } from "react";
import { ScreenRenderer } from "./ScreenRenderer";
import { type ScreenDef, type ScreenLayout } from "../../lib/screen";
import { useScreenLayouts } from "../../lib/screen-layouts";
import { useSaveScreenOverride } from "../../lib/org-screens";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useToast } from "@/hooks/use-toast";

/**
 * EditableScreen — the ONE wrapper that turns any generic ScreenRenderer screen into an admin/PMO
 * EDITABLE one. It renders the screen with its saved per-screen layout (panel order / spans / hidden)
 * applied, and — only for a PMO or admin — offers an "Edit layout" mode: drag to reorder, ±span to
 * resize, hide/show each panel, then Save (FOLDED into the screen def in the encrypted def store via the
 * importer, PMO-gated) or Cancel. Non-editors (and anyone in a build without the authoring authority) just see
 * the arranged
 * screen. The panels' CONTENT is governed separately (each data-backed screen has its own admin panel);
 * this only owns LAYOUT, so every screen gets the same editing affordance for free.
 */
export function EditableScreen({
  screen,
  caps,
  methodology,
  bare,
  fallbackLayout,
}: {
  screen: ScreenDef;
  caps?: Record<string, boolean>;
  methodology?: string;
  /** Full-bleed mode (a hosted full-page component) — passed through to the renderer. */
  bare?: boolean;
  /** A default arrangement applied when the customer hasn't saved their own — e.g. a methodology's
   *  canonical layout. The customer's saved layout always wins over this. */
  fallbackLayout?: ScreenLayout | null;
}) {
  const { data: auth } = useAuth();
  // Only offer layout editing when there's actually something to arrange (2+ panels). A single-panel
  // screen (e.g. a full-page component host) gains nothing from reorder/span/hide, so it stays clean.
  const canEdit = isPmoOrAdmin(auth?.role) && screen.panels.length >= 2;
  const { data: legacyLayouts } = useScreenLayouts(); // migration bridge — a not-yet-folded settings layout
  const { save: saveOverride, saving } = useSaveScreenOverride();
  const { toast } = useToast();

  // The layout is FOLDED INTO the screen def now: `screen.layout` wins. Beneath it, a not-yet-migrated legacy
  // settings layout (bridge), then a methodology's canonical layout (fallback).
  const saved = screen.layout ?? legacyLayouts?.[screen.id] ?? fallbackLayout ?? null;
  const [editing, setEditing] = useState(false);
  // The working copy while editing (committed to the server on Save).
  const [draft, setDraft] = useState<ScreenLayout | null>(null);
  const layout = editing ? draft : saved;

  const startEdit = () => {
    setDraft({ order: saved?.order ?? [], spans: { ...(saved?.spans ?? {}) }, hidden: [...(saved?.hidden ?? [])] });
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(null);
  };
  const commit = async () => {
    // Fold the arrangement INTO the screen def: upsert an org `screen` override carrying this layout, through
    // the ONE importer path. The def keeps its (custom or built-in) panels; the layout rides on it.
    try {
      await saveOverride({ ...screen, layout: draft ?? {} });
      setEditing(false);
      setDraft(null);
      toast({ title: "Layout saved", description: `“${screen.label}” arrangement updated for everyone.` });
    } catch (err) {
      toast({ title: "Couldn't save layout", description: (err as Error).message, variant: "destructive" });
    }
  };

  // Draft mutators — each returns a fresh ScreenLayout so React re-renders.
  const spanOf = (id: string, fallback: number): number => draft?.spans?.[id] ?? fallback;
  const setSpan = (id: string, span: number) => {
    const clamped = Math.min(Math.max(span, 1), 12);
    setDraft((d) => ({ ...(d ?? {}), spans: { ...(d?.spans ?? {}), [id]: clamped } }));
  };
  const isHidden = (id: string): boolean => (draft?.hidden ?? []).includes(id);
  const toggleHidden = (id: string) => {
    setDraft((d) => {
      const hidden = new Set(d?.hidden ?? []);
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
      return { ...(d ?? {}), hidden: [...hidden] };
    });
  };

  return (
    <div data-testid={`editable-screen-${screen.id}`} className={bare ? "h-full" : undefined}>
      {canEdit && (
        <div className="mb-4 flex items-center gap-2">
          {!editing ? (
            <button
              type="button"
              onClick={startEdit}
              data-testid="edit-layout"
              className="border-2 border-foreground bg-background px-3 py-1 text-xs font-bold uppercase tracking-wide hover:bg-muted"
            >
              Edit layout
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={commit}
                disabled={saving}
                data-testid="save-layout"
                className="border-2 border-foreground bg-foreground px-3 py-1 text-xs font-bold uppercase tracking-wide text-background disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save layout"}
              </button>
              <button
                type="button"
                onClick={cancel}
                data-testid="cancel-layout"
                className="border-2 border-foreground bg-background px-3 py-1 text-xs font-bold uppercase tracking-wide hover:bg-muted"
              >
                Cancel
              </button>
              <span className="text-xs text-muted-foreground">Drag panels to reorder; use the controls to resize or hide.</span>
            </>
          )}
        </div>
      )}

      {editing && (
        <div className="mb-4 border-2 border-dashed border-border p-3" data-testid="layout-editor-controls">
          <ul className="space-y-2">
            {screen.panels.map((panel) => {
              const span = spanOf(panel.id, panel.span ?? 12);
              const hidden = isHidden(panel.id);
              return (
                <li key={panel.id} className="flex flex-wrap items-center gap-2 text-xs" data-testid={`layout-row-${panel.id}`}>
                  <span className={`min-w-40 font-bold ${hidden ? "line-through text-muted-foreground" : ""}`}>{panel.title ?? panel.id}</span>
                  <span className="text-muted-foreground">span</span>
                  <button type="button" aria-label={`Narrow ${panel.id}`} data-testid={`span-down-${panel.id}`} onClick={() => setSpan(panel.id, span - 1)} className="border border-foreground px-1.5 font-bold">−</button>
                  <span data-testid={`span-value-${panel.id}`} className="w-6 text-center tabular-nums">{span}</span>
                  <button type="button" aria-label={`Widen ${panel.id}`} data-testid={`span-up-${panel.id}`} onClick={() => setSpan(panel.id, span + 1)} className="border border-foreground px-1.5 font-bold">+</button>
                  <button
                    type="button"
                    data-testid={`toggle-hidden-${panel.id}`}
                    onClick={() => toggleHidden(panel.id)}
                    className="border border-foreground px-2 py-0.5 font-bold uppercase hover:bg-muted"
                  >
                    {hidden ? "Show" : "Hide"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ScreenRenderer
        screen={screen}
        {...(caps ? { caps } : {})}
        {...(methodology ? { methodology } : {})}
        {...(bare ? { bare: true } : {})}
        layout={layout}
        editable={editing}
        onLayoutChange={(next) => setDraft(next)}
      />
    </div>
  );
}
