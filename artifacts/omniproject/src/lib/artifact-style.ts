/**
 * Artifact styling model — the serialisable look-and-feel a user can attach to any rendered artifact
 * (chart, report, view, tile). It is data, not markup: a StyleSpec lives in a definition file and is
 * applied at render time by the ArtifactFrame primitive, so the same spec themes a built-in and a
 * bespoke artifact identically. Nothing here imports React, so definitions and server-side validation
 * can share it.
 *
 * Colours are plain CSS colour strings (a builder constrains them to swatches); an invalid value is
 * simply ignored by the browser rather than breaking layout. Fonts are a small named set so the choice
 * survives serialisation and cannot smuggle in an arbitrary @font-face.
 */
export type FontChoice = "sans" | "serif" | "mono";

export interface StyleSpec {
  /** Heading shown above the artifact; overrides the artifact's own default title when set. */
  title?: string;
  /** Secondary line under the title. */
  subtitle?: string;
  /** Named font family for the artifact's text. */
  fontFamily?: FontChoice;
  /** CSS colour for text/labels. Marks that inherit `currentColor` pick this up too. */
  textColor?: string;
  /** CSS colour for the artifact background (adds padding + rounding when set). */
  background?: string;
  /** Heading alignment. */
  align?: "left" | "center";
}

export const FONT_CHOICES: FontChoice[] = ["sans", "serif", "mono"];

/** The concrete CSS stack each named font resolves to. Kept dependency-free (system fonts only). */
export const FONT_STACKS: Record<FontChoice, string> = {
  sans: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  serif: "ui-serif, Georgia, Cambria, Times New Roman, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/** Whether a spec carries any visible styling (so callers can skip the frame entirely when it is empty). */
export function hasStyle(style: StyleSpec | undefined): style is StyleSpec {
  if (!style) return false;
  return Boolean(style.title || style.subtitle || style.fontFamily || style.textColor || style.background);
}

/** Resolve a StyleSpec to the plain style properties ArtifactFrame applies. Only set keys are returned. */
export function resolveStyle(style: StyleSpec | undefined): { fontFamily?: string; color?: string; background?: string } {
  const out: { fontFamily?: string; color?: string; background?: string } = {};
  if (!style) return out;
  if (style.fontFamily) out.fontFamily = FONT_STACKS[style.fontFamily];
  if (style.textColor) out.color = style.textColor;
  if (style.background) out.background = style.background;
  return out;
}
