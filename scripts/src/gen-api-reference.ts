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
// The optional in-app browser portal (served at GET /api/docs only when API_PORTAL_ENABLED is set)
// is generated from the SAME route model as the markdown, as an embeddable HTML string module.
const OUT_PORTAL = path.join(ROOT, "artifacts/api-server/src/lib/api-portal.generated.ts");

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
md.push(
  "> **Optional browser portal.** The same surface renders as a self-contained, searchable HTML page " +
  "at `GET /api/docs` — **off by default**, exposed only when `API_PORTAL_ENABLED` is set (it 404s " +
  "otherwise, so a deployment that doesn't want its route map browsable never exposes it). It is a " +
  "documentation page: it makes no calls and holds no data.",
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

// ── The optional browser portal (a self-contained, theme-aware, searchable HTML page) ──────────
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildPortal(): string {
  const rows: string[] = [];
  for (const f of files) {
    rows.push(`<section class="grp"><h2>${esc(f.rel)}</h2>${f.title ? `<p class="blurb">${esc(f.title)}</p>` : ""}<table><tbody>`);
    for (const r of f.routes) {
      const hay = esc(`${r.method} ${r.routePath} ${r.gate} ${r.doc}`).toLowerCase();
      rows.push(
        `<tr class="rt" data-h="${hay}"><td><span class="m m-${r.method}">${r.method}</span></td>` +
        `<td class="pth">${esc(r.routePath)}</td><td class="gt">${r.gate ? esc(r.gate) : "—"}</td>` +
        `<td class="dc">${r.doc ? esc(r.doc) : ""}</td></tr>`,
      );
    }
    rows.push("</tbody></table></section>");
  }
  // Self-contained: inline CSS + JS, no external requests (CSP-safe). Theme-aware via prefers-color-scheme.
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>OmniProject API</title><style>",
    ":root{--bg:#fff;--fg:#111;--mut:#666;--bd:#e2e2e2;--card:#fafafa;--acc:#1d4ed8}",
    "@media(prefers-color-scheme:dark){:root{--bg:#0b0b0c;--fg:#e8e8ea;--mut:#9a9aa2;--bd:#26262b;--card:#141417;--acc:#60a5fa}}",
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
    "header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--bd);padding:16px 20px;z-index:1}",
    "h1{font-size:18px;margin:0 0 4px}.sub{color:var(--mut);font-size:12px;margin:0 0 10px}",
    "#q{width:100%;max-width:520px;padding:8px 10px;border:1px solid var(--bd);border-radius:6px;background:var(--card);color:var(--fg);font:inherit}",
    "main{padding:8px 20px 60px}.grp{margin:22px 0}.grp h2{font-size:13px;color:var(--fg);margin:0 0 2px}.blurb{color:var(--mut);font-size:12px;margin:0 0 8px;max-width:70ch}",
    "table{width:100%;border-collapse:collapse;display:block;overflow-x:auto}td{border-top:1px solid var(--bd);padding:6px 8px;vertical-align:top}",
    ".m{display:inline-block;min-width:56px;text-align:center;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px}",
    ".m-GET{background:#16a34a22;color:#15803d}.m-POST{background:#2563eb22;color:#1d4ed8}.m-PUT{background:#d9770622;color:#b45309}.m-PATCH{background:#7c3aed22;color:#6d28d9}.m-DELETE{background:#dc262622;color:#b91c1c}.m-ALL{background:#4b556322;color:#374151}",
    "@media(prefers-color-scheme:dark){.m-GET{color:#4ade80}.m-POST{color:#60a5fa}.m-PUT{color:#fbbf24}.m-PATCH{color:#a78bfa}.m-DELETE{color:#f87171}.m-ALL{color:#9ca3af}}",
    ".pth{font-weight:600}.gt{color:var(--acc);font-size:12px}.dc{color:var(--mut);font-size:12px}.hide{display:none}#empty{color:var(--mut);padding:20px}",
    "</style></head><body>",
    `<header><h1>OmniProject API</h1><p class="sub">${total} routes · every path is under <code>/api</code> · generated from the route source. This is a documentation portal — it makes no calls. Auth &amp; roles: see the project docs.</p>`,
    '<input id="q" type="search" placeholder="Filter by path, method, gate, or description…" autocomplete="off" aria-label="Filter routes"></header>',
    `<main>${rows.join("")}<p id="empty" class="hide">No routes match.</p></main>`,
    "<script>",
    "var q=document.getElementById('q'),rows=[].slice.call(document.querySelectorAll('.rt')),grps=[].slice.call(document.querySelectorAll('.grp')),empty=document.getElementById('empty');",
    "q.addEventListener('input',function(){var t=q.value.trim().toLowerCase(),n=0;rows.forEach(function(r){var m=!t||r.getAttribute('data-h').indexOf(t)>=0;r.classList.toggle('hide',!m);if(m)n++;});",
    "grps.forEach(function(g){var any=g.querySelectorAll('.rt:not(.hide)').length>0;g.classList.toggle('hide',!any);});empty.classList.toggle('hide',n>0);});",
    "</script></body></html>",
  ].join("\n");
}

const portalHtml = buildPortal();
const portalTs = [
  "/* GENERATED by scripts/src/gen-api-reference.ts — do not edit.",
  "   Run `pnpm --filter @workspace/scripts run gen-api-reference` to regenerate. */",
  "",
  "/** The optional, self-contained API portal page (served at GET /api/docs when API_PORTAL_ENABLED). */",
  `export const API_PORTAL_HTML = ${JSON.stringify(portalHtml)};`,
  "",
].join("\n");
fs.writeFileSync(OUT_PORTAL, portalTs);

console.log(`api reference: ${total} routes across ${files.length} router files`);
console.log(`  → ${path.relative(ROOT, OUT_MD)}`);
console.log(`  → ${path.relative(ROOT, OUT_PORTAL)} (browser portal, ${portalHtml.length} bytes)`);
