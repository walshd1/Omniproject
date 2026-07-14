# Mutation testing

Line/branch coverage proves a line *ran* during tests; it does not prove a test would *fail* if that
line were wrong. Mutation testing closes that gap: it injects a small fault ("mutant") at each code
location — flip a `>` to `>=`, a `+` to `-`, `&&` to `||`, delete a statement — and re-runs the covering
tests. A mutant that makes a test fail is **killed** (good — the tests caught the regression); one that
survives with all tests still green is a **survivor** (a real hole in the tests' assertions).

This is the tool that would have caught the currency bug class *before* it shipped: the roll-ups had
line coverage, but no test asserted that an FX-unconvertible row was excluded — a mutant removing that
guard would have survived. (That specific gap is now closed by the property test in
`currency-fold-invariants.test.ts`, which mutation-testing confirms has teeth.)

## Scope

Mutation testing runs the covering tests **once per mutant**, so it is deliberately **not** run over
the whole SPA. It targets the pure financial-derivation core — the code where a silent wrong answer
does the most damage and where a real bug class was found and fixed:

- `src/lib/currency.ts` — conversion + convertibility guards
- `src/lib/portfolio-value.ts` — income / benefits roll-ups
- `src/lib/benefits-realisation.ts` — pipeline / schedule
- `src/lib/portfolio-priority.ts` — scoring + FX-aware benefit
- `src/lib/funding-scenario.ts` — funding totals
- `src/lib/scenario.ts` — what-if KPI aggregation

Config: `artifacts/omniproject/stryker.conf.json` (StrykerJS + the Vitest runner). It uses a scoped
Vitest config, `vitest.mutation.config.ts`, that includes only these files' tests so the dry run and
per-mutant runs stay tight. Keep the `mutate` globs and that config's `include` list in step.

## Running

```bash
cd artifacts/omniproject
pnpm run mutation            # the full scoped set (minutes — heavy)
pnpm exec stryker run --mutate src/lib/currency.ts   # a single file, faster
```

A break threshold is enforced (`thresholds.break` in the config): the run fails if the mutation score
drops below it, so the money core can't quietly lose test quality.

## CI

`.github/workflows/mutation.yml` runs it **weekly** (Mondays) and on manual dispatch — off the fast PR
lane because of its cost — and uploads the HTML report as an artifact.

## Baseline

A first scoped run over `currency.ts` scored **~76%** (break threshold 60, high-water 85). Survivors
there point at assertions worth tightening (e.g. `LocalTracker` internals and a couple of conditional
branches) — exactly the follow-up mutation testing is meant to surface. Raising the score is done by
strengthening the tests' *assertions*, never by weakening the mutants.
