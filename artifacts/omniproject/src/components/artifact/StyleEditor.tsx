import { type StyleSpec, FONT_CHOICES } from "../../lib/artifact-style";

/**
 * StyleEditor — the shared control for authoring an artifact's presentation StyleSpec (title, subtitle,
 * font, text colour, background, alignment). Controlled: it renders the current spec and emits the next
 * one (or `undefined` once every field is cleared, so an unstyled artifact stays unstyled). Reused by the
 * report and view builders so styling is authored the same way everywhere.
 */
export function StyleEditor({ value, onChange, idPrefix = "style" }: {
  value: StyleSpec | undefined;
  onChange: (next: StyleSpec | undefined) => void;
  idPrefix?: string;
}) {
  const s = value ?? {};

  // Set one field (empty/undefined clears it), then collapse an all-empty spec back to `undefined`.
  const set = (key: keyof StyleSpec, val: string | undefined) => {
    const next: Record<string, string> = {};
    for (const k of Object.keys(s) as (keyof StyleSpec)[]) {
      const v = s[k];
      if (v) next[k] = v;
    }
    if (val) next[key] = val;
    else delete next[key];
    onChange(Object.keys(next).length ? (next as unknown as StyleSpec) : undefined);
  };

  const label = "text-[10px] uppercase tracking-widest text-muted-foreground";
  const field = "rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs";

  return (
    <div className="grid grid-cols-2 gap-2" data-testid={`${idPrefix}-editor`}>
      <label className="flex flex-col gap-1 col-span-2">
        <span className={label}>Title</span>
        <input className={field} value={s.title ?? ""} maxLength={200} placeholder="(artifact default)"
          onChange={(e) => set("title", e.target.value)} data-testid={`${idPrefix}-title`} />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        <span className={label}>Subtitle</span>
        <input className={field} value={s.subtitle ?? ""} maxLength={200}
          onChange={(e) => set("subtitle", e.target.value)} data-testid={`${idPrefix}-subtitle`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Font</span>
        <select className={field} value={s.fontFamily ?? ""} onChange={(e) => set("fontFamily", e.target.value || undefined)} data-testid={`${idPrefix}-font`}>
          <option value="">Default</option>
          {FONT_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Align</span>
        <select className={field} value={s.align ?? "left"} onChange={(e) => set("align", e.target.value === "center" ? "center" : undefined)} data-testid={`${idPrefix}-align`}>
          <option value="left">Left</option>
          <option value="center">Center</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Text colour</span>
        <span className="flex items-center gap-1">
          <input type="color" value={s.textColor ?? "#000000"} onChange={(e) => set("textColor", e.target.value)} data-testid={`${idPrefix}-text-color`} aria-label="Text colour" />
          {s.textColor && <button type="button" className="text-[10px] underline text-muted-foreground" onClick={() => set("textColor", "")} data-testid={`${idPrefix}-text-color-clear`}>clear</button>}
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Background</span>
        <span className="flex items-center gap-1">
          <input type="color" value={s.background ?? "#ffffff"} onChange={(e) => set("background", e.target.value)} data-testid={`${idPrefix}-bg-color`} aria-label="Background colour" />
          {s.background && <button type="button" className="text-[10px] underline text-muted-foreground" onClick={() => set("background", "")} data-testid={`${idPrefix}-bg-color-clear`}>clear</button>}
        </span>
      </label>
    </div>
  );
}
