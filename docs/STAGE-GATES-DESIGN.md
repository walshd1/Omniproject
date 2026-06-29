# Stage-gates / governance approval workflows — design

Status: **design (not yet implemented).** The scheduled executive digest (the other half of the
PM-domain work) shipped first because stage-gates have a real architectural constraint that needs
a decision before building. This doc records it.

## Goal

Route plan-affecting changes (baseline set, scope change, project plan update) through a
methodology-driven **gate**: a second approver must sign off before the change takes effect —
reusing the existing maker-checker (`lib/dual-control`) and methodology plane rather than inventing
a new engine.

## The constraint: maker-checker can't replay a *brokered* write under zero-at-rest

`lib/dual-control` holds a proposal and runs a registered **executor** on approval. That works
today for **gateway-state** actions (key revocation, maintenance lockdown) because the executor
needs no external authority.

A plan change like `updateProject`, however, is a **brokered write performed as the requesting
user** — the gateway forwards *that user's* backend token to the broker. By design (zero data at
rest) we **never store the user's token**. So when a second admin approves the proposal minutes
later, there is no stored credential to replay the write as the original user. Executing it under
a system/service credential would silently change the actor of record — unacceptable for a
governance gate.

## Options (pick one before building)

1. **Gate gateway-side governance changes only (recommended first step).** Apply stage-gates to
   the changes that are *gateway* state and need no backend token: business-ruleset / field-rule
   changes (`lib/ruleset`), methodology selection, approved-action/vocab changes, profile changes.
   These slot into `dual-control` cleanly (the executor re-applies gateway config). High value
   ("a second approver before the project's governance rules change"), zero token problem, small.

2. **Approve-then-reissue for brokered writes.** The gate records an *approval token* for a
   pending change; the change does **not** execute server-side. Once approved, the **original
   requester** (still holding their session/token) re-submits the same change with the approval
   token, and the gateway verifies the token + four-eyes before forwarding. Preserves zero-at-rest
   and the real actor, at the cost of a two-step UX (request → approved → reissue).

3. **Backend-native gates.** Where the backend (e.g. OpenProject, Jira) has its own approval
   workflow, defer to it and surface status. No gateway gate; least lock-in.

## Recommendation

Ship **Option 1** as the first stage-gate PR (methodology-aware gates over gateway-config
governance actions, reusing `dual-control`), and offer **Option 2** as a follow-up for brokered
plan/baseline changes where customers want gateway-enforced four-eyes. Keep everything **off by
default** and methodology-scoped.

## Reuse map

- Hold/approve/reject + four-eyes + executor registry: `lib/dual-control` (now shared-state backed,
  so a proposal raised on one replica is approvable on another).
- Methodology context: the methodology plane / personas + `lib/ruleset`.
- Audit: every propose/approve/reject already records an audit event.
