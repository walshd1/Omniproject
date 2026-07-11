import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Coverage for the module-load-time environment-seed helpers in settings.ts
 * (brandingFromEnv, labelsFromEnv, webhooksFromEnv, peersFromEnv, loggingSyncFromEnv,
 * disabled/enabledFeaturesFromEnv and the coerce* env readers). These run ONCE at import
 * to seed the default SettingsState, so they can't be driven through the public API.
 *
 * Recipe: set the relevant env var(s), then re-import the settings module with a UNIQUE
 * cache-busting query so its top-level runs again against the fresh env, and read the effect
 * off that fresh module's getSettings(). Each case cleans up the env vars it set so cases
 * don't bleed. node runs this file in its own process, so it can't corrupt sibling test files.
 */

let bustSeq = 0;
/** Re-import settings.ts fresh (busting the ESM cache) and return its seeded snapshot. */
async function loadFreshSettings(): Promise<any> {
  const mod = (await import(`./settings.js?bust=seed${bustSeq++}`)) as any;
  return mod.getSettings();
}

/** Run `fn` with the given env vars set, restoring/deleting them afterwards. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// ---------------------------------------------------------------------------
// brandingFromEnv
// ---------------------------------------------------------------------------

test("branding: no BRAND_* env → branding is null", async () => {
  const s = await loadFreshSettings();
  assert.equal(s.branding, null);
});

test("branding: all BRAND_* set → full BrandingConfig", async () => {
  const s = await withEnv(
    {
      BRAND_APP_NAME: "Acme",
      BRAND_SHORT_NAME: "AC",
      BRAND_LOGO_URL: "https://cdn.example.com/logo.png",
      BRAND_PRIMARY_COLOR: "#ff0066",
      BRAND_LOGIN_HEADING: "Welcome to Acme",
      BRAND_FOOTER_TEXT: "© Acme",
      BRAND_SUPPORT_URL: "https://support.example.com",
      BRAND_FONT_FAMILY: "Inter, sans-serif",
    },
    loadFreshSettings,
  );
  assert.deepEqual(s.branding, {
    appName: "Acme",
    shortName: "AC",
    logoUrl: "https://cdn.example.com/logo.png",
    primaryColor: "#ff0066",
    loginHeading: "Welcome to Acme",
    footerText: "© Acme",
    supportUrl: "https://support.example.com",
    fontFamily: "Inter, sans-serif",
  });
});

test("branding: one field set, others trim to null; whitespace-only coerces to null", async () => {
  const s = await withEnv({ BRAND_APP_NAME: "  Acme  ", BRAND_SHORT_NAME: "   " }, loadFreshSettings);
  // Set field is trimmed; whitespace-only field becomes null via `.trim() || null`.
  assert.equal(s.branding.appName, "Acme");
  assert.equal(s.branding.shortName, null);
  assert.equal(s.branding.logoUrl, null);
});

test("branding: all fields whitespace-only → .some(Boolean) false → null", async () => {
  const s = await withEnv({ BRAND_APP_NAME: "   ", BRAND_FOOTER_TEXT: "  " }, loadFreshSettings);
  assert.equal(s.branding, null);
});

// ---------------------------------------------------------------------------
// labelsFromEnv
// ---------------------------------------------------------------------------

test("labels: no LABEL_OVERRIDES → empty object", async () => {
  const s = await loadFreshSettings();
  assert.deepEqual(s.labelOverrides, {});
});

test("labels: valid JSON keeps string values, drops non-string values", async () => {
  const s = await withEnv(
    { LABEL_OVERRIDES: JSON.stringify({ status: "Stage", risk: "Threat", count: 5, nested: { a: 1 } }) },
    loadFreshSettings,
  );
  assert.deepEqual(s.labelOverrides, { status: "Stage", risk: "Threat" });
});

test("labels: malformed JSON → warns and seeds no overrides", async () => {
  const s = await withEnv({ LABEL_OVERRIDES: "{not valid json" }, loadFreshSettings);
  assert.deepEqual(s.labelOverrides, {});
});

test("labels: whitespace-only string is treated as unset", async () => {
  const s = await withEnv({ LABEL_OVERRIDES: "   " }, loadFreshSettings);
  assert.deepEqual(s.labelOverrides, {});
});

// ---------------------------------------------------------------------------
// webhooksFromEnv
// ---------------------------------------------------------------------------

test("webhooks: no WEBHOOKS → empty array", async () => {
  const s = await loadFreshSettings();
  assert.deepEqual(s.webhooks, []);
});

test("webhooks: valid JSON that is not an array → empty array", async () => {
  const s = await withEnv({ WEBHOOKS: JSON.stringify({ url: "https://x.example.com" }) }, loadFreshSettings);
  assert.deepEqual(s.webhooks, []);
});

test("webhooks: full object honoured; non-object entries filtered out", async () => {
  const s = await withEnv(
    {
      WEBHOOKS: JSON.stringify([
        { id: "wh1", url: "https://hooks.example.com/a", secret: "s3cr3t", events: ["issue.created"], active: false, description: "primary" },
        null,
        42,
      ]),
    },
    loadFreshSettings,
  );
  assert.equal(s.webhooks.length, 1);
  assert.deepEqual(s.webhooks[0], {
    id: "wh1",
    url: "https://hooks.example.com/a",
    secret: "s3cr3t",
    events: ["issue.created"],
    active: false,
    description: "primary",
  });
});

test("webhooks: missing optional fields get defaults (env-N id, empty secret, ['*'] events, active true, no description)", async () => {
  const s = await withEnv(
    { WEBHOOKS: JSON.stringify([{ url: "https://hooks.example.com/b" }]) },
    loadFreshSettings,
  );
  assert.equal(s.webhooks.length, 1);
  assert.deepEqual(s.webhooks[0], {
    id: "env-1",
    url: "https://hooks.example.com/b",
    secret: "",
    events: ["*"],
    active: true,
    description: undefined,
  });
});

test("webhooks: events coerced to strings; active defaults true when omitted", async () => {
  const s = await withEnv(
    { WEBHOOKS: JSON.stringify([{ url: "https://hooks.example.com/c", events: [1, "x", true] }]) },
    loadFreshSettings,
  );
  assert.deepEqual(s.webhooks[0].events, ["1", "x", "true"]);
  assert.equal(s.webhooks[0].active, true);
});

test("webhooks: entry with missing url → '' fails safety check → dropped", async () => {
  const s = await withEnv({ WEBHOOKS: JSON.stringify([{ id: "no-url" }]) }, loadFreshSettings);
  assert.deepEqual(s.webhooks, []);
});

test("webhooks: unsafe metadata URL is dropped by the SSRF safety filter", async () => {
  const s = await withEnv(
    {
      WEBHOOKS: JSON.stringify([
        { id: "safe", url: "https://hooks.example.com/ok" },
        { id: "unsafe", url: "http://169.254.169.254/latest/meta-data" },
      ]),
    },
    loadFreshSettings,
  );
  assert.equal(s.webhooks.length, 1);
  assert.equal(s.webhooks[0].id, "safe");
});

test("webhooks: malformed JSON → warns and seeds no webhooks", async () => {
  const s = await withEnv({ WEBHOOKS: "[oops" }, loadFreshSettings);
  assert.deepEqual(s.webhooks, []);
});

// ---------------------------------------------------------------------------
// peersFromEnv
// ---------------------------------------------------------------------------

test("peers: no FEDERATED_PEERS → empty array", async () => {
  const s = await loadFreshSettings();
  assert.deepEqual(s.federatedPeers, []);
});

test("peers: valid JSON that is not an array → empty array", async () => {
  const s = await withEnv({ FEDERATED_PEERS: JSON.stringify({ id: "p" }) }, loadFreshSettings);
  assert.deepEqual(s.federatedPeers, []);
});

test("peers: full object honoured; non-object entries filtered out", async () => {
  const s = await withEnv(
    {
      FEDERATED_PEERS: JSON.stringify([
        { id: "eu1", label: "EU", baseUrl: "https://eu.example.com", token: "tok", region: "eu", active: false },
        null,
      ]),
    },
    loadFreshSettings,
  );
  assert.equal(s.federatedPeers.length, 1);
  assert.deepEqual(s.federatedPeers[0], {
    id: "eu1",
    label: "EU",
    baseUrl: "https://eu.example.com",
    token: "tok",
    region: "eu",
    active: false,
  });
});

test("peers: missing optional fields get defaults (env-N id, 'Peer N' label, empty token, null region, active true)", async () => {
  const s = await withEnv(
    { FEDERATED_PEERS: JSON.stringify([{ baseUrl: "https://us.example.com" }]) },
    loadFreshSettings,
  );
  assert.equal(s.federatedPeers.length, 1);
  assert.deepEqual(s.federatedPeers[0], {
    id: "env-1",
    label: "Peer 1",
    baseUrl: "https://us.example.com",
    token: "",
    region: null,
    active: true,
  });
});

test("peers: empty-string label falls back to 'Peer N'; non-string region → null", async () => {
  const s = await withEnv(
    { FEDERATED_PEERS: JSON.stringify([{ id: "p", label: "", baseUrl: "https://p.example.com", region: 5 }]) },
    loadFreshSettings,
  );
  assert.equal(s.federatedPeers[0].label, "Peer 1");
  assert.equal(s.federatedPeers[0].region, null);
});

test("peers: entry with missing baseUrl → '' fails safety check → dropped", async () => {
  const s = await withEnv({ FEDERATED_PEERS: JSON.stringify([{ id: "p", label: "L" }]) }, loadFreshSettings);
  assert.deepEqual(s.federatedPeers, []);
});

test("peers: unsafe metadata baseUrl dropped by the SSRF safety filter", async () => {
  const s = await withEnv(
    {
      FEDERATED_PEERS: JSON.stringify([
        { id: "ok", label: "OK", baseUrl: "https://ok.example.com", token: "t" },
        { id: "bad", label: "Bad", baseUrl: "http://169.254.169.254/", token: "t" },
      ]),
    },
    loadFreshSettings,
  );
  assert.equal(s.federatedPeers.length, 1);
  assert.equal(s.federatedPeers[0].id, "ok");
});

test("peers: malformed JSON → warns and seeds no peers", async () => {
  const s = await withEnv({ FEDERATED_PEERS: "{bad" }, loadFreshSettings);
  assert.deepEqual(s.federatedPeers, []);
});

// ---------------------------------------------------------------------------
// loggingSyncFromEnv
// ---------------------------------------------------------------------------

test("loggingSync: no env → disabled, null url, not acknowledged", async () => {
  const s = await loadFreshSettings();
  assert.deepEqual(s.loggingSync, { enabled: false, url: null, acknowledgedWarranty: false });
});

test("loggingSync: safe url + ack → enabled with url preserved", async () => {
  const s = await withEnv(
    { LOGGING_SYNC_URL: "https://logs.example.com/ingest", LOGGING_SYNC_ACK_WARRANTY: "true" },
    loadFreshSettings,
  );
  assert.deepEqual(s.loggingSync, {
    enabled: true,
    url: "https://logs.example.com/ingest",
    acknowledgedWarranty: true,
  });
});

test("loggingSync: safe url but no ack → not enabled, url still preserved", async () => {
  const s = await withEnv({ LOGGING_SYNC_URL: "https://logs.example.com/ingest" }, loadFreshSettings);
  assert.deepEqual(s.loggingSync, {
    enabled: false,
    url: "https://logs.example.com/ingest",
    acknowledgedWarranty: false,
  });
});

test("loggingSync: ack but no url → not enabled, url null", async () => {
  const s = await withEnv({ LOGGING_SYNC_ACK_WARRANTY: "true" }, loadFreshSettings);
  assert.deepEqual(s.loggingSync, { enabled: false, url: null, acknowledgedWarranty: true });
});

test("loggingSync: unsafe metadata url dropped → not enabled, url null even with ack", async () => {
  const s = await withEnv(
    { LOGGING_SYNC_URL: "http://169.254.169.254/logs", LOGGING_SYNC_ACK_WARRANTY: "true" },
    loadFreshSettings,
  );
  assert.deepEqual(s.loggingSync, { enabled: false, url: null, acknowledgedWarranty: true });
});

test("loggingSync: ACK anything other than exactly 'true' is not acknowledged", async () => {
  const s = await withEnv(
    { LOGGING_SYNC_URL: "https://logs.example.com/ingest", LOGGING_SYNC_ACK_WARRANTY: "1" },
    loadFreshSettings,
  );
  assert.equal(s.loggingSync.acknowledgedWarranty, false);
  assert.equal(s.loggingSync.enabled, false);
});

// ---------------------------------------------------------------------------
// disabledFeaturesFromEnv / enabledFeaturesFromEnv
// ---------------------------------------------------------------------------

test("disabled/enabledFeatures: unset → empty arrays", async () => {
  const s = await loadFreshSettings();
  assert.deepEqual(s.disabledFeatures, []);
  assert.deepEqual(s.enabledFeatures, []);
});

test("disabledFeatures: comma/space separated, blanks stripped", async () => {
  const s = await withEnv({ DISABLED_FEATURES: " odata,  integrations ,, presence " }, loadFreshSettings);
  assert.deepEqual(s.disabledFeatures, ["odata", "integrations", "presence"]);
});

test("enabledFeatures: whitespace-separated list parsed", async () => {
  const s = await withEnv({ ENABLED_FEATURES: "presence predictivePrefetch" }, loadFreshSettings);
  assert.deepEqual(s.enabledFeatures, ["presence", "predictivePrefetch"]);
});

// ---------------------------------------------------------------------------
// coerce* env readers on the seed object
// ---------------------------------------------------------------------------

test("aiProvider: valid env value honoured; invalid → 'none'", async () => {
  const ok = await withEnv({ AI_PROVIDER: "openai" }, loadFreshSettings);
  assert.equal(ok.aiProvider, "openai");
  const bad = await withEnv({ AI_PROVIDER: "skynet" }, loadFreshSettings);
  assert.equal(bad.aiProvider, "none");
});

test("sttProvider: valid env value honoured; invalid → 'none'", async () => {
  const ok = await withEnv({ STT_PROVIDER: "whisper" }, loadFreshSettings);
  assert.equal(ok.sttProvider, "whisper");
  const bad = await withEnv({ STT_PROVIDER: "telepathy" }, loadFreshSettings);
  assert.equal(bad.sttProvider, "none");
});

test("fxRatePolicy: valid env value honoured; invalid → 'spot'", async () => {
  const ok = await withEnv({ FX_RATE_POLICY: "periodClose" }, loadFreshSettings);
  assert.equal(ok.fxRatePolicy, "periodClose");
  const bad = await withEnv({ FX_RATE_POLICY: "guesswork" }, loadFreshSettings);
  assert.equal(bad.fxRatePolicy, "spot");
});

test("deploymentProfile: valid env value coerced (case-insensitive); invalid → omitted", async () => {
  const ok = await withEnv({ DEPLOYMENT_PROFILE: "Enterprise" }, loadFreshSettings);
  assert.equal(ok.deploymentProfile, "enterprise");
  const bad = await withEnv({ DEPLOYMENT_PROFILE: "spaceship" }, loadFreshSettings);
  assert.equal(bad.deploymentProfile, undefined);
});

test("scalar env seeds: brokerUrl / backendSource / reportingCurrency / fxRateAsOfDate / aiModel / oidcIssuerUrl", async () => {
  const s = await withEnv(
    {
      BROKER_URL: "  https://n8n.example.com/webhook  ",
      BACKEND_SOURCE: "plane",
      REPORTING_CURRENCY: "gbp",
      FX_RATE_AS_OF_DATE: "2024-12-31",
      AI_MODEL: "gpt-4o",
      OIDC_ISSUER_URL: "https://issuer.example.com",
    },
    loadFreshSettings,
  );
  assert.equal(s.brokerUrl, "https://n8n.example.com/webhook");
  assert.equal(s.backendSource, "plane");
  assert.equal(s.reportingCurrency, "GBP"); // upper-cased
  assert.equal(s.fxRateAsOfDate, "2024-12-31");
  assert.equal(s.aiModel, "gpt-4o");
  assert.equal(s.oidcIssuerUrl, "https://issuer.example.com");
});

test("scalar env defaults: unset brokerUrl → null, backendSource → 'all'", async () => {
  const s = await loadFreshSettings();
  assert.equal(s.brokerUrl, null);
  assert.equal(s.backendSource, "all");
  assert.equal(s.reportingCurrency, null);
});
