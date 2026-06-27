# Microsoft Power Automate broker flow — template

Power Automate runs **cloud flows**, not Node, so (like Make) it mirrors the
binding structure rather than importing the shared core. It serves the full
contract because the **"When a HTTP request is received"** trigger + a **Response**
action are synchronous (premium connector). Native reach into Microsoft 365 /
Dataverse makes it a natural broker for those backends.

## Flow shape

```
[When a HTTP request is received]   ← BROKER_URL = the generated POST URL
   request body schema: { action, payload, source, origin, idempotencyKey, verify }
      │
[Condition: verify == true] ── yes ─→ [Response 200 { success: true, data: { verified: true } }]
      │ no
[Switch on  triggerBody()?['action']]
   ├─ "list_projects"   → [HTTP GET  <your-api>/projects]
   ├─ "list_issues"     → [HTTP GET  <your-api>/projects/@{…payload.projectId}/issues]
   ├─ "create_issue"    → [HTTP POST <your-api>/issues]
   ├─ "update_issue"    → [HTTP PATCH <your-api>/issues/@{…payload.issueId}]  ← 409 on mismatch
   ├─ "delete_issue"    → [HTTP DELETE <your-api>/issues/@{…payload.issueId}]
   └─ default           → [Response 400 { success: false, message: 'unknown action' }]
      ▼ (each case)
[Compose: normalise to the contract shape]
      ▼
[Response]  status from backend, body { success: true, data: <normalised> }
```

## Rules to honour

1. **Auth:** forward `triggerOutputs()?['headers']?['Authorization']` to the HTTP
   actions (or use a Dataverse / Office 365 connector with the user's identity).
2. **verify** short-circuits with a 200 and no backend call.
3. **Errors:** map the backend status onto the Response — `409` (current row),
   `404`, `401/403`, `4xx` bad request, `5xx` unavailable.
4. **Normalise** each result to the contract shape.

## Steps

1. New **Instant cloud flow** → trigger **When a HTTP request is received**; paste
   the request schema; save to get the POST URL → `BROKER_URL`.
2. Add the **Condition** (verify), then a **Switch** with a case per action.
3. Put the backend **HTTP** (or Dataverse) action + a **Compose** normaliser in
   each case, then a **Response**.
4. Run conformance against the URL.
