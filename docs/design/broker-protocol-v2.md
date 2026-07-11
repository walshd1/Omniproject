# Broker Protocol v2 — rollout spec

Status: **Proposed** · Supersedes parts of `docs/BROKER-HTTP-BINDING.md` (v1) · Owner: platform-security

This spec closes three residual findings from the 2026-07 audit that were deliberately deferred
because each one changes the **gateway↔broker wire format** and would break any external broker built
to the published v1 binding. It defines the v2 wire format, a capability-negotiated **dual-accept**
rollout that never breaks a v1 broker, and the test/guard/rollback plan to land it safely.

---

## 1. What v2 fixes (and the v1 gap each one closes)

| # | Finding (v1 gap) | Where it lives today | v2 change |
|---|------------------|----------------------|-----------|
| **F1** | **PSK key has no domain separation.** `p1.` seals under `deriveKeyCached(BROKER_PSK)` = raw `SHA-256(secret)` — the module's own *legacy* KDF. Any other subsystem that ever hashes the same secret the same way derives the identical key. | `lib/broker-psk.ts` → `key()` → `deriveKeyCached`; broker mirror in `reference-broker-blueprint.ts` `openPsk()` | Seal under `deriveKey(BROKER_PSK, "broker-psk/v2")` (HKDF-SHA256, domain-labelled). New token prefix **`p2.`**. |
| **F2** | **Session binding leaks in cleartext on a plaintext hop.** `X-Omni-Bind-Sub` (the username), `-Mono`, `-Salt`, `-Kver` travel as cleartext HTTP headers *even when the body is PSK-sealed* — defeating the one scenario PSK exists for (`tcpdump` sees ciphertext, but still sees `sub`). | `broker/reference-broker/index.ts:236-244` | When the envelope is sealed, carry bind material **inside** the sealed JSON, not as headers. Plaintext hop → identity no longer on the wire. |
| **F3** | **Signature covers only the body.** `X-Omni-Sig = HMAC(key, "<ts>.<nonce>.<rawBody>")`. Action, source-routing, idempotency-key and origin headers are **unsigned** — an on-path attacker can swap `X-OmniProject-Source` to reroute a write, or strip the bind headers to force a static-key downgrade, without invalidating the signature. | `lib/broker-hmac.ts` `sign()`; headers set in `reference-broker/index.ts` | Sign a **canonical request string** that binds method, action, source, idempotency-key, origin, ts, nonce, bind material, and a `sha256(body)`. |

A fourth, non-wire prerequisite falls out of F3:

- **F3a** — the reference broker **does not verify the signature at all today** (`processBrokerCall` ignores `X-Omni-*`; the binding doc calls them "additive headers … a broker that doesn't check them simply ignores them"). v2 ships a **reference verifier** (`verifyBrokerRequestV2`) wired into `processBrokerCall`, so conformance actually exercises it.

---

## 2. v2 wire format

### 2.1 Canonical signing string (F3)

```
v2\n
<METHOD>\n           # always POST today; included for future-proofing
<action>\n           # X-OmniProject-Action
<source>\n           # X-OmniProject-Source (empty string if absent)
<idempotencyKey>\n   # X-OmniProject-Idempotency-Key (empty if absent)
<origin>\n           # always "omniproject"
<ts>\n
<nonce>\n
<bindCanon>\n        # "" for static-key calls; else "sub\x1fsmono\x1fsalt\x1fbkver"
<sha256(rawBody) hex>
```

- Leading `v2\n` is a **domain tag** so a v2 signature can never be replayed as a v1 signature (and vice-versa) — different preimage space.
- `bindCanon` uses `\x1f` (unit separator) between fields; the fields are length-bounded by their existing validators, and `\x1f` cannot appear in a `sub`/UUID/hex value, so the encoding is unambiguous.
- `sha256(rawBody)` rather than the raw body keeps the signed string small and constant-size regardless of payload.

`X-Omni-Sig = HMAC-SHA256(key, canonicalString)`, hex. `key` is unchanged from v1: the per-session
derived key (`deriveSessionBrokerKey`) when bound, else the static `derivedKey("broker")`.

### 2.2 Sealed envelope carries binding (F2)

v1 sealed body: `{ "v": 1, "enc": "p1.<b64url>" }`, bind material in headers.

v2 sealed body: `{ "v": 2, "enc": "p2.<b64url>" }` where the **plaintext inside the seal** is:

```jsonc
{
  "body": <original request envelope>,
  "bind": { "sub": "...", "smono": "...", "salt": "...", "bkver": 3 }  // omitted for static-key calls
}
```

- The broker decrypts, lifts `bind` out, re-derives the session key, and verifies the signature — all
  from ciphertext-protected material. **No `X-Omni-Bind-*` headers are sent when sealed.**
- **Unsealed** v2 (no `BROKER_PSK`, TLS-only hop): bind still travels in `X-Omni-Bind-*` headers exactly
  as v1 — there is no confidentiality gain to be had without a seal, and TLS already covers the header.
  F2 only applies to the plaintext-hop-with-PSK case, which is precisely where the seal now carries it.

### 2.3 PSK domain separation (F1)

| | v1 (`p1.`) | v2 (`p2.`) |
|---|---|---|
| KDF | `SHA-256(BROKER_PSK)` (`deriveKeyCached`) | `HKDF-SHA256(BROKER_PSK, salt=omniproject/hkdf/v1, info="broker-psk/v2")` (`deriveKey`) |
| Cipher | AES-256-GCM, 96-bit IV | unchanged |
| Prefix | `p1.` | `p2.` |

`deriveKey`/HKDF is already implemented and used by config/vault/rate-card at-rest crypto — v2 just
adopts it for the PSK seam. The legacy `deriveKeyCached` stays only to open `p1.` during the window.

---

## 3. Capability negotiation (how a v1 broker never breaks)

The binding already has a handshake surface: the **`capabilities` action** and the **`verify`** ping.
v2 extends the capabilities response with a `protocol` block:

```jsonc
// broker → gateway, capabilities response
{
  "success": true,
  "data": {
    "issues": true, /* … existing capability flags … */
    "protocol": { "psk": ["p1", "p2"], "sig": ["v1", "v2"] }  // NEW, optional
  }
}
```

- **A v1 broker omits `protocol`.** The gateway reads "absent ⇒ `{ psk: ["p1"], sig: ["v1"] }`" and speaks v1. Zero change for existing brokers.
- The gateway picks, per broker, the **highest version present in BOTH** its own support list and the broker's advertised list, then caches it alongside the existing capabilities cache (same TTL/invalidation).
- An explicit override wins over negotiation: `BROKER_PROTOCOL = auto | v1 | v2` (default `auto`).

Negotiation runs on the **already-existing** capabilities probe — no extra round trip. Until the first
probe resolves, the gateway sends v1 (safe default).

---

## 4. Rollout phases

Each phase is independently shippable and reversible. No phase requires a coordinated
gateway+broker deploy; **v1 brokers keep working through every phase until Phase 4**, which is opt-in.

### Phase 0 — dual-accept, no behaviour change (gateway + reference broker)
- Land `sealPayloadV2`/`openPayloadV2` (`p2.`), `signBrokerRequestV2`/`verifyBrokerRequestV2`, and the canonical-string builder in `lib/`.
- Reference broker (`reference-broker-blueprint.ts`, `reference-sidecar.ts`) **accepts BOTH** `p1.`/`p2.` and, when `X-Omni-Sig` is present, verifies it under v1 **or** v2 by detecting the `v2\n` tag / `p2.` prefix.
- Gateway still **emits v1**. `protocol` capability is advertised by the reference broker but not yet consumed.
- Net effect on the wire: nothing changes. This phase is pure additive code + tests.

### Phase 1 — negotiation on, gateway emits v2 to v2-capable brokers
- Gateway consumes `protocol` from capabilities and emits v2 **only** to brokers that advertise it (i.e. the reference broker and any upgraded partner). Everything else still gets v1.
- `BROKER_PROTOCOL=v1` is the kill-switch to force v1 for a specific deployment.

### Phase 2 — v2 is the default for new deployments
- Docs and `BROKER-HTTP-BINDING.md` promote v2 to the recommended binding; v1 documented as legacy-compatible.
- No code default flips that would affect an un-upgraded broker — negotiation still down-shifts to v1 automatically.

### Phase 3 — deprecation warning
- Gateway logs a `broker.protocol.v1_deprecated` warning (rate-limited, once per broker per process) whenever it negotiates down to v1, naming the broker origin so operators know what to upgrade.

### Phase 4 — require v2 (opt-in, per deployment)
- `BROKER_REQUIRE_V2=true` makes the gateway refuse to negotiate v1: a broker that doesn't advertise `sig:["v2"]`/`psk:["p2"]` fails closed at the capabilities probe with a clear boot/health error.
- Never becomes an unconditional default in this spec — dropping v1 is a per-operator decision once their brokers are known-upgraded.

---

## 5. Compatibility matrix

| Gateway | Broker | PSK on? | Result |
|---|---|---|---|
| v1 | v1 | either | v1 (unchanged) |
| v2 (`auto`) | v1 (no `protocol`) | either | negotiates **down to v1** — works |
| v2 (`auto`) | v2 | no | v2 signature, bind in headers (TLS-covered) |
| v2 (`auto`) | v2 | yes | v2 signature, bind **inside `p2.` seal** |
| v2 (`BROKER_PROTOCOL=v1`) | v2 | either | forced v1 (kill-switch) |
| v2 (`BROKER_REQUIRE_V2`) | v1 | either | **fails closed** at capabilities probe (intended) |

Mixed fleet (some brokers upgraded, some not) is fully supported: negotiation is **per broker origin**,
so the pool can be upgraded one instance at a time.

---

## 6. Testing plan

1. **Vector tests** — freeze v1 and v2 signing/sealing test vectors (`lib/broker-hmac.test.ts`, `broker-psk.test.ts`): fixed `ts`/`nonce`/`salt`/body ⇒ fixed `X-Omni-Sig` and `p2.` token. Guards against accidental format drift.
2. **Round-trip conformance** — extend `http-conformance.test.ts` / `broker-conformance.test.ts` to run the **whole action catalogue twice**: once negotiated to v1, once to v2, each with PSK on and off (4 combinations). Must be byte-for-byte equivalent at the application layer.
3. **Negotiation tests** — capabilities without `protocol` ⇒ gateway emits v1; with `protocol:{sig:["v1","v2"]}` ⇒ v2; `BROKER_PROTOCOL` override and `BROKER_REQUIRE_V2` fail-closed paths.
4. **Tamper tests** (the point of F3) — flip `X-OmniProject-Source`, strip a bind header, replay a v1 sig against a v2 verifier: each must yield `bad-signature`, not silent acceptance.
5. **F2 leak test** — assert that a **sealed v2** request carries **no** `X-Omni-Bind-*` headers and that `sub` does not appear anywhere in the cleartext of the outbound request.
6. **Replay** — nonce cache behaviour (in-process and `verifyBrokerRequestShared` Redis path) is unchanged; add a v2 replay vector.

## 7. Guards & docs to update
- `guard-broker-isolation` / `verify-broker-contract`: teach the contract verifier the v2 canonical string and the `protocol` capability field.
- `docs/BROKER-HTTP-BINDING.md`: add §2b-v2 and §2a-v2; mark v1 sections "legacy, still accepted."
- `docs/contract/broker.v1.schema.json` → add `broker.v2.schema.json` (superset; `protocol` block).
- Regenerate `docs/FUNCTION-MAP.md` for the new `lib/` exports.

## 8. Rollback
- Phases 0–2 are reversible by config alone: set `BROKER_PROTOCOL=v1` fleet-wide and the gateway emits v1 to everyone; the v2 accept path is dormant. No data migration exists to unwind (the protocol is stateless per request), so rollback is a config change + redeploy, not a schema revert.
- `p2.` tokens are never persisted (broker requests are transient), so there is no at-rest artifact that a rollback would strand.

## 9. Out of scope
- **Forward secrecy / peer auth on the PSK hop** — still "use TLS." v2 does not turn PSK into a key-exchange protocol; the honest hierarchy in `lib/broker-psk.ts` stands.
- **Non-repudiation against the gateway** — v2 remains a shared-secret MAC to a master-holding broker, same trust boundary as v1.
- **Event-channel signature** (`X-OmniProject-Signature` on broker→gateway events, §4 of the binding) — separate surface; can adopt the same canonical-string approach in a follow-up.
```
