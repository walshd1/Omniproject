/**
 * Interactive-parity guard — enforces the product rule that every UI affordance is operable by
 * BOTH mouse and keyboard. The common way to break it is putting an `onClick` on a non-interactive
 * element (a `<div>` / `<span>` / `<li>` / `<td>`) with no keyboard path: a mouse user can click it
 * but a keyboard user can't reach or fire it. Real buttons/links/inputs are keyboard-operable for
 * free, so they're allowed; a non-interactive element is allowed only if it is genuinely reachable
 * AND fireable by keyboard — that means BOTH a keyboard handler (`onKeyDown`/`onKeyUp`/`onKeyPress`)
 * to fire it AND a `tabIndex` to focus it (a handler with no `tabIndex` never receives the key —
 * the element can't take focus), plus a `role` so assistive tech announces it as the control it is.
 * The alternative is an explicit `data-a11y-mouse-ok` opt-out — for mouse-only conveniences whose
 * action IS reachable by keyboard another way (a click-outside dismiss scrim closed by Escape; an
 * input-focus addon reached by Tab).
 *
 * This is a static, heuristic lint over the SPA's .tsx — it can't prove behaviour (that's what the
 * Playwright keyboard-only specs are for), but it catches the easy regressions in the fast lane.
 *
 * Run: pnpm --filter @workspace/scripts run guard-interactive
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT as ROOT } from "./lib/repo-root";
import { walkFiles } from "./lib/walk-files";
import { reportGuard } from "./lib/guard-harness";

const SPA_SRC = path.join(ROOT, "artifacts/omniproject/src");

/** Native elements that are keyboard-operable on their own. */
const INTERACTIVE = new Set(["button", "a", "input", "select", "textarea", "option", "label", "summary", "details"]);

/** Find the opening tag (`<div …`) that an `onClick` belongs to, scanning back from its index. */
function owningTag(src: string, clickIdx: number): { tag: string; open: number } | null {
  const open = src.lastIndexOf("<", clickIdx);
  if (open < 0) return null;
  const m = /^<([A-Za-z][\w.]*)/.exec(src.slice(open, clickIdx));
  return m ? { tag: m[1]!, open } : null;
}

/** Index just past the opening tag's closing `>` — tracks `{}` depth and string literals so a `>`
 *  inside a JSX expression (`=>`, generics, nested JSX) or a quoted attribute value doesn't end it
 *  early. Falls back to a bounded window if no clean terminator is found. */
function openingTagEnd(src: string, start: number): number {
  let depth = 0;
  let quote = "";
  for (let j = start + 1; j < src.length && j < start + 4000; j++) {
    const c = src[j]!;
    if (quote) { if (c === quote && src[j - 1] !== "\\") quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[j - 1] !== "=") return j;
  }
  return Math.min(start + 800, src.length);
}

const violations: string[] = [];
const files = walkFiles(SPA_SRC, { extensions: [".tsx"], excludeSuffixes: [".test.tsx"] });

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  let i = src.indexOf("onClick");
  while (i >= 0) {
    const owner = owningTag(src, i);
    if (owner) {
      const tagLc = owner.tag.toLowerCase();
      const isCustomComponent = /^[A-Z]/.test(owner.tag); // <Button/> etc. — own their semantics
      const isNativeInteractive = INTERACTIVE.has(tagLc);
      if (!isCustomComponent && !isNativeInteractive) {
        // Non-interactive native element: allowed only if it is BOTH fireable (a keyboard handler)
        // and focusable (a `tabIndex`) and announced (`role`) by keyboard — or it carries the
        // `data-a11y-mouse-ok` opt-out. All of these must appear in ITS OWN attribute region: the
        // scan is bounded to the opening tag's `>` (tracking brace depth + strings so `=>`, JSX
        // exprs and quoted `>` don't end it early) — a fixed byte window spilled into children, so a
        // CHILD's onKeyDown/tabIndex falsely cleared the parent.
        const tagText = src.slice(owner.open, openingTagEnd(src, owner.open));
        const optOut = /data-a11y-mouse-ok/.test(tagText);
        const hasKeyHandler = /on(KeyDown|KeyUp|KeyPress)=/.test(tagText);
        const isFocusable = /\btabIndex[=\s]/.test(tagText);
        const hasRole = /\brole=/.test(tagText);
        const ok = optOut || (hasKeyHandler && isFocusable && hasRole);
        if (!ok) {
          const line = src.slice(0, i).split("\n").length;
          const missing = [
            hasKeyHandler ? null : "a keyboard handler (onKeyDown)",
            isFocusable ? null : "tabIndex (to receive focus)",
            hasRole ? null : "role (to be announced)",
          ].filter(Boolean).join(", ");
          violations.push(`${path.relative(ROOT, file)}:${line} — <${owner.tag}> has onClick but isn't keyboard-operable — missing ${missing} (use <button>, or add onKeyDown + tabIndex + role)`);
        }
      }
    }
    i = src.indexOf("onClick", i + 1);
  }
}

reportGuard("interactive-parity", {
  violations,
  failHeadline: `interactive-parity guard: ${violations.length} violation(s) — every clickable must be keyboard-operable:`,
  okSummary: `scanned ${files.length} SPA components; every onClick is on a keyboard-operable element.`,
});
