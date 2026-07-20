/**
 * Org-authored SCREEN DEFINITIONS — the data behind "a PMO builds or modifies a screen and stores it in
 * their org's (encrypted) config JSON to override a shipped default, and a new methodology arrives as a
 * simple JSON bundle." This module owns only the SHAPE VALIDATOR for that stored JSON; the SPA merges these
 * over its built-in screen catalogue (org id wins) and renders them through the one generic builder.
 *
 * Validation is deliberately LENIENT + forward-compatible: it pins the structural essentials (each screen
 * has a string id + label and an array of panels, each panel a string id + kind) and passes everything else
 * (panel `config` / `source`, `methodologies`, `route`, `nav`, `methodologyLayouts`, `bare`) through
 * untouched, so a bundle authored against a newer builder — new panel kinds, new fields — is stored rather
 * than rejected. The renderer already degrades an unknown panel kind to a labelled placeholder.
 */

export class ScreenDefError extends Error {
  constructor(message: string) { super(message); this.name = "ScreenDefError"; }
}

/** A stored org screen definition. Structurally validated; extra fields are preserved verbatim. */
export interface OrgScreenDef {
  id: string;
  label: string;
  panels: Array<Record<string, unknown> & { id: string; kind: string }>;
  [key: string]: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the stored org screen-def list. Pure — throws {@link ScreenDefError}. Ids are
 *  unique across the list (an override targets exactly one built-in), and each panel is uniquely id'd
 *  within its screen. Unknown top-level / panel fields are retained so the SPA sees the full authored def. */
export function validateScreenDefs(value: unknown): OrgScreenDef[] {
  if (!Array.isArray(value)) throw new ScreenDefError("screenDefs must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const label = str(o["label"]);
    if (!id) throw new ScreenDefError("each screen def needs a string id");
    if (!label) throw new ScreenDefError(`screen def "${id}" needs a label`);
    if (ids.has(id)) throw new ScreenDefError(`duplicate screen def id "${id}"`);
    ids.add(id);
    if (!Array.isArray(o["panels"])) throw new ScreenDefError(`screen def "${id}" panels must be an array`);
    const panelIds = new Set<string>();
    const panels = (o["panels"] as unknown[]).map((pr) => {
      const p = (pr ?? {}) as Record<string, unknown>;
      const pid = str(p["id"]);
      const kind = str(p["kind"]);
      if (!pid) throw new ScreenDefError(`screen def "${id}" has a panel with no id`);
      if (!kind) throw new ScreenDefError(`screen def "${id}" panel "${pid}" needs a kind`);
      if (panelIds.has(pid)) throw new ScreenDefError(`screen def "${id}" has a duplicate panel id "${pid}"`);
      panelIds.add(pid);
      return { ...p, id: pid, kind };
    });
    return { ...o, id, label, panels };
  });
}
