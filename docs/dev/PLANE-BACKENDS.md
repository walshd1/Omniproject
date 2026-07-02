# Dev guide — the BACKENDS plane

A backend is a system of record (Jira, SAP, Salesforce, …). You add one as a
`BackendDefinition` (neutral `BackendManifest` + a `BrokerBinding`, flattened
into one object) by dropping a `<id>.json` file under
`lib/backend-catalogue/vendors/backends/`, validated against
`lib/backend-catalogue/vendors/schema/backend.schema.json` and embedded into
`lib/backend-catalogue/src/backend-catalogue.ts`'s `BACKENDS` array by
`pnpm --filter @workspace/scripts run gen-vendors`.

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

Then save it as `lib/backend-catalogue/vendors/backends/my-backend.json`, run
`pnpm --filter @workspace/scripts run gen-vendors` (embeds it into `BACKENDS`)
and `pnpm --filter @workspace/api-server test` (the gateway's manifest +
HTTP-URL conformance) — the seam works with zero core changes. See
`docs/BROKER-HTTP-BINDING.md` for the contract the actions normalise to.
