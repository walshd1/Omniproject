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

## Verification status

Every **backend** manifest carries a required `verification` field —
`"verified" | "catalogued" | "experimental"` — an honesty signal for how much to
trust the mapping before wiring it up, surfaced as a badge in the Configurator:

- **`catalogued`** (the default posture): built from the vendor's public API
  docs/schema, matching the manifest shape, but never run against a real, live
  instance. This is what every shipped backend is today.
- **`verified`**: exercised end-to-end against a live instance of the vendor
  (contract conformance + a real read/write round trip, not just a schema check).
- **`experimental`**: speculative or partial — a generic placeholder (e.g. the
  `enterprise` catch-all) or an API surface we're not even confident about on
  paper. Custom/self-authored backends (built via the admin's custom-backend
  form) default here until reviewed.

This is **purely an honesty/UI signal, self-declared in JSON** — it carries no
more authority than `notes` does. Nothing in the gateway/broker may ever consult
it to gate a capability, skip a warning, or auto-grant anything; it is not a
trust boundary and must not become one.

## Catalogue freeze

The catalogue is frozen at its current **41 backends** — `gen-vendors` (and so
CI's drift-guard step) refuses to embed a 42nd+ backend until a flagship set
spanning the catalogue's major categories is actually `verified`. This freeze is
a **build-time contribution policy** on the shipped catalogue only — it does not
(and is not meant to) constrain a deployment's own `$OMNI_CONFIG_DIR` vendor
overlay, which is trusted operator config, schema-validated but otherwise
unbounded.

| Backend | Category |
| --- | --- |
| `jira`       | PM / work management |
| `asana`      | PM / work management |
| `salesforce` | CRM |
| `servicenow` | ITSM |
| `sap`        | ERP |

The rationale: 41 backends is already broad coverage, all built from docs and
none proven against a real instance. Rather than keep adding untested breadth,
verify the highest-value connector in each major category first — that buys
more real confidence per unit of effort than a 42nd never-run backend would.
Once every flagship id above carries `"verification": "verified"`, the freeze
lifts on its own (see `scripts/src/lib/backend-freeze.ts` — the check is
mechanical, not a standing manual gate). To verify a flagship backend: run it
through the contract conformance suite against a real instance (see
`docs/BROKER-HTTP-BINDING.md`), confirm a live read + write round trip, then
flip its JSON's `verification` to `"verified"`.

## Per-deployment config (runtime)

The files here are the **shipped defaults**, baked into the image. A *deployment*
can add or override vendors without a rebuild by pointing `OMNI_CONFIG_DIR` at a
folder of JSON the gateway reads at boot:

```
$OMNI_CONFIG_DIR/
  config.json              settings + label overrides (a config snapshot)
  vendors/backends/*.json  add / override backends (validated against the schema)
  vendors/brokers/*.json   …and the other three planes
```

Each file is validated against the same plane schema; an invalid file is logged
and skipped, never fatal. The gateway holds nothing durable — the JSON on disk is
the persistence — so the code stays stateless and a deployment is portable as one
folder. `GET /api/setup/config-dir` (admin) reports what loaded.

## Why JSON + a generated module?

Authoring is data, not code — you don't touch TypeScript to add a vendor. But the
catalogue is imported by the gateway **and** the browser SPA, so it can't read
files at runtime. `gen-vendors` embeds the validated JSON into a portable,
type-checked `src/vendors.generated.ts` (the same generate-and-drift-guard pattern
as the broker contract). The vendor's specifics stay **below the broker seam** —
nothing above it ever names a vendor.
