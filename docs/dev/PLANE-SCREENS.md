# Dev guide — the SCREENS plane

A screen is an SPA view (Home, Gantt, Reports, Settings, …). Register it as a
`ScreenDefinition` in `lib/backend-catalogue/src/screen-catalogue.ts` (the
manifest), and build the React view in `artifacts/omniproject`.

## Shape

```ts
{
  id: "my-screen",
  label: "My Screen",
  route: "/my-screen",                 // SPA path (":id" params allowed)
  kind: "dashboard" | "detail" | "planning" | "report" | "admin",
  capabilities: {
    requiresRole: "viewer" | "contributor" | "manager" | "admin",  // RBAC still enforces this
    requiresCapability: "scheduling" | null,   // backend-plane link
    dataLineage: true,                 // carries the per-screen lineage overlay
    exportable: true,                  // offers CSV/JSON export
  },
  tools: ["the", "widgets", "on", "it"],
}
```

- `requiresRole` documents the gate; **the hard RBAC gate still enforces it** —
  the manifest doesn't replace `useAuth()`/`requireRole`.
- `requiresCapability` hides the screen when the backend can't feed it.
- If the screen shows entered/brokered data, set `dataLineage: true` and mount the
  lineage overlay; set `exportable: true` to offer the CSV/JSON pull.

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane screens my-screen.json
```
