import { useTagPrefs } from "../lib/use-tag-prefs";
import { resolveTagColor, tagPath, defaultTagColor } from "../lib/tag-prefs";

/**
 * TagEditor — the per-user tag COLOUR + HIERARCHY controls. For each tag it shows the resolved chip,
 * a colour picker (clearing reverts to the name-derived default), and a parent selector (the tag's
 * place in a hierarchy) drawn from the other known tags. Everything writes to the personal tag-prefs
 * overlay (localStorage) — it never touches the shared task data.
 */
export function TagEditor({ tags }: { tags: string[] }) {
  const prefs = useTagPrefs((s) => s.prefs);
  const setTag = useTagPrefs((s) => s.setTag);

  // The parent universe: every tag we know about (on this task + already in prefs), so a tag can nest
  // under another existing tag. A tag can't be its own parent.
  const universe = Array.from(new Set([...tags, ...Object.keys(prefs)])).sort();
  const unique = Array.from(new Set(tags));

  if (unique.length === 0) return null;

  return (
    <div data-testid="tag-editor">
      <h3 className="text-xs font-bold uppercase tracking-widest mb-2">Tags</h3>
      <ul className="space-y-2">
        {unique.map((tag) => {
          const path = tagPath(tag, prefs);
          const chosen = prefs[tag]?.color ?? "";
          return (
            <li key={tag} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono" style={{ color: resolveTagColor(tag, prefs) }}>#{tag}</span>
              {path.length > 1 && <span className="text-[10px] text-muted-foreground">{path.join(" › ")}</span>}
              <input
                type="color"
                aria-label={`Colour for ${tag}`}
                className="h-5 w-6 rounded-none border border-border bg-card p-0"
                value={chosen || toHexInput(defaultTagColor(tag))}
                onChange={(e) => setTag(tag, { color: e.target.value })}
              />
              {chosen && (
                <button type="button" className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground" onClick={() => setTag(tag, { color: undefined })}>Reset</button>
              )}
              <label className="flex items-center gap-1">
                <span className="uppercase tracking-widest text-[10px] text-muted-foreground">Parent</span>
                <select
                  aria-label={`Parent tag for ${tag}`}
                  className="rounded-none border border-border bg-card px-1.5 py-0.5 text-[11px]"
                  value={prefs[tag]?.parent ?? ""}
                  onChange={(e) => setTag(tag, { parent: e.target.value || undefined })}
                >
                  <option value="">— none —</option>
                  {universe.filter((t) => t !== tag).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** `<input type=color>` needs a #rrggbb value; the default colour is an hsl() string, so fall back to a
 *  neutral grey for the picker's initial swatch (the resolved default still colours the chip). */
function toHexInput(color: string): string {
  return color.startsWith("#") ? color : "#808080";
}
