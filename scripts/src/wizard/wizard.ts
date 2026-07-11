import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backendCatalogue } from "@workspace/backend-catalogue";
import {
  renderEnv, renderCompose, validateDeployConfig, effectiveBrokerUrl,
  type DeployConfig, type IdpChoice, type AiProvider,
} from "./deploy-config";
import {
  isCustomBackend, renderSkeletonWorkflow, renderKnownWorkflow, renderBindingGuide,
  renderManifestSource, renderFieldMap,
} from "./custom-backend";
import { bold as b, dim, green as ok, yellow as warn, red as err } from "../lib/ansi";

/**
 * First-run setup wizard (TUI). Interviews the operator — broker backend, IdP,
 * optional AI + logging, and the remaining operator choices — guiding the
 * questions by earlier answers, then validates the result with the gateway's own
 * security self-check and writes a known-good `.env` + `docker-compose.yml`.
 *
 * Run: `pnpm --filter @workspace/api-server wizard` (or `tsx src/wizard.ts`).
 * Pure logic lives in lib/deploy-config.ts; this file is just the readline shell.
 */

const rand = (bytes: number) => crypto.randomBytes(bytes).toString("base64url");

/** The readline question shapes every prompt* step is handed, so each is testable in isolation
 *  from the concrete TTY (a slim wrapper of the same three primitives main() used to define inline). */
interface Prompter {
  ask(q: string, def?: string): Promise<string>;
  /** Like `ask`, but the typed value is NOT echoed to the terminal (for secrets — client secrets,
   *  API keys — so they don't land in scrollback or a screen-share). */
  secret(q: string): Promise<string>;
  confirm(q: string, def?: boolean): Promise<boolean>;
  choose<T extends string>(q: string, opts: { id: T; label: string }[], def?: T): Promise<T>;
}

function makePrompter(rl: readline.Interface): Prompter {
  const ask = async (q: string, def?: string): Promise<string> => {
    const a = (await rl.question(`${q}${def ? dim(` [${def}]`) : ""} `)).trim();
    return a || def || "";
  };
  const secret = async (q: string): Promise<string> => {
    // Mute the readline echo while the secret is typed: keep newlines (so Enter still ends the line)
    // but drop the character echo. `_writeToOutput` is readline's documented hook for exactly this.
    const rlInternal = rl as unknown as { _writeToOutput?: (s: string) => void };
    const original = rlInternal._writeToOutput?.bind(rl);
    let muted = false;
    rlInternal._writeToOutput = (s: string): void => {
      if (muted && !/[\r\n]/.test(s)) return; // swallow the typed characters
      original?.(s);
    };
    stdout.write(`${q} `);
    muted = true;
    try {
      return (await rl.question("")).trim();
    } finally {
      muted = false;
      if (original) rlInternal._writeToOutput = original;
    }
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
  return { ask, secret, confirm, choose };
}

interface BrokerChoice {
  broker: DeployConfig["broker"];
  /** No shipped mapping ("custom", or an enterprise placeholder) — guided onboarding applies. */
  custom: boolean;
  backendLabel: string;
  contributeCatalogue: boolean;
}

/** Section 1: which backend, and — for a backend with no shipped mapping — the guided-onboarding
 *  questions (name, catalogue contribution) plus the broker transport (bundled n8n vs external). */
async function promptBroker(p: Prompter): Promise<BrokerChoice> {
  const cat = backendCatalogue();
  const backendId = await p.choose(
    "Which project backend are you connecting to?",
    [...cat.map((c) => ({ id: c.id, label: `${c.label}${c.tier === "enterprise" ? dim(" (enterprise)") : ""}` })), { id: "custom", label: "Other / custom (any system n8n can reach)" }],
    "jira",
  );
  const chosen = cat.find((c) => c.id === backendId);
  if (chosen?.requiredEnv?.length) {
    console.log(dim(`  ${chosen.label} needs these set in n8n: ${chosen.requiredEnv.join(", ")}`));
    if (chosen.notes) console.log(dim(`  note: ${chosen.notes}`));
  }
  // A backend with no shipped mapping ("custom", or an enterprise placeholder)
  // gets guided onboarding: a name → an id slug, then a generated workflow
  // skeleton + binding guide written alongside the compose.
  const custom = isCustomBackend(backendId);
  let backendLabel = chosen?.label ?? "Custom backend";
  let effectiveBackendId = backendId;
  let contributeCatalogue = false;
  if (custom) {
    backendLabel = (await p.ask("\n  Name this backend (free text):", chosen?.label ?? "Acme PM")) || "Custom backend";
    effectiveBackendId = (backendId === "custom" ? backendLabel : backendId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
    console.log(dim(`  I'll scaffold an n8n workflow skeleton + a step-by-step binding guide for "${backendLabel}".`));
    console.log(dim("  You'll fill in your API's endpoints/auth and verify with the smoke test — full walkthrough in the guide."));
    // Optionally promote it to a first-class catalogue entry + field map you can
    // contribute back, so the wizard + gateway know it next time.
    contributeCatalogue = await p.confirm("  Also generate a catalogue entry + field map to add this backend permanently?", true);
  }
  const bundleReferenceBroker = await p.confirm("\nBundle a ready-to-configure n8n (the reference broker) in the compose?", true);
  const brokerUrl = bundleReferenceBroker ? "" : await p.ask("External broker (n8n webhook) URL:", "https://n8n.internal/webhook/omniproject");
  const wantPsk = !bundleReferenceBroker && (await p.confirm("Encrypt the broker hop with a pre-shared key? (only if TLS isn't available on that hop)", false));
  const psk = wantPsk ? rand(32) : undefined;

  return {
    broker: { backendId: effectiveBackendId, bundleReferenceBroker, brokerUrl, ...(psk ? { psk } : {}) },
    custom, backendLabel, contributeCatalogue,
  };
}

/** Section 2: identity provider — external OIDC, bundled Authentik, or demo (no) auth. */
async function promptIdp(p: Prompter): Promise<IdpChoice> {
  const idpKind = await p.choose(
    "How will users sign in (identity provider)?",
    [
      { id: "oidc", label: "External OIDC IdP (Okta, Entra, Keycloak, Authentik you already run, …)" },
      { id: "authentik-bundled", label: "Bundle Authentik for me (adds Postgres + server + worker)" },
      { id: "none", label: "None — demo auth (everyone is admin; dev/eval ONLY)" },
    ],
    "oidc",
  );
  if (idpKind === "none") {
    console.log(warn("  ! demo auth makes every visitor an admin — never expose this publicly."));
    return { kind: "none" };
  }
  if (idpKind === "oidc") {
    const issuerUrl = await p.ask("  OIDC issuer URL (discovery base):", "https://idp.example.com/application/o/omniproject/");
    const clientId = await p.ask("  OIDC client id:");
    const clientSecret = await p.secret("  OIDC client secret:");
    return { kind: "oidc", issuerUrl, clientId, clientSecret };
  }
  console.log(dim("  Authentik will be bundled; create the OmniProject application/provider in its UI after first boot."));
  const issuerUrl = await p.ask("  Issuer URL Authentik will expose (its external origin + provider path):", "https://authentik.example.com/application/o/omniproject/");
  const clientId = await p.ask("  OIDC client id you'll configure in Authentik:", "omniproject");
  const clientSecret = (await p.secret("  OIDC client secret (blank = generate):")) || rand(32);
  return { kind: "authentik-bundled", issuerUrl, clientId, clientSecret, pgPassword: rand(24), secretKey: rand(48) };
}

/** Section 3: the optional AI assistant. */
async function promptAi(p: Prompter): Promise<{ ai: DeployConfig["ai"]; bundleOllama: boolean }> {
  const aiProvider = (await p.choose(
    "Enable the AI assistant? (optional)",
    [
      { id: "none", label: "No AI" },
      { id: "openai", label: "OpenAI" },
      { id: "openrouter", label: "OpenRouter" },
      { id: "anthropic", label: "Anthropic" },
      { id: "ollama", label: "Ollama (self-hosted local LLM)" },
    ],
    "none",
  )) as AiProvider;
  const ai: DeployConfig["ai"] = { provider: aiProvider };
  let bundleOllama = false;
  if (aiProvider !== "none") {
    ai.model = await p.ask("  Model id:", aiProvider === "anthropic" ? "claude-sonnet-4-6" : aiProvider === "ollama" ? "llama3.1" : "gpt-4o-mini");
    if (aiProvider === "ollama") {
      bundleOllama = await p.confirm("  Bundle a local Ollama service in the compose?", true);
      if (!bundleOllama) ai.ollamaUrl = await p.ask("  External Ollama URL:", "http://ollama.internal:11434");
    } else {
      ai.apiKey = await p.secret(`  ${aiProvider} API key:`);
    }
  }
  return { ai, bundleOllama };
}

interface OperatorChoices {
  loggingSyncUrl?: string;
  port: number;
  publicUrl: string;
  redisUrl?: string;
  bundleRedis?: boolean;
  reverseProxy?: DeployConfig["reverseProxy"];
}

/** Sections 4-5: optional time-travel logging, then the remaining operator choices — port, public
 *  origin, multi-replica Redis, and an optional bundled reverse proxy for TLS termination. */
async function promptOperatorChoices(p: Prompter): Promise<OperatorChoices> {
  const wantLogging = await p.confirm("\nEnable time-travel snapshots to an external logging server? (optional, the one durable egress)", false);
  const loggingSyncUrl = wantLogging ? await p.ask("  Logging sync URL:", "https://logs.example.com/omniproject") : undefined;

  const port = Number(await p.ask("\nPort for the shell:", "3000")) || 3000;
  const publicUrl = await p.ask("External https origin you'll serve this behind (PUBLIC_URL):", "https://omniproject.example.com");
  const multiReplica = await p.confirm("Run multiple replicas (adds Redis for cross-replica fan-out + shared rate limits)?", false);
  const bundleRedis = multiReplica && (await p.confirm("  Bundle a Redis service for it?", true));
  const redisUrl = multiReplica && !bundleRedis ? await p.ask("  External Redis URL:", "redis://redis.internal:6379") : undefined;

  // Reverse proxy / TLS termination. Bundling Traefik means you don't need your
  // own ingress — it gets a real cert for PUBLIC_URL's host via Let's Encrypt.
  const wantProxy = await p.confirm("Bundle a reverse proxy (Traefik) to terminate TLS for PUBLIC_URL via Let's Encrypt?", false);
  let reverseProxy: DeployConfig["reverseProxy"];
  if (wantProxy) {
    console.log(dim("  Needs PUBLIC_URL to be a real, publicly-resolvable https domain (ACME HTTP-01 on :80/:443)."));
    const host = publicUrl.replace(/^https?:\/\//, "").replace(/[:/].*$/, "") || "example.com";
    const acmeEmail = await p.ask("  Email for Let's Encrypt registration:", `admin@${host}`);
    reverseProxy = { acmeEmail };
  }

  return {
    ...(loggingSyncUrl ? { loggingSyncUrl } : {}),
    port, publicUrl,
    ...(redisUrl ? { redisUrl } : {}),
    ...(bundleRedis ? { bundleRedis } : {}),
    ...(reverseProxy ? { reverseProxy } : {}),
  };
}

/** Validate (security self-check), then — unless the operator aborts on a CRITICAL finding — write
 *  the `.env` + compose + (for a custom backend) workflow/guide/contribution files, and report. */
async function writeOutputs(config: DeployConfig, brokerChoice: BrokerChoice, p: Prompter): Promise<void> {
  const { custom, backendLabel, contributeCatalogue } = brokerChoice;
  const effectiveBackendId = config.broker.backendId;

  console.log(b("\nValidating your choices…"));
  const findings = validateDeployConfig(config);
  const crit = findings.filter((f) => f.severity === "critical");
  for (const f of findings) {
    const tag = f.severity === "critical" ? err("CRITICAL") : f.severity === "warn" ? warn("WARN") : dim("info");
    console.log(`  ${tag} ${f.id}: ${f.message}`);
  }
  if (!findings.length) console.log(ok("  no findings — looks good."));
  if (crit.length && !(await p.confirm(err("\nThere are CRITICAL findings. Write the files anyway?"), false))) {
    console.log("Aborted; nothing written. Re-run to adjust your answers.");
    return;
  }

  const outDir = path.resolve(await p.ask("\nOutput directory:", "./omniproject-deploy"));
  fs.mkdirSync(outDir, { recursive: true });
  const envPath = path.join(outDir, ".env");
  const composePath = path.join(outDir, "docker-compose.yml");
  fs.writeFileSync(envPath, renderEnv(config), { mode: 0o600 });
  fs.writeFileSync(composePath, renderCompose(config));

  // Backend workflow: a ready-to-import one for a shipped backend, or a skeleton
  // + binding guide for a custom/unsupported one (the guided-onboarding path).
  let workflowPath: string | null = null;
  let guidePath: string | null = null;
  const contribPaths: string[] = [];
  if (custom) {
    workflowPath = path.join(outDir, `${effectiveBackendId}.workflow.json`);
    guidePath = path.join(outDir, `${effectiveBackendId}-binding-guide.md`);
    fs.writeFileSync(workflowPath, renderSkeletonWorkflow(effectiveBackendId, backendLabel));
    fs.writeFileSync(guidePath, renderBindingGuide(effectiveBackendId, backendLabel));
    if (contributeCatalogue) {
      const manifestPath = path.join(outDir, `${effectiveBackendId}.backend.ts`);
      const fieldMapPath = path.join(outDir, `${effectiveBackendId}.fieldmap.json`);
      fs.writeFileSync(manifestPath, renderManifestSource(effectiveBackendId, backendLabel));
      fs.writeFileSync(fieldMapPath, renderFieldMap(effectiveBackendId));
      contribPaths.push(manifestPath, fieldMapPath);
    }
  } else {
    const wf = renderKnownWorkflow(effectiveBackendId);
    if (wf) { workflowPath = path.join(outDir, `${effectiveBackendId}.workflow.json`); fs.writeFileSync(workflowPath, wf); }
  }

  console.log(ok("\n✓ Wrote:"));
  console.log(`  ${envPath} ${dim("(chmod 600 — contains secrets; do not commit)")}`);
  console.log(`  ${composePath}`);
  if (workflowPath) console.log(`  ${workflowPath} ${dim(custom ? "(n8n skeleton — fill in your API)" : "(ready-to-import n8n workflow)")}`);
  if (guidePath) console.log(`  ${guidePath} ${dim("(step-by-step binding guide)")}`);
  for (const cp of contribPaths) console.log(`  ${cp} ${dim(cp.endsWith(".backend.ts") ? "(catalogue entry — add to BACKENDS to ship it)" : "(field map — surface/store per field)")}`);

  console.log(b("\nNext steps:"));
  console.log(`  1. Review ${path.relative(process.cwd(), composePath)} and the .env.`);
  console.log(`  2. From the repo root:  docker compose --env-file ${path.relative(process.cwd(), envPath)} -f ${path.relative(process.cwd(), composePath)} up -d`);
  if (config.broker.bundleReferenceBroker) console.log(`  3. Open n8n at http://localhost:5678, import ${workflowPath ? path.basename(workflowPath) : "your workflow"}, point BROKER_URL → ${effectiveBrokerUrl(config)}.`);
  if (custom) console.log(`  ${err("→")} New backend: follow ${guidePath ? path.basename(guidePath) : "the binding guide"} to wire your API, then verify with the smoke test.`);
  if (config.idp.kind === "authentik-bundled") console.log("  4. Configure the OmniProject provider in Authentik, then confirm the issuer URL matches.");
  console.log(`  Verify readiness:  curl ${config.publicUrl}/api/readyz\n`);
}

async function main(): Promise<void> {
  if (!stdin.isTTY) {
    console.error("The setup wizard needs an interactive terminal (TTY). Run it directly, not piped.");
    process.exit(1);
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const p = makePrompter(rl);

  try {
    console.log(b("\nOmniProject setup wizard"));
    console.log(dim("Answer a few questions; I'll validate and write a known-good .env + docker-compose.yml.\n"));

    const brokerChoice = await promptBroker(p);
    const idp = await promptIdp(p);
    const aiChoice = await promptAi(p);
    const operator = await promptOperatorChoices(p);

    const config: DeployConfig = {
      publicUrl: operator.publicUrl, port: operator.port, sessionSecret: rand(48),
      broker: brokerChoice.broker,
      idp, ai: aiChoice.ai,
      ...(operator.loggingSyncUrl ? { loggingSyncUrl: operator.loggingSyncUrl } : {}),
      ...(operator.redisUrl ? { redisUrl: operator.redisUrl } : {}),
      ...(operator.bundleRedis ? { bundleRedis: operator.bundleRedis } : {}),
      ...(aiChoice.bundleOllama ? { bundleOllama: aiChoice.bundleOllama } : {}),
      ...(operator.reverseProxy ? { reverseProxy: operator.reverseProxy } : {}),
    };

    await writeOutputs(config, brokerChoice, p);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(err("\nwizard failed:"), e instanceof Error ? e.message : e);
  process.exit(1);
});
