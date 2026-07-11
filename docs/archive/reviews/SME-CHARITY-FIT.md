# SME & charity fit — audit

**Question:** does OmniProject still serve small/medium enterprises and charities as
first-class users, or has the recent enterprise-grade work (portfolio consolidation,
governance hierarchy, EVM, exec packs) priced them out or complexity-ed them out?

**Verdict: OmniProject remains a strong fit for SMEs and charities.** Core value —
connect a backend, see projects/issues, run basic reports and dashboards — is **free**,
and the enterprise surface is genuinely additive and off-by-default. The audit found one
real, user-facing gap (the AI copilot had no small-org lens despite shipping charity/SME
methodologies) plus two discoverability gaps, all fixed additively in this change. No
enterprise feature was removed.

## Why this audit exists (for the reader, not just the record)

README's "Why OmniProject exists" names three problems — tool sprawl, nobody trusting a
second copy of their data, and migration risk killing the idea before it starts — and a
small org or charity carries a fourth fear on top: that the product quietly grows up and
leaves them behind, the way "enterprise-ready" software so often does. This audit exists
to answer that fear with evidence, not reassurance. Every enterprise feature added since
(portfolio consolidation, governance hierarchy, EVM, exec packs) had to prove it was
additive and off-by-default before it shipped — this document is where that promise gets
checked against the actual code, file and line, which is why README points a skeptical
small-org reader here instead of just asserting "still free" in a paragraph.

---

## What is well-supported (evidence)

### Core value is free; only genuinely-premium extras are gated
- Only **four** features are ever gated: `branding`, `labels`, `webhooks`,
  `enterprise_workflows` — `artifacts/api-server/src/lib/license.ts:26`. Connecting a
  backend, viewing projects/issues, reports and dashboards are **not** in that list, so
  core use is free for everyone.
- The gated set is prebuilt *enterprise* convenience (white-label, company nomenclature,
  outbound webhooks, prebuilt SAP/Primavera/Dynamics/Project workflows) —
  `artifacts/api-server/src/lib/license.ts:14-20`. The docs are explicit that *building*
  a view or workflow yourself stays Apache-2.0 and free (`README.md:522-531`).
- Even those four are **free right now**: `resolveBaseLicense` grants the full catalogue
  unless `PREMIUM_ENFORCEMENT=on` — `artifacts/api-server/src/lib/license.ts:188-201`.
- Feature governance is **monotonic narrowing**: every non-`defaultOff` feature is ON by
  default; org/programme/project levels can only *remove*, never add a paywall —
  `artifacts/api-server/src/lib/feature-resolution.ts:82-135`. A small org that ignores
  governance keeps everything.

### Deployment is genuinely small-org friendly
- A dedicated **`nonprofit`** profile (bundled IdP, HTTP-on-LAN acceptable by choice,
  no corporate IdP required) and a **`business` / SME** profile —
  `artifacts/api-server/src/lib/deployment-profile.ts:77-89,62-76`.
- Every advanced control (SSO, SCIM, KMS, IP allowlist, session caps, maker-checker) is
  **off by default**; the profile only relaxes TLS coupling and the no-IdP severity —
  `artifacts/api-server/src/lib/deployment-profile.ts:1-18,163-176`.
- The Configurator opens with a deployment-type picker surfacing each profile's posture —
  `artifacts/omniproject/src/lib/deployment-profile.ts:59`,
  `artifacts/omniproject/src/components/setup/ProfileStep.tsx`.
- A thorough small-org guide already exists — `docs/SMALL-ORG-GUIDE.md`.

### Free/open backends are first-class, not second to enterprise vendors
- OpenProject, Plane and Excel are bundled backends alongside every enterprise vendor,
  with no tiering/ordering field that would bias the picker toward paid vendors —
  `lib/backend-catalogue/vendors/backends/openproject.json`,
  `lib/backend-catalogue/vendors/backends/plane.json`,
  `lib/backend-catalogue/vendors/backends/excel.json`. All 41 vendors are flat/equal.

### Charity/SME domain templates already ship
- Charity/SME starter methodologies: **grant tracking**, **fundraising pipeline**,
  **volunteer roster** —
  `lib/backend-catalogue/assets/methodologies/grant-tracking.json`,
  `.../fundraising-pipeline.json`, `.../volunteer-roster.json` (each `notes` says
  "Charity/SME starter template").

---

## Gaps / risks found — and the fix

### GAP 1 (fixed) — the AI copilot had no small-org lens
The copilot's persona RAG selects an "experienced PM/PgM lens" per question, falling back
to the enterprise-flavoured **PMO Analyst** when nothing matches
(`artifacts/api-server/src/lib/personas.ts:19,47-49`). All five shipped personas were
enterprise/portfolio lenses — none referenced the charity/SME methodologies or keywords
(`lib/backend-catalogue/assets/personas/*.json`). So a charity user asking about *grants*,
*funders*, *donors* or *volunteers*, or an SME asking a lean *budget/capacity* question,
got portfolio-governance advice — off-key and heavier than they need.

**Fix (additive):** two new personas mirroring the existing JSON shape exactly —
- `lib/backend-catalogue/assets/personas/charity-programme-lead.json` (methodologies
  `grant-tracking`, `fundraising-pipeline`, `volunteer-roster`; keywords grant/funder/
  donor/beneficiary/volunteer/impact/charity…).
- `lib/backend-catalogue/assets/personas/sme-delivery-lead.json` (lean small-team lens;
  keywords small/team/budget/cost/capacity/priority…).

Regenerated via `pnpm --filter @workspace/scripts run gen-personas` (7 personas now
validated) and covered by new tests in
`artifacts/api-server/src/lib/personas.test.ts`. The default PMO-analyst fallback is
unchanged, so no existing behaviour regresses.

### GAP 2 (fixed) — the small-org story wasn't discoverable from the README
`docs/SMALL-ORG-GUIDE.md` existed but was **not linked** from `README.md`, and the
Quick-start jumped straight to demo mode with no signpost for cost-sensitive small orgs.
**Fix:** a short "Small teams, charities & self-hosters" subsection after Quick start
(`README.md`) linking the guide and naming the free backends, profiles and starter
templates.

### RISK (accepted, no change) — enterprise surface is large but inert for small orgs
Portfolio consolidation, the governance hierarchy, EVM and exec packs add breadth, but
they are additive and default-off, so they don't tax a small deployment. No change made;
the goal is that small orgs stay first-class, not that large orgs lose anything.

---

## Recommendations not taken here (future, low priority)
- Consider a charity/SME **preset bundle** in the Configurator that pre-selects a free
  backend + a starter methodology (grant tracking / volunteer roster) in one click.
- Consider surfacing the charity starter methodologies more prominently in the methodology
  picker for the `nonprofit` profile.

Both are additive polish; the core SME/charity experience is sound today.
