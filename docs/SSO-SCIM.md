# Enterprise SSO (SAML) + SCIM provisioning runbook

This document is written to be handed to a **CISO / IAM engineer**. It covers, end to end:

1. how OmniProject fits an enterprise identity stack (the stateless-overlay model);
2. **SAML 2.0 SSO** setup (the config, the SP metadata, the assertion → role mapping);
3. **SCIM 2.0** user + group **provisioning**, and — just as important — **DEPROVISIONING**;
4. copy-paste **Okta / Microsoft Entra ID / Google Workspace** examples;
5. how an IdP group becomes an OmniProject role, identically for OIDC, SAML, and SCIM.

> **The one-paragraph mental model.** OmniProject is a **stateless overlay**. It does not own a
> user directory, passwords, or sessions — your IdP authenticates the user (OIDC **or** SAML),
> and the assertion's **group/role claims** are mapped onto OmniProject's five fixed roles. SCIM
> is a thin **lifecycle overlay** on top: it lets the IdP **deprovision** a user (deny at the
> gate even with a still-valid token) and **sync group→role** membership out of band. Nothing
> here grants access to your systems of record — every brokered write still carries the user's
> own token and is authorised by the backend.

---

## 0. Which sign-in path should I use?

| Path | When | Per-user backend token? | Enable with |
|---|---|---|---|
| **OIDC** (recommended) | Your IdP speaks OIDC (Okta, Entra, Keycloak, Auth0, Google) | **Yes** — brokered writes carry the user's token | `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, … |
| **SAML 2.0** | Your IdP is SAML-only (many ADFS / legacy Entra / Okta app setups) | No — identity + RBAC only; writes use the broker's credentials | `SAML_*` (this doc) |
| **SCIM 2.0** | You want IdP-driven provisioning / **deprovisioning** and group→role sync | n/a (runs alongside OIDC or SAML) | `SCIM_TOKEN` (this doc) |

SAML and OIDC can be configured **simultaneously**; they sit behind the same auth seam and mint
the same session cookie. SCIM is independent of both and complements either.

> **Honest scope of SAML.** A SAML assertion authenticates the user to the **gateway** and drives
> RBAC; it does **not** mint a per-user backend bearer token, so brokered writes use the broker's
> own credentials (the same posture as demo/magic-link). If you need per-user backend tokens, use
> **OIDC**.

---

## 1. SAML 2.0 SSO

### 1.1 Enable the provider library (one-time)

The SAML library `@node-saml/node-saml` is a **runtime-optional** dependency: a default install
never pulls it, so OIDC / demo / charity deployments carry zero extra weight. Install it on the
gateway only when you intend to run SAML:

```bash
pnpm --filter @workspace/api-server add @node-saml/node-saml
```

If SAML is configured but the library is absent, the gateway **does not crash** — SAML endpoints
return `503` and OIDC/demo keep working. A one-time warning logs the exact install command.

### 1.2 Configure (env)

SAML turns on when the **three required** vars are present. Every other var has a sensible
default. A **partially** configured SAML (some but not all requirements) stays **disabled** and
is flagged loudly — at boot (a `warn` log naming the missing vars), in `GET /api/auth/me`
(`samlStatus.missing`), and, in production, as a fatal boot issue via the env check.

| Env var | Required | Default | Notes |
|---|---|---|---|
| `SAML_IDP_ENTRY_POINT` | ✅ | — | The IdP's SSO redirect URL (`SAML_ENTRY_POINT` is an accepted alias). |
| `SAML_IDP_CERT` | ✅ | — | The IdP's **signing** certificate: PEM, or base64-of-PEM (env-friendly, no newlines). |
| `SAML_CALLBACK_URL` | ✅¹ | `${PUBLIC_URL}/api/auth/saml/callback` | Our ACS URL. ¹Satisfied by `PUBLIC_URL` alone. |
| `SAML_SP_ENTITY_ID` | | `PUBLIC_URL`, else `omniproject` | Our SP entityID / issuer. |
| `SAML_AUDIENCE` | | the SP entityID | Expected assertion audience. |
| `SAML_EMAIL_ATTR` | | `email` | Attribute holding the user's email. |
| `SAML_NAME_ATTR` | | `displayName` | Attribute holding the display name. |
| `SAML_GROUPS_ATTR` | | `groups` | Attribute holding the **group/role** values → RBAC (see §3). |
| `SAML_WANT_RESPONSE_SIGNED` | | `false` | Also require the `<Response>` signed. The **assertion is always required signed** regardless. |

Minimal example:

```bash
PUBLIC_URL=https://omni.example.com
SAML_IDP_ENTRY_POINT=https://example.okta.com/app/omniproject/exk.../sso/saml
SAML_IDP_CERT=MIIDpDCCAoyg...            # base64-of-PEM is fine
SAML_GROUPS_ATTR=groups
# map the IdP groups to roles (shared with OIDC — see §3):
OIDC_ADMIN_ROLES=omni-admins
OIDC_PMO_ROLES=programme-managers
OIDC_MANAGER_ROLES=delivery-leads
```

### 1.3 SP endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/saml/login` | GET | SP-initiated login → redirects to the IdP. `?returnTo=/path` round-trips via RelayState. |
| `/api/auth/saml/callback` | POST | **ACS** — the IdP POSTs the signed `SAMLResponse` here (HTTP-POST binding). |
| `/api/auth/saml/metadata` | GET | **SP metadata XML** — hand this to your IdP admin to auto-configure the integration. |

Security posture: the assertion signature, audience, and conditions are validated by
`@node-saml/node-saml`; SHA-256 signature/digest; `disableRequestedAuthnContext`. The ACS POST is
CSRF-exempt **only** for the no-session first login (its trust rests entirely on the signed
assertion). Sanitised `returnTo` prevents open redirects.

### 1.4 IdP configuration values

Give your IdP admin:

- **ACS / Reply URL / SSO URL:** `https://<your-host>/api/auth/saml/callback`
- **SP Entity ID / Audience / Issuer:** your `PUBLIC_URL` (or `SAML_SP_ENTITY_ID`)
- **NameID format:** email address (recommended) or persistent
- **Attribute statements:** `email`, `displayName`, and a multi-valued **`groups`** attribute
  (or set `SAML_*_ATTR` to your IdP's chosen names / URNs).

> Tip: `GET /api/auth/saml/metadata` emits the SP metadata XML so most IdPs configure the above
> automatically from a URL/upload.

---

## 2. SCIM 2.0 provisioning + deprovisioning

### 2.1 Enable

SCIM turns on **only** when `SCIM_TOKEN` is set (the bearer the IdP presents). The token must be
long/random; in production it must be **≥ 24 chars** (enforced at boot — it can deprovision every
user).

```bash
SCIM_TOKEN=$(openssl rand -hex 32)
# SCIM_STATE_FILE=  # optional; defaults to <OMNI_CONFIG_DIR>/scim.json (sealed at rest)
```

- **Base URL (give this to the IdP):** `https://<your-host>/api/scim/v2`
- **Auth:** `Authorization: Bearer <SCIM_TOKEN>` (constant-time checked; bad token → `401`,
  disabled → `404`).
- The small users/groups directory is held in memory and persisted **sealed** (AES-256-GCM), so
  provisioning survives a restart. Every mutation is **audited** (`scim.user.*`, `scim.group.*`).

Supported: `Users` and `Groups` (create/read/replace/**patch**/delete/list with `attr eq "…"`
filters), plus `ServiceProviderConfig`, `ResourceTypes`, `Schemas`. Patch is the operation IdPs
lean on most (toggling `active`, adding/removing group members).

### 2.2 What SCIM actually controls (the overlay)

Because OmniProject is stateless, SCIM does **not** own passwords or sessions. At request time the
directory contributes exactly two things (`directoryDecision`):

1. **`active=false` ⇒ DENY.** A user the IdP has marked inactive is refused **at the gate even
   with a valid OIDC/SAML token**, and any open notification stream is closed with a `revoked`
   event. This is the hard **deprovisioning** control.
2. **Group membership ⇒ role claims.** A user's SCIM group display names are merged into their
   role claims and resolved through the **same** role map as OIDC/SAML (see §3) — so assigning a
   user to a group in the IdP grants the mapped OmniProject role without re-issuing tokens.

A user the directory has **never seen** yields *no opinion* — access falls back to pure OIDC/SAML.

### 2.3 Provisioning lifecycle (happy path)

1. **Assign** the user to the OmniProject app in your IdP → IdP sends `POST /Users`
   (`active:true`). User can now sign in via OIDC/SAML.
2. **Group assignment** → IdP sends `POST /Groups` and/or `PATCH /Groups/:id` (`add members`) →
   the user gains the mapped role at their next request.
3. **Profile/name change** → `PUT`/`PATCH /Users/:id`.

### 2.4 DEPROVISIONING runbook (the part that matters)

> **Golden rule:** deprovisioning is driven by the **IdP**, and OmniProject **honours it at the
> gate**. You do not need to touch OmniProject to revoke a leaver — remove them in the IdP and
> SCIM propagates the denial. Verify below.

**Standard leaver (soft deprovision — recommended):**

1. In the IdP, **unassign** the user from the OmniProject app (or disable/offboard them).
2. The IdP sends `PATCH /Users/:id` with `active:false` (Okta/Entra do this on unassignment).
3. OmniProject immediately: denies the user at the gate (even with an unexpired session/token),
   closes their live streams, and audits `scim.user.patch` with `active:false`.
4. **Verify:** `GET /api/scim/v2/Users?filter=userName eq "user@corp.com"` → the user shows
   `active:false`. (Optionally confirm a `403`/redirect on their next app request.)

**Hard delete:** some IdPs send `DELETE /Users/:id` instead of deactivating. That removes the
record entirely; the user then reverts to "unknown" (no SCIM opinion) — so if you rely on the
**deny** behaviour, prefer IdP settings that **deactivate** rather than delete, or also remove the
user from the OIDC/SAML app so they can no longer authenticate at all.

**Emergency / IdP-down manual revoke:** with the SCIM token, deactivate directly:

```bash
curl -sS -X PATCH https://<host>/api/scim/v2/Users/<id> \
  -H "Authorization: Bearer $SCIM_TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
       "Operations":[{"op":"replace","path":"active","value":false}]}'
```

(For a full account lockout independent of SCIM, also revoke the user's sessions via the security
admin controls / IdP session revocation.)

**Group removal (drop a role without offboarding):** `PATCH /Groups/:id` with
`{"op":"remove","path":"members","value":[{"value":"<userId>"}]}` → the user keeps access but
loses that group's mapped role at the next request.

---

## 3. How a group becomes a role (identical across OIDC, SAML, SCIM)

All three protocols funnel their group/role values into **one** pure resolver
(`grantsFromClaims` in `lib/rbac`) against **one** operator-configured role map — so a
"group → role" decision is made once and honoured everywhere. (A regression test,
`sso-role-parity.test.ts`, pins this: the same group string yields identical grants whether it
arrives via an OIDC claim, a SAML assertion, or a SCIM group.)

```
OIDC id-token roles ─┐
SAML assertion groups ┼─▶  (lower-cased group names)  ─▶  grantsFromClaims()  ─▶  Grants
SCIM group memberships ┘        against OIDC_*_ROLES / admin role-map override
```

**The five fixed roles** (the RBAC boundary is static in code — SSO can only assign IdP groups to
these; it can never invent a role or a permission):

- **Base ladder:** `viewer` < `contributor` < `manager`.
- **Two orthogonal authorities above manager:** `pmo` (business governance) and `admin`
  (technical config). Neither implies the other; a person can hold neither, either, or both.

**Map your IdP groups** via env comma-lists (a group may appear in several — grants are the
**union**). These are also editable at runtime by an admin via the role-map editor
(`PUT /api/admin/role-map`), which overrides the env base:

```bash
OIDC_ADMIN_ROLES=omni-admins,platform-admins
OIDC_PMO_ROLES=pmo,programme-managers
OIDC_MANAGER_ROLES=delivery-leads
OIDC_CONTRIBUTOR_ROLES=
OIDC_VIEWER_ROLES=stakeholders
OIDC_DEFAULT_ROLE=contributor   # authenticated user with no matching group
```

> The env prefix is `OIDC_` for historical reasons, but the map governs **all** protocols — a
> SAML `groups` value and a SCIM group `displayName` of `omni-admins` both confer `admin`.

---

## 4. IdP recipes

### 4.1 Okta

**SAML app:**
1. Admin → Applications → Create App Integration → **SAML 2.0**.
2. Single sign-on URL / ACS: `https://<host>/api/auth/saml/callback` (or import
   `/api/auth/saml/metadata`).
3. Audience URI (SP Entity ID): your `PUBLIC_URL`.
4. NameID format: **EmailAddress**.
5. Attribute Statements: `email` → `user.email`, `displayName` → `user.displayName`.
6. Group Attribute Statements: name **`groups`**, filter *Matches regex* `.*` (or your naming).
7. Copy the **X.509 signing cert** → `SAML_IDP_CERT`; copy the **Identity Provider SSO URL** →
   `SAML_IDP_ENTRY_POINT`.

**SCIM:** in the app's **Provisioning** tab → *Configure API Integration* →
Base URL `https://<host>/api/scim/v2`, token `$SCIM_TOKEN`. Enable **Create / Update / Deactivate
Users** and **Push Groups**. Okta sends `active:false` on unassignment (soft deprovision).

### 4.2 Microsoft Entra ID (Azure AD)

**SAML:** Enterprise applications → New application → *Create your own* → **SAML**.
1. Basic SAML config: **Reply URL (ACS)** `https://<host>/api/auth/saml/callback`;
   **Identifier (Entity ID)** = your `PUBLIC_URL`.
2. Attributes & Claims: emit `email`, `displayName`, and a **`groups`** claim (Group Claims →
   *Groups assigned to the application*; emit **group names** if you map by name, else map the
   object IDs in `OIDC_*_ROLES`).
3. SAML Signing Certificate: download **Certificate (Base64)** → `SAML_IDP_CERT`; copy **Login
   URL** → `SAML_IDP_ENTRY_POINT`.

**SCIM:** the same enterprise app → **Provisioning** → Automatic → Tenant URL
`https://<host>/api/scim/v2`, Secret Token `$SCIM_TOKEN` → *Test Connection* → set mappings for
Users and Groups. Unassigning/disabling a user sends `active:false` (soft deprovision).

### 4.3 Google Workspace

**SAML:** Admin console → Apps → Web and mobile apps → Add custom SAML app.
1. Copy Google's **SSO URL** → `SAML_IDP_ENTRY_POINT` and **Certificate** → `SAML_IDP_CERT`.
2. Service provider details: **ACS URL** `https://<host>/api/auth/saml/callback`; **Entity ID** =
   your `PUBLIC_URL`; Name ID = **EMAIL**.
3. Attribute mapping: Primary email → `email`; add a group/role attribute → **`groups`** (Google
   *Group membership* mapping) if you drive RBAC from Google groups.

**SCIM / provisioning:** Google provides autoprovisioning for supported apps; for a custom app use
the SCIM endpoint above with a directory-sync tool, or provision manually via the SCIM API. Group
membership emitted as the `groups` SAML attribute already drives RBAC without SCIM.

---

## 5. Verification checklist

- [ ] `GET /api/auth/me` shows `samlConfigured:true` and `samlStatus.configured:true` (or
      `samlStatus.missing` lists exactly what's absent).
- [ ] `GET /api/auth/saml/metadata` returns SP XML (library installed + configured).
- [ ] A test user in an admin group signs in via `/api/auth/saml/login` and lands with the
      **admin** authority (`/api/auth/me` → `role`).
- [ ] `GET /api/scim/v2/ServiceProviderConfig` returns `200` with a valid `SCIM_TOKEN`, `401`
      with a bad one, `404` when SCIM is disabled.
- [ ] Deprovision a test user in the IdP → `Users?filter=userName eq "…"` shows `active:false` →
      that user is denied at the gate.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/auth/saml/login` → `404` | SAML not (fully) configured | Check `samlStatus.missing`; set the missing `SAML_*` env. |
| `/api/auth/saml/login` → `503` | Library not installed | `pnpm --filter @workspace/api-server add @node-saml/node-saml`. |
| Callback → `401 invalid assertion` | Wrong `SAML_IDP_CERT`, audience, or clock skew | Re-copy the IdP signing cert; set `SAML_AUDIENCE`; sync NTP. |
| User signs in but has only default role | Group attribute name/values don't match the map | Set `SAML_GROUPS_ATTR`; align `OIDC_*_ROLES` with the IdP group names. |
| SCIM calls → `404` | `SCIM_TOKEN` unset | Set it (≥ 24 chars in prod). |
| Deprovisioned user still gets in | IdP **deleted** (not deactivated) the record | Prefer deactivate; also remove them from the SSO app. |

---

*Related: `docs/ENTERPRISE-OPS.md` (data map, DSAR, DR), `docs/TECHNICAL.md`, `docs/THREAT-MODEL.md`.*
