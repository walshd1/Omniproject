# Make (Integromat) broker scenario — template

Make runs **visual scenarios**, not Node — so unlike the serverless / Pipedream
templates it can't `import` the shared `processBrokerCall` core. It mirrors the
**same binding structure** instead (the contract is the single source of truth:
`docs/BROKER-HTTP-BINDING.md`). Make *is* a full data broker because its **Webhook
Response** module returns a synchronous body.

## Scenario shape

```
[Custom webhook]  ← BROKER_URL points here
      │ body: { action, payload, source, origin, idempotencyKey }   (+ Authorization header)
      ▼
[Router]  ── one route per action, filter on {{1.action}} ──────────────┐
  ├─ action = "list_projects"  → [HTTP GET your-api/projects]           │
  ├─ action = "list_issues"    → [HTTP GET …/projects/{{payload.projectId}}/issues]
  ├─ action = "create_issue"   → [HTTP POST …/issues]                   │
  ├─ action = "update_issue"   → [HTTP PATCH …/issues/{{payload.issueId}}]  ← 409 on version mismatch
  ├─ action = "delete_issue"   → [HTTP DELETE …/issues/{{payload.issueId}}]
  ├─ action = "get_capabilities" → [Set variable: your capability flags]
  └─ verify = true             → [skip straight to the response, no backend call]
      ▼ (each route)
[Set variable: normalise the backend result to the contract shape]
      ▼
[Webhook Response]  status 200, body { "success": true, "data": {{normalised}} }
```

## Rules to honour (same as every broker)

1. **Auth:** read the forwarded `Authorization` header (the user's token) and pass
   it to your HTTP modules — the backend authorises. Don't use a shared admin key.
2. **verify:** when the body has `verify: true`, respond
   `{ success: true, data: { verified: true } }` **without** calling the backend.
3. **Errors:** set the Webhook Response status from the backend — `409` (with the
   current row) on an optimistic-concurrency conflict, `404`, `401/403`, else `4xx`
   = bad request, `5xx` = unavailable.
4. **Normalise** each backend result to the contract shape before responding.

## Steps

1. Create a scenario, add a **Custom webhook**, copy its URL → `BROKER_URL`.
2. Add a **Router**; add a route + filter per action above.
3. In each route, add the HTTP call to your backend and a **Set variable** to map
   the result to the contract shape.
4. End with a **Webhook Response** returning `{ success, data }`.
5. Run the OmniProject conformance suite against the webhook URL.

> PSK note: if you run plaintext and want `BROKER_PSK`, add a decrypt step at the
> top (AES-256-GCM, key = SHA-256(BROKER_PSK)) — or just use TLS (preferred).
