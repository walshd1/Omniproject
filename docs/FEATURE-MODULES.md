# Feature modules (optional, lazily-loaded backend modules)

OmniProject ships a lot of optional capability. **Feature modules** let an operator switch off the
parts they don't use, so a deployment only loads — and only pays the resources for — what it needs.
This is the foundation of the modular UX: features you control are optional modules; an admin (or
PMO) curates which are available.

> **Where this sits now:** the flat opt-out described below is the **base layer**. It still exists and
> works exactly as documented here, but it now sits **under** the scoped org→programme→project governance
> model — see `docs/FEATURE-GOVERNANCE.md` for the layered resolution.

## The model

- **Opt-out.** Every feature module is **on by default**. You disable modules by id.
- **Lazy backend loading.** Each module's route code is reached only through a dynamic `import()`
  (`lib/feature-modules.ts` → `FEATURE_MODULES[].load`). The mount step (`routes/index.ts`) runs that
  import **only for enabled modules**, so a disabled module's code is never loaded or initialised at
  startup. The bundle is built with esbuild **code-splitting**, so each module lands in its own chunk.
- **Runtime toggle.** A `requireFeature(id)` gate **404s** a module the instant it's disabled at
  runtime, even though its code stays resident until the next restart. Enabling a module that was
  **off at startup** takes effect on the next restart (it wasn't loaded) — surfaced honestly as
  `needsRestart` so the admin panel can say so.

## Configuring

| Where | How |
| --- | --- |
| Env | `DISABLED_FEATURES=odata,integrations` |
| Admin panel | Settings → **Feature modules** (toggle on/off) |
| Config bundle | `settings.disabledFeatures: string[]` — rides the snapshot/export, so the chosen module set travels with the deployment |

## API

- `GET /api/features` → `{ features: [{ id, label, description, enabled, loaded, needsRestart }] }`
  (any authenticated session). Toggling is an admin write: `PATCH /api/settings { disabledFeatures }`.

## Registry

Modules are declared in `lib/feature-modules.ts`. Only **genuinely-optional, self-contained** route
modules belong here; core routes stay always-on. Each entry is:

```ts
{ id, label, description, load: () => import("../routes/<module>") }
```

The first migrated modules are **`odata`** (OData / BI feeds) and **`integrations`** (integration
helpers). More route modules migrate to this registry in follow-up changes.

## SPA

`useFeatures()` (`lib/features.ts`) exposes the status list; `featureEnabled(features, id)` lazily
gates optional UI (defaults to enabled while loading so core UI never flickers). The **Feature
modules** admin panel (`components/settings/FeatureModulesAdmin.tsx`) toggles modules.
