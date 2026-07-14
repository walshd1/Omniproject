# Raw broker passthrough — the escape hatch of last resort

> ## ⚠️ HEALTH WARNING — read this before enabling
> `POST /api/admin/raw` forwards an **arbitrary action + payload straight to your
> configured broker**, deliberately **bypassing the typed contract, capability
> gating, and the business ruleset**. There is **no safety net**: a malformed
> action, a destructive payload, or a backend quirk goes through unchecked. It can
> mutate or destroy real data. **Do not enable it unless you have exhausted every
> other option, and turn it back off when you're done.**

## When (not) to use it

Use it only when the supported paths genuinely cannot express what you need against
a one-off / legacy backend. In order of preference, reach for these **first**:

1. A **typed route** (`/api/projects/...`, `/api/...`) — validated, gated, audited.
2. The **generic command edge** `/api/broker/command` (manager-gated, still
   goes through the broker but with the normal envelope).
3. A proper **backend mapping** in your broker/workflow (the durable fix).

The raw hatch is the thing you use once, under supervision, to unblock yourself —
not a place to build on.

## What it does and does NOT relax

**Still enforced (the hard floor is intact):**

- **Admin only** — `requireRole("admin")` (the technical authority; a PMO can't).
- **Off by default** — does nothing unless `RAW_API_ENABLED` is set; otherwise it
  returns `503` and the surface effectively doesn't exist.
- **Rides the broker seam** — it calls your already-configured, SSRF-guarded broker
  URL. The caller **cannot name a URL**, so this is *not* an SSRF/relay primitive.
- **Forwards the user's own bearer** — the backend authorises the call as them, and
  **every call is audited** (`raw_api:<action>`, `write: true`).
- Client-supplied `userContext`/`origin` are stripped (identity comes from the
  validated session, as on `/broker/command`).

**Bypassed (the "raw" / last-resort part, by design):**

- the **zod request contract** — any action string + arbitrary JSON payload;
- **capability gating** — it won't first check the backend claims to support it;
- the **business ruleset** — no require-field / freeze / no-delete checks.

## Enabling + using

```bash
# 1. Opt in (off by default). Turn it OFF again when finished.
export RAW_API_ENABLED=1

# 2. As an admin session, forward a raw action:
curl -s https://omni.example.com/api/admin/raw \
  -H "cookie: <admin session>" -H "content-type: application/json" \
  -d '{"action":"some_backend_action","payload":{"foo":"bar"}}'
# → { "warning": "⚠️ RAW passthrough: …", "action": "some_backend_action", "data": … }
```

Responses carry an `X-OmniProject-Raw-Warning` header and a `warning` field. Disabled
returns `503`; demo mode (no broker wired) returns the broker-unavailable error.
