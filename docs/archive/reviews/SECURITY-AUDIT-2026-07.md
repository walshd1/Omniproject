# Security Re-Audit — 2026-07

## Scope + methodology

A focused re-audit of the surfaces **added or changed since the last pentest pass**. OmniProject is a
stateless, zero-at-rest, broker-agnostic PM/PgM overlay; prior passes already covered CSRF
double-submit, gateway↔broker HMAC + nonce/replay, step-up re-auth, injection hardening, AES-GCM
config-at-rest, durable security state, and the AI-security model (`docs/AI-SECURITY.md`). This audit
did **not** re-derive those; it threat-modelled only the newest seams.

**In scope (newest surfaces):**

- Messy-data generator — `artifacts/api-server/src/lib/messy-data.ts`,
  `artifacts/api-server/src/broker/messy-broker.ts`, and the `GET/POST /api/dev-mode/messy` route in
  `routes/dev-mode.ts`.
- Dev-mode routes generally (`routes/dev-mode.ts`): impersonation, entitlements, dev-broker switch, messy.
- Report overrides — `routes/report-overrides.ts` + `artifacts/omniproject/src/lib/report-overrides.ts`.
- Dashboards / custom-reports / report-overrides persistence in `lib/settings.ts`, plus the SPA upload
  seams (`lib/dashboard-file.ts`, `lib/custom-report-file.ts`) and the component-library.
- Snapshots — `lib/snapshot.ts`, `routes/snapshots.ts`, `lib/signing.ts` (Ed25519).
- safe-json seams — `artifacts/omniproject/src/lib/safe-json.ts` (there is no api-server copy; the
  server relies on a fixed key allow-list in `settings.updateSettings`).

**Threat classes checked:** authz / IDOR, injection (command/SQL/log/header), prototype pollution,
XSS / output-encoding, SSRF / egress-policy bypass, secret handling, DoS (unbounded input, ReDoS, huge
payloads), and dev-surface prod-inertness.

**Method:** static read + trace of every seam to `file:line`, cross-referenced against the git history
(`#312`–`#324`) to isolate what is genuinely new, plus regression tests for the confirmed fix.

## Findings summary

| # | Severity | Area | Status |
|---|----------|------|--------|
| 1 | Medium | Dashboard import seam skips `safeParseJson` (prototype-pollution reviver) | **Fixed** |
| 2 | Low | `dead` shadcn chart component injects `color` into a `<style>` via `dangerouslySetInnerHTML` | Accepted (not reachable) |
| 3 | Info | `dev-mode/messy` + `dev-mode/broker` gate on the impersonated (not real) identity | Accepted (no escalation) |
| 4 | Info | `snapshots.ts` reads `sessionStorage` with raw `JSON.parse` | Accepted (same-origin, validated) |

No Critical or High issues were found.

---

## Finding 1 — Dashboard import seam skips the prototype-pollution reviver (Medium — FIXED)

**Affected:** `artifacts/omniproject/src/lib/dashboard-file.ts:62` (`readDashboardFile`).

**Detail.** Commit `#320` established the invariant "parse **untrusted uploaded JSON** through
`safeParseJson`, whose reviver strips `__proto__` / `constructor` / `prototype` at every depth, before
the value is used or merged." The dashboard export/import feature (`#324`) landed **after** that pass and
introduced a new upload seam — `readDashboardFile` — that parsed the uploaded file with the **raw**
`JSON.parse`:

```ts
parsed = JSON.parse(await file.text());   // ← untrusted upload, no reviver
return parseDashboard(parsed);
```

The file's own docstring claimed it "neutralises prototype-pollution keys," but that neutralisation
relied solely on `parseDashboard` reconstructing the object field-by-field. That reconstruction does
limit *today's* blast radius (the uploaded object is never merged wholesale into settings), so this is
**Medium**, not High — but it breaks the "reviver at every untrusted seam" invariant and leaves the
guarantee dependent on every future reader of the parsed object never doing a raw merge. A dashboard is
persisted to org settings and shared across a deployment, so the seam is exactly the kind #320 targeted.

**Exploit scenario.** A crafted `dashboard.json` containing
`{"name":"D","widgets":[],"__proto__":{"polluted":"x"},"constructor":{"prototype":{"polluted":"x"}}}`
is uploaded. With raw `JSON.parse` the dangerous keys survive on the parsed object; if any later code
path (a future refactor, a `deepMerge`, a spread of the raw parsed value rather than the reconstructed
`Dashboard`) touched it before reconstruction, it could pollute `Object.prototype`.

**Fix.** Import and use `safeParseJson` at the seam, so the dangerous keys are stripped at parse time —
independent of, and in addition to, the field-by-field reconstruction. Docstring corrected to describe
the belt-and-braces posture.

**Regression tests** (`lib/dashboard-file.test.ts`): `readDashboardFile` parses a valid dashboard,
rejects non-JSON with a friendly error, and — given the crafted pollution payload — returns a clean
dashboard while leaving `Object.prototype` unpolluted.

---

## Finding 2 — Unused chart component injects `color` into `<style>` (Low — ACCEPTED)

**Affected:** `artifacts/omniproject/src/components/ui/chart.tsx:79-96` (`ChartStyle`).

**Detail.** The shadcn/ui `ChartStyle` helper builds CSS with `dangerouslySetInnerHTML`, interpolating
`itemConfig.color` directly into a `<style>` block. If `color` were ever fed from untrusted config
(e.g. an imported dashboard/report colour), a value like `red}</style><script>…` could break out of the
style context. A repo-wide search shows **no caller** of `ChartContainer`/`ChartConfig` anywhere in the
app — this is dead boilerplate, and no untrusted data reaches it.

**Recommendation (follow-up).** If/when charts are wired up, sanitise `color` to a strict CSS-colour
allow-list before interpolation, or drop the unused component. Left as documented Low.

---

## Finding 3 — Messy/broker dev routes gate on the impersonated identity (Info — ACCEPTED)

**Affected:** `routes/dev-mode.ts:40,48,87,92` — `requireRole("admin")` on the broker + messy routes.

**Detail.** `requireRole("admin")` resolves grants via `getSession(req)`, which applies any active
impersonation, whereas the impersonation and entitlements handlers deliberately use
`isRealAdmin(req)` / `getRealSession(req)` to authorise against the genuine actor. This asymmetry is
**not** an escalation: starting an impersonation already requires a real admin
(`routes/dev-mode.ts:159-165`), so the only reachable states are (a) a real admin not impersonating —
passes, correct; or (b) a real admin impersonating a *lower* role — fails closed, safe. A non-admin can
never obtain an admin effective identity. Documented for consistency; no change required.

---

## Finding 4 — `sessionStorage` reads use raw `JSON.parse` (Info — ACCEPTED)

**Affected:** `artifacts/omniproject/src/lib/snapshots.ts:139,198` (`loadSnapshots`, `loadSchedule`).

**Detail.** Both read values the app itself wrote via `JSON.stringify` into same-origin
`sessionStorage`, and both re-validate the parsed shape (`validateSnapshot`, field type checks) before
use. This is a trusted-origin round-trip, not an untrusted-upload seam, so the `safeParseJson` reviver
is not required. The genuine upload seam in the same file (`parseSnapshotFile`, line 123) already uses
`safeParseJson`. No change.

---

## Areas reviewed and found clean (no issues)

- **Messy-data prod-inertness & scope.** `messyDataArmed()` (`broker/messy-broker.ts:38`) is
  `isDevMode() && getMessyConfig().on`, and `isDevMode()` is hard-`false` when `NODE_ENV=production`
  (`lib/dev-mode.ts:32-35`). The wrap is applied only behind that gate (`broker/index.ts:68`). The proxy
  messifies **only** the read methods in `MESSY_METHODS` and passes every other method (all writes)
  straight through; the transform operates on a shallow copy (`applyGremlinsWith` spreads the row), so
  the backing store is never mutated and writes are never touched.
- **Messy-data DoS surface.** All gremlin outputs are bounded constants; the longest (`UNICODE_STRESS`
  overlong string) is `~150 chars × 3` and fixed. `intensity` is clamped to `0..1` at both the env seed
  (`messyDataConfigFromEnv`) and the setter (`setMessyConfig`) and again validated in the route
  (`0 ≤ n ≤ 1`, finite). `seed` must be a non-empty string; `gremlins` are filtered to the known id set.
  The duplicate-id pass is O(n). No unbounded growth, no ReDoS (no user-controlled regex).
- **Config setters.** `setMessyConfig` (`lib/messy-data.ts:84-92`) validates/clamps every field and
  ignores unknown gremlin ids; a malformed patch cannot produce an unusable config. The route rejects
  bad input with 400 before calling the setter and **audits** the change (`recordAudit`, `write:true`).
- **Dev-mode routes generally.** Every dev-only endpoint is behind `requireDevMode` (409 when dev mode
  is off) plus an admin/real-admin check, and every mutating call is audited. Impersonation requires a
  real admin, a ≥3-char reason (recorded), and expires after `IMPERSONATION_TTL_MS` (30 min); a stale
  impersonation cookie is inert outside dev mode (`lib/impersonation.ts:23-29`). Entitlement overrides
  are in-memory, real-admin-gated, and audited. None of these surfaces exist on a production build.
- **Report overrides.** `PUT /api/reports/overrides` is `requireRole("pmo")`; the payload is
  shape-validated in `settings.validateReportOverrides` (id required; `label`/`order`/`hidden` typed);
  it is presentation-only metadata merged over the shipped catalogue on the client
  (`lib/report-overrides.mergeReportOverrides`) and never influences rendering code or data. Labels are
  rendered through React (auto-escaped) — no XSS sink.
- **Dashboards / custom-reports server persistence.** `updateSettings` (`lib/settings.ts:730-741`)
  copies **only** keys from a fixed `ALLOWED_KEYS` allow-list, so no attacker-controlled top-level key
  (incl. `__proto__`) can be written; each list is shape-validated
  (`validateCustomReports`/`validateReportOverrides`/dashboards inline). The custom-report upload seam
  uses `safeParseJson` (`lib/custom-report-file.ts:87`) before passing a `filter` sub-object through.
- **Snapshots / Ed25519.** `canonicalJson` produces stable, key-sorted output; `contentHash` is SHA-256
  over it. Signing uses `crypto.sign(null, …)` / `crypto.verify(null, …)` — the correct null-algorithm
  form for Ed25519. Only the **public** key is ever exposed (`GET /snapshots/key`, `signingInfo`); the
  private key never leaves `lib/signing.ts` and bad key material fails closed (signing stays disabled).
  Verify recomputes the hash and checks the signature, failing closed on hash mismatch, missing key, or
  a bad signature (`verifySnapshot`). Nothing is stored — only the manifest (hashes/scope/counts, never
  content) is audited on capture.
- **safe-json.** `FORBIDDEN_KEYS = {__proto__, constructor, prototype}` are stripped by the reviver at
  every depth. After Finding 1's fix, every untrusted **upload** seam in the SPA routes through it
  (`custom-report-file`, `dashboard-file`, `snapshot`, `snapshots.parseSnapshotFile`, `BackupStep`,
  `ReplicaWorkbench`). The server has no equivalent reviver because it never deep-merges request bodies
  — it copies a fixed key allow-list instead, which is an equivalent (and arguably stronger) control.

## Definition-of-done gate results

- `artifacts/api-server`: `tsc --noEmit` clean; `tsx --test` — **1099 pass / 0 fail** (2 skipped).
- `artifacts/omniproject`: `tsc --noEmit` clean; affected Vitest suites (`dashboard-file`, `safe-json`,
  `custom-report-file`, `report-overrides`) — **25 pass / 0 fail**.
- Library project references build clean (`tsc --build`).
- No mapped source (api-server / backend-catalogue / scripts) changed, so `docs/FUNCTION-MAP.md`
  needs no regeneration; the single fix is in the SPA (`artifacts/omniproject`), which the map does not
  index.
