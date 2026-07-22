# Branching & release flow

How work moves through the repo. Two long-lived branches, one direction of travel.

```
 feature/*, fix/*, dependabot/*  ─▶  next  ─(promote when green)─▶  main
                                     ▲                               │
                                     └────── rebase after promote ───┘
```

## The two standing branches

### `main` — latest **stable**
- The release line. Everything on it is green, reviewed, and shippable.
- **Protected**: no direct pushes; merges only via PR with **all required checks green**.
- Tags/releases are cut from here.

### `next` — the **development** line (standing, always-green)
- Sits **ahead of `main`**: all feature work, refactors, and bleeding-edge dependency
  bumps land here first. This is the canary — breakage surfaces here, on our schedule,
  not in an incident.
- **"The answer is always fix."** `next` is kept **green**: if a change reddens CI, the
  fix lands on `next` before anything else moves. A red `next` is stop-the-line.
- It is a **standing branch** — it is never retired. When `next` is promoted into `main`,
  it is immediately **re-based onto the new `main`** so it always starts one step ahead of
  stable (never deleted-and-forgotten). See the ritual below.
- The supply-chain guard still applies here: `minimumReleaseAge: 1440` in
  `pnpm-workspace.yaml` stays on. "Bleeding edge" means *latest published ≥ 1 day ago*, not
  *unvetted*.

## Where a change goes

| Change | Base branch |
| --- | --- |
| Feature / refactor / bugfix | `next` |
| Dependency bump (Dependabot) | `next` (configured in `.github/dependabot.yml`) |
| Hotfix that must ship to stable *now* | `main` (via PR), then **forward-merge `main` → `next`** so it isn't lost |

Nothing is merged straight to `main` except a promotion of `next` or a genuine hotfix.

## Promotion: `next` → `main`

Promote when `next` is green and the batch of work on it is release-ready:

```bash
git fetch origin
git checkout main && git merge --ff-only origin/main
git merge --no-ff origin/next -m "promote: next → main"   # or a PR next→main
git push origin main
```

Then **immediately re-seat `next`** on the new `main` so it stays one step ahead:

## The `next` re-seat ritual (run after every promotion)

`next` must never drift or disappear. After `next` lands in `main`, recreate it from the
new stable tip:

```bash
git fetch origin
git checkout -B next origin/main
git push --force-with-lease origin next
```

`--force-with-lease` (never plain `--force`) refuses to clobber if someone else advanced
`next` in the meantime — so the re-seat is safe.

If `next` still carries **un-promoted** work when you want fresh `main` underneath it,
**rebase** instead of recreate, to keep that work:

```bash
git fetch origin
git checkout next
git rebase origin/main
git push --force-with-lease origin next
```

Keep `next` current with `main` at least **weekly** even between promotions, so it never
becomes a big-bang merge.

## Dependabot

`.github/dependabot.yml` sets `target-branch: next` for every ecosystem (npm, docker,
github-actions), so all bump PRs open against `next`, are validated by its CI, and ride into
`main` with the next promotion. Majors still get their own individual PRs (they're excluded
from the batched dev-deps group), so each is small and independently revertable.

## Keeping CI fast without lowering the bar

Speed is a runner/parallelism problem, **not** a coverage problem — the thresholds in
`vitest`/coverage config stay put. Levers (apply as separate infra PRs):

- **Shard** the SPA coverage run and e2e across CI runners (`--shard=i/N` matrix), then
  merge coverage reports — same threshold, less wall-clock.
- Give **e2e a per-worker server** and raise `workers` above 1: parallel isolated servers
  are both faster *and* less flaky than one shared server serialising every spec.
- On PRs run the **changed-scope** suite for fast feedback; run the **full** suite as the
  required gate on `next`/`main`.
- Cache the pnpm store, Playwright browsers, and tsc/vite build across jobs.

---

*Rule of thumb: if you're about to push to `main` and it isn't a promotion or a hotfix,
you want `next` instead.*
