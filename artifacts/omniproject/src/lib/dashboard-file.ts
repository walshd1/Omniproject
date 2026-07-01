import type { Dashboard, DashboardWidget } from "./dashboards";
import { safeParseJson } from "./safe-json";

/**
 * Round-trip a dashboard DEFINITION in and out of a JSON file — the same principle as the report
 * generator's import/export, so a dashboard built in one deployment can be exported, shared and
 * re-imported. Pure. The upload is parsed with safeParseJson (which strips __proto__ / constructor /
 * prototype keys at every depth), and the parser then reconstructs the object field-by-field from
 * validated values — belt-and-braces, so no prototype-pollution key can survive into config.
 */

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function span(v: unknown): 1 | 2 | 3 | undefined {
  return v === 1 || v === 2 || v === 3 ? v : undefined;
}

function parseWidget(v: unknown, i: number): DashboardWidget {
  if (!v || typeof v !== "object") throw new Error(`widget ${i + 1} is not an object`);
  const w = v as Record<string, unknown>;
  if (!isStr(w["type"])) throw new Error(`widget ${i + 1} needs a "type"`);
  const out: DashboardWidget = { id: isStr(w["id"]) ? w["id"] : `w${i + 1}`, type: w["type"] };
  const s = span(w["span"]);
  if (s) out.span = s;
  if (isStr(w["title"])) out.title = w["title"];
  return out;
}

/** Validate + normalise an unknown value into a Dashboard, throwing a friendly error if it isn't one. */
export function parseDashboard(value: unknown): Dashboard {
  if (!value || typeof value !== "object") throw new Error("not a dashboard (expected a JSON object).");
  const o = value as Record<string, unknown>;
  if (!isStr(o["name"])) throw new Error('dashboard needs a "name".');
  if (!Array.isArray(o["widgets"])) throw new Error('dashboard needs a "widgets" array.');
  const dash: Dashboard = {
    id: isStr(o["id"]) ? o["id"] : "",
    name: o["name"],
    widgets: (o["widgets"] as unknown[]).map(parseWidget),
  };
  if (typeof o["refreshMs"] === "number" && o["refreshMs"] >= 0) dash.refreshMs = o["refreshMs"];
  return dash;
}

/** Trigger a browser download of a dashboard as pretty JSON. */
export function downloadDashboard(dash: Dashboard): void {
  const safe = (dash.name || "dashboard").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "dashboard";
  const blob = new Blob([JSON.stringify(dash, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dashboard-${safe}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse an uploaded file as a dashboard (throws a friendly error if it isn't valid JSON / a dashboard). */
export async function readDashboardFile(file: File): Promise<Dashboard> {
  let parsed: unknown;
  try {
    parsed = safeParseJson(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  return parseDashboard(parsed);
}
