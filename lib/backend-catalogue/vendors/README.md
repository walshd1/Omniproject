# Vendor definitions

Every **vendor** OmniProject knows about lives here as a single JSON file, one
per vendor, grouped by the plane it belongs to. Vendors are only ever one of four
things — a **backend**, a **broker**, a **notification** channel, or an **output**
(never a new plane) — so there are four subdirectories:

```
vendors/
  backends/<id>.json        systems of record (Jira, OpenProject, SAP, …)
  brokers/<id>.json         automation/translation layer (n8n, Make, …)
  notifications/<id>.json   channels alerts go TO (Slack, Teams, PagerDuty, …)
  outputs/<id>.json         outward interfaces (OData, MCP, metrics, exports, …)
  schema/<plane>.schema.json   the JSON Schema each vendor is validated against
```

## Adding a vendor

1. **Design the JSON.** Copy an existing file in the right subdirectory as a
   starting point and edit it. Point your editor at the schema for autocomplete +
   validation:

   ```json
   { "$schema": "../schema/backend.schema.json", "id": "my-backend", … }
   ```

   (The `$schema` line is optional — it isn't stored — but it makes authoring
   easier. The filename **must** equal the `id`.)

2. **Verify it.** Regenerate the embedded catalogue; this validates every vendor
   file against its plane schema and fails loudly on any violation:

   ```
   pnpm --filter @workspace/scripts run gen-vendors
   ```

3. **Commit** both your JSON file and the regenerated
   `src/vendors.generated.ts`. CI re-runs the generator and fails if they drift,
   so the embedded data can never lie about the JSON.

## Why JSON + a generated module?

Authoring is data, not code — you don't touch TypeScript to add a vendor. But the
catalogue is imported by the gateway **and** the browser SPA, so it can't read
files at runtime. `gen-vendors` embeds the validated JSON into a portable,
type-checked `src/vendors.generated.ts` (the same generate-and-drift-guard pattern
as the broker contract). The vendor's specifics stay **below the broker seam** —
nothing above it ever names a vendor.
