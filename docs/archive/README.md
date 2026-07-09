# Archive

Documents kept for the record but no longer part of the living documentation set. They are **not**
maintained against the current codebase — treat them as point-in-time artefacts. For current docs,
start at the [documentation index](../DOCUMENTATION-INDEX.md).

## `reviews/` — point-in-time quality & stress passes

Snapshots of review findings run against the codebase at a moment in time. The fixes they prompted are
already merged; the files remain as a record of what was checked and found.

- `CLEAN-CODE-AUDIT.md` — whole-codebase clean-code review.
- `PERF-PATTERNS-REVIEW.md` — speed/responsiveness/design-patterns review at the scale target.
- `RESILIENCE-FINDINGS.md` — messy-data stress pass over reports/derivations/screens.
- `LOGIC-FINDINGS.md` — logic & collision audit (identity collisions, unstable sorts).
- `BUNDLED-BACKENDS-STRESS.md` — stress pass over the bundled backend/broker catalogue.
- `COMPOSE-AUDIT.md` — Docker Compose topology correctness audit.
- `I18N-COVERAGE.md` — localisation coverage audit (en/fr/de/es).
- `SECURITY-AUDIT-2026-07.md` — dated re-audit of surfaces changed since the prior pentest pass;
  the living posture is [../SECURITY-AUDIT.md](../SECURITY-AUDIT.md).

## `design/` — historical design proposals

Design records and RFCs. Some were implemented (and are described in the current docs); some are
explicitly *not implemented* and parked. Kept for the reasoning, not as a description of what ships.

- `RFC-001-capabilities-creation-replica.md`, `RFC-002-roadmap.md`, `RFC-003-db-broker.md`,
  `RFC-004-delegation.md`, `RFC-005-secure-delegation-design.md` — the original RFC series.
- `MULTI-TENANCY-DESIGN.md` — pooled multi-tenancy (design only, not implemented).
- `STAGE-GATES-DESIGN.md` — maker-checker governance gates (design only, not implemented).

## `releases/` — superseded release notes

Per-release notes now subsumed by the top-level [CHANGELOG](../../CHANGELOG.md).

- `0.4.0.md` — 0.4.0 release notes.
- `RELEASE-NOTES-0.7.0-DRAFT.md` — an unshipped 0.7.0 draft.
