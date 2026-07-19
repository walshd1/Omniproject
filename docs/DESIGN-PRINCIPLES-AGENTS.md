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
- CHECK: A new secret sealed under the config key; a secret value in a response body; a non-atomic sealed write.

## 10. Org identity vs branding
- RULE: Org identity (`org-identity` config def: immutable `org_…` id + name + optional logo) is UNGATED and
  sits at the TOP of the org JSON. Premium `branding` is the whitebox that replaces the PRODUCT name/logo —
  entitlement-gated (`requireEntitlement("branding")`). Don't gate org naming; don't ungate the whitebox.

## 11. No silent truncation
- RULE: If code bounds coverage (top-N, no-retry, sampling, dropped items), it must `log`/surface what was
  dropped. Silent truncation is a bug.

---

## Workflow rules
- Match surrounding code: comment density, naming, idioms. Reference `file:line`.
- After editing JSON assets, run the matching `gen-<kind>` and commit the generated file.
- Typecheck each package you touch (`npx tsc --noEmit`) and run the affected tests before claiming done.
- exactOptionalPropertyTypes is ON: optional props that can be `undefined` need `| undefined` in the type.
- Vitest: components using `useQuery`/`useQueryClient` need a `QueryClientProvider` or a context guard; fetch
  mocks returning non-arrays crash `.map` — guard `Array.isArray`.
- Report outcomes faithfully: failing tests, skipped steps, and bounded coverage get stated plainly.
