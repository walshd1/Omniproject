/**
 * Screen-reader announcer — a single shared ARIA live region the app speaks
 * through, so dynamic changes (scanning focus, async results) reach the user's own
 * screen reader (NVDA/JAWS/VoiceOver). We don't bundle a reader; we make the app
 * announce. `polite` waits for a pause, `assertive` interrupts.
 */
let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (region && document.body.contains(region)) return region;
  region = document.createElement("div");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("role", "status");
  region.setAttribute("data-testid", "a11y-announcer");
  region.className = "sr-only";
  document.body.appendChild(region);
  return region;
}

/** Announce a message to the user's screen reader via the shared live region. */
export function announce(message: string, politeness: "polite" | "assertive" = "polite"): void {
  const r = ensureRegion();
  if (!r) return;
  r.setAttribute("aria-live", politeness);
  r.textContent = message;
}

// Verbose mode: extra, non-essential narration (route changes, load completions) that
// only helps screen-reader users. Off by default so we don't chatter at everyone.
let verbose = false;

/** Turn verbose narration on/off (driven by the user's `screenReader` pref). */
export function setAnnounceVerbose(on: boolean): void {
  verbose = on;
}

/** Announce only when the user has opted into verbose screen-reader narration. */
export function announceVerbose(message: string, politeness: "polite" | "assertive" = "polite"): void {
  if (verbose) announce(message, politeness);
}
