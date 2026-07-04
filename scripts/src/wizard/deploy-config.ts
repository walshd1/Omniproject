import { securityFindings, type SecurityFinding } from "../../../artifacts/api-server/src/lib/security-check";

/**
 * Deployment config model + pure generators for the first-run setup wizard.
 *
 * This module is PURE and unit-tested: given an operator's choices it renders a
 * `.env` and a known-good `docker-compose.yml`. The interactive TUI (wizard.ts)
 * is a thin readline shell that builds a `DeployConfig` and calls these — exactly
 * the "pure formatter + thin shell" split used elsewhere (lib/metrics.ts).
 *
 * The generated compose mirrors the vetted reference files
 * (docker-compose.enterprise.yml / .standalone.yml) so the output is genuinely
 * deployable, not a sketch: same images, healthchecks, hardening
 * (no-new-privileges, read-only shell, loopback port binding).
 */

export type AiProvider = "none" | "openai" | "openrouter" | "anthropic" | "ollama";

export type IdpChoice =
  | { kind: "none" } // demo auth — everyone admin; dev/eval only
  | { kind: "oidc"; issuerUrl: string; clientId: string; clientSecret: string }
  | { kind: "authentik-bundled"; pgPassword: string; secretKey: string; clientId: string; clientSecret: string; issuerUrl: string };

export interface DeployConfig {
  /** External https origin the shell is served behind (OIDC redirect base). */
  publicUrl: string;
  port: number;
  sessionSecret: string;
  broker: {
    /** A catalogue id (jira, openproject, …) or "custom" — routing hint only. */
    backendId: string;
    /** Bundle a standalone reference-broker (n8n) service, or point BROKER_URL at an external one. */
    bundleReferenceBroker: boolean;
    /** Used when bundleReferenceBroker is false. */
    brokerUrl: string;
    /** Optional app-layer broker encryption (fallback below TLS). */
    psk?: string;
  };
  idp: IdpChoice;
  ai: { provider: AiProvider; model?: string; apiKey?: string; ollamaUrl?: string };
  /** Optional time-travel/logging snapshot server (the one durable egress). */
  loggingSyncUrl?: string;
  /** Optional shared Redis for multi-replica fan-out. */
  redisUrl?: string;
  /** Bundle a Redis service (implies redisUrl=redis://redis:6379). */
  bundleRedis?: boolean;
  /** Bundle a Traefik reverse proxy that terminates TLS for PUBLIC_URL via
   *  Let's Encrypt (so you don't have to front it with your own ingress). */
  reverseProxy?: { acmeEmail: string };
  /** Bundle a local Ollama service (only meaningful when ai.provider==="ollama"). */
  bundleOllama?: boolean;
}

const INTERNAL_REFERENCE_BROKER_URL = "http://reference-broker:5678/webhook/omniproject";
const INTERNAL_REDIS_URL = "redis://redis:6379";
const INTERNAL_OLLAMA_URL = "http://ollama:11434";

/** The host portion of PUBLIC_URL (for the Traefik router rule). */
export function publicHost(c: DeployConfig): string {
  try {
    return new URL(c.publicUrl).host;
  } catch {
    return c.publicUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** The effective broker URL (internal reference-broker when bundled, else the external one). */
export function effectiveBrokerUrl(c: DeployConfig): string {
  return c.broker.bundleReferenceBroker ? INTERNAL_REFERENCE_BROKER_URL : c.broker.brokerUrl;
}

/** The effective Redis URL (internal when bundled, else the external one). */
export function effectiveRedisUrl(c: DeployConfig): string | undefined {
  return c.bundleRedis ? INTERNAL_REDIS_URL : c.redisUrl?.trim() || undefined;
}

// ── .env rendering ────────────────────────────────────────────────────────────

/** Build the env map the gateway will see (also what we validate). */
export function envMap(c: DeployConfig): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: "production",
    PORT: String(c.port),
    PUBLIC_URL: c.publicUrl,
    SESSION_SECRET: c.sessionSecret,
    BROKER_URL: effectiveBrokerUrl(c),
    BACKEND_SOURCE: c.broker.backendId,
  };
  if (c.broker.psk?.trim()) env["BROKER_PSK"] = c.broker.psk.trim();

  if (c.idp.kind === "oidc" || c.idp.kind === "authentik-bundled") {
    env["OIDC_ISSUER_URL"] = c.idp.issuerUrl;
    env["OIDC_CLIENT_ID"] = c.idp.clientId;
    env["OIDC_CLIENT_SECRET"] = c.idp.clientSecret;
  }
  if (c.idp.kind === "authentik-bundled") {
    env["AUTHENTIK_PG_PASSWORD"] = c.idp.pgPassword;
    env["AUTHENTIK_SECRET_KEY"] = c.idp.secretKey;
  }

  env["AI_PROVIDER"] = c.ai.provider;
  if (c.ai.provider !== "none") {
    if (c.ai.model) env["AI_MODEL"] = c.ai.model;
    if (c.ai.provider === "openai" && c.ai.apiKey) env["OPENAI_API_KEY"] = c.ai.apiKey;
    if (c.ai.provider === "openrouter" && c.ai.apiKey) env["OPENROUTER_API_KEY"] = c.ai.apiKey;
    if (c.ai.provider === "anthropic" && c.ai.apiKey) env["ANTHROPIC_API_KEY"] = c.ai.apiKey;
    if (c.ai.provider === "ollama") {
      const url = c.bundleOllama ? INTERNAL_OLLAMA_URL : c.ai.ollamaUrl;
      if (url) env["OLLAMA_URL"] = url;
    }
  }

  if (c.loggingSyncUrl?.trim()) env["LOGGING_SYNC_URL"] = c.loggingSyncUrl.trim();
  const redis = effectiveRedisUrl(c);
  if (redis) env["REDIS_URL"] = redis;
  return env;
}

/** Render the `.env` file (compose reads it for ${VAR} substitution). */
export function renderEnv(c: DeployConfig): string {
  const env = envMap(c);
  const lines = [
    "# Generated by the OmniProject setup wizard. Review before deploying.",
    "# Secrets are in plaintext here — keep this file out of version control.",
    "",
  ];
  for (const [k, v] of Object.entries(env)) lines.push(`${k}=${v}`);
  // Compose-only vars (consumed by bundled services, not the gateway runtime).
  if (c.reverseProxy) lines.push("", "# Reverse proxy (Traefik) — Let's Encrypt registration address.", `ACME_EMAIL=${c.reverseProxy.acmeEmail}`);
  if (c.idp.kind === "none") {
    lines.push(
      "",
      "# WARNING: no IdP configured → DEMO AUTH (every user is admin).",
      "# Do NOT use this in production. Re-run the wizard and choose an IdP.",
    );
  }
  return lines.join("\n") + "\n";
}

// ── docker-compose rendering ────────────────────────────────────────────────────

function shellService(c: DeployConfig): string {
  const oidc = c.idp.kind !== "none";
  const redis = !!effectiveRedisUrl(c);
  const envLines = [
    "      NODE_ENV: production",
    `      PORT: ${c.port}`,
    "      PUBLIC_URL: ${PUBLIC_URL:?set PUBLIC_URL to the external https origin}",
    "      BROKER_URL: ${BROKER_URL}",
    "      BACKEND_SOURCE: ${BACKEND_SOURCE:-all}",
    ...(c.broker.psk ? ["      BROKER_PSK: ${BROKER_PSK:-}"] : []),
    "      SESSION_SECRET: ${SESSION_SECRET:?set SESSION_SECRET (long random string)}",
    ...(oidc
      ? [
          "      OIDC_ISSUER_URL: ${OIDC_ISSUER_URL:?set OIDC_ISSUER_URL (https) to your IdP}",
          "      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:?set OIDC_CLIENT_ID}",
          "      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:?set OIDC_CLIENT_SECRET}",
        ]
      : []),
    "      AI_PROVIDER: ${AI_PROVIDER:-none}",
    ...(c.ai.provider !== "none" ? ["      AI_MODEL: ${AI_MODEL:-}"] : []),
    ...(c.ai.provider === "openai" ? ["      OPENAI_API_KEY: ${OPENAI_API_KEY:-}"] : []),
    ...(c.ai.provider === "openrouter" ? ["      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}"] : []),
    ...(c.ai.provider === "anthropic" ? ["      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}"] : []),
    ...(c.ai.provider === "ollama" ? ["      OLLAMA_URL: ${OLLAMA_URL:-}"] : []),
    ...(c.loggingSyncUrl ? ["      LOGGING_SYNC_URL: ${LOGGING_SYNC_URL:-}"] : []),
    ...(redis ? ["      REDIS_URL: ${REDIS_URL:-}"] : []),
  ];
  // Behind Traefik, the shell isn't published to the host — Traefik routes to it
  // in-network and terminates TLS. Otherwise we publish the port on loopback.
  const proxy = c.reverseProxy;
  const portOrLabels = proxy
    ? [
        "    labels:",
        '      - "traefik.enable=true"',
        `      - "traefik.http.routers.omni.rule=Host(\`${publicHost(c)}\`)"`,
        '      - "traefik.http.routers.omni.entrypoints=websecure"',
        '      - "traefik.http.routers.omni.tls=true"',
        '      - "traefik.http.routers.omni.tls.certresolver=le"',
        `      - "traefik.http.services.omni.loadbalancer.server.port=${c.port}"`,
      ]
    : ["    ports:", `      - "127.0.0.1:${c.port}:${c.port}"`];
  // One depends_on block covering every bundled dependency (never duplicate keys).
  const deps: string[] = [];
  if (c.broker.bundleReferenceBroker) deps.push("      reference-broker:\n        condition: service_healthy");
  if (proxy) deps.push("      traefik:\n        condition: service_healthy");
  const dependsBlock = deps.length ? [`    depends_on:\n${deps.join("\n")}`] : [];
  return [
    "  # ── OmniProject shell (SPA + gateway) ───────────────────────────────────────",
    "  omni-shell:",
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile",
    "    image: omniproject-shell:latest",
    "    container_name: omni-shell",
    ...portOrLabels,
    "    security_opt:",
    "      - no-new-privileges:true",
    "    cap_drop:",
    "      - ALL",
    "    read_only: true",
    "    tmpfs:",
    "      - /tmp",
    "    environment:",
    ...envLines,
    ...dependsBlock,
    "    healthcheck:",
    `      test: ["CMD", "node", "-e", "require('http').get('http://localhost:${c.port}/api/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]`,
    "      interval: 10s",
    "      timeout: 3s",
    "      retries: 5",
    "      start_period: 20s",
    "    networks:",
    "      - omni-net",
    "    mem_limit: 512m",
    "    restart: unless-stopped",
  ].join("\n");
}

function referenceBrokerService(): string {
  return [
    "  # ── reference broker (n8n) ──────────────────────────────────────────────────",
    "  reference-broker:",
    "    image: n8nio/n8n:1.123.61",
    "    container_name: omni-reference-broker",
    "    ports:",
    '      - "127.0.0.1:5678:5678"',
    "    security_opt:",
    "      - no-new-privileges:true",
    "    environment:",
    "      N8N_PORT: 5678",
    "      GENERIC_TIMEZONE: UTC",
    "      DB_TYPE: sqlite",
    "      WEBHOOK_URL: ${REFERENCE_BROKER_PUBLIC_URL:-http://localhost:5678/}",
    "    volumes:",
    "      - reference_broker_data:/home/node/.n8n",
    "    healthcheck:",
    `      test: ["CMD", "node", "-e", "require('http').get('http://localhost:5678/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]`,
    "      interval: 10s",
    "      timeout: 3s",
    "      retries: 10",
    "      start_period: 20s",
    "    networks:",
    "      - omni-net",
    "    mem_limit: 1g",
    "    restart: unless-stopped",
  ].join("\n");
}

function redisService(): string {
  return [
    "  # ── Redis (multi-replica fan-out + shared rate limit) ───────────────────────",
    "  redis:",
    "    image: redis:7.4-alpine",
    "    container_name: omni-redis",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    command: [\"redis-server\", \"--save\", \"\", \"--appendonly\", \"no\"]",
    "    healthcheck:",
    '      test: ["CMD", "redis-cli", "ping"]',
    "      interval: 10s",
    "      timeout: 3s",
    "      retries: 5",
    "    networks:",
    "      - omni-net",
    "    mem_limit: 256m",
    "    restart: unless-stopped",
  ].join("\n");
}

function traefikService(): string {
  return [
    "  # ── Traefik (reverse proxy + automatic TLS via Let's Encrypt) ───────────────",
    "  traefik:",
    "    image: traefik:v3.7.5",
    "    container_name: omni-traefik",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    command:",
    '      - "--ping=true"',
    '      - "--providers.docker=true"',
    '      - "--providers.docker.exposedbydefault=false"',
    '      - "--entrypoints.web.address=:80"',
    '      - "--entrypoints.websecure.address=:443"',
    '      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"',
    '      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"',
    '      - "--certificatesresolvers.le.acme.email=${ACME_EMAIL:?set ACME_EMAIL for Let\'s Encrypt}"',
    '      - "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json"',
    '      - "--certificatesresolvers.le.acme.httpchallenge=true"',
    '      - "--certificatesresolvers.le.acme.httpchallenge.entrypoint=web"',
    '      - "--log.level=WARN"',
    "    ports:",
    '      - "80:80"',
    '      - "443:443"',
    "    volumes:",
    '      - "/var/run/docker.sock:/var/run/docker.sock:ro"',
    '      - "traefik_letsencrypt:/letsencrypt"',
    "    healthcheck:",
    '      test: ["CMD", "traefik", "healthcheck", "--ping"]',
    "      interval: 10s",
    "      timeout: 3s",
    "      retries: 5",
    "      start_period: 10s",
    "    networks:",
    "      - omni-net",
    "    restart: unless-stopped",
  ].join("\n");
}

function ollamaService(): string {
  return [
    "  # ── Ollama (local LLM) ──────────────────────────────────────────────────────",
    "  ollama:",
    "    image: ollama/ollama:0.30.10",
    "    container_name: omni-ollama",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    volumes:",
    "      - ollama_data:/root/.ollama",
    "    healthcheck:",
    '      test: ["CMD", "ollama", "list"]',
    "      interval: 15s",
    "      timeout: 5s",
    "      retries: 5",
    "      start_period: 20s",
    "    networks:",
    "      - omni-net",
    "    mem_limit: 4g",
    "    restart: unless-stopped",
  ].join("\n");
}

function authentikServices(): string {
  const pg =
    "      AUTHENTIK_POSTGRESQL__HOST: authentik-postgres\n" +
    "      AUTHENTIK_POSTGRESQL__USER: authentik\n" +
    "      AUTHENTIK_POSTGRESQL__PASSWORD: ${AUTHENTIK_PG_PASSWORD:?set AUTHENTIK_PG_PASSWORD}\n" +
    "      AUTHENTIK_POSTGRESQL__NAME: authentik\n" +
    "      AUTHENTIK_SECRET_KEY: ${AUTHENTIK_SECRET_KEY:?set AUTHENTIK_SECRET_KEY (50+ random chars)}";
  return [
    "  # ── Authentik (bundled IdP) ─────────────────────────────────────────────────",
    "  authentik-postgres:",
    "    image: postgres:16.14-alpine",
    "    container_name: omni-authentik-pg",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    environment:",
    "      POSTGRES_DB: authentik",
    "      POSTGRES_USER: authentik",
    "      POSTGRES_PASSWORD: ${AUTHENTIK_PG_PASSWORD:?set AUTHENTIK_PG_PASSWORD}",
    "    volumes:",
    "      - authentik_pg_data:/var/lib/postgresql/data",
    "    healthcheck:",
    '      test: ["CMD-SHELL", "pg_isready -U authentik -d authentik"]',
    "      interval: 10s",
    "      timeout: 3s",
    "      retries: 5",
    "      start_period: 10s",
    "    networks:",
    "      - omni-net",
    "    mem_limit: 512m",
    "    restart: unless-stopped",
    "",
    "  authentik-server:",
    "    image: ghcr.io/goauthentik/server:2026.5.3",
    "    container_name: omni-authentik-server",
    "    command: server",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    environment:",
    pg,
    "      AUTHENTIK_ERROR_REPORTING__ENABLED: \"false\"",
    "    volumes:",
    "      - authentik_media:/media",
    "    depends_on:",
    "      authentik-postgres:",
    "        condition: service_healthy",
    "    healthcheck:",
    '      test: ["CMD", "ak", "healthcheck"]',
    "      interval: 15s",
    "      timeout: 5s",
    "      retries: 10",
    "      start_period: 90s",
    "    networks:",
    "      - omni-net",
    "    mem_limit: 1g",
    "    restart: unless-stopped",
    "",
    "  authentik-worker:",
    "    image: ghcr.io/goauthentik/server:2026.5.3",
    "    container_name: omni-authentik-worker",
    "    command: worker",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    environment:",
    pg,
    "    volumes:",
    "      - authentik_media:/media",
    "    depends_on:",
    "      authentik-postgres:",
    "        condition: service_healthy",
    "    healthcheck:",
    '      test: ["CMD", "ak", "healthcheck"]',
    "      interval: 15s",
    "      timeout: 5s",
    "      retries: 10",
    "      start_period: 90s",
    "    networks:",
    "      - omni-net",
    "    mem_limit: 1g",
    "    restart: unless-stopped",
  ].join("\n");
}

/** Render the full known-good docker-compose.yml for these choices. */
export function renderCompose(c: DeployConfig): string {
  // Traefik first so it's the obvious ingress; then the shell and its deps.
  const services: string[] = [];
  if (c.reverseProxy) services.push(traefikService());
  services.push(shellService(c));
  if (c.broker.bundleReferenceBroker) services.push(referenceBrokerService());
  if (c.bundleRedis) services.push(redisService());
  if (c.bundleOllama) services.push(ollamaService());
  if (c.idp.kind === "authentik-bundled") services.push(authentikServices());

  const volumes: string[] = [];
  if (c.broker.bundleReferenceBroker) volumes.push("  reference_broker_data:");
  if (c.bundleOllama) volumes.push("  ollama_data:");
  if (c.reverseProxy) volumes.push("  traefik_letsencrypt:");
  if (c.idp.kind === "authentik-bundled") volumes.push("  authentik_pg_data:", "  authentik_media:");

  const tlsNote = c.reverseProxy
    ? "# Traefik terminates TLS for PUBLIC_URL automatically via Let's Encrypt."
    : "# This profile does NOT terminate TLS; front it with your own reverse proxy /\n# ingress and set PUBLIC_URL to the https origin (cookie is Secure in production).";
  const out = [
    "name: omniproject",
    "",
    "# Generated by the OmniProject setup wizard — a known-good starting point.",
    "# Reads values from the sibling .env.",
    tlsNote,
    "",
    "networks:",
    "  omni-net:",
    "    driver: bridge",
    "",
  ];
  if (volumes.length) out.push("volumes:", ...volumes, "");
  out.push("services:", services.join("\n\n"));
  return out.join("\n") + "\n";
}

// ── Validation (the "guided correctness gate") ──────────────────────────────────

/** Run the gateway's own security self-check against the chosen config so the
 *  wizard can warn BEFORE writing files (e.g. demo-auth, plaintext broker). */
export function validateDeployConfig(c: DeployConfig): SecurityFinding[] {
  return securityFindings(envMap(c));
}
