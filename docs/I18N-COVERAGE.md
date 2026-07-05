# Localisation coverage

OmniProject localises its high-traffic surfaces through a small, dependency-free
translation dictionary in
[`artifacts/omniproject/src/lib/i18n.tsx`](../artifacts/omniproject/src/lib/i18n.tsx):
one `Dict` (a flat `key → string` map) per operating language, with **English as
the base and fallback**. On top of the localized dictionaries sits a
per-deployment `LABEL_OVERRIDES` layer (`labelOverrides` on `I18nProvider`) that
lets an installation rename a label — e.g. "Projects" → "Engagements" — in every
locale at once. Overrides win over the dictionary; the dictionary wins over the
English fallback.

Because a key a locale omits **degrades quietly to English** rather than
breaking, translation gaps can accumulate unseen. This audit surfaces them.

## Operating languages

The active languages are declared by `LOCALES` in `i18n.tsx`:

| Code | Language   | Role          |
| ---- | ---------- | ------------- |
| `en` | English    | base + fallback |
| `fr` | Français   | translated    |
| `de` | Deutsch    | translated    |
| `es` | Español    | translated    |

The active locale also drives `Intl` number / currency / date formatting
app-wide, which is what makes the multi-currency reporting render correctly per
region.

## What the audit checks

For every non-base locale, the audit classifies each base key as:

- **missing** — the base declares the key but the locale has no entry for it;
- **empty** — the locale has the key but its value is blank; or
- **orphan** — the locale carries a key the base **no longer declares** (dead
  weight or a typo).

## Coverage snapshot

As of this writing (run `pnpm --filter @workspace/scripts run guard-i18n-coverage`
for the current numbers — the dictionary grows over time, so treat this section
as a snapshot, not a standing guarantee):

- Base locale **English** declares **33** keys.
- **fr / de / es**: each **32 / 33** translated (**97%**), with a single
  untranslated key — `nav.explore` — apiece.
- No empty values, no orphan keys.

Because coverage is currently incomplete, the guard runs in **warn-only** mode:
it prints the gaps and a summary but exits `0`, so these pre-existing gaps do not
turn CI red (the English fallback keeps the app correct in the meantime).

## Running the audit

```sh
pnpm --filter @workspace/scripts run guard-i18n-coverage
```

## Exit behaviour (deterministic, non-breaking)

- **Every operating language fully covered** → hard guard: prints OK, exits `0`.
  A future regression (a newly-added base key left untranslated) then **fails
  CI**, locking the coverage in.
- **Coverage incomplete** → **warn-only** audit: prints the per-locale gap report
  and a summary, and exits `0` so pre-existing gaps never break the build.
- **Orphan keys present** → always a **hard failure** (`exit 1`): an orphan is
  dead weight or a typo, cheap to fix, and never legitimate translation debt.

The audit is wired into CI in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) alongside the other
coverage guards.

## Closing a gap

Add the missing key(s) to the matching `Dict` in `i18n.tsx` (`FR`, `DE`, `ES`,
…). Once every operating language reaches 100%, the guard flips itself from
warn-only to a hard failure automatically — no code change needed.
