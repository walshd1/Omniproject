import { backendCatalogue } from "@workspace/backend-catalogue";

/**
 * Connection-credential scaffolding — works out WHICH credentials a deployment's
 * brokers need for the vendors they reach (each vendor declares its `requiredEnv`)
 * and renders a fill-in template for the operator's secret store.
 *
 * It deliberately deals ONLY in credential NAMES, never values: OmniProject stays
 * stateless and never receives or stores a vendor secret. The secret lives with the
 * thing that uses it — the broker's env / Docker secret / credential vault. This is
 * the same "author the scaffolding, the operator supplies the secret" model as the
 * gateway's own config export.
 */

export interface RequiredCredential {
  /** The env var name the broker must provide. */
  name: string;
  /** True when the name looks like a secret (vs a plain URL/config value). */
  secret: boolean;
  /** Which selected backends require it. */
  backends: string[];
}

const SECRET_RE = /(TOKEN|KEY|SECRET|AUTH|PASSWORD|PAT|CRED|APIKEY)/i;

/** Heuristic: is this env var a secret to protect (vs a plain instance URL etc.)? */
export function isSecretEnv(name: string): boolean {
  return SECRET_RE.test(name);
}

/** The union of required env across the given backends, tagged secret/config. */
export function requiredCredentials(backendIds: string[]): RequiredCredential[] {
  const want = new Set(backendIds);
  const byName = new Map<string, Set<string>>();
  for (const b of backendCatalogue()) {
    if (!want.has(b.id)) continue;
    for (const name of b.requiredEnv ?? []) {
      let set = byName.get(name);
      if (!set) { set = new Set(); byName.set(name, set); }
      set.add(b.id);
    }
  }
  return [...byName.entries()]
    .map(([name, backends]) => ({ name, secret: isSecretEnv(name), backends: [...backends].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type CredentialFormat = "env" | "compose";

/** Render a fill-in template (placeholders only) for the operator to complete. */
export function renderCredentialTemplate(creds: RequiredCredential[], format: CredentialFormat): string {
  if (creds.length === 0) return "# no vendor credentials required for the selected backends";

  if (format === "env") {
    const lines = [
      "# Broker vendor credentials — set these in your broker's env / secret store.",
      "# OmniProject never sees or stores these values; fill them where the broker runs.",
      "# Do NOT commit real secrets.",
      "",
      ...creds.map((c) => {
        const used = `used by: ${c.backends.join(", ")}`;
        const ph = c.secret ? "<secret: fill in>" : "<value: fill in>";
        return `${c.name}=${ph}   # ${used}${c.secret ? " (SECRET)" : ""}`;
      }),
    ];
    return lines.join("\n");
  }

  // compose: non-secret values as environment; secrets as Docker secrets.
  const secrets = creds.filter((c) => c.secret);
  const plain = creds.filter((c) => !c.secret);
  const out: string[] = [
    "# docker-compose excerpt for your BROKER service.",
    "# OmniProject never stores these; secrets are mounted as Docker secrets.",
    "services:",
    "  broker:                    # <- your broker service",
    "    environment:",
    ...plain.map((c) => `      ${c.name}: \${${c.name}}        # used by: ${c.backends.join(", ")}`),
    ...secrets.map((c) => `      ${c.name}_FILE: /run/secrets/${c.name.toLowerCase()}   # used by: ${c.backends.join(", ")}`),
  ];
  if (secrets.length) {
    out.push("    secrets:");
    out.push(...secrets.map((c) => `      - ${c.name.toLowerCase()}`));
    out.push("secrets:");
    for (const c of secrets) {
      out.push(`  ${c.name.toLowerCase()}:`);
      out.push(`    file: ./secrets/${c.name.toLowerCase()}   # create this file (gitignored) with the secret`);
    }
  }
  return out.join("\n");
}
