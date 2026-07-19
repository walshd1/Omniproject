# Design Principles (human guide)

This is the *why* behind OmniProject's architecture — the small set of principles that everything else
follows from. If you understand these, most design decisions in the codebase become predictable. There is a
companion terse version for AI agents at **[DESIGN-PRINCIPLES-AGENTS.md](DESIGN-PRINCIPLES-AGENTS.md)**; this
one is for people.

Read alongside **[ARCHITECTURE.md](ARCHITECTURE.md)** (the layer cake) and **[../SECURITY.md](../SECURITY.md)**
(the threat model).

---

## 1. Stateless overlay, zero-at-rest

OmniProject is a **program-management overlay**, not a system of record. The authoritative data lives in
whatever backend(s) an organisation already runs (Jira, Azure DevOps, ServiceNow, GitHub, a self-hosted
sidecar DB…), reached through the **broker seam**. The gateway holds *configuration*, not project data.

Consequences you'll see everywhere:

- The only durable thing worth protecting is **config**, and it is sealed at rest (AES-256-GCM). "Keep your
  encrypted JSON safe and you have your whole system" is meant literally.
- A snapshot/backup is small and portable. Losing the box loses nothing you can't restore from a backend + a
  config backup.
- The codebase **must not know** which backend it's talking to. Anything backend-specific belongs behind the
  broker contract, never in the app.

## 2. Data is JSON; code is code

Anything that is **content** — catalogues, vocabularies, presets, templates, forms, reference rulesets,
mappings, seed data, blueprints — is authored as **JSON assets** under an `assets/` directory, validated
against a schema, and run through a generator into a `*.generated.ts` module consumed via a thin accessor.
Hand-authored TypeScript *constants that hold data* are the anti-pattern.

Why: data-as-JSON can be shipped, overridden, diffed, and validated without a code change; it keeps the
"a new preset is data, not a deploy" promise; and it keeps the type layer about *shapes and logic*, not
payloads. When you find a data blob inlined in a `.ts` file, that's usually drift to fix (see the
[JSON-vs-TS audit pattern](DESIGN-PRINCIPLES-AGENTS.md#2-data-lives-in-json-not-typescript)).

The legitimate exceptions are narrow: **root primitives** and a handful of type-coupled enums that mirror a
hand-written union and feed a validator. Everything derived from those is JSON.

## 3. One validated choke point per boundary

Every place untrusted input can enter the system funnels through a **single validated writer**, so a rule can
never be half-enforced:

- **Definitions** (primitives, screens, forms, reports, dashboards, mappings, config) enter *only* through the
  importer (`def-import`), which validates by kind against the real product validators, checks composition
  ancestry + bidirectional integrity, and seals into the scoped store. There is no side door.
- **Tabular data** enters through the import route → the broker.
- **Sessions** are minted in exactly one place (`establishSession`), so the "seal cookie + rotate CSRF"
  sequence can't drift between login providers.
- **Untrusted deserialization** goes through `safeParseJson`; a bare `JSON.parse` is allowed only on content
  whose integrity is already established (a sealed file we just decrypted), and each such use is allowlisted
  and CI-guarded.

If you're adding an input path, find the existing choke point and go through it. Don't add a second writer.

## 4. Composition over configuration: the primitive taxonomy

The building blocks are **primitives**. Richer artifacts are *composed* from them via `extends` (a thin child
overrides a parent property-by-property), and the whole graph is integrity-checked on every write so a change
to a root can never silently break a descendant. Screens, reports, tables, charts all bottom out in the same
atom tree.

This is what lets an organisation **copy-and-override** anything we ship without forking it, and lets us prove
(in code + tests) that a customer's recipe still holds against what it inherits.

## 5. Scope-layered config: nearest wins, tighten-only where it's a floor

Configuration resolves across scopes — **system → org → programme → project → user** — with a shared merge
algebra (`resolveScopedConfig`): objects deep-merge, id-keyed arrays merge by id, scalars replace. The nearest
scope wins. A *floor* config (an allowlist / ceiling) is special: a lower scope may only **tighten** it, never
loosen it.

So a shipped default, an org override, and a project tweak are the *same mechanism* at different layers — no
bespoke per-setting override machinery. When you add a setting, make it a scope-layered config def, not a new
one-off store.

## 6. Presets: most customers, different settings, one quick-load

The product serves most customers by shipping **presets** — named bundles that reference the pieces that
already exist (a methodology, a reference ruleset, a starter project template, a persona dashboard, a settings
posture) and configure an org for a way of working in one action. Presets are **data in the system JSON**,
copy-and-overridable like every other catalogue. "Zero to enterprise Scrum in ten minutes" is a preset plus a
setup wizard, not custom code per customer.

## 7. Identity, branding and tiers

- **Org identity** (a stable, immutable `org_…` id + a name + an optional logo) is the org's own, **ungated**
  record — the first row of the org-level JSON. Every deployment can name and badge itself.
- **White-label branding** is the *premium whitebox*: it replaces the **product** name/logo entirely (so the
  app becomes "Acme Ltd PPM & Resource Management System", no OmniProject shown). That's the paid tier; naming
  your org on OmniProject is always free.
- Keep the two straight: org identity is *your name on our product*; branding is *our product becoming yours*.

## 8. Authentication is tiered, and it only ever tightens

Auth has an explicit hierarchy, weakest to strongest:

1. **Demo** — no auth; every session is admin. Usable out of the box, loudly flagged, never for production.
2. **In-app local users** — native accounts with passwords, for a solo user or a homelab. The *entry* tier.
3. **External-container / self-hosted identity** — a step up.
4. **Enterprise OIDC / SAML / SCIM SSO** — the strongest tier.

Two hard rules make this safe:

- **No silent downgrade.** The moment a stronger tier (real SSO) is configured, in-app passwords are
  **automatically disabled**. A box-level attacker can't fall back to a local password to get around SSO.
- **Recovery isolates the data.** The only way to re-enable local passwords while SSO is configured is a
  host-side break-glass (`LOCAL_PASSWORD_RECOVERY`). Engaging it does two things: it **re-keys the credential
  store** (existing local passwords are invalidated), and it **redirects every sealed store to an isolated
  `recovery/` directory** so the whole system runs **blank** — the original org data stays on disk, untouched,
  but is never loaded. So re-enabling privileged local access on a compromised box yields **no readable data**:
  you create a new local admin from scratch, or **restore from backup into the recovery instance**. It's
  reversible (disengage recovery to return to the original data), so a false trigger doesn't destroy anything —
  the guarantee is "not exposed while engaged", not "irreversibly wiped". The cost is the point: recovery can
  never be a stealth downgrade past SSO.

## 9. Privileged actions demand strong, separated auth

- **Admin / PMO authority requires strong auth** (hardware-bound MFA / passkey step-up), separately from the
  base role ladder. Holding a session is not enough to perform the highest-risk actions.
- **Separate your accounts.** A person who *is* an admin should not carry admin authority on their everyday
  account. Give them a **distinct privileged identity** for admin tasks, and use the ordinary account for
  ordinary work. The strong-auth gate and step-up make this enforceable; the operational discipline is yours.
  (If Joe Bloggs does admin work, "Joe the admin" and "Joe the contributor" should be two identities.)
- **Secrets are separately keyed.** Password hashes live in their own key domain, distinct from the config key
  and the AI-key vault, so compromise of one key never opens another store.

## 10. Fail closed, and make truncation loud

- On doubt, **deny**: a malformed allowlist entry matches nobody; an unresolved scope returns nothing; an
  undecryptable sealed file is *not* treated as empty (we refuse to overwrite it).
- If a process bounds its work (top-N, no-retry, sampling), it **says so** — silent truncation reads as
  "covered everything" when it didn't.

## 11. The hard-data seam is the third pillar (data and code are separated)

Everyone reaches for two boundaries first — the **crypto** boundary (what's sealed) and the **auth** boundary
(who may act). A third matters just as much: the **hard-data seam**. "Hard data" is the authoritative,
load-bearing record — the real issues, resources, actuals and financials that live in the systems of record
*below* the broker. The gateway is an **overlay**, and the seam (`getBroker()` / the `Broker` contract) is the
line it must never cross.

Two disciplines keep it honest:

- **Data below the seam, code above it.** Nothing above `getBroker()` may know a backend's name or shape;
  anything backend-specific is an adapter *below* the seam (the architecture-guard fails the build if a
  backend-ism leaks upward). The overlay must never quietly become a **shadow system of record** — where we
  genuinely need to persist hard data ourselves, that is the **sidecar**: an explicit, bounded, addressable
  store, never an accidental cache that drifts into being the source of truth.
- **Content is data, logic is code** — principle 2 restated *as a seam*. The *shapes* of hard data (mappings,
  field supersets, vocabularies) are JSON resolved per scope; the *movement* of hard data is code behind the
  contract. A field name hard-coded in a route, or a backend quirk leaking upward, is the same class of error
  as leaking a secret across the crypto boundary.

Why this is a *security* principle and not merely an architectural one: a clean hard-data seam is what makes
**zero-at-rest** mean something. If project data never lands in the gateway, losing or compromising the box
exposes *config* — not the organisation's book of record. The seam is the reason "keep your encrypted JSON
safe and you have your whole system" is also "…and losing the box loses nothing you can't restore."

## 12. Clean boundaries and dependency inversion (the Uncle Bob principles)

The codebase leans on **Clean Architecture / SOLID** habits — not as dogma, but because they are what make the
seams above *enforceable* rather than aspirational:

- **Dependencies point inward.** The domain (primitives, composition, scope resolution) knows nothing of
  Express, of any specific backend, or of any specific KMS. IO and frameworks sit at the edges as adapters —
  the broker adapters, the KMS providers, the sealed-file layer. You can swap Jira for ADO, AWS KMS for Azure,
  or the demo broker for a real one, and the core does not move. (Dependency inversion; the broker seam is
  ports-and-adapters made concrete.)
- **Single responsibility, small units.** One validated writer per boundary (principle 3), one seal/open
  primitive, one session mint. When a function grows a *second* reason to change, split it — a module that
  resolves scope *and* seals bytes *and* talks HTTP is three modules wearing one name.
- **Names carry intent; code reads like prose.** `localPasswordsAllowed()`, `engageRecoveryConfigDir()`,
  `unwrapCandidates()` — a reader shouldn't have to open the body to know what a thing does or guarantees.
  Match the surrounding density and idiom; the cheapest documentation is a well-named function.
- **Open for extension, closed for modification.** `extends` + property-by-property merge (principle 4) is the
  open/closed principle made concrete: ship a default, let a customer override it, never fork it.

When a change makes one of these *harder* — a core module reaching outward for an adapter, a "quick" second
writer, a function that needs a comment because its name lies — that's the smell, and the fix is a boundary,
not a workaround.

## 13. Kaizen: security is maintained, not achieved

Security here is a **practice, not a property**. Nothing in this document stays true on its own; it stays true
because every change leaves the system a little better than it found it, and because guardrails fail the build
when an invariant slips.

- **Small, reversible slices.** The system was built — and should keep growing — in narrow, independently
  verifiable steps. A small diff you can reason about and roll back beats a big one you can only hope about.
  Recovery mode, the isolated `recovery/` directory, the in-place IRK re-wrap — each was chosen partly because
  it is reversible.
- **Leave it better (the boy-scout rule).** When you touch a file and see drift — a data blob in TypeScript, a
  bare `JSON.parse`, a secret that could be sealed under its own key — fix it in passing or file it; don't step
  over it. Today's "someone else's problem" is tomorrow's incident.
- **Guardrails encode the lesson.** Every invariant that matters has a test that fails loudly when it
  regresses: the JSON-vs-TS drift guard, the `no-unsafe-json-parse` allowlist, the architecture-guard on seam
  leaks, the strong-auth gate on privileged actions. A principle without a guard is a wish — when you establish
  a new invariant, add the guard that keeps it.
- **Assume decay; re-audit on a cadence.** Dependencies age, threat models shift, features accrete. The
  security posture is revisited (the audit-remediation program), not declared done. "It passed review once" is
  not a state the system is allowed to rest in.

The through-line: **continuous improvement *is* the security model.** The crypto, the auth tiers and the
hard-data seam are only ever as strong as the discipline that keeps them from eroding.

---

## Operational implications (read this if you run OmniProject)

- **Save your recovery key on first setup, and keep it offline.** A fresh instance mints an **Instance Recovery
  Key** (IRK) — a portable secret shown to the admin **once** (Settings → Recovery key), stored *wrapped* on
  the box (never plaintext, never a bare env var). When a cloud KMS is configured the IRK is wrapped **directly
  under the KMS-unwrapped root** — its protection sits in the HSM, exactly like the config and vault roots —
  and enabling KMS on an existing instance migrates the IRK into the HSM on the next boot (the key value is
  unchanged). Without KMS the wrap derives from the box master secret. It is the ONLY thing that opens an encrypted
  **portable backup** on a different box, so save it somewhere separate — a password manager, or printed and
  locked away. **Restore** is: upload the portable backup + paste the old key → it decrypts, reloads, and the
  instance **rotates to a fresh key it then reveals** (save that one too). Lose the key and its backups can't be
  opened — that's the zero-at-rest guarantee cutting both ways.
- **Back up regularly, and keep a copy offline.** Because the system is zero-at-rest and several stores are
  *separately keyed*, your encrypted backup + your recovery key **are** your recoverability. Recovery
  break-glass and total key loss both resolve to "start afresh or restore from backup". A regular, offline
  (air-gapped or otherwise out-of-band) backup is the difference between a bad afternoon and a data-loss
  event. Test your restores.
- **Guard your keys like the crown jewels.** KMS-wrapped root keys (config + vault) and any
  `USERCRED_SECRET` / `SESSION_SECRET` are what make the encrypted stores openable. Losing them is losing the
  data; leaking them is losing the confidentiality.
- **Choose the lowest auth tier that fits, then only go up.** Start solo on in-app users if that's you; move to
  SSO as you grow. You can't be downgraded by accident, and you shouldn't downgrade on purpose.
- **Use separate privileged accounts** for admin work, and keep MFA on the privileged identities.

---

*If a change you're making seems to fight one of these principles, that's a signal to stop and reconsider the
change — not the principle. If the principle is genuinely wrong for a case, say so explicitly in the PR rather
than quietly working around it.*
