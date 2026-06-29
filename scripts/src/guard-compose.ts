import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";

/**
 * Compose correctness guard — parses every docker-compose file in the repo and asserts a focused set
 * of deployment-safety invariants that `docker compose config` (a pure syntax/interpolation check)
 * does NOT catch:
 *
 *   1. Every `depends_on: { x: { condition: service_healthy } }` target actually DEFINES a
 *      healthcheck — otherwise the dependant waits forever (or Compose errors at up time).
 *   2. Every image is PINNED (an explicit, non-`latest` tag or a digest) — reproducible deploys.
 *   3. Production-intent compose files (standalone/enterprise) run the gateway hardened:
 *      no-new-privileges, cap_drop ALL, read_only — matching the stateless posture.
 *   4. Traefik never exposes its dashboard via the insecure API (`--api.insecure`).
 *
 * Pure + exported so the unit test drives the same checker over fixtures. Run in CI (verify job);
 * the deploy-lint job additionally runs `docker compose config` for syntax/interpolation.
 */

export interface ComposeIssue { file: string; service?: string; message: string }

interface ComposeService {
  image?: string;
  build?: unknown;
  healthcheck?: unknown;
  depends_on?: unknown;
  security_opt?: string[];
  cap_drop?: string[];
  read_only?: boolean;
  command?: unknown;
}
interface ComposeDoc { services?: Record<string, ComposeService> }

/** An image reference is pinned when it has an explicit tag (not `latest`) or a digest. */
export function isPinnedImage(image: string): boolean {
  if (image.includes("@sha256:")) return true;
  const tag = image.slice(image.lastIndexOf(":") + 1);
  // No tag at all (no colon, or colon is part of a registry:port) ⇒ implicit :latest ⇒ not pinned.
  const hasTag = image.includes(":") && !tag.includes("/");
  return hasTag && tag !== "latest" && tag.length > 0;
}

/** Normalise depends_on (list form OR map-with-conditions) to the services that must be healthy. */
function healthDependencies(dependsOn: unknown): string[] {
  if (!dependsOn || typeof dependsOn !== "object" || Array.isArray(dependsOn)) return [];
  const out: string[] = [];
  for (const [dep, spec] of Object.entries(dependsOn as Record<string, unknown>)) {
    if (spec && typeof spec === "object" && (spec as { condition?: string }).condition === "service_healthy") out.push(dep);
  }
  return out;
}

/** Check one parsed compose document; `prod` toggles the hardening invariants. */
export function auditComposeDoc(file: string, doc: ComposeDoc, opts: { prod: boolean } = { prod: false }): ComposeIssue[] {
  const issues: ComposeIssue[] = [];
  const services = doc.services ?? {};
  const names = new Set(Object.keys(services));

  for (const [name, svc] of Object.entries(services)) {
    // (2) Pinned images (services that pull rather than build).
    if (svc.image && !isPinnedImage(svc.image)) {
      issues.push({ file, service: name, message: `image '${svc.image}' is not pinned to an explicit non-latest tag/digest` });
    }
    // (1) Healthcheck-backed depends_on.
    for (const dep of healthDependencies(svc.depends_on)) {
      if (!names.has(dep)) {
        issues.push({ file, service: name, message: `depends_on '${dep}' which is not defined in this file` });
      } else if (!services[dep]!.healthcheck) {
        issues.push({ file, service: name, message: `waits for '${dep}' to be service_healthy, but '${dep}' defines no healthcheck` });
      }
    }
    // (4) No insecure Traefik dashboard.
    const cmd = Array.isArray(svc.command) ? svc.command.join(" ") : typeof svc.command === "string" ? svc.command : "";
    if (cmd.includes("--api.insecure")) {
      issues.push({ file, service: name, message: "Traefik started with --api.insecure (exposes the dashboard unauthenticated)" });
    }
  }

  // (3) Production hardening: the gateway service must drop privileges + run read-only.
  if (opts.prod) {
    const gateway = services["omni-shell"] ?? services["gateway"];
    const gwName = services["omni-shell"] ? "omni-shell" : "gateway";
    if (gateway) {
      if (!(gateway.security_opt ?? []).some((o) => o.includes("no-new-privileges"))) {
        issues.push({ file, service: gwName, message: "gateway is missing security_opt no-new-privileges in a production compose" });
      }
      if (!(gateway.cap_drop ?? []).some((c) => c.toUpperCase() === "ALL")) {
        issues.push({ file, service: gwName, message: "gateway is missing cap_drop: [ALL] in a production compose" });
      }
      if (gateway.read_only !== true) {
        issues.push({ file, service: gwName, message: "gateway is not read_only in a production compose (stateless posture)" });
      }
    }
  }
  return issues;
}

/** The compose files in the repo and whether each carries production-deploy intent. */
export const COMPOSE_FILES: { file: string; prod: boolean }[] = [
  { file: "docker-compose.standalone.yml", prod: true },
  { file: "docker-compose.enterprise.yml", prod: true },
  { file: "docker-compose.loadtest.yml", prod: false },
  { file: "docker-compose.dev.yml", prod: false },
];

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/** Audit every repo compose file; returns all invariant violations. */
export function auditRepoCompose(root = repoRoot()): ComposeIssue[] {
  const issues: ComposeIssue[] = [];
  for (const { file, prod } of COMPOSE_FILES) {
    let doc: ComposeDoc;
    try {
      doc = parse(readFileSync(path.join(root, file), "utf8")) as ComposeDoc;
    } catch (err) {
      issues.push({ file, message: `failed to parse: ${(err as Error).message}` });
      continue;
    }
    issues.push(...auditComposeDoc(file, doc, { prod }));
  }
  return issues;
}

// CLI entry: print + exit non-zero on any violation.
if (import.meta.url === `file://${process.argv[1]}`) {
  const issues = auditRepoCompose();
  if (issues.length > 0) {
    for (const i of issues) console.error(`compose guard: ${i.file}${i.service ? ` [${i.service}]` : ""} — ${i.message}`);
    console.error(`\ncompose guard: FAILED — ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log(`compose guard: OK — ${COMPOSE_FILES.length} compose files satisfy the deployment-safety invariants.`);
}
