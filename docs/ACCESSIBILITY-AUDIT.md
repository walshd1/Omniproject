# Accessibility audit — WCAG 2.2 Level AA

A full audit of the SPA against the industry standard (**WCAG 2.2 Level AA**), covering all four
principles. This complements `ACCESSIBILITY-CONFORMANCE.md` (the standing conformance claim): an audit
actively *finds* defects; the findings below were then remediated in code where fixable, with the rest
recorded honestly as residual or manual-only.

## Method

- **Automated (structural):** axe-core configured for the full `wcag2a/2aa/21a/21aa/22aa` tag set, run
  in jsdom over a representative cross-section of UI patterns — `src/test/a11y-audit.test.ts(x)` +
  `src/test/a11y.ts`. Runs in the normal Vitest suite (a regression gate), on top of the existing CI
  `accessibility` job that runs axe against the built SPA in a real browser.
- **Code-level (criterion by criterion):** a manual review of the whole `src/` tree against each A/AA
  success criterion — labels, names/roles/values, keyboard operability, focus visibility, use of
  colour, status messages, structure.
- **Contrast (computed):** every core theme token pair (light + dark) run through the WCAG relative-
  luminance formula against 4.5:1 (text) / 3:1 (large text + non-text UI).
- jsdom can't evaluate layout, so **contrast, target size (2.5.8) and reflow (1.4.10)** are covered by
  the browser axe job + the manual checks flagged at the end — not the jsdom gate.

## Result

The app was already strong (skip link, landmarks, `announce()` live region, `<th scope>`+`aria-sort`
tables, focus-trapped Radix dialogs, aria-labelled icon buttons, accessible SSO/magic-link/passkey auth
with **no** cognitive-test login — 3.3.8 exemplary). The audit found **14 real defects**, now **fixed**,
plus a small set of residual/manual items below.

## Fixed

**Contrast (1.4.3 / 1.4.11)** — `src/index.css` + `src/components/tiles/Badge.tsx`,
`src/components/DataQualityBadge.tsx`:
- `--input` (form-field boundary) was **1.45:1** vs the page — below the 3:1 needed when the border is
  the field's only boundary. Darkened to 3.75:1 (light) / 3.8:1 (dark). Decorative `--border` left as-is.
- `--destructive` gave **3.38:1** as text and **3.78:1** as a button — both below AA. Darkened (light)
  so red text is 5.2:1 and the destructive button 5.8:1.
- The default brand accent + white was **3.64:1** (fails normal-size button text). Default darkened to
  `217 91% 50%` → 5.07:1. (Org/user accent overrides remain the deployer's responsibility.)
- Status-tone TEXT (`Badge` good/warn/bad, the data-quality badge) used 500/600 shades over a faint
  tint ≈ the page → **~2.9–3.4:1** on the light theme. Moved to `text-*-700 dark:text-*-400` (≥4.48:1
  light, ≥6.8:1 dark). Fixing `Badge` centrally fixed every RAG/flag chip at once.

**Focus visible (2.4.7)** — 5 native controls used `outline-none` with no replacement (no focus ring in
the default theme). Added `focus-visible:ring-1 focus-visible:ring-ring` to: `Resources.tsx`,
`LanguageSwitcher.tsx`, `ProjectFinancialsStrip.tsx`, `FinancialEvmChart.tsx`, `ProgrammeFinancialsCard.tsx`.

**Name/Role/Value + Labels (4.1.2 / 1.3.1 / 3.3.2 / 1.3.5)** — placeholder-only / unlabelled controls
given accessible names or label associations: `AiProvidersAdmin` (API-key field + 5 add-provider
fields), `CalendarPushConsent` (2 selects wired via `htmlFor`/`id`), `setup/GenerateStep` (connector
select), `GovernanceAdmin` (state select), `Login` (email `autocomplete`).

**Use of Color (1.4.1)** — RAG count chips distinguished categories by colour alone. Added visible
non-colour text cues (`OK` / `AT` / `CR`) in `ProjectHealth` and `StrategyAlignment` RagChips.

**Status Messages (4.1.3)** — async status that updated silently now announces: the data-quality badge
(`role="status" aria-live="polite"`) and the gateway connection indicator (`role="status" aria-live`).

**Non-text Content (1.1.1)** — the toast close button (`ui/toast.tsx`) was an unnamed `<X>` icon; added
`aria-label="Close"` + `aria-hidden` on the icon.

**Error Identification (3.3.1)** — `Copilot` error text given `role="alert"`.

## Residual / recommended (not fixed in this pass)

- **Dark-mode `--destructive` token split.** In dark mode a single red can't be both an AA red-text
  (wants brighter) and an AA white-on-red button (wants darker); today red text passes (4.99:1) and the
  destructive button is 3.78:1 (AA for large text only). Proper fix: a dedicated `--destructive-text`
  token separate from the button background. Recommended, low frequency (delete confirmations).
- **Remaining direct status-text classes.** A handful of inline conditional colours still use 500/600
  shades as text on the page (e.g. `themeTone`, ProjectHealth overdue/blocked cells, `Utilisation`
  flag tone, IncomeInvoicing unbilled). Same remediation as `Badge`: `text-*-700 dark:text-*-400`.
- **Minor:** report tables could use `<th scope="row">` for the first column; `NotificationsBell` live
  toggle could expose `aria-pressed`; `ProportionBar` `<svg role="img">` could carry an overall name;
  `GanttChart` reschedule is drag-only (a keyboard/edit-dialog alternative exists, so 2.5.7 is met but
  the focusable bar is keyboard-inert).

## Requires manual verification (not statically decidable)

- **Screen-reader pass** (NVDA / JAWS / VoiceOver) over the primary flows — the ultimate check for
  4.1.2/1.3.1/4.1.3 that automation can't fully replace.
- **1.4.10 Reflow / 1.4.4 Resize text** at 200% zoom / 320px — the pervasive `text-[10px]`/`[11px]`
  sizes and fixed-width panels need a real-viewport check.
- **2.5.8 Target Size / 1.4.11 non-text contrast in situ** and **2.4.11 Focus Not Obscured** — the
  browser axe job covers part; a manual pass confirms the rest.
- **3.3.7 Redundant Entry** — walk the multi-step setup wizard to confirm earlier answers auto-populate.
