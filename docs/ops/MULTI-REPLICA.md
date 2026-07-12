# Running OmniProject multi-replica (horizontal scale)

OmniProject is built to run as **N stateless replicas behind a load balancer**.
Because the design holds no project data and no server-side session state, most of
horizontal scale is free — but a few in-process working sets need a shared
**fan-out** to behave correctly across replicas. This page is the checklist.

> **One knob turns it on:** set **`REDIS_URL`** and install the optional Redis
> clients. Without it, every replica runs correctly *in isolation* (the product
> still works); you only lose the cross-replica behaviours in the table below.

---

## 1. What's already replica-safe (no action needed)

| Concern | Why it just works |
| --- | --- |
| **Sessions / auth** | The session lives in the client cookie (sealed, AES-256-GCM) — no server-side session store, so any replica can serve any request. No sticky sessions required. |
| **Project data** | Stateless read-through to the backend on every request; nothing cached across requests by default. |
| **Settings / config** | The settings store is gateway config, written admin-gated; run it from a shared config source (env/secret/volume) so replicas agree. |
| **Broker round-robin / capability cache** | Per-replica by design — each replica load-balances its own broker pool and keeps its own short-TTL capability cache. Independent is correct here. |
| **Read cache** | Per-replica, off by default, short-TTL memoisation — divergence is harmless (it re-reads). |

## 2. What needs the shared bus (set `REDIS_URL`)

| Concern | Per-replica default (no Redis) | With `REDIS_URL` |
| --- | --- | --- |
| **Notifications** (SSE bell) | A notification ingested on replica A only reaches users connected to A | Redis Pub/Sub fans every ingest to all replicas → every connected user gets it (`lib/notify-bus.ts`) |
| **Admin live broker log** | The admin screen shows only the replica that served the SSE connection | Each entry is fanned out fleet-wide and folded into every replica's ring + live stream, tagged with the originating `replica` label (`lib/broker-log-bus.ts`) |
| **Rate limiting** | Counters are in-memory → the effective global ceiling is **N×** the configured limit | Counters move to a shared Redis store so the ceiling is enforced across the fleet (`lib/rate-limit.ts`) |

All three degrade **gracefully**: if `REDIS_URL` is unset, or the optional client
isn't installed, they log once and fall back to per-replica. Nothing crashes.

> **⚠️ NOT yet fleet-shared — per-replica even with `REDIS_URL`.** These security/lifecycle controls
> are held in each replica's memory (sealed to a local state file on the replica that served the admin
> call) and are **not** fanned out across the fleet, so a change on replica A does not take effect on
> B…N until those replicas reload:
>
> - **AI kill-switch** (`lib/ai-kill.ts`) — engaging/releasing writes through to shared state and every
>   replica converges on its fleet-sync tick (a few seconds), so with `REDIS_URL` set the break-glass
>   control is **fleet-wide**. In-process mode (no shared state) it is per-replica.
> - **Key/session revocation and maintenance lockdown** (`lib/security-state.ts`, `lib/key-registry.ts`)
>   — still per-replica: revoking a credential on one replica leaves the others running the prior state
>   until they reload.
> - **SCIM deprovisioning** (`active=false`) — the SCIM directory (`lib/scim.ts`) is loaded once per
>   replica; an IdP deactivation lands on one replica, so the user can still pass the gate on the others
>   until each reloads its directory.
>
> For the controls not yet routed through shared state, enforce them fleet-wide with a **rolling restart**
> after the change (or run a single admin replica for these actions). This gap is deliberately called
> out because `docs/COMPLIANCE.md`/`THREAT-MODEL.md`/`ENTERPRISE-OPS.md` describe these controls as taking
> effect "immediately" — that holds on the handling replica; fleet-wide immediacy needs shared state (AI
> kill-switch) or a rolling restart (the rest).

## 3. Enabling it

```bash
# 1. Point every replica at the same Redis
export REDIS_URL=redis://your-redis:6379

# 2. Install the runtime-optional clients (kept out of the default image so a
#    single-replica deploy carries zero extra deps)
pnpm --filter @workspace/api-server add ioredis rate-limit-redis

# 3. (optional) Give each replica a stable, human label for the broker log.
#    Defaults to a random short id per process if unset.
export REPLICA_ID=eu-west-1a-pod-7
```

Redis is the right tool here — ephemeral, fire-and-forget broadcast. If Kafka is
your backbone, bridge it into `/api/notifications/ingest` *upstream* of the bus
rather than replacing the bus.

## 4. Verifying the wiring

`GET /api/setup/status` reports the live fan-out modes so you can confirm scale
wiring at a glance (no guessing):

```jsonc
"scale": {
  "notifyBus":   "redis",       // or "in-process"
  "brokerLogBus":"redis",
  "rateLimit":   "redis"
}
```

All three should read `"redis"` once `REDIS_URL` + the optional clients are in
place. Any still showing `"in-process"` means that concern is running per-replica
— check the boot logs for the one-line fallback warning naming the missing piece.

## 5. Notes

- **Failure mode:** if Redis goes down at runtime, fan-out stops but each replica
  keeps serving from its own state — you lose cross-replica live updates and the
  global rate ceiling, not availability.
- **No data at rest in Redis:** the bus carries only ephemeral broadcasts
  (notifications, the already-redacted broker-log projection) and rate-limit
  counters — never project data or credentials. It is not a datastore concession;
  see `EGRESS-INVENTORY.md`.
- **Security self-check:** plain-`http://` broker and demo-auth warnings are
  unchanged under scale; the same `runSecuritySelfCheck` runs on every replica.
