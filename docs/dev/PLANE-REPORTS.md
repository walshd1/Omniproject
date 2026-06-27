# Dev guide — the REPORTS plane

A report is a visualisation type (Gantt, burndown, EVM, …). Add one as a
`ReportDefinition` in `lib/backend-catalogue/src/report-catalogue.ts`.

## Shape

```ts
{
  id: "my-report",
  label: "My Report",
  docsUrl: "…",
  kind: "schedule" | "progress" | "financial" | "resource" | "quality" | "portfolio",
  capabilities: {
    requiresCapability: "financials" | null,  // ← links to the BACKENDS plane
    timeSeries: true,
    exports: ["csv", "pdf"],
  },
  tools: ["the", "metrics", "or", "series", "it", "produces"],
}
```

- **`requiresCapability` is the link to the backend plane.** A report only lights
  up when the active backend declares that capability (EVM needs `financials`,
  burndown needs `history`). Use `null` for always-available. This is how the
  planes stay *separate but linked* and avoid promising a report the backend can't
  feed.

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane reports my-report.json
```

Add to `REPORTS`; the Reports screen renders the plane, capability-gated.
