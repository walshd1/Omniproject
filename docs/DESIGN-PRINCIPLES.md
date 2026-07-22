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
- **Every dependency is tracked, and borrowed code is a tracked dependency.** All runtime and dev dependencies
  live under Dependabot (`.github/dependabot.yml`), so an upstream fix arrives as a small, reviewable PR on a
  cadence — never a manual chase — and the 1-day `minimumReleaseAge` in `pnpm-workspace.yaml` keeps us on
  *stable*, not day-zero. The corollary for **imported / borrowed / vendored third-party code** (for example the
  `yjs` CRDT core behind the wiki co-editor): it is declared as a real, version-pinned dependency, marked at its
  call site with its provenance and licence, and thereby swept into that same update flow. Copy-pasting a
  snippet into the tree — untracked, unversioned, invisible to Dependabot — is the anti-pattern: it ages
  silently and no CVE scan will ever find it. If you must borrow, **pin it and mark it** so it updates like
  everything else.

The through-line: **continuous improvement *is* the security model.** The crypto, the auth tiers and the
hard-data seam are only ever as strong as the discipline that keeps them from eroding.

## 14. One function, one job — write it once, call it everywhere

Every distinct task has exactly **one** implementation, and everything that needs it **calls that one**. This
is DRY stated as a design rule, and it is the general form of principle 3 (one validated writer per boundary):
the choke points are its security-critical instances, but the rule is broader.

- **A behaviour lives in one place.** `aesGcmSeal`/`aesGcmOpen` is the *only* AES-GCM implementation;
  `establishSession` the only session mint; `mergeValue` the only merge algebra (shared by the composition
  axis *and* the scope-override axis); the shared coercion module the only place junk input is tamed. When two
  call sites need the same thing, they share the function — they do not each grow their own copy.
- **Why it isn't just tidiness:** a rule that exists once can be *fixed* once. A GCM tag-handling tweak, a
  tighter allowlist match, a scope-precedence correction — each lands in a single function and every caller
  inherits it. Two copies mean a fix to one silently misses the other; that is exactly how a half-enforced
  security rule is born.
- **A function does one job, and its name says which.** If you can't name it without "and", it's two
  functions. Small, single-purpose, honestly-named units compose; god-functions don't.
- **Reuse over re-derivation.** Before writing a helper, look for the existing one (`coerce`, `scope`,
  `crypto-*`, `def-compose`, `scoped-config`). Duplicated logic is drift waiting to happen — the JSON-vs-TS
  guard, the `no-unsafe-json-parse` allowlist and the architecture-guard exist precisely to catch copies
  diverging from the canon.

## 15. The JSON tree: scoped stores, forking, and inheritance

Almost everything configurable in OmniProject is a **definition** ("def") — a small JSON document: a screen,
report, form, dashboard, mapping, methodology, theme, config, or a primitive — and every def lives in a
**scoped, sealed JSON store**. Understanding the tree explains forking, inheritance, RBAC and primitives all
at once.

**The scopes (the tree).** One AES-256-GCM–sealed JSON collection per (kind, scope), stacked broadest to
narrowest:

```
system  →  org  →  programme  →  project  →  user
(ours,      (the customer's own layers)         (a person's
 read-only)                                       private area)
```

- **`system`** holds the defaults *we* ship (default screens, reports, rulesets, and the primitive
  vocabulary). It is **read-only** to every customer — deliberately *not* a storage target, so the
  importer/editor can never write it; only the product's own seeder populates it.
- **`org` / `programme` / `project` / `user`** are the customer's own sealed stores. A user's area is
  structurally private (their own `sub` is always used, so cross-user reads are impossible); the others are
  permission-gated by the route before a scope is chosen.

**Forking a system artifact = copy-and-override, never edit-in-place.** Because `system` is read-only, an org
that wants to change a shipped screen doesn't mutate ours — it **writes a def with the same `id` into its own
scope**. At render time the resolver reads the tree **leaf-first** (user → project → programme → org → system)
and the **nearest scope wins by id**. So the org's copy shadows the shipped one *for that org*, while every
other deployment still gets our default and our later updates to the untouched parts still flow through. That
is the "copy-and-override anything we ship without forking the product" promise made literal: your fork is a
thin overlay in *your* tree, not a divergent branch of ours.

**Two inheritance axes, one merge algebra.** Nothing is copied wholesale unless you want it to be:

- **Scope-override (across the tree):** the same logical id authored at several scopes is folded base→leaf,
  nearest wins property-by-property (`resolveScopedConfig` / `configDefLayers`). This is how a shipped default,
  an org tweak and a project tweak combine into one resolved value.
- **Composition (`extends`, within a kind):** a def can `extends` a parent and override it property-by-property;
  the whole graph is integrity-checked on every write, so a change to a root can never silently break a
  descendant. Screens, reports, tables and charts all bottom out in the same atom tree.

Both axes use the **same `mergeValue` algebra** (objects deep-merge, id-keyed arrays merge by id, scalars
replace) — one merge rule, two uses (principle 14 in action).

**Primitives are the locked roots of the tree.** Primitives are the vocabulary every richer def is composed
from, so they are **vendor-controlled**: shipped in `system`, and the *only* kind the importer refuses to write
at any customer scope. An org can compose recipes *from* primitives endlessly, but it can never redefine a
building block out from under its own descendants (or ours). The sanctioned way to get a *new* org-level
building block is the **registry**: submit → admin approval → per-scope activation, which surfaces the approved
primitive into the builder for the chosen programme/project — a governed promotion, not a silent fork.

**RBAC over the tree.** Who may read or write each node is enforced on two axes, both fixed in code
(principle 7):

- **Write authority** — the route gates a def write by scope: org/programme defs need governance authority
  (pmo / a programme's manager), a project def needs project-manage rights, a user def only the user; and
  `def-policy` governs *which kinds* a given role may author. Admin/PMO authority additionally requires strong
  auth (passkey step-up).
- **Read / data scope** — orthogonally, `resolveScope` bounds *which rows* a principal sees (`all` for
  pmo/admin, a manager's owned programmes, a user's own resources, a guest's single project), fail-closed for
  anything unattributable.

So the tree answers "what is the winning def here?" and RBAC answers "…and are you allowed to see or change
it?" — separately, and by the same rules everywhere.

The payoff: presets, org branding, a customer's bespoke screen and our monthly default update are all **the
same mechanism at different layers of one sealed JSON tree** — no per-customer code, no forked product, and
every override diffable, validated, and revocable.

## 16. Documented, tested, and mapped — the readability contract

Code is read far more than it is written, and an author's output — human or agent — is only trustworthy if the
next reader can audit it quickly. Three habits are **enforced**, not merely encouraged:

- **Every file has a title; every exported function has a comment.** A block comment at the top of each file
  says what the file does (the one thing it does); every exported function carries a comment saying what it
  does — a JSDoc directly above it, or a section/`//` header over a documented group. This is not decoration:
  it is the source the function map is built from. The `readability-guard` test fails the build when a file or
  an exported function is undocumented, so the rule can't quietly rot.
- **Every change ships with unit tests, and you fix what they find.** New or changed behaviour lands *with* the
  tests that pin it — in the same slice, not as a someday follow-up. Run the affected suites (and typecheck the
  package) before you call the work done. If a test surfaces an error, fixing it is the author's job **now**,
  before moving on to anything else — a red test you walked past is a regression you shipped. "It's unrelated"
  is a claim to verify, not a licence to skip; a genuinely pre-existing failure gets **stated plainly**
  (principle 10 / faithful reporting), never silently left for the next person to inherit.
- **The coverage gate is a per-slice floor, and debt is never allowed to accumulate.** The thresholds
  (statements / branches / functions / lines, enforced in CI) are a floor to stay above, not a target to reach
  later. New code lands at or above the floor in the **same PR** that adds it — a screen, a lib, a hook and its
  tests are one change. Do **not** stack feature work on a branch whose coverage gate is red: "we'll write the
  tests afterwards" is exactly how a whole phase of untested code becomes an audit backlog that someone has to
  claw back later. The gate runs per change precisely so that can't happen — keep it green as you go, and the
  debt never exists to pay down. Lowering a threshold to make a red gate pass is not an option; the fix is
  always the missing tests.
- **Keep the function map honest.** `docs/FUNCTION-MAP.md` is a *generated*, one-screen-per-package index of
  every file and exported function, collated from those same code comments and kept current by a CI drift guard
  — so it can never lie about the code. You don't hand-edit it; you improve the comment in the code and
  regenerate (`pnpm --filter @workspace/scripts run gen-function-map`). After adding or renaming a file or an
  exported function, regenerate the map **in the same change**, exactly as you regenerate a `*.generated.ts`
  after editing its JSON asset (principle 2). A stale map is a broken build, by design.

Why bundle these three: together they are the guarantee that the codebase stays **auditable by skimming** — a
good developer, or an agent picking up where another left off, can learn how the whole system is put together
from the map and the comments, trust that behaviour is pinned by tests, and never inherit a known-red state
someone chose not to fix.

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
