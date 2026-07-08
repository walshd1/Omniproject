import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnNode } from "../broker/spawn-helper.test";
import {
  isOAuth2Configured,
  buildAuthUrl,
  exchangeCodeOAuth2,
  fetchUserInfo,
  mapUserInfo,
  newOAuth2Flow,
  type OAuth2Config,
} from "./oauth2";

const CONFIG: OAuth2Config = {
  authUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  userInfoUrl: "https://api.github.com/user",
  clientId: "client-123",
  clientSecret: "secret-xyz",
  scope: "read:user user:email",
  fields: { sub: "id", name: "name", email: "email", roles: "roles" },
};

test("isOAuth2Configured is false with no OAUTH2_* env", () => {
  // No env set in the test process → the module's lazy config is null.
  assert.equal(isOAuth2Configured, false);
});

test("buildAuthUrl includes code, state, scope and S256 PKCE challenge", () => {
  const url = new URL(buildAuthUrl({ config: CONFIG, redirectUri: "https://app.test/api/auth/oauth2/callback", state: "st-1", codeVerifier: "verifier-abc" }));
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.test/api/auth/oauth2/callback");
  assert.equal(url.searchParams.get("scope"), "read:user user:email");
  assert.equal(url.searchParams.get("state"), "st-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok((url.searchParams.get("code_challenge") || "").length > 0);
});

test("newOAuth2Flow mints a distinct state and verifier", () => {
  const a = newOAuth2Flow();
  const b = newOAuth2Flow();
  assert.ok(a.state && a.verifier);
  assert.notEqual(a.state, a.verifier);
  assert.notEqual(a.state, b.state); // CSPRNG → different each call
});

test("exchangeCodeOAuth2 posts the grant and returns the access token (injected fetch)", async () => {
  let seenUrl = "", seenBody = "";
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seenUrl = String(url);
    seenBody = String(init.body);
    return new Response(JSON.stringify({ access_token: "tok-789", token_type: "bearer" }), { status: 200 });
  }) as unknown as typeof fetch;

  const tokens = await exchangeCodeOAuth2({ config: CONFIG, code: "code-1", redirectUri: "https://app.test/cb", codeVerifier: "ver-1", fetchImpl });
  assert.equal(tokens.access_token, "tok-789");
  assert.equal(seenUrl, CONFIG.tokenUrl);
  assert.match(seenBody, /grant_type=authorization_code/);
  assert.match(seenBody, /code_verifier=ver-1/);
});

test("exchangeCodeOAuth2 throws when the token endpoint returns an error payload", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: "bad_verification_code" }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(
    () => exchangeCodeOAuth2({ config: CONFIG, code: "x", redirectUri: "https://app.test/cb", codeVerifier: "v", fetchImpl }),
    /no access token|bad_verification_code/,
  );
});

test("exchangeCodeOAuth2 throws on a non-ok response", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(
    () => exchangeCodeOAuth2({ config: CONFIG, code: "x", redirectUri: "https://app.test/cb", codeVerifier: "v", fetchImpl }),
    /token exchange failed \(401\)/,
  );
});

test("fetchUserInfo sends the bearer token and returns the profile JSON (injected fetch)", async () => {
  let auth = "";
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    auth = String((init.headers as Record<string, string>)["Authorization"]);
    return new Response(JSON.stringify({ id: 4242, login: "octocat", name: "The Octocat", email: "octo@github.test" }), { status: 200 });
  }) as unknown as typeof fetch;

  const info = await fetchUserInfo(CONFIG, "tok-789", fetchImpl);
  assert.equal(auth, "Bearer tok-789");
  assert.equal(info["login"], "octocat");
});

test("mapUserInfo maps GitHub-style id/name/email via the configured fields", () => {
  const user = mapUserInfo(CONFIG, { id: 4242, login: "octocat", name: "The Octocat", email: "octo@github.test" });
  assert.ok(user);
  assert.equal(user!.sub, "4242"); // numeric id coerced to string
  assert.equal(user!.name, "The Octocat");
  assert.equal(user!.email, "octo@github.test");
  assert.deepEqual(user!.roles, []);
});

test("mapUserInfo falls back across sub/id/login and collects roles from a string or array", () => {
  // Default mapping (sub field 'sub') but provider only exposes 'login' → fallback resolves it.
  const cfg: OAuth2Config = { ...CONFIG, fields: { sub: "sub", name: "name", email: "email", roles: "roles" } };
  const fromLogin = mapUserInfo(cfg, { login: "alice", roles: "pmo admin" });
  assert.equal(fromLogin!.sub, "alice");
  assert.deepEqual(fromLogin!.roles, ["pmo", "admin"]);
  const fromArray = mapUserInfo(cfg, { sub: "u2", roles: ["manager", "contributor"] });
  assert.deepEqual(fromArray!.roles, ["manager", "contributor"]);
});

test("mapUserInfo throws when no identifier is present", () => {
  assert.throws(() => mapUserInfo(CONFIG, { name: "no id here" }), /no subject identifier/);
});

// The module builds `oauth2Config` from OAUTH2_* env at import time, so it can only
// be exercised in a fresh process with those vars set. Spawn one and read the parsed
// config back as JSON.
const MODULE = fileURLToPath(new URL("./oauth2.ts", import.meta.url));
function loadConfigWithEnv(env: Record<string, string>): { cfg: unknown; configured: boolean } {
  const code =
    "import(process.env.MOD).then(m => console.log(JSON.stringify({ cfg: m.oauth2Config, configured: m.isOAuth2Configured })))" +
    ".catch(e => { console.error(e); process.exit(1); })";
  const res = spawnNode(["--import", "tsx", "-e", code], { ...process.env, MOD: MODULE, ...env } as Record<string, string>);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim()) as { cfg: unknown; configured: boolean };
}

test("oauth2Config is built with defaults when the five required OAUTH2_* vars are set", () => {
  const { cfg, configured } = loadConfigWithEnv({
    OAUTH2_AUTH_URL: "https://prov.test/authorize",
    OAUTH2_TOKEN_URL: "https://prov.test/token",
    OAUTH2_USERINFO_URL: "https://prov.test/userinfo",
    OAUTH2_CLIENT_ID: "the-client",
    OAUTH2_CLIENT_SECRET: "the-secret",
    // optional vars deliberately unset → the `|| default` fallbacks are used
    OAUTH2_SCOPE: "",
    OAUTH2_USERINFO_SUB_FIELD: "",
    OAUTH2_USERINFO_NAME_FIELD: "",
    OAUTH2_USERINFO_EMAIL_FIELD: "",
    OAUTH2_USERINFO_ROLES_FIELD: "",
  });
  assert.equal(configured, true);
  const c = cfg as OAuth2Config;
  assert.equal(c.authUrl, "https://prov.test/authorize");
  assert.equal(c.clientId, "the-client");
  assert.equal(c.scope, "read:user user:email"); // default
  assert.deepEqual(c.fields, { sub: "sub", name: "name", email: "email", roles: "roles" }); // defaults
});

test("oauth2Config honours the optional OAUTH2_* overrides when provided", () => {
  const { cfg, configured } = loadConfigWithEnv({
    OAUTH2_AUTH_URL: "https://prov.test/authorize",
    OAUTH2_TOKEN_URL: "https://prov.test/token",
    OAUTH2_USERINFO_URL: "https://prov.test/userinfo",
    OAUTH2_CLIENT_ID: "the-client",
    OAUTH2_CLIENT_SECRET: "the-secret",
    OAUTH2_SCOPE: "openid profile",
    OAUTH2_USERINFO_SUB_FIELD: "id",
    OAUTH2_USERINFO_NAME_FIELD: "login",
    OAUTH2_USERINFO_EMAIL_FIELD: "primaryEmail",
    OAUTH2_USERINFO_ROLES_FIELD: "groups",
  });
  assert.equal(configured, true);
  const c = cfg as OAuth2Config;
  assert.equal(c.scope, "openid profile");
  assert.deepEqual(c.fields, { sub: "id", name: "login", email: "primaryEmail", roles: "groups" });
});
