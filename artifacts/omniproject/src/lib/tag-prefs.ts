/**
 * Tag preferences — a PURE, per-user overlay giving a tag a COLOUR and a place in a HIERARCHY
 * (a parent tag). Like the a11y prefs, this is a personal layer: it never changes the shared data,
 * and losing it just reverts every tag to its deterministic default colour and a flat (parent-less)
 * list. The hook that persists it lives in `use-tag-prefs`; everything here is a pure function.
 */

/** One tag's personal settings. Both optional — absent colour ⇒ the derived default; absent parent ⇒ top-level. */
export interface TagPref {
  /** Chip colour (hex), or absent for the name-derived default. */
  color?: string;
  /** Parent tag name (hierarchy), or absent for a top-level tag. */
  parent?: string;
}

/** The whole per-user map, keyed by tag name. */
export type TagPrefs = Record<string, TagPref>;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const MAX_TAGS = 500;
const MAX_DEPTH = 20;

/** A stable non-negative hash of a string (djb2). Deterministic ⇒ a tag keeps its colour across sessions. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The DEFAULT colour for a tag — a deterministic hue derived from its (normalised) name, at a fixed
 * saturation/lightness so every default chip is legible. Same name ⇒ same colour, always.
 */
export function defaultTagColor(tag: string): string {
  const hue = hash(tag.trim().toLowerCase()) % 360;
  return `hsl(${hue} 55% 45%)`;
}

/** The EFFECTIVE colour for a tag — the user's chosen colour if valid, else the derived default. */
export function resolveTagColor(tag: string, prefs: TagPrefs): string {
  const c = prefs[tag]?.color;
  return c && HEX.test(c) ? c : defaultTagColor(tag);
}

/**
 * The hierarchy PATH for a tag — its ancestor chain ending in the tag itself, e.g.
 * `["work", "work-clientA", "work-clientA-urgent"]`. Cycle- and depth-guarded so a malformed
 * parent link can never loop; a tag that is its own ancestor simply stops the walk.
 */
export function tagPath(tag: string, prefs: TagPrefs): string[] {
  const path: string[] = [tag];
  const seen = new Set<string>([tag]);
  let cur = tag;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const parent = prefs[cur]?.parent;
    if (!parent || seen.has(parent)) break;
    path.unshift(parent);
    seen.add(parent);
    cur = parent;
  }
  return path;
}

/** The direct children of a tag (tags whose parent is `tag`), sorted for stable display. */
export function tagChildren(tag: string, prefs: TagPrefs): string[] {
  return Object.entries(prefs)
    .filter(([, p]) => p.parent === tag)
    .map(([name]) => name)
    .sort();
}

/** Sanitise an untrusted prefs object (localStorage / imported profile): valid hex colours, string
 *  parents, no forbidden keys, no self-parent, capped size. Mirrors the a11y sanitiser's discipline. */
export function cleanTagPrefs(input: unknown): TagPrefs {
  if (typeof input !== "object" || input == null || Array.isArray(input)) return {};
  const out: TagPrefs = {};
  let n = 0;
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_TAGS) break;
    if (FORBIDDEN.has(key) || !key || key.length > 100 || typeof val !== "object" || val == null) continue;
    const v = val as Record<string, unknown>;
    const pref: TagPref = {};
    if (typeof v["color"] === "string" && HEX.test(v["color"])) pref.color = v["color"];
    if (typeof v["parent"] === "string" && v["parent"] && v["parent"] !== key && v["parent"].length <= 100 && !FORBIDDEN.has(v["parent"])) {
      pref.parent = v["parent"];
    }
    if (pref.color === undefined && pref.parent === undefined) continue;
    out[key] = pref;
    n++;
  }
  return out;
}
