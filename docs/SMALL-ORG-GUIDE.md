# SMEs, charities & self-hosters — running OmniProject without the enterprise weight

OmniProject is built **opt-in-hardened**: every advanced control (SSO, SCIM, KMS, IP
allowlist, session caps, maker-checker) is **off by default**, and the product runs fully
without any of them. This guide is the small-org counterpart to `docs/AI-SECURITY.md` /
`docs/ENTERPRISE-OPS.md` — what you actually need, and what you can safely skip.

## Why this exists (for you specifically)

README's "Why OmniProject exists" names three things: tool sprawl, nobody trusting a
second copy of their data, and migration risk killing the project before it starts. For
a charity or small team, all three show up sharper than anywhere else. You can't
justify a fourth subscription just to see status across the spreadsheet, the Trello
board and whatever the last grant-funded project set up in Jira. You definitely can't
risk a tool that quietly becomes a new place donor, volunteer or beneficiary data
lives — a new thing to secure, and a new place it could leak from if a subscription
lapses or a volunteer moves on. And nobody's getting buy-in to migrate off whatever's
already limping along, however messy, just to get one dashboard. OmniProject's answer —
no database of its own, every read/write live against what you already use — is exactly
why the "opt-in-hardened" claim above is real rather than a marketing line: there's
genuinely nothing sensitive sitting in OmniProject waiting to be secured until you
choose to turn something on, so skipping SSO/SCIM/KMS isn't a corner cut, it's a
control that had nothing to guard in the first place.

## TL;DR — the smallest real deployment

```
DEPLOYMENT_PROFILE=self-hosted     # or nonprofit
SESSION_SECRET=<long random string>   # the one secret you must set
PORT=8080
# No OIDC, no broker URL, no licence, no KMS — all optional.
```

That boots, serves **plain HTTP on your LAN** (sessions keep working — no broken secure
cookies), authenticates in demo mode, and shows sample data until you wire a backend. Nothing
is stored at rest beyond your encrypted config.

## Pick your type in the Configurator

The **Configurator** opens with **“Choose your deployment type”** — a card per customer type
(Enterprise · Business/SME · Non-profit/charity · Self-hosted · Demo) showing what each one
relaxes and the env it suggests. Picking one persists the choice (admins). For a permanent,
boot-time setting also set `DEPLOYMENT_PROFILE` in your environment (it stays authoritative
across a fresh start).

## The deployment profile

`DEPLOYMENT_PROFILE` tells the gateway your context so the couplings that exist for enterprises
don't get in your way. Strict → relaxed: `enterprise · business (default) · nonprofit ·
self-hosted · demo`. It only changes two things; **everything else is identical** and opt-in.

| Coupling | enterprise / business | nonprofit / self-hosted / demo |
|---|---|---|
| **TLS** (secure cookies + HSTS) | required in production | **HTTP-on-LAN is fine** — no secure-cookie breakage |
| **No SSO** (demo auth = everyone admin) | a **critical** finding — **refuses to boot** by default | an **accepted choice** (warn/info), boots fine |

Overrides if you want finer control: `PUBLIC_TLS=1/0` forces the TLS posture either way;
`ACCEPT_DEMO_AUTH=1` accepts no-SSO on any profile. The active profile + every relaxation is
shown to admins at **Settings → Deployment profile** and `GET /api/setup/profile`, so the
choices are visible, not accidental.

## What each kind of org typically needs

### Self-hoster / homelab
- `DEPLOYMENT_PROFILE=self-hosted`, set `SESSION_SECRET`, run on HTTP behind your home network.
- One admin? Demo auth is fine. Multiple people? Use the **bundled IdP** (Authentik ships in
  `docker-compose.standalone.yml`) for real accounts + roles — still self-contained, no cloud.
- Remote access? Put any TLS reverse proxy in front and set `PUBLIC_TLS=1` (or
  `DEPLOYMENT_PROFILE=business`).

### Charity / non-profit
- `DEPLOYMENT_PROFILE=nonprofit`. Staff need individual accounts + roles → use the bundled IdP
  (no corporate IdP required); map your groups to roles with `OIDC_*_ROLES`.
- All premium features are **free** (`PREMIUM_ENFORCEMENT` off) — branding, labels, webhooks,
  enterprise workflows included.
- Plain HTTP on a trusted LAN is accepted; enable HTTPS once you're reachable from outside.

### SME / small business
- `DEPLOYMENT_PROFILE=business` (the default). Configure OIDC SSO with whatever IdP you have
  (Google Workspace, Entra, Authentik…), serve over HTTPS, set `SESSION_SECRET` + `BROKER_PSK`.
  No OIDC IdP but already on **GitHub**? Use the OAuth2 path instead: set the `OAUTH2_*` env
  (the Configurator's GitHub preset pre-fills the endpoints) for "Sign in with GitHub".
- Turn on **only** the hardening you want — e.g. add a `MAX_SESSIONS_PER_USER` cap or an
  `IP_ALLOWLIST`; ignore SCIM/KMS/maker-checker unless you need them.

## What you can safely skip (and the consequence)

| Skip | Consequence | Fine for |
|---|---|---|
| OIDC / SSO | Demo auth: every session is admin | A single self-hoster / a closed LAN demo |
| HTTPS | Traffic + cookies in clear | A trusted LAN (use the profile so sessions don't break) |
| `BROKER_PSK` | Only needed once you connect a real broker | Demo / sample-data mode |
| SCIM, KMS, IP allowlist, session caps, maker-checker | No effect — they're off by default | Everyone until you want them |
| Premium licence | None — features are free | Everyone (pre-community) |
| A SIEM | Audit goes to stdout (still hash-chained) | Small deployments; scrape later if needed |

## When to harden (and the one-line switch)

| You now… | Turn on |
|---|---|
| have more than one user | the bundled IdP, or `OIDC_ISSUER_URL` |
| are reachable from the internet | HTTPS + `DEPLOYMENT_PROFILE=business` (or `PUBLIC_TLS=1`) |
| handle sensitive data | `IP_ALLOWLIST`, `MAX_SESSIONS_PER_USER`, ship audit to a SIEM |
| have compliance obligations | `KMS_PROVIDER`, `DUAL_CONTROL_ACTIONS`, SCIM (boot refusal on a critical finding is already the default) |

You never have to adopt the enterprise surface to run OmniProject — you grow into it.
