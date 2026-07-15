import type { RequestHandler } from "express";
import { getSettings } from "./settings";
import { isComposed } from "@workspace/backend-catalogue";

/**
 * Server-side HARD GATE for OUTPUT surfaces under the methodology composition. An output curated out of the
 * deployment's composition (OData, exports, iCal, MCP, metrics, BI feeds, the notification stream/ingest)
 * has its endpoint refuse (403) — so a strict deployment can't have data pulled through an interface it
 * disabled, not just hidden in the SPA. Uncurated (`null`) composition ⇒ every output is on. One central
 * path→output map (mounted once) rather than a per-router middleware, so a router mounted at "/" can't leak
 * its gate onto every request. Uses the ONE shared composition predicate.
 */

/** Is the OUTPUT `id` enabled under the current composition? (`null` composition ⇒ yes.) */
export function isOutputComposed(id: string): boolean {
  return isComposed(getSettings().methodologyComposition, "output", id);
}

/** Map an /api-relative request path to the OUTPUT it serves (the catalogue output id), or null. */
const OUTPUT_ROUTES: ReadonlyArray<{ re: RegExp; output: string }> = [
  { re: /^\/odata(\/|$)/, output: "odata" },
  { re: /^\/calendar\.ics$/, output: "ical" },
  { re: /^\/export\.[a-z0-9]+$/i, output: "exports" },
  { re: /^\/mcp$/, output: "mcp" },
  { re: /^\/metrics$/, output: "metrics" },
  { re: /^\/bi\/feeds(\/|$)/, output: "bi-feeds" },
  { re: /^\/notifications\/stream$/, output: "notifications-stream" },
  // notifications-ingest is INBOUND (n8n → us, secret-authed) and mounts ahead of this gate — it's ingress,
  // not an egress output to gate, so it is deliberately omitted.
];

/** The output an /api-relative path serves, or null when it isn't an output surface. */
export function outputForPath(path: string): string | null {
  return OUTPUT_ROUTES.find((r) => r.re.test(path))?.output ?? null;
}

/** Central middleware: 403 a request to an OUTPUT surface curated out of the composition; pass everything
 *  else through. Mount ONCE on the /api router (before the output routers). */
export const outputCompositionGate: RequestHandler = (req, res, next) => {
  const output = outputForPath(req.path);
  if (output && !isOutputComposed(output)) {
    res.status(403).json({ error: `The "${output}" output is disabled for this deployment (methodology composition).` });
    return;
  }
  next();
};
