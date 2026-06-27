# Dev guide — the BACKENDS plane

A backend is a system of record (Jira, SAP, Salesforce, …). You add one as a
`BackendDefinition` (neutral `BackendManifest` + an `N8nBinding`) in
`lib/backend-catalogue/src/n8n-backends.ts`.

## Shape

```ts
{
  id: "acme-pm",
  label: "Acme PM",
  docsUrl: "https://acme.example.com/api",
  via: "Native n8n node (acmeApi credential)",   // human-readable wiring
  authHeader: "=Bearer {{ $json.body.payload.userContext.token }}", // OR credentialType
  requiredEnv: ["ACME_BASE_URL"],
  capabilities: { issues: true, scheduling: false, /* … */ },
  actions: {                                     // the n8n binding (the "tools")
    list_projects: { /* http or n8nNode mapping */ },
    list_issues:   { /* … */ },                  // list_projects + list_issues are required
    create_issue:  { /* … */ },
    update_issue:  { /* honour expectedVersion → 409 */ },
    delete_issue:  { /* … */ },
    get_capabilities: { /* … */ },
  },
}
```

- **Transport is derived** from the actions (`n8nNode` ⇒ native-node/n8n-only,
  else `http` ⇒ portable across brokers). `brokerCatalogue()` says which brokers
  reach it — you don't set this.
- Mark it enterprise (premium workflow gen) by adding the id to
  `ENTERPRISE_BACKENDS`.

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane backends my-backend.json
```

Then add the object to `BACKENDS`, run `pnpm --filter @workspace/api-server test`
(the gateway's manifest + HTTP-URL conformance), and the seam works with zero core
changes. See `docs/BROKER-HTTP-BINDING.md` for the contract the actions normalise to.
