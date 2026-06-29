import { Button } from "@/components/ui/button";
import { useAvailability, useSetHiddenFields } from "../../lib/availability";

/**
 * Admin/PMO field-visibility curation. The backend decides what's *available* (superset ∩ backend);
 * this lets an admin or PMO HIDE available-but-unwanted fields from view. It can only hide what's
 * available — never reveal what the backend lacks. The choice persists to the config bundle
 * (settings.hiddenFields), so the curated view travels with the deployment.
 */
export function FieldVisibilityAdmin() {
  const { data: availability } = useAvailability();
  const setHidden = useSetHiddenFields();

  if (!availability) return null;
  const hiddenSet = new Set(availability.hidden);

  function toggle(field: string) {
    const next = new Set(availability!.hidden);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    setHidden.mutate([...next]);
  }

  return (
    <section className="space-y-3" data-testid="field-visibility">
      <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Field visibility</h2>
      <p className="text-xs text-muted-foreground">
        Your backend makes <span className="font-mono">{availability.available.length}</span> fields available
        (source: {availability.source}). Hide any you don't use — the choice travels in your config bundle.
        Hidden: <span className="font-mono">{availability.hidden.length}</span>.
      </p>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {availability.available.map((field) => {
          const hidden = hiddenSet.has(field);
          return (
            <button
              key={field}
              type="button"
              onClick={() => toggle(field)}
              disabled={setHidden.isPending}
              aria-pressed={!hidden}
              className={`flex items-center justify-between border-2 border-foreground px-2 py-1 text-left text-xs font-mono ${hidden ? "opacity-40 line-through" : ""}`}
            >
              <span>{field}</span>
              <span className="ml-2 font-bold">{hidden ? "hidden" : "shown"}</span>
            </button>
          );
        })}
      </div>
      {availability.available.length === 0 && (
        <p className="text-xs text-muted-foreground">No fields available from the current backend yet.</p>
      )}
    </section>
  );
}
