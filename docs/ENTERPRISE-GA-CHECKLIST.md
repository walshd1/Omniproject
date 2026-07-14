# Path to enterprise "shoo-in" — the go/no-go checklist

There are two different bars. **Engineering-ready** — the product survives a technical
deep-dive — is roughly *there* (~85%): stateless/zero-at-rest architecture, OIDC/SAML/SCIM,
RBAC + step-up + dual-control, audit hash-chain, signed snapshots, CodeQL/semgrep/gitleaks,
SBOM + SLSA provenance, the read-seam sanitizer, mutation testing, a WCAG 2.2 AA audit, and a
control-evidence index. **Procurement-proven** — a CISO/procurement panel says *yes without
conditions* — is the lower number (~55–60%), and the gap is dominated by evidence that **no
code or doc change can manufacture**: it's earned through a live pilot, an external audit, and a
published number.

This page tracks that second bar. It does **not** restate the engineering roadmap — that lives
in [`ENTERPRISE-READINESS.md`](ENTERPRISE-READINESS.md) §4 (the 14-row buyer-panel gap table)
and [`TECH-DEBT-AND-ROADMAP.md`](TECH-DEBT-AND-ROADMAP.md) §1/§6. Each gate below points at the
row that owns the underlying work and adds the **decision gate** and the **evidence artifact**
that actually closes it.

**Status:** ☐ not started · ◐ in progress · ✅ done. *Evidence* = the citable artifact a buyer's
panel accepts as proof (not "the code exists" — that's the engineering bar, already tracked).

---

## P0 — the shoo-in gates (these flip the answer)

These are the deciding artifacts. None is fixable by writing more code or docs; each is *earned*.

| ☐ | Gate | Why it decides the buy | Current state (honest) | Done = evidence artifact | Owned by |
|---|------|------------------------|------------------------|--------------------------|----------|
| ☐ | **Live-tenant verified flagship connector** | Buyers connect *their* SAP/Oracle/ServiceNow/Jira, not a mapping guide. This is the single biggest blocker. | All **41 backends are catalogued; none is live-tenant-verified**. ~7 have real, tested adapter code; the n8n contract has never executed inside real n8n. | ≥1 flagship connector proven **read + write against a real tenant**, with a captured conformance/round-trip run (and the headless-n8n CI harness from TECH-DEBT §1 landed). | TECH-DEBT §1; ENT-READINESS §4 #10; `vendors/*` |
| ☐ | **Published scale run at target size** | "Handles our portfolio" is currently a claim, not a number. IT won't sign on "probably". | Load harness ships and is unit-tested but **has never been run for real**; throughput numbers are placeholders. | A captured result at **~60 programmes / 200 projects**: p99 latency + error rate <1%, recorded in [`ops/BENCHMARKS.md`](ops/BENCHMARKS.md) / [`ops/LOAD-HARNESS.md`](ops/LOAD-HARNESS.md). | ENT-READINESS §4 #3; `ops/LOAD-HARNESS.md` |
| ☐ | **Independent security attestation** | Procurement wants the *report*, not a self-assessment. Control mapping ≠ certified. | Controls are **mapped** to SOC 2 / ISO 27001 / NIST CSF ([`COMPLIANCE.md`](COMPLIANCE.md)); no audited report exists. Pen testing is *invited* ([`SECURITY.md`](../SECURITY.md)) but none has run. | A **SOC 2 Type II report** (or ISO 27001 cert) **+ an external penetration-test summary** with findings remediated. | ENT-READINESS §4 #5, #6; `CONTROL-EVIDENCE.md` |
| ☐ | **One lighthouse production pilot + reference** | No panel makes an easy "yes" with zero production proof. A named reference collapses perceived risk. | Pre-launch (0.6.0); **zero named production references**. The POV plan and pilot-readiness runbook exist and are unused. | One real tenant **live in production** with a citable reference, and the [`POV-SUCCESS-CRITERIA.md`](POV-SUCCESS-CRITERIA.md) go/no-go gates met. | `POV-SUCCESS-CRITERIA.md`; `ops/PILOT-READINESS.md` |
| ☐ | **Fleet-shared state proven under HA** | Enterprises run N replicas; per-replica state is a correctness and audit risk. | The `SHARED_STATE` seam ships (Redis-gated) and registries adopt it *incrementally*; some session/settings/audit-head state is **still per-replica** without Redis. | A **multi-replica HA run** with every security-relevant registry fleet-shared, and a **DR playbook exercised** (not just written). | TECH-DEBT §2; ENT-READINESS §4 #11 |

---

## P1 — confidence strengtheners (raise the score; not strictly blocking)

These make the "yes" *easy* rather than *conditional*. All are already tracked as roadmap rows;
listed here so the go/no-go view is complete.

| ☐ | Strengthener | Current state | Tracked in |
|---|--------------|---------------|------------|
| ☐ | Live/audited FX feed (replace the indicative table) | Conversion + broker FX read ship; live feed does not | ENT §4 #1 |
| ☐ | Multi-region data-residency consolidation | Single fail-closed region enforced | ENT §4 #2 |
| ☐ | SSO/SAML first-class by default + SCIM IdP presets | Implemented; SAML runtime-optional | ENT §4 #4 |
| ☐ | One-click compliance/evidence pack | Primitives (audit-chain, snapshots) exist; bundling does not | ENT §4 #7 |
| ☐ | Segregation-of-duties widened to more sensitive actions | Maker-checker engine ships | ENT §4 #8 |
| ☐ | ERP/finance book-of-record adapter for actuals | Not built | ENT §4 #10 |
| ☐ | External secret/KMS + OTLP validated against a real endpoint | Mock-verified / local-listener only | TECH-DEBT §1 caveats |
| ☐ | Authentik blueprint applied against a live Authentik + version pinned | Written to schema, not live-verified | TECH-DEBT §1 caveat |

---

## The three-move fast path

The minimum set that flips "exceptionally credible contender" → "shoo-in". Everything else is upside:

1. **One verified flagship connector** (P0-1) — turns the catalogue into a proven integration.
2. **SOC 2 Type II + external pen test** (P0-3) — turns a strong self-assessment into an accepted one.
3. **One lighthouse pilot with a published scale run** (P0-4, folding in P0-2) — turns claims into a reference and a number.

P0-5 (fleet-shared HA) rides along with a serious pilot. Do these three and the deciding artifacts
are in hand.

---

## How to use this page

This is the **single go/no-go tracker** for the enterprise-buy decision. The *engineering* detail
for each item lives in the linked roadmap rows; this page owns the buyer-decision gates and their
evidence. Update the status marks as artifacts land — a gate flips to ✅ only when the **evidence
artifact** exists, not when the code does.
