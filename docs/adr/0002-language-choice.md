# ADR 0002 — TypeScript across the codebase; the broker seam is the polyglot boundary

- **Status:** Accepted
- **Date:** 2026-06-29

## Context

OmniProject is a **stateless overlay**: a Node/Express gateway (zero-data-at-rest),
a React SPA, a shared catalogue/contract library, and Node build/generator scripts —
**all TypeScript** (~65k hand-written lines across four packages, ~266 test files,
~6.5k lines of generated code, ~12 CI drift guards). The question raised: is
TypeScript the right language for all of this, or should some part be another
language (Go, Rust, Python, …)?

The decisive properties of this system:

- **One contract, shared end to end.** The canonical broker contract, the
  `FIELD_REGISTRY` superset, the OpenAPI/zod schemas and the generated client are a
  *single type system* spanning SPA ↔ gateway ↔ scripts. The whole
  "config-as-data → generators → drift guards" architecture (see ADR 0001 and the
  `gen-*` scripts) relies on this.
- **I/O-bound, not CPU-bound.** The gateway proxies reads/writes to the broker and
  holds nothing at rest. There is no query crunching, no heavy compute hot path.
  Crypto runs on native `node:crypto` (OpenSSL). Node/V8 suits this workload.
- **The browser half must be TS/JS.** The SPA has no alternative short of WASM.

## Decision

**Keep TypeScript for the entire first-party codebase** — gateway, SPA, shared
library, and scripts. Do **not** rewrite any part in another language.

**The broker seam is the sanctioned polyglot boundary.** Brokers and sidecars
*below* the seam communicate with the gateway over a language-agnostic HTTP/JSON
contract (`docs/CONTRACT.md`, `docs/BROKER-HTTP-BINDING.md`). A broker — including
the reference sidecar and the forthcoming self-host-DB SQL worker — **may be written
in any language** (Go, Python, Rust, …) that speaks the contract. This is by design,
not a gap.

**Reach for another language only for a specific, measured need**, and even then
*out of process or in WASM*, never by fragmenting the first-party type system:

- A genuine CPU-bound hot path (e.g. very large-scale EVM/schedule recompute, or
  high-volume document generation) → a Go/Rust **sidecar** behind the seam, or a
  **WASM** module called from the gateway/SPA. **No such hot path exists today.**
- A backend/sidecar where an ecosystem fit is decisive (a DB driver, a vendor SDK)
  → implement that broker in its native language; the contract keeps it isolated.

Runtime note: Node vs Bun/Deno is a *runtime* choice, not a language one. Node is
stable, the build/CI are green, and there is no compelling reason to switch runtimes.

## Consequences

**Positive**

- The shared contract stays type-checked across client, server and codegen — the
  single biggest correctness lever in the project is preserved.
- One language → one toolchain, one test story, one hiring profile; the existing
  tests, guards and generators keep their full value.
- Polyglot is still available *exactly where it pays* — below the seam — without any
  cost to the gateway's type safety.

**Negative / trade-offs**

- Node is not the tool for CPU-bound number-crunching. Accepted: there is none here,
  and the escape hatch (sidecar/WASM behind the seam) covers any future case.
- A single-language first party means a future broker author in another language
  re-derives the contract types by hand in their language — mitigated by the
  published JSON-Schema contract (`docs/contract/broker.v1.schema.json`).

## Alternatives considered

- **Rewrite the gateway in Go/Rust for performance.** Rejected: the workload is
  I/O-bound; the win is ~zero, and it would sever the shared-type story and discard
  the test/guard/codegen scaffolding.
- **Python for the gateway or scripts.** Rejected: loses the end-to-end types and
  adds a second toolchain for no benefit on an I/O-bound proxy.
- **Split a "parts in X" first-party codebase.** Rejected as premature; the seam
  already provides the clean place for another language when a real need is measured.
