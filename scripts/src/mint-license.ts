/**
 * Licence minting / key generation helper (vendor-side).
 *
 * OmniProject premium features (branding, labels, webhooks) are gated by a
 * time-limited Ed25519-signed licence key. The DEPLOYMENT only verifies; the
 * VENDOR mints. This script does both halves of the vendor side:
 *
 *   1. Generate an issuing keypair (run once, keep the private key secret):
 *        pnpm --filter @workspace/scripts exec tsx src/mint-license.ts keygen
 *      → prints LICENSE_PUBLIC_KEY (ship to deployments) + the private key
 *        (keep offline). Set the public key as LICENSE_PUBLIC_KEY in the gateway.
 *
 *   2. Mint a licence for a customer:
 *        LICENSE_PRIVATE_KEY="$(cat issuer.key)" \
 *        pnpm --filter @workspace/scripts exec tsx src/mint-license.ts mint \
 *          --customer "Acme Corp" --tier enterprise \
 *          --features branding,labels,webhooks --days 365
 *      → prints the LICENSE_KEY to set in the customer's deployment.
 *
 * Pure Node crypto — no dependencies, and no network.
 */
import crypto from "node:crypto";

const FEATURES = ["branding", "labels", "webhooks", "enterprise_workflows"] as const;
const TOKEN_PREFIX = "omni-lic.v1";
const SECONDS_PER_DAY = 86_400;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function keygen(): void {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.stdout.write("# Issuing keypair generated. Keep the PRIVATE key offline.\n\n");
  process.stdout.write("# Public key — set this in each deployment as LICENSE_PUBLIC_KEY:\n");
  process.stdout.write(pub + "\n");
  process.stdout.write("# Private key — vendor-only, used to mint licences:\n");
  process.stdout.write(priv + "\n");
}

function mint(): void {
  const privPem = process.env["LICENSE_PRIVATE_KEY"]?.trim();
  if (!privPem) throw new Error("set LICENSE_PRIVATE_KEY (PEM) to mint a licence");
  const customer = arg("customer", "Customer")!;
  const tier = arg("tier", "professional")!;
  const featuresArg = (arg("features", "branding,labels,webhooks") ?? "").split(",").map((s) => s.trim());
  const features = FEATURES.filter((f) => featuresArg.includes(f));
  const days = Number(arg("days", "365"));
  const iat = Math.floor(Date.now() / 1000);
  const exp = Number.isFinite(days) && days > 0 ? iat + Math.round(days * SECONDS_PER_DAY) : undefined;

  const payload = { customer, tier, features, iat, ...(exp ? { exp } : {}) };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signingInput = `${TOKEN_PREFIX}.${body}`;
  const sig = crypto.sign(null, Buffer.from(signingInput), crypto.createPrivateKey(privPem)).toString("base64url");
  const token = `${signingInput}.${sig}`;

  process.stdout.write(`# Licence for ${customer} (${tier}); features: ${features.join(", ") || "none"}; ` +
    `${exp ? `expires ${new Date(exp * 1000).toISOString().slice(0, 10)}` : "no expiry"}.\n`);
  process.stdout.write("# Set in the deployment as LICENSE_KEY:\n");
  process.stdout.write(token + "\n");
}

const cmd = process.argv[2];
try {
  if (cmd === "keygen") keygen();
  else if (cmd === "mint") mint();
  else {
    process.stderr.write("usage: mint-license.ts <keygen|mint> [--customer .. --tier .. --features a,b --days N]\n");
    process.exit(1);
  }
} catch (e) {
  process.stderr.write(`error: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
}
