# Design Principles (agent guide)

Terse, directive invariants for AI agents editing this repo. Follow these unless a task explicitly overrides
one; if a change fights a principle, stop and flag it rather than working around it. Human rationale:
**[DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md)**. Repo orientation: **[../AGENTS.md](../AGENTS.md)**.

Format: each principle is a RULE + how to CHECK it + the usual FIX.

---

## 1. Stateless overlay, zero-at-rest
- RULE: The gateway holds *config*, never authoritative project data. Backend-specific logic lives behind the
  broker contract, never in the app.
- CHECK: New code that hard-codes a backend (Jira/ADO/…) name or shape outside `broker/` is wrong.
- FIX: Route it through the `Broker` seam (`broker/types`, `broker/index`).

## 2. Data lives in JSON, not TypeScript
- RULE: Content (catalogues, presets, templates, forms, reference rulesets, mappings, seed data, blueprints)
  = JSON assets under `assets/<kind>/` → `scripts/src/gen-<kind>.ts` → `src/<kind>.generated.ts` → thin
  accessor. TS holds types/logic/accessors ONLY.
- CHECK: A `.ts` file with a large literal array/record of domain data is drift. Regenerate after editing JSON:
  `pnpm --filter @workspace/scripts run gen-<kind>` — the generated file is committed and CI-drift-guarded.
- FIX: Move the data to `assets/`, add a schema + gen script (mirror `gen-presets`/`gen-templates`), replace
  the const with `export const X = X_DATA;`.
- EXCEPTION: root primitives + a few type-coupled enums that mirror a hand-written union and feed a validator.
  Everything derived is JSON.

## 3. One validated choke point per boundary
- RULE: Every input path goes through its single validated writer. Do NOT add a second writer.
  - Definitions → `def-import` (`sanitizeDef` / `putDef` / activation path). Never write a def store directly.
  - Sessions → `establishSession` (auth.ts). Never hand-roll seal+cookie+CSRF.
  - Config collections → the scoped config-def helpers (`scoped-config.ts`).
- CHECK: A new route that writes a sealed store or mints a cookie without the choke point.
- FIX: Call the existing choke point.

## 4. Untrusted deserialization is guarded
- RULE: Parse untrusted bytes with `safeParseJson`. A bare `JSON.parse` is allowed ONLY on already-integrity-
  established content (a sealed file you just decrypted/opened), and MUST be added to the allowlist in
  `src/__tests__/no-unsafe-json-parse.test.ts` with a reason + count.
- CHECK: `no-unsafe-json-parse` test fails → classify (trusted) or switch to `safeParseJson` (untrusted).

## 5. Composition + integrity
- RULE: Non-root artifacts compose via `extends` and are integrity-checked on write (ancestry resolves; the
  composed whole validates; no descendant that was valid becomes invalid). Never bypass the integrity check on
  a def write/delete.
- CHECK: A def write that skips `checkImportIntegrity` / `checkImportAncestry`.

## 6. Scope-layered config
- RULE: A new setting is a scope-layered `config` def (system→org→programme→project→user, nearest wins via
  `resolveScopedConfig`), not a bespoke store. A *floor* config may only tighten downward (`resolveFloorConfig`
  / `tightenAllowlist`).
- CHECK: A new one-off settings store or a lower scope that can LOOSEN a floor.

## 7. RBAC is fixed in code; only the mapping is data
- RULE: The role set (guest < viewer < contributor < manager < programmeManager, + orthogonal pmo/admin
  authorities) is FIXED in `rbac.ts`. Group→role assignment is the only editable part (`OIDC_*_ROLES` / the
  role-map override). Do NOT invent a role or a permission.
- RULE: admin/PMO authority requires strong auth (`hasStrongAuth`) — a base role never confers it.
- CHECK: New code that grants admin/pmo without the strong-auth gate, or a route gated by an ad-hoc role.

## 8. Auth tiers only tighten (no silent downgrade)
- RULE: Tiers, weak→strong: demo → in-app local passwords → external/self-hosted identity → OIDC/SAML/SCIM.
  Once a stronger SSO is configured, in-app passwords are auto-disabled (`localPasswordsAllowed()` gates login,
  bootstrap, `/auth/me`, the users plane). Recovery (`LOCAL_PASSWORD_RECOVERY`) both (a) re-keys the credential
  domain (`user-credentials.credKey`) and (b) redirects every sealed store to an isolated `recovery/` dir at
  boot (`recovery-mode.engageRecoveryConfigDir`, called first in `bootstrap()`), so the box runs BLANK — no
  original data is loaded (reversible: original dir is never written to). Restore from backup INTO the recovery
  dir, or start afresh.
- CHECK: A local-auth surface that doesn't consult `localPasswordsAllowed()`; a boot path that reads a sealed
  store before `engageRecoveryConfigDir()`; a recovery path that writes to the original config dir.

## 9. Separately-keyed secret stores; fail closed
- RULE: Secret stores are keyed in their OWN domain (config key ≠ AI vault key ≠ `usercreds:v1` credential
  key). Route sealing through `crypto-aes-gcm` + a domain-separated `deriveKey(root, "<domain>")`. Secrets are
  never returned over the API (presence/fingerprint only).
- RULE: Fail closed — malformed allowlist matches nobody; unresolved scope returns nothing; an undecryptable
  sealed file is NOT overwritten. Atomic writes (temp→fsync→rename) for durable files.
- RULE: The Instance Recovery Key (`instance-key.ts`) is stored WRAPPED, never plaintext/env. Its wrap key
  prefers the KMS-unwrapped config root (`deriveKeyFromBytes(kmsConfigKey(), "instance-key:v1")`) when KMS is
  configured, else derives from the master — same KMS-first pattern as `config-crypto.rawKey()`. Unwrap tries
  KMS-then-master, and `ensureInstanceKey` re-wraps in place under the preferred key on boot (key value
  unchanged) so enabling KMS migrates the IRK into the HSM automatically.
- CHECK: A new secret sealed under the config key; a secret value in a response body; a non-atomic sealed write.

## 10. Org identity vs branding
- RULE: Org identity (`org-identity` config def: immutable `org_…` id + name + optional logo) is UNGATED and
  sits at the TOP of the org JSON. Premium `branding` is the whitebox that replaces the PRODUCT name/logo —
  entitlement-gated (`requireEntitlement("branding")`). Don't gate org naming; don't ungate the whitebox.

## 11. No silent truncation
- RULE: If code bounds coverage (top-N, no-retry, sampling, dropped items), it must `log`/surface what was
  dropped. Silent truncation is a bug.

## 12. The hard-data seam (data/code separation — the third boundary, alongside crypto + auth)
- RULE: "Hard data" (authoritative records: issues, resources, actuals, financials) lives BELOW the broker
  seam in the SoR; the gateway is an overlay holding config only. Above `getBroker()` no backend name/shape.
  Where we persist hard data ourselves it's the EXPLICIT sidecar (addressable, bounded) — never an accidental
  shadow SoR that drifts into being the source of truth.
- RULE: Data *shapes* (mappings / field supersets / vocab) are JSON resolved per scope; data *movement* is
  code behind the contract. A field name or backend quirk in a route is a seam leak — same class as leaking a
  secret across the crypto boundary.
- CHECK: A route above the seam hard-coding a backend field/quirk; a store silently becoming the source of
  truth for hard data; the architecture-guard failing on a backend-ism above the seam.
- WHY: the clean seam is what makes zero-at-rest meaningful — lose the box, lose config, not the book of record.

## 13. Clean boundaries / SOLID (Uncle Bob)
- RULE: Dependencies point INWARD. Domain (primitives / composition / scope resolution) imports no
  framework/backend/KMS; IO lives in edge adapters (broker adapters, KMS providers, sealed-file). An adapter
  must be swappable without the core moving.
- RULE: One responsibility per unit — one writer per boundary (§3), one seal/open primitive, one session mint.
  Split a function that grows a second reason to change. Names state intent + guarantee; code reads without
  opening the body.
- RULE: Extend by composition (`extends`, §5), don't fork/modify (open/closed).
- RULE: Functional core, imperative shell — computation is a PURE function (ruleset fold, consolidation,
  depreciation planner, cron matcher: data→data) with IO (broker / shared KV / clock) INJECTED, so it
  unit-tests without a broker or request. Lift `getBroker()` / `Date.now()` out of a compute body into the caller.
- CHECK: A core module importing an adapter; a second writer for an existing boundary; a function needing a
  comment because its name misleads; a pure engine that reaches for `getBroker()`/`Date.now()` internally.

## 14. Kaizen — security is maintained, not achieved
- RULE: Ship small, reversible slices; prefer a diff you can roll back. Leave touched files better (boy-scout
  rule): fix drift (data-in-TS, bare `JSON.parse`, mis-keyed secret) in passing or file it — don't step over it.
- RULE: Every invariant that matters ships WITH a build-failing guard (JSON-drift guard, `no-unsafe-json-parse`,
  architecture-guard on seam leaks, strong-auth gate). A principle without a guard is a wish.
- RULE: Re-audit on cadence (the audit-remediation program); "passed review once" is not a resting state.
- RULE: Every runtime AND dev dependency is tracked by Dependabot (`.github/dependabot.yml`); the 1-day
  `minimumReleaseAge` keeps installs on stable, not day-zero. Any imported/borrowed/vendored third-party code
  (e.g. `yjs` behind the wiki co-editor) is declared as a real version-pinned dependency, marked at its call
  site with provenance + licence, and thereby included in that update flow.
- CHECK: A new invariant with no guard test; a "temporary" workaround with no follow-up; drift stepped over in
  a file you edited; a new dependency missing from the manifest; borrowed code copy-pasted into the tree
  (untracked, unversioned, invisible to Dependabot) instead of pinned + marked.

## 15. One function, one job — write once, call everywhere (DRY)
- RULE: Each behaviour has ONE implementation; every call site uses it (the general form of §3's choke points).
  Canonical singletons: `aesGcmSeal`/`aesGcmOpen` (all AES-GCM), `establishSession` (all session mints),
  `mergeValue` (both inheritance axes), the shared `coerce` module (all untrusted-input taming).
- RULE: A function does one job and its name says which — if you need "and" to name it, split it. Look for the
  existing helper (`coerce` / `scope` / `crypto-*` / `def-compose` / `scoped-config`) before writing a new one.
- CHECK: A hand-rolled second copy (GCM / cookie / merge / coercion); a helper duplicating one in a shared lib.
- WHY: one impl can be fixed once — two copies let a security fix miss the other.

## 16. The JSON tree: scoped sealed stores, forking, inheritance
- MODEL: Every def (screen / report / form / dashboard / mapping / methodology / theme / config / primitive)
  lives in an AES-GCM-sealed JSON collection per (kind, scope). Scopes broad→narrow: `system` (OURS, READ-ONLY
  — not a StorageTarget, seeder-only) → `org` → `programme` → `project` → `user` (private; caller's own `sub`).
- RESOLVE: Renderers read leaf-first (user→project→programme→org→system); NEAREST scope wins BY ID. "Forking" a
  shipped artifact = write a def with the SAME id into your scope (copy-and-override). Never edit `system`.
- INHERIT: Two axes, one algebra (`mergeValue`): scope-override across the tree (`resolveScopedConfig` /
  `configDefLayers`, nearest-wins) and composition within a kind (`extends`, integrity-checked whole on write).
- PRIMITIVES: vendor-controlled roots (`VENDOR_CONTROLLED_KINDS`) — shipped in `system`, importer REFUSES them
  at any customer scope. A new org building block = registry submit → approve → per-scope activation, not a def
  write.
- RBAC: route gates writes by scope + `def-policy` by kind (admin/pmo need strong auth); `resolveScope` bounds
  readable rows (fail-closed). Tree answers "winning def?"; RBAC answers "may you see/change it?".
- CHECK: A path writing the `system` scope; a resolver not honouring nearest-wins-by-id; the importer accepting
  a `primitive` at org/project/user.

## 17. Documented, tested, mapped (the readability contract)
- RULE: Every source file opens with a TITLE block comment; every EXPORTED FUNCTION carries a comment saying
  what it does (JSDoc above, or a `//`/section header over the group). Enforced by `readability-guard.test.ts`
  — an undocumented file/export fails the build.
- RULE: New/changed behaviour ships WITH its unit tests in the same slice. Run the affected suites + `tsc
  --noEmit` before claiming done. A failing test is the AUTHOR's job to fix NOW, before other work — never walk
  past red. A genuinely pre-existing failure is stated plainly, not silently inherited (§10).
- RULE: The coverage gate (statements/branches/functions/lines thresholds, CI-enforced) is a per-slice FLOOR,
  not a later target. New code lands at or above it in the SAME PR; a screen/lib/hook and its tests are one
  change. NEVER stack feature work on a branch whose coverage gate is red — that is how an untested phase
  becomes an audit backlog. Lowering a threshold to green a red gate is forbidden; the fix is the missing tests.
- CHECK: A feature PR that drops global coverage; source added with no matching test; a lowered threshold; work
  stacked on a red coverage gate "to be tested later".
- RULE: `docs/FUNCTION-MAP.md` is GENERATED from the code comments and CI-drift-guarded — never hand-edit.
  Improve the comment in the code and regenerate: `pnpm --filter @workspace/scripts run gen-function-map`.
  Regenerate in the SAME change whenever you add/rename a file or an exported function (like a `*.generated.ts`
  after its JSON asset, §2).
- CHECK: An undocumented file/export; a code change with no test; a red test left for later; a stale
  FUNCTION-MAP (drift guard fails).

## 18. Centralize by mechanism, not by noun (when to merge vs split)
- RULE: The decision procedure between §15 (DRY: write once) and §13 (split on a second reason to change).
  Merge two call sites ONLY when they must change TOGETHER — same wire format / security property / validation
  order / serialization. If a plausible change touches one but not the other, keep them separate and share only
  the primitive underneath.
- RULE: No false unification — do NOT collapse look-alikes into one function that switches on a
  `kind`/`type`/`mode` flag across different purposes; that couples things that change for different reasons
  (whack-a-mole behind one point of failure). If naming it needs "and", or an internal `switch` on *what it is
  used for*, it is two functions over one primitive — split it.
- MODEL (correct): `hmac-chain.chainLinkHash` shared by audit-chain + omnistore, provenance's different MAC
  left out; `aesGcmSeal` one wire format with per-domain KDF/prefix kept separate; `logger` vs the three
  ledgers — same word "log", never merged. Non-merge on purpose: `masterSecret`/key-registry's separate ladders
  (`crypto-keys.ts`).
- CHECK: A new "shared" helper that switches on a usage discriminator; a util that grows a second reason to
  change; two byte-identical hand-rolled copies of one formula (those DO merge — §15).
- FIX: Extract the shared PRIMITIVE; leave the divergent purpose with each caller. Add/extend the primitive's
  drift guard so it can't un-consolidate.

## 19. Every mutation is guarded by construction (write-lane coverage)
- RULE: Every live POST/PUT/PATCH/DELETE is in EXACTLY ONE lane — Lane 1 entity pipeline (`mountEntity`), Lane 2
  action base (`mountCommand`), or Lane 3 `BESPOKE_WRITES` (irreducible: auth/session, SSE, break-glass, SCIM).
  Lane 1/2 apply RBAC → validate → ruleset → scope → write BY CONSTRUCTION; you cannot add a write that skips a gate.
- RULE: A new write route joins a spine (prefer Lane 1/2). If it's a true oddball, add it to `BESPOKE_WRITES`
  with a reason — that list may only SHRINK.
- CHECK: `write-lane-coverage.test.ts` fails ⇒ your new write is in no lane. Register it; never suppress the test.

## 20. Autonomous writes are default-deny under an explicit grant
- RULE: Any write with NO live human request (rule dispatch, scheduled job, AI/agent) runs as a named autonomous
  principal (`automation:rule_<id>` / `agent:<id>:<onBehalfOf>`) through the autonomous-guarded broker — REFUSED
  unless an admin granted that EXACT action (default-deny). `allowWrites` opens the EFFECT, never the authorization.
- RULE: A mutating effect is reachable ONLY on the autonomous, grant-gated path (`effectsForAutonomousContext`);
  the human/direct surface stays read+notify. Add a mutating effect as an allowlisted `case` gated by `opts.allowWrites`.
- RULE: Autonomous runs are attributable (audit + causation), kill-switchable, and cascade-bounded (depth +
  fan-out). Mint least privilege (≤ `contributor`); never widen the actor.
- CHECK: A workflow/rule that mutates on the direct path; an effect that writes without `allowWrites`; an
  autonomous actor minted above `contributor`; automating something the author couldn't do by hand.

## 21. Background work is idempotent and fleet-safe
- RULE: A scheduled/dispatched job must be safe to run twice AND on every replica. The "already done" marker
  lives in the SYSTEM OF RECORD (a field write-back, e.g. `depreciationThroughDate`), never an in-memory flag a
  restart forgets — a re-run posts nothing new.
- RULE: Exactly-once across a fleet — claim each unit (`sharedKv.cas`) BEFORE acting; a lost claim means another
  tick/replica owns it, so skip. A claim outage fails CLOSED (don't act), never double-fires.
- RULE: The in-process interval timer (`createIntervalScheduler`, env-hours, `0` = off) is an opt-out
  single-instance convenience; a fleet sets it to 0 and drives the `…/run` endpoint from external cron.
- CHECK: A job keyed on module/in-memory state; acting before the claim; a "run twice" path that re-posts.

---

## Workflow rules
- Match surrounding code: comment density, naming, idioms. Reference `file:line`.
- After editing JSON assets, run the matching `gen-<kind>` and commit the generated file.
- Typecheck each package you touch (`npx tsc --noEmit`) and run the affected tests before claiming done.
- exactOptionalPropertyTypes is ON: optional props that can be `undefined` need `| undefined` in the type.
- Vitest: components using `useQuery`/`useQueryClient` need a `QueryClientProvider` or a context guard; fetch
  mocks returning non-arrays crash `.map` — guard `Array.isArray`.
- Report outcomes faithfully: failing tests, skipped steps, and bounded coverage get stated plainly.
