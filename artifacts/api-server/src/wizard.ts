import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backendCatalogue } from "./lib/n8n-backends";
import {
  renderEnv, renderCompose, validateDeployConfig, effectiveBrokerUrl,
  type DeployConfig, type IdpChoice, type AiProvider,
} from "./lib/deploy-config";

/**
 * First-run setup wizard (TUI). Interviews the operator — broker backend, IdP,
 * optional AI + logging, and the remaining operator choices — guiding the
 * questions by earlier answers, then validates the result with the gateway's own
 * security self-check and writes a known-good `.env` + `docker-compose.yml`.
 *
 * Run: `pnpm --filter @workspace/api-server wizard` (or `tsx src/wizard.ts`).
 * Pure logic lives in lib/deploy-config.ts; this file is just the readline shell.
 */

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;
const err = (s: string) => `\x1b[31m${s}\x1b[0m`;
const rand = (bytes: number) => crypto.randomBytes(bytes).toString("base64url");

async function main(): Promise<void> {
  if (!stdin.isTTY) {
    console.error("The setup wizard needs an interactive terminal (TTY). Run it directly, not piped.");
    process.exit(1);
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = async (q: string, def?: string): Promise<string> => {
    const a = (await rl.question(`${q}${def ? dim(` [${def}]`) : ""} `)).trim();
    return a || def || "";
  };
  const confirm = async (q: string, def = true): Promise<boolean> => {
    const a = (await ask(`${q} ${dim(def ? "(Y/n)" : "(y/N)")}`)).toLowerCase();
    return a ? a.startsWith("y") : def;
  };
  const choose = async <T extends string>(q: string, opts: { id: T; label: string }[], def?: T): Promise<T> => {
    console.log(`\n${b(q)}`);
    opts.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}`));
    const defIdx = def ? opts.findIndex((o) => o.id === def) + 1 : 1;
    while (true) {
      const a = await ask("  choose", String(defIdx));
      const n = Number(a);
      if (Number.isInteger(n) && n >= 1 && n <= opts.length) return opts[n - 1]!.id;
      console.log(err("  please enter a number from the list"));
    }
  };

  try {
    console.log(b("\nOmniProject setup wizard"));
    console.log(dim("Answer a few questions; I'll validate and write a known-good .env + docker-compose.yml.\n"));

    // ── 1. Broker backend ─────────────────────────────────────────────────────
    const cat = backendCatalogue();
    const backendId = await choose(
      "Which project backend are you connecting to?",
      [...cat.map((c) => ({ id: c.id, label: `${c.label}${c.tier === "enterprise" ? dim(" (enterprise)") : ""}` })), { id: "custom", label: "Other / custom (any system n8n can reach)" }],
      "jira",
    );
    const chosen = cat.find((c) => c.id === backendId);
    if (chosen?.requiredEnv?.length) {
      console.log(dim(`  ${chosen.label} needs these set in n8n: ${chosen.requiredEnv.join(", ")}`));
      if (chosen.notes) console.log(dim(`  note: ${chosen.notes}`));
    }
    const bundleN8n = await confirm("\nBundle a ready-to-configure n8n (the reference broker) in the compose?", true);
    const brokerUrl = bundleN8n ? "" : await ask("External broker (n8n webhook) URL:", "https://n8n.internal/webhook/omniproject");
    const wantPsk = !bundleN8n && (await confirm("Encrypt the broker hop with a pre-shared key? (only if TLS isn't available on that hop)", false));
    const psk = wantPsk ? rand(32) : undefined;

    // ── 2. IdP ────────────────────────────────────────────────────────────────
    const idpKind = await choose(
      "How will users sign in (identity provider)?",
      [
        { id: "oidc", label: "External OIDC IdP (Okta, Entra, Keycloak, Authentik you already run, …)" },
        { id: "authentik-bundled", label: "Bundle Authentik for me (adds Postgres + server + worker)" },
        { id: "none", label: "None — demo auth (everyone is admin; dev/eval ONLY)" },
      ],
      "oidc",
    );
    let idp: IdpChoice;
    if (idpKind === "none") {
      console.log(warn("  ! demo auth makes every visitor an admin — never expose this publicly."));
      idp = { kind: "none" };
    } else if (idpKind === "oidc") {
      const issuerUrl = await ask("  OIDC issuer URL (discovery base):", "https://idp.example.com/application/o/omniproject/");
      const clientId = await ask("  OIDC client id:");
      const clientSecret = await ask("  OIDC client secret:");
      idp = { kind: "oidc", issuerUrl, clientId, clientSecret };
    } else {
      console.log(dim("  Authentik will be bundled; create the OmniProject application/provider in its UI after first boot."));
      const issuerUrl = await ask("  Issuer URL Authentik will expose (its external origin + provider path):", "https://authentik.example.com/application/o/omniproject/");
      const clientId = await ask("  OIDC client id you'll configure in Authentik:", "omniproject");
      const clientSecret = (await ask("  OIDC client secret (blank = generate):")) || rand(32);
      idp = { kind: "authentik-bundled", issuerUrl, clientId, clientSecret, pgPassword: rand(24), secretKey: rand(48) };
    }

    // ── 3. Optional AI ────────────────────────────────────────────────────────
    const aiProvider = (await choose(
      "Enable the AI assistant? (optional)",
      [
        { id: "none", label: "No AI" },
        { id: "openai", label: "OpenAI" },
        { id: "openrouter", label: "OpenRouter" },
        { id: "anthropic", label: "Anthropic" },
        { id: "ollama", label: "Ollama (self-hosted, external)" },
      ],
      "none",
    )) as AiProvider;
    const ai: DeployConfig["ai"] = { provider: aiProvider };
    if (aiProvider !== "none") {
      ai.model = await ask("  Model id:", aiProvider === "anthropic" ? "claude-sonnet-4-6" : aiProvider === "ollama" ? "llama3.1" : "gpt-4o-mini");
      if (aiProvider === "ollama") ai.ollamaUrl = await ask("  Ollama URL:", "http://ollama:11434");
      else ai.apiKey = await ask(`  ${aiProvider} API key:`);
    }

    // ── 4. Optional logging / time-travel ─────────────────────────────────────
    const wantLogging = await confirm("\nEnable time-travel snapshots to an external logging server? (optional, the one durable egress)", false);
    const loggingSyncUrl = wantLogging ? await ask("  Logging sync URL:", "https://logs.example.com/omniproject") : undefined;

    // ── 5. Other operator choices ─────────────────────────────────────────────
    const port = Number(await ask("\nPort for the shell:", "3000")) || 3000;
    const publicUrl = await ask("External https origin you'll serve this behind (PUBLIC_URL):", "https://omniproject.example.com");
    const multiReplica = await confirm("Run multiple replicas (adds Redis for cross-replica fan-out + shared rate limits)?", false);
    const bundleRedis = multiReplica && (await confirm("  Bundle a Redis service for it?", true));
    const redisUrl = multiReplica && !bundleRedis ? await ask("  External Redis URL:", "redis://redis.internal:6379") : undefined;

    const config: DeployConfig = {
      publicUrl, port, sessionSecret: rand(48),
      broker: { backendId, bundleN8n, brokerUrl, ...(psk ? { psk } : {}) },
      idp, ai,
      ...(loggingSyncUrl ? { loggingSyncUrl } : {}),
      ...(redisUrl ? { redisUrl } : {}),
      ...(bundleRedis ? { bundleRedis } : {}),
    };

    // ── Validate (security self-check) ────────────────────────────────────────
    console.log(b("\nValidating your choices…"));
    const findings = validateDeployConfig(config);
    const crit = findings.filter((f) => f.severity === "critical");
    for (const f of findings) {
      const tag = f.severity === "critical" ? err("CRITICAL") : f.severity === "warn" ? warn("WARN") : dim("info");
      console.log(`  ${tag} ${f.id}: ${f.message}`);
    }
    if (!findings.length) console.log(ok("  no findings — looks good."));
    if (crit.length && !(await confirm(err("\nThere are CRITICAL findings. Write the files anyway?"), false))) {
      console.log("Aborted; nothing written. Re-run to adjust your answers.");
      return;
    }

    // ── Write ─────────────────────────────────────────────────────────────────
    const outDir = path.resolve(await ask("\nOutput directory:", "./omniproject-deploy"));
    fs.mkdirSync(outDir, { recursive: true });
    const envPath = path.join(outDir, ".env");
    const composePath = path.join(outDir, "docker-compose.yml");
    fs.writeFileSync(envPath, renderEnv(config), { mode: 0o600 });
    fs.writeFileSync(composePath, renderCompose(config));

    console.log(ok("\n✓ Wrote:"));
    console.log(`  ${envPath} ${dim("(chmod 600 — contains secrets; do not commit)")}`);
    console.log(`  ${composePath}`);
    console.log(b("\nNext steps:"));
    console.log(`  1. Review ${path.relative(process.cwd(), composePath)} and the .env.`);
    console.log(`  2. From the repo root:  docker compose --env-file ${path.relative(process.cwd(), envPath)} -f ${path.relative(process.cwd(), composePath)} up -d`);
    if (config.broker.bundleN8n) console.log(`  3. Open n8n at http://localhost:5678, import the ${chosen?.label ?? backendId} workflow, point BROKER_URL → ${effectiveBrokerUrl(config)}.`);
    if (idp.kind === "authentik-bundled") console.log("  4. Configure the OmniProject provider in Authentik, then confirm the issuer URL matches.");
    console.log(`  Verify readiness:  curl ${config.publicUrl}/api/readyz\n`);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(err("\nwizard failed:"), e instanceof Error ? e.message : e);
  process.exit(1);
});
