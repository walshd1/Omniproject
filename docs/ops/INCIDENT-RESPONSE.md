# Incident response — admin impersonation & session compromise

This runbook answers one question: **a bad actor is impersonating an admin (a stolen or replayed admin
session, a phished admin login, an over-broad IdP group) — what do we do?** It assumes breach and aims
to minimise blast radius. Every control here is designed so you can act even when you can't trust the
admin identity itself.

## The layered model (what's already stopping them)

Impersonation is contained at several independent layers, so a single failure isn't game over:

| Layer | Control | What it stops |
|---|---|---|
| **Authentication** | Session cookie is AES-256-GCM sealed + HMAC-signed, `HttpOnly` + `Secure` + `SameSite=Lax` | Forging a session; reading/stealing it via XSS/CSRF |
| **Replay** | Rotating-token **sequence** (`SESSION_SEQUENCE_ENFORCE`) | A captured cookie used out-of-order → the session forks → **killed for all holders, fleet-wide** |
| **Lifetime** | Short idle (15m) + absolute (4h) caps | A captured-but-idle cookie dies fast; an active one is force-re-authed within a half-day |
| **Authority** | `hasStrongAuth` — admin/pmo requires phishing-resistant MFA (WebAuthn/FIDO2 `amr`) | A phished password+OTP admin login does **not** get admin authority |
| **Step-up** | Highest-risk actions demand a fresh, genuine re-auth (no self-stamp) | A mere cookie-holder can't reach key revocation, egress/governance, the raw escape hatch |
| **Sensitive-action** | Four-eyes (dual control) on the most destructive actions | One compromised admin can't act alone |
| **Backend** | The systems of record enforce their own authz on every brokered write | The gateway session can't exceed what the backend already allows |
| **Detection** | Impossible-travel flags anomalous logins → forces step-up; tamper-evident audit chain | Anomalies surface; actions are non-repudiably logged |

## If you suspect an admin is impersonated — act now

**1. Break-glass lockdown (works even if you can't trust any admin login).**
Break-glass is authenticated by `BREAK_GLASS_TOKEN` — a local secret held out-of-band, **not** by the
IdP — so it works when the admin identity is exactly what's in doubt. It can *only* contain (lock down
+ rotate keys) or release; it can never read or change data, so its worst case if the token itself
leaks is a self-inflicted denial-of-service, not a breach.

```
curl -X POST https://<host>/api/break-glass/lockdown \
  -H "X-Break-Glass-Token: $BREAK_GLASS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"admin impersonation suspected"}'
```

This does two things fleet-wide (via the shared-state / key-registry sync):
- engages **read-only maintenance mode** — every write is refused; reads keep working; and
- **rotates the session key** — invalidating *every* session, including the impersonator's. Everyone
  (including you) must sign in again.

Confirm: `GET /api/break-glass/status` (same token) shows `maintenance: true` and a bumped
`sessionKeyVersion`.

**2. Investigate while frozen.** Reads still work. Pull the tamper-evident **audit chain** (stdout/SIEM)
for the suspect actor's actions and the impossible-travel flags around the login. Nothing can be
mutated while locked down, so the picture can't be tampered with.

**3. Remove the foothold** (once you can sign in cleanly, ideally from a known-good admin with a
hardware key):
- If an over-broad or compromised **IdP group** granted the authority: revoke it in the role-map editor
  (`PUT /api/admin/role-map`) — the change is now durable and propagates fleet-wide.
- Revoke the specific principal's sessions (`POST /api/security/sessions/revoke-user`) and/or rotate
  keys again (`POST /api/security/keys/session/revoke`).
- If the AI/autonomous surface was involved, engage the AI kill-switch and tighten the containment
  relax-floor / approved-actions — all now fleet-consistent.
- In your IdP: disable/rotate the compromised account; SCIM deprovisioning denies it at the gate
  fleet-wide.

**4. Release** once the foothold is gone:
```
curl -X POST https://<host>/api/break-glass/release -H "X-Break-Glass-Token: $BREAK_GLASS_TOKEN"
```
Sessions rotated during lockdown stay invalidated (rotation is monotonic) — users simply sign in again.

## Hardening so impersonation is hard in the first place

- **Require phishing-resistant MFA** for admin/pmo at the IdP, and pin `OIDC_STRONG_AMR_VALUES` /
  `OIDC_STRONG_ACR_VALUES` to values only your real authenticators emit. This is the single biggest
  lever: it means a phished credential is not enough to wield admin.
- **Keep sessions short** (the defaults: 15m idle / 4h absolute) and **sequencing on** (the default).
- **Set `BREAK_GLASS_TOKEN`** (`openssl rand -hex 32`) and store it out-of-band (sealed envelope /
  password manager), separate from any operator's day-to-day access. Test the runbook.
- **Run with `SECURITY_STATE_FILE`** so revocations/lockdowns survive a restart, and — for >1 replica —
  **Redis**, so all of the above propagate fleet-wide (the `/readyz` probe fails closed without it).
- **Enable four-eyes** (`DUAL_CONTROL_ACTIONS`) on the most destructive actions.

## Residual limit (worth knowing)

If the **IdP itself is fully compromised** (the attacker controls it and can mint tokens with any
claims, including a forged phishing-resistant-MFA assertion), no gateway logic can fully trust it. Your
backstops then are the IdP-independent controls: `BREAK_GLASS_TOKEN` lockdown, rotating `SESSION_SECRET`
(invalidates every session on the next deploy/restart), the backend systems' own authorization, and the
tamper-evident audit trail for forensics. Treat IdP key compromise as a top-tier incident with its own
IdP-vendor runbook.
