import { useEffect, useRef, useState } from "react";
import { useA11yPrefs } from "../lib/a11y-prefs";
import { collectScannable, nextIndex, labelOf, activate } from "../lib/switch-scan";
import { announce } from "../lib/announce";

/**
 * Switch-access scanning engine. Sweeps a highlight over the page's interactive
 * controls so a user with one or two physical switches can drive the whole UI:
 *   • single-switch — the highlight auto-advances every `scanRateMs`; SPACE/ENTER picks.
 *   • two-switch    — SPACE (or →/↓) advances by hand; ENTER picks.
 * It renders nothing visible: the current control is marked `data-scan-current` (the
 * stylesheet draws the ring) and announced to the user's own screen reader. Inert
 * unless the user has turned scanning on, so it costs nothing for everyone else.
 */
const ADVANCE_KEYS = new Set(["ArrowRight", "ArrowDown", " ", "Spacebar"]);
const SELECT_KEYS = new Set(["Enter"]);
const MARK = "data-scan-current";

export function SwitchScanner() {
  const { prefs } = useA11yPrefs();
  const mode = prefs.switchScan;
  const [index, setIndex] = useState(-1);
  // Live list + index in refs so the timer/key handlers always see current values
  // without re-subscribing on every advance.
  const itemsRef = useRef<HTMLElement[]>([]);
  const indexRef = useRef(-1);

  // Paint the highlight: clear the old mark, mark + reveal + announce the new one.
  const highlight = (items: HTMLElement[], i: number): void => {
    document.querySelectorAll(`[${MARK}]`).forEach((el) => el.removeAttribute(MARK));
    const el = items[i];
    if (!el) return;
    el.setAttribute(MARK, "true");
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    announce(labelOf(el));
  };

  // Re-scan the DOM, then move the highlight to `i` (clamped into range).
  const moveTo = (i: number): void => {
    const items = collectScannable();
    itemsRef.current = items;
    const next = items.length ? (i + items.length) % items.length : -1;
    indexRef.current = next;
    setIndex(next);
    highlight(items, next);
  };

  const advance = (): void => moveTo(nextIndex(indexRef.current, collectScannable().length));
  const select = (): void => {
    const el = itemsRef.current[indexRef.current];
    if (el) activate(el);
  };

  // OFF ⇒ tear everything down (no timers, no marks, no key listeners).
  useEffect(() => {
    if (mode === "off") {
      document.querySelectorAll(`[${MARK}]`).forEach((el) => el.removeAttribute(MARK));
      indexRef.current = -1;
      setIndex(-1);
      return;
    }

    // Kick off at the first control.
    moveTo(0);

    const onKey = (e: KeyboardEvent): void => {
      if (SELECT_KEYS.has(e.key)) { e.preventDefault(); select(); return; }
      // In two-switch mode the user advances by hand; single-switch advances itself.
      if (mode === "two" && ADVANCE_KEYS.has(e.key)) { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey);

    let timer: ReturnType<typeof setInterval> | undefined;
    if (mode === "single") timer = setInterval(advance, prefs.scanRateMs);

    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearInterval(timer);
    };
    // Re-arm when the mode or (single-switch) dwell time changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prefs.scanRateMs]);

  // Purely a status line for screen readers / tests; the visible ring is CSS.
  if (mode === "off") return null;
  const current = index >= 0 ? itemsRef.current[index] : undefined;
  return (
    <div className="sr-only" role="status" aria-live="polite" data-testid="switch-scanner">
      {current ? `Scanning: ${labelOf(current)}` : "Scanning"}
    </div>
  );
}
