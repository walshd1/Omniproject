/**
 * API-reference generator.
 *
 * Emits docs/API-REFERENCE.md: the complete northbound HTTP surface of the gateway — every
 * registered route, its method, its full `/api`-prefixed path, the inline auth/RBAC gate, and the
 * one-line description from the route's own comment. Unlike the hand-written OpenAPI spec
 * (lib/api-spec/openapi.yaml), which is the CODEGEN contract scoped to what the SPA client consumes,
 * this reference documents the WHOLE surface — admin, security, setup, AI, SCIM, auth, costing, and
 * feature-config endpoints included.
 *
 * It reads the truth directly from the route source via the TypeScript AST (every `router.<method>`
 * call, plus the `settingsCollectionRouter({...})` factory), so it cannot drift from the code: a CI
 * guard regenerates it and fails the build if it is stale, exactly like the function-map and
 * broker-contract generators. Output is deterministic (no timestamps).
 *
 * Run: pnpm --filter @workspace/scripts run gen-api-reference
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./lib/walk-files";
import { escapeTableCell } from "./lib/markdown";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ROUTES_DIR = path.join(ROOT, "artifacts/api-server/src/routes");
const OUT_MD = path.join(ROOT, "docs/API-REFERENCE.md");

const METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);
// Middleware whose presence on a route we surface as its gate. Call-forms carry a string arg
// (requireRole("manager")); bare identifiers do not (requireAuth).
const GATE_CALLS = new Set(["requireRole", "requireAnyRole", "requireEntitlement", "requireFeature"]);
const GATE_IDENTS = new Set(["requireAuth", "requireStepUp", "requireAdmin", "requireRealAdmin", "requireDevMode"]);

// Files mounted at the app root rather than under /api (the sole exception to the single mount).
const APP_ROOT_FILES = new Set(["well-known.ts"]);

interface RouteEntry { method: string; routePath: string; gate: string; doc: string }
interface FileRoutes { rel: string; title: string; routes: RouteEntry[] }

/** First sentence of a leading comment run (mirrors the function-map summariser, minimally). */
function firstLine(comment: string): string {
  const body = comment
    .replace(/^\/\*+/, "").replace(/\*+\/$/, "")
    .split("\n").map((l) => l.replace(/^\s*[/*]+/, "").replace(/─+/g, "").trim());
  const lead: string[] = [];
  for (const l of body) { if (!l) { if (lead.length) break; else continue; } lead.push(l); }
  const text = lead.join(" ").replace(/\s+/g, " ").trim();
  const m = /(?<!\b(?:e\.g|i\.e|etc|vs|cf))\. /.exec(text);
  return m ? text.slice(0, m.index + 1) : text;
}

function leadingComment(fullText: string, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
  if (!ranges.length) return "";
  const last = ranges[ranges.length - 1]!;
  return firstLine(fullText.slice(last.pos, last.end));
}

/** Collect the gate label for a route from its middleware arguments. */
function gateFrom(args: readonly ts.Expression[]): string {
  const parts: string[] = [];
  for (const arg of args) {
    if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && GATE_CALLS.has(arg.expression.text)) {
      const strs = arg.arguments.filter(ts.isStringLiteral).map((s) => s.text);
      parts.push(strs.length ? `${arg.expression.text}(${strs.join(", ")})` : arg.expression.text);
    } else if (ts.isIdentifier(arg) && GATE_IDENTS.has(arg.text)) {
      parts.push(arg.text);
    }
  }
  return parts.join(" + ");
}

function readFile(abs: string, rel: string): FileRoutes {
  const fullText = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, fullText, ts.ScriptTarget.Latest, true);
  const base = APP_ROOT_FILES.has(path.basename(rel)) ? "" : "/api";
  const routes: RouteEntry[] = [];
  let title = "";
  for (const stmt of sf.statements) {
    if (!title) { const r = ts.getLeadingCommentRanges(fullText, stmt.getFullStart()) ?? []; if (r.length) title = firstLine(fullText.slice(r[0]!.pos, r[0]!.end)); }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // router.<method>("path", ...gates, handler)
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "router"
        && METHODS.has(callee.name.text) && node.arguments.length && ts.isStringLiteral(node.arguments[0]!)) {
        const p = (node.arguments[0] as ts.StringLiteral).text;
        routes.push({ method: callee.name.text.toUpperCase(), routePath: base + p, gate: gateFrom(node.arguments.slice(1)), doc: leadingComment(fullText, ts.isExpressionStatement(node.parent) ? node.parent : node) });
      }
      // settingsCollectionRouter({ path: "/x", writeGuards: [requireRole("pmo")] }) → GET (open) + PUT (guarded)
      else if (ts.isIdentifier(callee) && callee.text === "settingsCollectionRouter" && node.arguments.length && ts.isObjectLiteralExpression(node.arguments[0]!)) {
        const obj = node.arguments[0] as ts.ObjectLiteralExpression;
        const pathProp = obj.properties.find((pr): pr is ts.PropertyAssignment => ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === "path");
        const guardsProp = obj.properties.find((pr): pr is ts.PropertyAssignment => ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === "writeGuards");
        if (pathProp && ts.isStringLiteral(pathProp.initializer)) {
          const p = base + pathProp.initializer.text;
          const writeGate = guardsProp && ts.isArrayLiteralExpression(guardsProp.initializer) ? gateFrom(guardsProp.initializer.elements) : "";
          routes.push({ method: "GET", routePath: p, gate: "requireAuth", doc: "Read the collection." });
          routes.push({ method: "PUT", routePath: p, gate: ["requireAuth", writeGate].filter(Boolean).join(" + "), doc: "Replace the collection (write-guarded)." });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { rel, title, routes };
}

// ── Build ─────────────────────────────────────────────────────────────────────
const files = walkFiles(ROUTES_DIR, { extensions: [".ts"], excludeSuffixes: [".test.ts"] })
  .map((abs) => ({ abs, rel: path.relative(ROOT, abs) }))
  .filter(({ rel }) => !rel.includes("/__tests__/") && !rel.endsWith("/_harness.ts"))
  .sort((a, b) => a.rel.localeCompare(b.rel))
  .map(({ abs, rel }) => readFile(abs, rel))
  .filter((f) => f.routes.length > 0);

// ── Emit ────────────────────────────────────────────────────────────────────────
const md: string[] = [];
md.push("<!-- GENERATED by scripts/src/gen-api-reference.ts — do not edit. Run `pnpm --filter @workspace/scripts run gen-api-reference`. -->");
md.push("# API reference (northbound HTTP)");
md.push("");
md.push(
  "The complete northbound HTTP surface of the gateway — every registered route grouped by router " +
  "file, with its method, full `/api`-prefixed path, the inline auth/RBAC gate, and the one-line " +
  "description from the route's own source comment. This is **generated** from the route source and " +
  "kept honest by a CI drift guard, so it cannot lie about the code.",
);
md.push("");
md.push(
  "> This complements — it does not duplicate — the OpenAPI spec (`lib/api-spec/openapi.yaml`), which " +
  "is the **codegen contract** deliberately scoped to the core CRUD the SPA client consumes. This " +
  "page is the full surface (admin, security, setup, AI, SCIM, auth, costing, feature-config).",
);
md.push("");
md.push("## Authentication & roles");
md.push("");
md.push("- **Session cookie** — OIDC (also SAML, OAuth2, magic-link, demo); signed httpOnly; full read + write. Cookie-authed mutations pass a CSRF guard.");
md.push("- **Read-only API token** — `Authorization: Bearer <t>` or `X-API-Key: <t>` (`API_TOKENS`); **GET only** (mutations → 403), maps to the viewer grant, optionally programme-scoped.");
md.push("- **Out-of-band secrets** (not the user ladder): `SCIM_TOKEN` for `/api/scim/v2/*`, `NOTIFY_INGEST_SECRET` for `/api/notifications/ingest`, `BREAK_GLASS_TOKEN` for `/api/break-glass/*`.");
md.push("- **Role ladder** — viewer < contributor < manager, plus two orthogonal authorities **pmo** (business governance) and **admin** (technical config); pmo/admin also require strong (WebAuthn) MFA in real-SSO mode. See [`ops/ROLES.md`](ops/ROLES.md).");
md.push("");
md.push(
  "The **Gate** column shows gates declared inline on the route. Most routes additionally sit behind " +
  "the `requireAuth` baseline (a valid session or read-only token) applied at mount; a blank gate on a " +
  "non-public route still requires an authenticated session. Deeper semantics: [`ops/RAW-API.md`](ops/RAW-API.md), " +
  "[`MCP.md`](MCP.md), [`SSO-SCIM.md`](SSO-SCIM.md), [`CONTRACT.md`](CONTRACT.md) (the separate southbound broker contract).",
);
md.push("");

let total = 0;
md.push("## Endpoints by router");
md.push("");
for (const f of files) {
  md.push(`### \`${f.rel}\``);
  md.push("");
  if (f.title) { md.push(f.title); md.push(""); }
  md.push("| Method | Path | Gate | Description |");
  md.push("| --- | --- | --- | --- |");
  for (const r of f.routes) {
    total++;
    md.push(`| ${r.method} | \`${r.routePath}\` | ${r.gate ? escapeTableCell(r.gate) : "—"} | ${r.doc ? escapeTableCell(r.doc) : "—"} |`);
  }
  md.push("");
}

fs.writeFileSync(OUT_MD, md.join("\n") + "\n");
console.log(`api reference: ${total} routes across ${files.length} router files → ${path.relative(ROOT, OUT_MD)}`);
