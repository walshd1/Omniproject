/**
 * Interactive-parity guard — enforces the product rule that every UI affordance is operable by
 * BOTH mouse and keyboard. The common way to break it is putting an `onClick` on a non-interactive
 * element (a `<div>` / `<span>` / `<li>` / `<td>`) with no keyboard path: a mouse user can click it
 * but a keyboard user can't reach or fire it. Real buttons/links/inputs are keyboard-operable for
 * free, so they're allowed; a non-interactive element is allowed only if it also wires a keyboard
 * handler (`onKeyDown`/`onKeyUp`/`onKeyPress`), OR it carries an explicit `data-a11y-mouse-ok`
 * opt-out — for mouse-only conveniences whose action IS reachable by keyboard another way (a
 * click-outside dismiss scrim closed by Escape; an input-focus addon reached by Tab).
 *
 * This is a static, heuristic lint over the SPA's .tsx — it can't prove behaviour (that's what the
 * Playwright keyboard-only specs are for), but it catches the easy regressions in the fast lane.
 *
 * Run: pnpm --filter @workspace/scripts run guard-interactive
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SPA_SRC = path.join(ROOT, "artifacts/omniproject/src");

/** Native elements that are keyboard-operable on their own. */
const INTERACTIVE = new Set(["button", "a", "input", "select", "textarea", "option", "label", "summary", "details"]);

function walk(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(full);
  }
}

/** Find the opening tag (`<div …`) that an `onClick` belongs to, scanning back from its index. */
function owningTag(src: string, clickIdx: number): { tag: string; open: number } | null {
  const open = src.lastIndexOf("<", clickIdx);
  if (open < 0) return null;
  const m = /^<([A-Za-z][\w.]*)/.exec(src.slice(open, clickIdx));
  return m ? { tag: m[1]!, open } : null;
}

const violations: string[] = [];
const files: string[] = [];
walk(SPA_SRC, files);

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
        // Non-interactive native element: allowed if a keyboard handler or the opt-out marker
        // appears in its attribute region. We can't reliably find the tag's closing ">" (JSX
        // attributes contain "=>" and ">"), so scan a window over the element's props.
        const tagText = src.slice(owner.open, owner.open + 800);
        const ok = /on(KeyDown|KeyUp|KeyPress)=/.test(tagText) || /data-a11y-mouse-ok/.test(tagText);
        if (!ok) {
          const line = src.slice(0, i).split("\n").length;
          violations.push(`${path.relative(ROOT, file)}:${line} — <${owner.tag}> has onClick but no keyboard handler (use <button>, or add onKeyDown + role/tabIndex)`);
        }
      }
    }
    i = src.indexOf("onClick", i + 1);
  }
}

if (violations.length) {
  console.error(`interactive-parity guard: ${violations.length} violation(s) — every clickable must be keyboard-operable:`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`interactive-parity guard: OK — scanned ${files.length} SPA components; every onClick is on a keyboard-operable element.`);
