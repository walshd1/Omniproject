/**
 * Colour helpers shared by the ORG branding layer (lib/branding) and the PER-USER
 * accessibility layer (lib/a11y-prefs). Dependency-free (no React) so both providers
 * and any server-side validation can reuse it.
 */

/**
 * Convert a hex accent colour (#rgb / #rrggbb / #rrggbbaa) into the app's accent token
 * form: `channels` is the "H S% L%" string consumed via `hsl(var(--primary))`, and `fg`
 * is a legible on-accent text colour (near-black or white) chosen by WCAG relative
 * luminance. Returns null for non-hex input, so the caller falls back to the layer below.
 */
export function brandTokensFromHex(colour: string): { channels: string; fg: string } | null {
  let h = colour.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6); // drop alpha — the accent is opaque
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let s = 0, hue = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  const channels = `${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  // WCAG relative luminance → pick a foreground that stays legible on the accent.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const fg = L > 0.179 ? "220 10% 7%" : "0 0% 100%";
  return { channels, fg };
}
