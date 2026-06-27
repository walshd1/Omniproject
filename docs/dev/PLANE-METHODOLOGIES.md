# Dev guide — the METHODOLOGIES plane

A methodology shapes OmniProject's workflow (Scrum, Kanban, Waterfall, SAFe, …).
Add one as a `MethodologyDefinition` in
`lib/backend-catalogue/src/methodology-catalogue.ts`.

## Shape

```ts
{
  id: "my-method",
  label: "My Method",
  docsUrl: "…",
  kind: "agile" | "hybrid" | "traditional",
  capabilities: {
    iterations: true, board: true, wipLimits: false,
    phases: false, baseline: false,
    estimation: "story-points" | "hours" | "t-shirt" | "none",
  },
  tools: {                                   // the workflow it introduces
    states: ["backlog", "todo", "in_progress", "done"],
    ceremonies: ["planning", "standup", "review"],
  },
  alsoProvides: [{ plane: "reports", note: "burndown" }, { plane: "screens", note: "board" }],
}
```

- A methodology usually **spans planes** — declare the reports/screens it implies
  with `alsoProvides`.
- `estimation` should match what the relevant reports need (e.g. `story-points`
  for velocity/burndown).

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane methodologies my-method.json
```
