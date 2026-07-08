/**
 * Notification-route catalogue generator.
 *
 * Routes are authored as one JSON file per route under
 * lib/backend-catalogue/assets/notification-routes/<id>.json. Validates each
 * against assets/schema/notification-route.schema.json (via the shared gen-registry
 * engine) and emits the portable lib/backend-catalogue/src/notification-routes.generated.ts
 * — the same generate-and-drift-guard pattern as gen-views.
 *
 * Run: pnpm --filter @workspace/scripts run gen-notification-routes
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "notification-routes",
  schemaFile: "notification-route.schema.json",
  label: "notification-routes",
  constName: "ROUTES_DATA",
  typeName: "NotificationRoute",
  typeModule: "./notification-routing",
  noun: "Routes",
});
