# Accessibility Conformance Report (ACR / VPAT-style)

**Product:** OmniProject (SPA + gateway) · **Standard:** WCAG 2.1 Level AA · **Report type:** vendor
self-assessment (not a third-party audit). This is the procurement-facing summary; the controls it
describes are enforced in code and CI.

> Conformance language follows the VPAT convention: **Supports** / **Partially Supports** /
> **Does Not Support** / **Not Applicable**.

## How conformance is enforced (not just claimed)

- **Automated WCAG checks in CI.** The `accessibility` job runs **axe-core (WCAG 2.1 A/AA)** against
  the built SPA in a real browser on every change over 4 representative routes (`/`, `/projects`,
  `/reports`, `/settings` — configurable via `A11Y_ROUTES`; modals/wizards/sub-settings panels aren't
  separately enumerated); a violation on a scanned route fails the build. The scan itself fails
  **open**, not closed: if the throwaway Playwright/axe-core install isn't resolvable in a given CI
  environment, it prints `SKIPPED` and exits 0 rather than blocking (see `scripts/a11y-scan.cjs`).
- **Keyboard/mouse parity is a CI gate.** The `guard-interactive` drift guard fails CI if any
  clickable element lacks a keyboard path; paired Playwright specs exercise both routes for each
  affordance.
- **A per-user accessibility overlay** (text size, background colour, high contrast, reduced motion,
  UI density) persists across sessions/devices on top of company branding — `lib/a11y-prefs`.
- **Assistive-tech modes:** switch-access scanning (single/two-switch), screen-reader narration
  (verbose live regions), and on-device voice dictation.
- **Deeper audit (supporting evidence).** A newer full audit against the **WCAG 2.2 AA** tag set
  (`wcag2a/2aa/21a/21aa/22aa`) — [`ACCESSIBILITY-AUDIT.md`](./ACCESSIBILITY-AUDIT.md) — found and
  **fixed 14 real defects** and added a jsdom **axe-core regression gate** to the normal test suite on
  top of the browser `accessibility` job. It exceeds this report's 2.1 AA baseline and stands as
  stronger conformance evidence; the standing conformance scope below remains WCAG 2.1 AA.

## Conformance summary (WCAG 2.1 AA)

> **Scope of the "Supports" claims below.** The automated axe-core evidence covers **4 top-level
> static routes** (`/`, `/projects`, `/reports`, `/settings`); the setup wizard, dialogs/modals, and
> the board/Gantt drag-drop surfaces are **not** separately machine-scanned, and the keyboard-parity
> guard is a static source check, not a full WCAG audit of dynamic content. Read the ratings as
> **"Supports" on the scanned routes, "Partially Supports" pending scan coverage** for wizard/modal/
> drag-drop surfaces.

| Principle | Level | Conformance | Notes |
| --- | --- | --- | --- |
| **1. Perceivable** | A/AA | Supports | Text alternatives on icons/controls; semantic landmarks/headings; colour is never the sole signal (status carries text/shape); contrast meets AA (tokens documented WCAG-AA in `index.css`); honours `prefers-reduced-motion` **and** an explicit per-user toggle; content reflows + respects user text scaling (0.85–1.5×). |
| **2. Operable** | A/AA | Supports | **Fully keyboard-operable** (CI-enforced parity); visible focus (`:focus-visible`, thick rings in high-contrast); no keyboard traps; shortcut registry with a discoverable help overlay; switch-access scanning for motor-impaired users; no time-limited interactions beyond security session timeouts. |
| **3. Understandable** | A/AA | Supports | Consistent navigation/affordances; form fields have labels + `aria-describedby` error text with `role="alert"`; predictable focus; British-English copy via the i18n/translation layer. |
| **4. Robust** | A/AA | Supports | Valid semantics; ARIA used only to fill gaps (`aria-pressed`, `aria-selected`, `role="group/note/status"`); status changes announced via live regions; tested against a real browser + axe-core. |

## Criteria worth calling out

| WCAG SC | Conformance | Evidence |
| --- | --- | --- |
| 1.4.3 Contrast (Minimum) | Supports | Theme tokens documented AA on background and muted surfaces; high-contrast mode adds underlines + thick focus rings. |
| 1.4.4 Resize Text | Supports | Per-user font scale 85–150% via root `font-size`; layout is rem-based. |
| 1.4.10 Reflow / 1.4.12 Text Spacing | Supports | Responsive layout; UI density tokens; no fixed-width text traps. |
| 2.1.1 Keyboard / 2.1.2 No Trap | Supports | `guard-interactive` CI gate + paired e2e; overlays close on Escape. |
| 2.4.7 Focus Visible | Supports | `:focus-visible` outlines; reinforced in high-contrast mode. |
| 2.5.8 Target Size (Minimum) — WCAG 2.2 AA (no 2.1 AA target-size criterion exists; 2.5.5 Target Size is AAA-only in 2.1) | Supports | Touch layout enforces ≥44px hit targets; gestures are additive to button/keyboard paths. |
| 3.3.1/3.3.2 Error ID & Labels | Supports | `aria-invalid`, `role="alert"` messages, associated labels. |
| 4.1.3 Status Messages | Supports | `role="status"`/live regions; verbose mode for screen-reader users. |

## Known limitations & roadmap

- **Third-party assessment.** This is a vendor self-assessment; an independent audit is recommended
  for environments that mandate one (e.g. public-sector procurement).
- **Localization breadth.** The i18n framework ships; non-English locale *content* is limited — see
  the parked decisions for the language set to prioritise.
- **Customer content.** Conformance covers the product UI; data rendered from a customer's backend
  (e.g. an issue description with poor contrast images) is outside the product's control.

## Mapping to standards

WCAG 2.1 AA is the basis for **EN 301 549** (EU) and **Section 508** (US, which incorporates WCAG
2.0 AA — fully covered by 2.1 AA). Procurement teams can treat this ACR as the WCAG evidence for both.
