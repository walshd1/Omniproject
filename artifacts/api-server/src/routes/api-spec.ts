import { Router } from "express";
import { OPENAPI_YAML, OPENAPI_INFO, OPENAPI_PATHS } from "../lib/openapi.generated";
import { baseUrl, InsecureBaseUrlError } from "./auth";

/**
 * The consumer (northbound) API spec — exposed at runtime, broker-agnostic.
 *
 * This is the STABLE interface a consumer builds against: it sits above the
 * swappable broker seam, so it is the same regardless of which broker (n8n by
 * default) reaches your backends. Distinct from `GET /api/contract`, which is the
 * SOUTHBOUND contract a *broker* implements. Public (documentation, not data) —
 * mounted before auth, like the broker contract.
 *
 * The spec text is embedded at build time (scripts/gen-openapi-bundle.ts, CI-drift
 * guarded), so it ships with the single-container image and needs no YAML runtime.
 */
const router = Router();

// The full OpenAPI document, verbatim. OpenAPI tooling (Swagger UI, Redoc,
// openapi-generator, Postman) consumes YAML directly.
router.get("/openapi.yaml", (_req, res) => {
  res.type("application/yaml").send(OPENAPI_YAML);
});

// A small JSON discovery document — the machine-readable entry point that says
// what this API is, that it's broker-agnostic, and where to find the spec, the
// broker contract, and the other outward interfaces.
router.get("/discovery", (req, res) => {
  // Unlike the auth redirects/magic links baseUrl() also serves, this is a public,
  // unauthenticated, read-only pointer document — a spoofed Host header here can't
  // drive a redirect or land in anyone's inbox. So degrade to relative paths rather
  // than fail closed when PUBLIC_URL isn't set in a production-like deployment.
  let base = "";
  try {
    base = baseUrl(req);
  } catch (err) {
    if (!(err instanceof InsecureBaseUrlError)) throw err;
  }
  const abs = (p: string) => (base ? `${base}${p}` : p);
  res.json({
    name: OPENAPI_INFO.title === "Api" ? "OmniProject API" : OPENAPI_INFO.title,
    version: OPENAPI_INFO.version,
    brokerAgnostic: true,
    description:
      "The stable, broker-agnostic consumer API. It lives above the swappable broker seam, so it stays the same regardless of which broker reaches your backends.",
    openapi: { format: "yaml", url: abs("/api/openapi.yaml") },
    // The southbound contract a broker implements (the other half of the seam).
    brokerContract: abs("/api/contract"),
    auth: {
      session: "OIDC session cookie (Authorization Code + PKCE)",
      apiToken: "read-only Bearer token (API_TOKENS) for BI / automation",
    },
    // The other outward interfaces over the same broker-agnostic core.
    outputs: { odata: abs("/api/odata"), metrics: abs("/api/metrics"), mcp: abs("/api/mcp") },
    paths: OPENAPI_PATHS,
  });
});

export default router;
