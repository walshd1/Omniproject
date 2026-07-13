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
> - **Key/session revocation** (`lib/key-registry.ts`) — revoking a key version or a user's sessions
>   writes the union of local + shared revocation state back to shared, and every replica pulls it in on
>   its fleet-sync tick (a few seconds), so with `REDIS_URL` set a revocation is **fleet-wide**. The merge
>   is monotonic (a version, once revoked, stays revoked; a user's cut-off only moves forward), so a
>   shared-state blip or a racing writer can only ever add revocations, never un-revoke. In-process mode
>   it is per-replica.
> - **SCIM deprovisioning** (`active=false`) — the SCIM directory (`lib/scim.ts`) write-throughs every
>   mutation to shared state, and each replica pulls it in on its fleet-sync tick (a few seconds), so with
>   `REDIS_URL` set an IdP deactivation landing on ANY replica denies the user at the gate **fleet-wide**.
>   A directory is not monotonic (a later reactivation must win), so the merge is per-record
>   last-writer-wins keyed on `meta.lastModified`, with tombstones for hard deletes. In-process mode it is
>   per-replica.
> - **Maintenance lockdown** (`lib/maintenance.ts`) and the durable security-state file
>   (`lib/security-state.ts`) — still per-replica: engaging maintenance on one replica leaves the others
>   serving until they reload.
>
> For the controls not yet routed through shared state (maintenance lockdown, SCIM), enforce them
> fleet-wide with a **rolling restart** after the change (or run a single admin replica for these
> actions). This gap is deliberately called out because `docs/COMPLIANCE.md`/`THREAT-MODEL.md`/
> `ENTERPRISE-OPS.md` describe these controls as taking effect "immediately" — that holds on the handling
> replica; fleet-wide immediacy comes from shared state (the AI kill-switch and key/session revocation
> with `REDIS_URL` set) or, for the rest, a rolling restart.

## 3. Enabling it

```bash
# 1. Point every replica at the same Redis
export REDIS_URL=redis://your-redis:6379

# 2. Use a Redis-enabled image. The clients are runtime-optional and kept OUT of the
#    default image so a single-replica deploy carries zero extra deps; bake them in
#    with a build arg — no source edit, no committing the deps, default build unchanged:
docker build --build-arg WITH_REDIS=1 -t your-registry/omniproject-shell:TAG-redis .
#    (For a local/dev process rather than the image, the equivalent is:
#     pnpm --filter @workspace/api-server add ioredis rate-limit-redis)

# 3. (optional) Give each replica a stable, human label for the broker log.
#    Defaults to a random short id per process if unset.
export REPLICA_ID=eu-west-1a-pod-7
```

> **Why a build arg, not the default image?** The gateway loads `ioredis` /
> `rate-limit-redis` via runtime-optional dynamic import, and the runtime image ships only
> the esbuild bundle (no `node_modules`) — so a default image can't use `REDIS_URL` even
> when set. `--build-arg WITH_REDIS=1` installs the clients into the image's `/app/node_modules`
> (where the bundle resolves them) so scaling out needs **no bespoke rebuild** and the lean
> default is preserved.

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

## 6. The automation backend (n8n) is a separate scale story

The gateway is stateless and scales as above, but the **n8n automation backend** shipped in
`k8s-enterprise-manifest.yaml` / the compose files defaults to **SQLite on a ReadWriteOnce PVC**.
That is deliberately simple for a starter deploy, but it is a **single point of failure**: it is
single-instance (a second replica can't attach the RWO volume and SQLite has no shared-write
story), and a node/PVC loss takes the automation backend down with no standby. The manifest pins
`replicas: 1` and `strategy: Recreate` accordingly (a RollingUpdate would deadlock on the RWO
volume).

To make the automation backend highly available, move it off SQLite:

```bash
# On the n8n Deployment: swap the DB driver and point it at a managed/replicated Postgres,
# then drop the PVC and raise replicas + add a PodDisruptionBudget.
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=your-postgres-host
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=…            # from a Secret, not inline
# (queue mode with EXECUTIONS_MODE=queue + a Redis broker is n8n's fully-HA topology;
#  Postgres alone already removes the single-writer PVC SPOF.)
```

This is a **deployment choice**, not a gateway change — OmniProject holds no automation state
itself, so the gateway replicas above are unaffected by which n8n topology you run.
