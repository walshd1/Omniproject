/**
 * Switch-access scanning — the PURE, testable core (no React, no timers).
 *
 * Switch users drive the whole UI from one or two physical switches: the app
 * sweeps a highlight across the interactive controls and the user hits a switch to
 * pick the highlighted one. Single-switch = the app auto-advances on a timer and one
 * switch SELECTS; two-switch = one switch ADVANCES and the other SELECTS. This module
 * only answers "what can be scanned, in what order, and how do I act on one"; the
 * timing/keys live in the SwitchScanner component.
 */

/** Interactive controls we sweep over. Mirrors the platform's own focus order. */
export const SCANNABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[role="button"]:not([aria-disabled="true"])',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Is this control visible enough to scan? Skips `hidden`, anything inside an
 *  aria-hidden subtree (e.g. the inert background behind an open modal), and
 *  display:none / visibility:hidden. (We avoid offsetParent so it behaves the same
 *  under a real browser and a layout-less test DOM.) */
export function isScannable(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden) return false;
  if (h.closest('[aria-hidden="true"]')) return false;
  const style = typeof getComputedStyle === "function" ? getComputedStyle(h) : null;
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

/** All scannable controls under `root`, in document (≈ tab) order. */
export function collectScannable(root: ParentNode = document): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR));
  return all.filter(isScannable);
}

/** Next index with wrap-around (empty list ⇒ -1). */
export function nextIndex(current: number, length: number): number {
  if (length <= 0) return -1;
  return current < 0 ? 0 : (current + 1) % length;
}

/** Previous index with wrap-around (empty list ⇒ -1). */
export function prevIndex(current: number, length: number): number {
  if (length <= 0) return -1;
  return current <= 0 ? length - 1 : current - 1;
}

/** A human label for announcing the highlighted control to a screen reader. */
export function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const text = el.textContent?.trim();
  if (text) return text;
  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return placeholder.trim();
  const title = el.getAttribute("title");
  if (title) return title.trim();
  return el.tagName.toLowerCase();
}

/** Act on a highlighted control: focus a field for typing, else click it. */
export function activate(el: HTMLElement): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    el.focus();
    return;
  }
  el.focus();
  el.click();
}
