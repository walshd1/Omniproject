# Privacy & data protection

How OmniProject handles personal data, the **records of processing** a deploying organisation needs
for GDPR Article 30, and the data-protection-agreement (DPA) position. Companion to
[`ENTERPRISE-OPS.md`](./ENTERPRISE-OPS.md) (data map / DSAR / retention) and
[`EGRESS-INVENTORY.md`](./ops/EGRESS-INVENTORY.md) (outbound destinations / sub-processor basis).

## Controller / processor position

OmniProject is a **stateless overlay**: it does not own the user directory (your IdP does) and does
not store project data (your backends do). For data that flows *through* the gateway:

- **You are the data controller.** You determine why and how personal data is processed.
- **OmniProject the software** acts within your environment as part of your processing — it is **not
  a third-party processor that receives your data on its own infrastructure** (there is no vendor
  SaaS in the self-hosted model; you run it). Where you use OmniProject's optional **AI providers**,
  *those providers* are sub-processors **you** select and contract with — OmniProject only brokers the
  call, and AI is **off by default**.
- **DPA.** Because the self-hosted product is not a SaaS that ingests your data, a DPA with "the
  vendor" is generally **not required** for the gateway itself. A DPA **is** required between you and
  any external sub-processor you enable (AI provider, hosted IdP, hosted backend). Use the
  sub-processor inventory below as the schedule.

## What personal data the gateway touches (and where it lives)

| Data | Where it lives | At rest? |
| --- | --- | --- |
| Identity claims (`sub`, name, email, roles) | the **sealed session cookie** + request memory | No — cookie only; never written to disk by the gateway |
| Per-user preferences (a11y, density, recents) | the user's **browser** (localStorage) + optional server mirror | Only if you enable server prefs; sealed like config |
| SCIM directory (users/groups) | in-memory, persisted **sealed** (optional) | Only when SCIM is enabled |
| Audit events (actor `sub`/email, action) | **stdout → your SIEM**; chain head optional file | Per **your** SIEM retention |
| Project/work data (issues, assignees, comments) | **your backend** — transits the gateway, not stored | No (the nothing-at-rest guarantee) |

> The gateway's design goal is **nothing personal at rest by default**. The only personal data it can
> persist are the optional SCIM mirror and per-user prefs, both sealed with the config crypto.

## Records of Processing (ROPA / Article 30) — template rows

Fill these into your own Article 30 register; OmniProject supplies the technical facts.

| Processing activity | Categories of data subjects | Categories of personal data | Purpose | Recipients / sub-processors | Retention | Safeguards |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication & session | Staff/volunteer users | Identity claims (sub, email, name, roles) | Access control | Your IdP | Session lifetime (idle/abs cap) | Sealed cookie, TLS, step-up |
| Authorization & audit | Staff/volunteer users | Actor id + action metadata | Security monitoring, non-repudiation | Your SIEM | Your SIEM policy | Tamper-evident hash chain |
| Project/work overlay | Subjects named in work items | Whatever your backend holds (assignees, comments) | Project delivery | Your backend(s) | Backend policy (transits only) | Backend authz, TLS, broker HMAC |
| Optional AI assistance | Users invoking AI | Prompt content (may include work data) | NL queries / summaries | **AI provider you select** | Provider policy | Off by default; prompt DLP; vault-held key |
| Optional email/notifications | Notified users | Email address | Sign-in links, alerts | Your SMTP relay | Transient | Env-config; no at-rest credential |

## Sub-processor inventory

OmniProject ships **no built-in sub-processors**. Any external recipient is one **you** enable; the
authoritative, environment-specific list is generated from your config — see
[`EGRESS-INVENTORY.md`](./ops/EGRESS-INVENTORY.md). Typical categories: your **IdP**, your **backends**
(Jira/OpenProject/…), an optional **AI provider**, an optional **SMTP relay**, and an optional
**logging/SIEM sink**. The egress guard can pin outbound traffic to exactly this set
(`EGRESS_ALLOWLIST`).

## Data subject rights (DSAR)

Access, rectification and erasure are mostly satisfied at your **backend** (the system of record). For
the gateway's own footprint, see the **DSAR evidence report** and erasure guidance in
[`ENTERPRISE-OPS.md`](./ENTERPRISE-OPS.md) §2. Per-user prefs are erased by clearing the user's stored
prefs; the SCIM mirror by deprovisioning.

## International transfers & residency

The gateway can be pinned to a region and **fail-closed** on cross-region routing (data-residency
mode — [`DATA-RESIDENCY.md`](./DATA-RESIDENCY.md)). Transfers happen only to sub-processors you
enable; assess each under your transfer mechanism (e.g. SCCs).

## DPIA prompt

A DPIA is advisable where you enable **AI assistance** over personal work data, or process **special-
category** data in work items. Key mitigations the product provides: AI off by default, prompt DLP,
per-capability governance, the egress allowlist, and the tamper-evident audit trail.
