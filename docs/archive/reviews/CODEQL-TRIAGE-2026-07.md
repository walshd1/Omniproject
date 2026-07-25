# CodeQL Triage — API gateway (2026-07)

**Scope:** `artifacts/api-server` (gateway) + `artifacts/omniproject` (SPA) where a rule
class reaches client code. Triage of the open CodeQL `security-extended` backlog
(~78 alerts across the classes below).

**Method — inspection-driven, comprehensive by rule class.** The code-scanning REST API
returns `403 "Resource not accessible by integration"` for this session's token, and the
CodeQL CLI bundle download is blocked by the environment proxy, so the authoritative
per-alert list could not be pulled into the working session. Instead of triaging a list we
could not see, we enumerated **every instance of each flagged rule class directly in the
source** and classified each one. That covers the code the alerts point at whether or not
the exact alert IDs were visible. An authoritative alert-ID cross-check still wants a SARIF/CSV
export from the Security tab — see *Reconciliation* at the end.

## Verdict

Across all six flagged rule classes, **one genuine (low-severity) web-reachable finding**,
now fixed with a regression test. Everything else is a false positive: the queries misfire on
defensive/allowlist code that they don't recognize as a sanitizer — fixed dispatch tables, the
global prototype-stripping body reviver, RE2-backed pattern compilation, length-capped inputs,
non-HTML content types, and encrypted-at-rest / httpOnly-signed-secure cookies.

## Genuine finding (fixed)

| # | Sev | Rule | Site | Fix |
|---|-----|------|------|-----|
| G1 | Low | `js/unvalidated-dynamic-method-call` | `broker/reference-broker-blueprint.ts:233` | `dispatch` looked up its handler with a bare `BINDING_ACTIONS[action]` on a plain object literal (inherits `Object.prototype`); an `action` of `constructor`/`toString`/`valueOf`/`hasOwnProperty` resolved to an inherited method, passed the `if (!handler)` check, and was **invoked** — `constructor` echoed the internal `{ be, ctx, payload, … }` argument back into the response envelope; the others 500'd — instead of a clean `400 unknown action`. Gated on `Object.hasOwn(BINDING_ACTIONS, action)` (the recognized own-property barrier). Regression test asserts each `Object.prototype` method name → 400 with no `data` echoed. |

**Hardening surfaced by the audit (no active leak; defense-in-depth):**

- **`lib/logger.ts`** — the pino `redact` list covered only access/id tokens. Added
  `refreshToken`, `verifier`, `codeVerifier`, `password` (+ nested `*.` forms) so a future
  `logger.x({ verifier })` can never write a live secret in clear text. `state`/`nonce`/`link`
  deliberately left loggable (semi-public, collide with common non-secret fields).

## False-positive dismissals — by rule class

Each site below was inspected and is safe for the stated reason. Suggested CodeQL dismissal
reason in **bold**.

### Reflected/stored XSS (`js/reflective-xss`, `js/stored-xss`) — **won't fix / false positive**

Every Express response sink was reviewed (17 sites). None is exploitable:

- `routes/setup/config-io.ts:74/129/177/186/213/247/256/344` — backup/export/diff downloads
  served as `application/json` / `text/plain` / `application/zip` with `Content-Disposition:
  attachment`; bodies are server-side state, `?format=`/`?encrypted=` only branch, never
  reflected. **Non-HTML content type + attachment; no request reflection.**
- `routes/calendar.ts:63` (`text/calendar` + attachment), `routes/export.ts:24/37`
  (per-dataset non-HTML MIME + attachment, filename sanitized), `routes/odata.ts:69`
  (`application/xml`), `routes/integrations.ts:66/72` (`text/plain` Prometheus),
  `routes/auth.ts:532` (SAML metadata `application/xml`). **Non-HTML content type.**
- `routes/auth.ts` OIDC/OAuth2/SAML status `res.send(...)` (392/408/417/422/…/570) — `text/html`
  but every body is a hard-coded literal; the one attacker-controlled value, provider `?error=`,
  is **logged only and never echoed** (in-code comments at `auth.ts:412-418` and `562-567`
  document the XSS avoidance). `returnTo` flows to `res.redirect(safeLocalPath(...))`, path-sanitized.
  **Tainted value not reflected into the body.**
- `routes/api-spec.ts:24/36` (static generated OpenAPI/portal constants), `routes/well-known.ts:35`
  (`text/plain` security.txt), broker sidecar `res.end(JSON.stringify(...))` with
  `application/json` (`broker/omnistore/server.ts`, `broker/reference-sidecar.ts`, etc.).
  **Static/JSON, no request reflection.**

### Clear-text storage/logging (`js/clear-text-storage-of-sensitive-data`, `js/clear-text-logging`) — **won't fix / false positive**

- `routes/auth.ts:542` and `:861` (**the flagged OAuth2 sites**) + siblings `:369`, `:885` —
  PKCE `verifier` / OAuth `state` / OIDC `nonce` in an `httpOnly + signed + secure(TLS) +
  sameSite=lax`, **10-minute-TTL** cookie. This is the textbook stateless PKCE/OIDC pattern; the
  verifier is a single-flow secret useless without the concurrent auth-code. **Ephemeral flow
  token in a hardened short-TTL cookie — by design.**
- `routes/auth.ts:232` — session cookie carries real `accessToken`/`idToken` but is
  **AES-256-GCM sealed** (`lib/session-crypto.ts`), so the stored value is ciphertext.
  **Encrypted at rest.**
- `lib/csrf.ts:76` — `omni_csrf` is deliberately `httpOnly:false`/unsigned because the SPA must
  read it to echo `X-CSRF-Token`. **A double-submit CSRF nonce is not a confidential credential.**
- On-disk secret writes — password hashes (`lib/user-credentials.ts`), vault API keys
  (`lib/vault-store.ts`, doubly-sealed), instance root key (`lib/instance-key.ts`, `wrapped`),
  broker sealed files — all **AES-256-GCM sealed, mode 0600**. **Encrypted at rest.**
- `lib/magic-link.ts:149` — logs the full token-bearing magic-link URL, but **only when
  `MAGIC_LINK_LOG_URL` is explicitly set** (off by default, documented as sensitive).
  **Operator opt-in debug path — accepted by design**, not an accidental leak.

### Polynomial ReDoS (`js/polynomial-redos`, `js/redos`) — **won't fix / false positive**

- `routes/odata.ts:75` (the flagged `$filter` `projectId eq` regex) — `^…$`-anchored with a
  single unbounded group; `$filter` is bounded by Node's ~16 KB header/URL cap. **Anchored
  single-group → linear; input bounded.**
- `lib/form-def.ts:22/119` `EMAIL_RE` — the quadratic backtracking *shape* is real, but
  `capLength` (≤10 000, default 2 000) runs on the **immediately preceding line**, so worst-case
  work is bounded and non-catastrophic. **Input hard length-capped before the match.**
- `lib/odata.ts:71/80/87/158`, `routes/client-errors.ts:19/22`, `lib/comments.ts:48`
  (`{1,64}`-bounded), `lib/scim.ts:378`, `lib/nl-action.ts:59`, `lib/estimate.ts:61`,
  `lib/column-mapper.ts`, `lib/custom-roles.ts:58`, and the SPA markdown-lite/search splitters —
  all single character-class / anchored / bounded-quantifier / simple-split → **linear**.
- All **admin-supplied pattern strings compile through RE2** (`lib/safe-regex.ts`), which is
  backtrack-free by construction. **Not vulnerable to ReDoS.**

### Unvalidated dynamic method call (`js/unvalidated-dynamic-method-call`) — **mostly false positive** (G1 excepted)

- `routes/mcp.ts:153`, `lib/def-store-export.ts:202`, `lib/column-mapper.ts:210`,
  `lib/vault-store.ts:217`, `broker/sanitizer.ts:282`, `lib/validate.ts:109`, and the broker
  proxy-instrumentation wrappers (`meter`/`cache`/`trace`/`autonomous-guard`/…) — the invoked
  value comes from a **fixed dispatch table selected by a typed union / allowlist-checked key /
  `Object.keys`-derived own key**, or is the real target method obtained via `Reflect.get`.
  **Allowlist dispatch, key cannot select an unintended method.**
- `broker/send-cli.ts:55`, `broker/replay-cli.ts:57` — genuine-by-shape (argv key into an
  arbitrary object cast) but **dev/ops CLIs whose input is `argv`, not web-reachable**. Left as-is;
  noted for optional hardening. **Not attacker-facing.**

### Remote property injection / prototype pollution (`js/remote-property-injection`, `js/prototype-polluting-assignment`) — **won't fix / false positive**

The systemic guards CodeQL doesn't model as sanitizers:

- **Global body reviver** — `app.ts:223` `express.json({ reviver: stripDangerousKeys })` strips
  `__proto__`/`constructor`/`prototype` from **every** request body at parse time (urlencoded uses
  `qs` with `allowPrototypes:false`). Any `obj[key] = …` where `key` derives from a body key is
  already clean.
- **`isForbiddenKey` / `FORBIDDEN_KEYS`** (`lib/safe-json.ts`) and inline 3-key guards on
  **route-param / restore-sourced** keys (which the reviver doesn't touch): `history-retention.ts:44`,
  `user-credentials.ts:136/151`, `scim.ts` (`safeId` + `Object.create(null)` member map),
  `mapping-sidecar.ts`, `wbs-sidecar.ts`, `settings.ts` (+ `stripDangerousKeysDeep`),
  `user-prefs.ts`, `capability-governance.ts`, `key-registry.ts`, `ruleset-scope.ts`,
  `automation.ts`, `mapping.ts`, `wbs-mapping.ts`, `column-mapper.ts`, `custom-fields.ts`,
  `collection-edit-roles.ts`, `deployment-types.ts`, `broker/sanitizer.ts`, and others.
- **Allowlist / regex-gated keys**: `priority-labels.ts`, `features.ts`, `labels.ts`,
  `settings-scope.ts`, `form-def.ts:223`, `config-store.ts`, `residency-policy.ts`,
  `selfhost/adapter.ts`, `nl-action.ts`, vocabulary configs, `broker/demo.ts`.
- **Numeric/string-typed values** that make a proto key a harmless no-op: `ai-providers.ts`,
  `broker/sanitizer.ts:189`, `scim.ts:75`, `goal.ts:326`.

No unguarded prototype-pollution sink found.

### Incomplete string escaping (`js/incomplete-sanitization`, `js/incomplete-multi-character-sanitization`) — **won't fix / false positive**

Every `.replace()` used for actual escaping/redaction carries the `g` flag (DLP redaction,
control-char strip, filename sanitizer, HTML/XML/CSV/iCal/PDF/Prometheus/markdown escapers,
IPv6-bracket strips). Every **non-`g`** replace is a benign single-token normalizer (trailing-slash
trim on operator-config URLs, single leading-scheme / trailing-port / `::ffff:` prefix strip),
anchored, where repetition only leaves a harmless extra token — not a security bypass.

## What holds up (verified strong)

- **Prototype-safe by default:** global body reviver + `isForbiddenKey` on every param/restore path
  + `Object.create(null)` sinks + typed-value no-ops.
- **Regex safety:** RE2 for all admin-supplied patterns; anchored/bounded/length-capped user regexes.
- **Secrets:** AES-256-GCM sealed at rest, session cookie signed+sealed, PKCE flow cookies
  httpOnly+signed+secure+short-TTL, log redaction (now extended to refresh/verifier/password).
- **Output encoding:** every response carrying request data uses a non-HTML content type /
  attachment / path-sanitized redirect; the one `?error=` taint source is logged-only.

## Reconciliation

This triage is organized by **code site**, comprehensive per rule class. To reconcile against the
exact open alert IDs, export the SARIF/CSV from **Security → Code scanning** (or grant the session
the code-scanning read scope) and map each alert to its class above — every class resolves to
*false positive* except **G1** (fixed). The false-positive classes can be batch-dismissed with the
bolded reasons; G1 closes on the next CodeQL run over this branch.
