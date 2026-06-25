/**
 * The read-only broker actions the setup "verify" probe and the n8n adapter's
 * VerifyReport both exercise. Defined once here so the route and the adapter
 * can't drift to different action sets. These are dry-run reads only — the probe
 * must never invoke a mutating action.
 */
export const VERIFIABLE_ACTIONS = [
  "get_capabilities",
  "list_projects",
  "list_issues",
  "list_activity",
  "get_resource_capacity",
  "get_project_financials",
  "get_portfolio_health",
  "get_project_history",
  "get_baseline",
  "get_raid",
  "get_notifications",
] as const;
