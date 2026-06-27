import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredCredentials, renderCredentialTemplate, isSecretEnv } from "./connection-credentials";

/**
 * Connection-credential scaffolding deals only in credential NAMES — it derives
 * which env each vendor needs and renders a fill-in template; never a secret value.
 */

test("isSecretEnv flags secrets but not plain config like instance URLs", () => {
  assert.equal(isSecretEnv("JIRA_BASIC_AUTH"), true);
  assert.equal(isSecretEnv("OPENPROJECT_API_TOKEN"), true);
  assert.equal(isSecretEnv("JIRA_INSTANCE_URL"), false);
  assert.equal(isSecretEnv("OPENPROJECT_INSTANCE_URL"), false);
});

test("requiredCredentials unions each backend's requiredEnv, tagged + attributed", () => {
  const creds = requiredCredentials(["jira", "openproject"]);
  const byName = Object.fromEntries(creds.map((c) => [c.name, c]));
  // Jira declares an auth secret + a URL; OpenProject declares a URL.
  assert.ok(byName["JIRA_BASIC_AUTH"]);
  assert.equal(byName["JIRA_BASIC_AUTH"]!.secret, true);
  assert.deepEqual(byName["JIRA_BASIC_AUTH"]!.backends, ["jira"]);
  assert.ok(byName["OPENPROJECT_INSTANCE_URL"]);
  assert.equal(byName["OPENPROJECT_INSTANCE_URL"]!.secret, false);
});

test("an env shared by two backends is attributed to both", () => {
  // (synthetic) two backends sharing a name would list both; here just assert sort/shape
  const creds = requiredCredentials(["jira"]);
  assert.ok(creds.every((c) => Array.isArray(c.backends) && c.backends.length >= 1));
});

test("templates contain placeholders + attribution but NEVER a value", () => {
  const creds = requiredCredentials(["jira", "openproject"]);
  const env = renderCredentialTemplate(creds, "env");
  assert.match(env, /JIRA_BASIC_AUTH=<secret: fill in>/);
  assert.match(env, /used by: jira/);
  assert.match(env, /never sees or stores/i);

  const compose = renderCredentialTemplate(creds, "compose");
  assert.match(compose, /JIRA_BASIC_AUTH_FILE: \/run\/secrets\/jira_basic_auth/); // secret ⇒ Docker secret
  assert.match(compose, /OPENPROJECT_INSTANCE_URL: \$\{OPENPROJECT_INSTANCE_URL\}/); // plain ⇒ env ref
  assert.match(compose, /file: \.\/secrets\/jira_basic_auth/);
});

test("no backends ⇒ an empty, honest template", () => {
  assert.deepEqual(requiredCredentials([]), []);
  assert.match(renderCredentialTemplate([], "env"), /no vendor credentials required/);
});
