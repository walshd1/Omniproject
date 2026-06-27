import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEnv, renderCompose, envMap, validateDeployConfig, effectiveBrokerUrl, type DeployConfig } from "./deploy-config";

function base(over: Partial<DeployConfig> = {}): DeployConfig {
  return {
    publicUrl: "https://omni.example.com",
    port: 3000,
    sessionSecret: "a-strong-secret",
    broker: { backendId: "jira", bundleN8n: true, brokerUrl: "" },
    idp: { kind: "oidc", issuerUrl: "https://idp/realm", clientId: "omni", clientSecret: "shh" },
    ai: { provider: "none" },
    ...over,
  };
}

test("bundled n8n resolves the broker URL to the internal service", () => {
  assert.equal(effectiveBrokerUrl(base()), "http://n8n:5678/webhook/omniproject");
  assert.equal(effectiveBrokerUrl(base({ broker: { backendId: "jira", bundleN8n: false, brokerUrl: "https://n8n.acme/webhook/x" } })), "https://n8n.acme/webhook/x");
});

test("envMap carries the core + OIDC + chosen-AI vars, omits unset ones", () => {
  const env = envMap(base({ ai: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" } }));
  assert.equal(env["SESSION_SECRET"], "a-strong-secret");
  assert.equal(env["BROKER_URL"], "http://n8n:5678/webhook/omniproject");
  assert.equal(env["BACKEND_SOURCE"], "jira");
  assert.equal(env["OIDC_ISSUER_URL"], "https://idp/realm");
  assert.equal(env["AI_PROVIDER"], "openai");
  assert.equal(env["OPENAI_API_KEY"], "sk-test");
  assert.ok(!("ANTHROPIC_API_KEY" in env)); // other providers' keys not emitted
  assert.ok(!("REDIS_URL" in env)); // single replica
});

test("demo IdP omits OIDC vars and the .env carries a loud warning", () => {
  const cfg = base({ idp: { kind: "none" } });
  const env = envMap(cfg);
  assert.ok(!("OIDC_ISSUER_URL" in env));
  assert.match(renderEnv(cfg), /DEMO AUTH/);
});

test("renderCompose always has the shell; bundles n8n/redis/authentik only when chosen", () => {
  const plain = renderCompose(base());
  assert.match(plain, /omni-shell:/);
  assert.match(plain, /n8n:/);              // bundled by default here
  assert.ok(!/authentik-server:/.test(plain));
  assert.ok(!/ {2}redis:/.test(plain));

  const full = renderCompose(base({
    broker: { backendId: "jira", bundleN8n: false, brokerUrl: "https://n8n.acme/webhook/x" },
    idp: { kind: "authentik-bundled", issuerUrl: "https://idp/x", clientId: "omni", clientSecret: "s", pgPassword: "p", secretKey: "k" },
    bundleRedis: true,
  }));
  assert.ok(!/ {2}n8n:/.test(full));        // external broker → no n8n service
  assert.match(full, /authentik-server:/);
  assert.match(full, /authentik-worker:/);
  assert.match(full, /authentik_pg_data:/); // volume declared
  assert.match(full, / {2}redis:/);
  assert.match(full, /REDIS_URL:/);          // shell wired to redis
});

test("bundling a reverse proxy adds Traefik, drops the shell's host port, routes by PUBLIC_URL host", () => {
  const cfg = base({ publicUrl: "https://omni.acme.com", reverseProxy: { acmeEmail: "ops@acme.com" } });
  const compose = renderCompose(cfg);
  assert.match(compose, / {2}traefik:/);
  assert.match(compose, /traefik_letsencrypt:/);                 // ACME storage volume
  assert.match(compose, /certificatesresolvers\.le\.acme/);      // Let's Encrypt resolver
  assert.match(compose, /routers\.omni\.rule=Host\(`omni\.acme\.com`\)/);
  assert.ok(!/127\.0\.0\.1:3000:3000/.test(compose), "shell port is not published when behind Traefik");
  assert.match(renderEnv(cfg), /ACME_EMAIL=ops@acme\.com/);
});

test("bundling Ollama adds the service + volume and points the shell at it internally", () => {
  const cfg = base({ ai: { provider: "ollama", model: "llama3.1" }, bundleOllama: true });
  assert.match(renderCompose(cfg), / {2}ollama:/);
  assert.match(renderCompose(cfg), /ollama_data:/);
  assert.equal(envMap(cfg)["OLLAMA_URL"], "http://ollama:11434");
});

test("the generated compose references PUBLIC_URL + SESSION_SECRET as required vars", () => {
  const c = renderCompose(base());
  assert.match(c, /PUBLIC_URL:\s+\$\{PUBLIC_URL:\?/);
  assert.match(c, /SESSION_SECRET:\s+\$\{SESSION_SECRET:\?/);
});

test("validateDeployConfig surfaces the gateway's own findings (demo-auth, plaintext broker)", () => {
  // Demo IdP in production → the critical demo-auth finding.
  const demo = validateDeployConfig(base({ idp: { kind: "none" } }));
  assert.ok(demo.some((f) => f.id === "demo-auth-in-prod" && f.severity === "critical"));

  // Plain-http external broker to a remote host → the broker-plaintext warning.
  const http = validateDeployConfig(base({ broker: { backendId: "jira", bundleN8n: false, brokerUrl: "http://n8n.remote:5678/webhook" } }));
  assert.ok(http.some((f) => f.id === "broker-plaintext"));

  // A clean config (OIDC + bundled n8n on the internal network) → no criticals.
  assert.equal(validateDeployConfig(base()).filter((f) => f.severity === "critical").length, 0);
});
