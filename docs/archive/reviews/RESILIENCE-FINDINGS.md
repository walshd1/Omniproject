# Resilience findings — messy-data stress pass

How resilient are OmniProject's reports, derivations and screens to dirty data? We armed the dev-only
**messy-data generator** (`artifacts/api-server/src/lib/messy-data.ts`) at maximum intensity across six
seeds, messified the demo read model, and ran every pure derivation / report builder over the dirty
rows, cataloguing every unhandled throw, `NaN`, `Infinity` or invalid `Date` that reached an output.

- **Probe:** `scripts/src/messy-resilience-probe.ts` — run with
  `pnpm --filter @workspace/scripts exec tsx src/messy-resilience-probe.ts`.
- **Config:** `intensity 1`, seeds `omni, chaos, gremlin, 3, zzz, north-star`, all gremlins active.
- **Method:** `messifyRows(demoRows, config, salt)` is called directly on the demo rows (deterministic,
  reproducible per seed), then each derive function runs over the result. The output tree is walked for
  `NaN` / `Infinity` / `Invalid Date` leaves; throws are caught.

The generator itself was **not** weakened — the fixes harden the **consumers** so they degrade
gracefully (safe number coercion, string→number, null/`''` handling, clamping, no dirty-field leakage).

## Findings

| # | Severity | Function (file:line) | Seed(s) | Failure mode | Status |
|---|----------|----------------------|---------|--------------|--------|
| 1 | High | `buildExecHealth` — `artifacts/omniproject/src/lib/exec-pack.ts:57` | chaos, north-star | `NaN`: `activeBlockersCount` / `scheduleVarianceDays` / `budgetVariancePercentage` arrive as strings/`null`/`NaN`, poisoning `totalBlockers`, `worstSlipDays` and every exception; `execHeadline` then renders "NaN active blocker(s)". Mixed-casing rag (`"amber"`, `"Red"`) silently mis-bucketed to GREEN. | **Fixed** |
| 2 | High | `buildRoadmap` → `completionRate` — `artifacts/omniproject/src/lib/roadmap.ts:88` | omni, chaos, 3, zzz | `NaN`: a stringy/`null`/`NaN` `issueCount` or `completedCount` produces a `NaN` completion rate → the rendered progress-bar fill width becomes `NaN%` (blank/broken bar). | **Fixed** |
| 3 | High | `consolidateFinancials` → `fold` — `artifacts/omniproject/src/lib/portfolio-finance.ts:49` | omni | `NaN`: `convertAmount` passes dirty amounts (`"1,234"`, `NaN`, `null`) straight through, so a single bad `budgetAllocated`/`actualBurn`/`earnedValue`/`forecastCostAtCompletion` turns the whole consolidated portfolio total into `NaN`. | **Fixed** |
| 4 | High | `rollupByProgramme` → `fold` — `artifacts/omniproject/src/lib/capacity-rollup.ts:40` | omni, zzz | `NaN`: a stringy/`null`/`NaN` `assignedHours`/`availableHours`/`allocationPercentage` poisons the summed hours and the derived utilisation for the whole programme/portfolio row. | **Fixed** |
| 5 | Low | `summariseBenefits` — `artifacts/omniproject/src/lib/benefits.ts:75` | zzz, north-star | Dirty passthrough: the `{ ...i }` spread copied **unmodelled** raw fields (e.g. a `NaN opexAmount`, a symbolised `currency`) from the read-model row into the report row. Cosmetic — the row's *computed* fields (`planned`, `actual`, `realisation`) and all totals were already guarded and finite, and no consumer reads the leaked fields — but a report row should carry only its modelled fields. | **Fixed** |

After the fixes, a full re-run of the probe across all six seeds reports:
**"No throws / NaN / Infinity / invalid dates observed across any seed. All consumers resilient."**

## What was hardened

Each consumer now coerces untrusted read-model values at the point of use, with a local
`num()`/coercion helper (`typeof number && Number.isFinite ? v : Number(v)`, falling back to `0`) so a
single dirty row can't poison an aggregate:

- **`exec-pack.ts`** — `buildExecHealth` coerces the three numeric health fields, normalises
  `ragStatus` case-insensitively (so `"amber"`/`"Red"` bucket correctly), and stringifies
  `projectId`/`projectName`.
- **`roadmap.ts`** — `completionRate` coerces `issueCount`/`completedCount` and returns `0` for a
  non-finite/≤0 total, keeping the bar fraction in `[0,1]`.
- **`portfolio-finance.ts`** — `fold` coerces every amount *before* currency conversion and stringifies
  the source currency.
- **`capacity-rollup.ts`** — `fold` coerces `allocationPercentage`/`assignedHours`/`availableHours`.
- **`benefits.ts`** — `summariseBenefits` now projects **only** the modelled `BenefitInput` fields into
  each report row (via `pickBenefitInput`), so unmodelled dirty fields on the raw row can't leak.

Regression tests feeding dirty/messified rows to each hardened function (asserting no-throw and
finite/sane output) live beside each lib: `exec-pack.test.ts`, `roadmap.test.ts`,
`portfolio-finance.test.ts`, `capacity-rollup.test.ts`, `benefits.test.ts`.

## Already-resilient consumers (no change needed)

The probe confirmed these were already hardened against the same mess and needed no change:

- **`benefits.ts` / `income.ts` / `capex.ts` / `financial-summary.ts`** — all use a `num()` guard on
  every numeric field before summing.
- **`forecast-curve.ts`** — `scheduleWindow` and `monthBuckets` guard `Date.parse` with
  `Number.isNaN`; division is guarded (`remaining <= 1e-9`, `cumNow > 0`).
- **`benefits-realisation.ts`** — consumes the already-guarded `summariseBenefits` output; `Date.parse`
  is `NaN`-checked (undated benefits are bucketed, not summed as `NaN`).
- **`monte-carlo.ts`** — `simulate` drops any task whose `estimate` is not `> 0` (so `NaN`/stringy/
  negative estimates are excluded rather than propagated).
- **`raid-register.ts`** — free-form `type`/`severity`/`status` are `String(... ?? "")`-normalised and
  bucketed to `"other"`; no numeric maths.
- **`effort.ts`** — `effortProgress` coerces both inputs with `Number.isFinite` and clamps.
- **`resource-load.ts`** — operates on caller-resolved day numbers; the caller's date→day resolution is
  `NaN`-guarded.

## Baseline (clean-data acceptance harness)

Running the Playwright acceptance harness (`pnpm run e2e`) on **clean** data surfaced a pre-existing
baseline breakage (present on `main`, unrelated to messy data): under Express 5, the single-container
server's `res.sendFile(absolutePath)` fallback returned **404 for every client-side deep link** (`/login`
included) when `STATIC_DIR` was relative — so the SPA never loaded and all 33 specs failed. Fixed by
switching the fallback to `res.sendFile("index.html", { root })` (`artifacts/api-server/src/app.ts`),
with a relative-`STATIC_DIR` regression test (`spa-fallback-relative.test.ts`). After the fix the
harness is **33/33 green** on clean data.

## Follow-ups (not fixed in this pass)

- **Raw modelled numeric passthrough in report rows.** `summariseBenefits`/`summariseIncome` rows still
  echo the backend's *original* `plannedBenefitValue`/`revenue` etc. verbatim (by design — a report
  row preserves source values), so those specific fields can still be a string/`NaN` if the backend
  sends one. The *computed* fields are always clean, and the current UIs render the computed fields, so
  this is safe today — but a future consumer that reads the raw modelled field directly should coerce
  at that read. Low priority.
- **No component-level (render) probe was automated.** This pass exercised the pure derivations
  exhaustively; a follow-up could arm the server with `OMNI_DEV_MODE=1 OMNI_MESSY_DATA=1` and drive the
  Playwright suite to catch any *render-layer* crash a derivation fix doesn't already prevent. The
  clean-data Playwright baseline is green; the derivation layer (the most likely crash source) is now
  hardened.
