import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { awsSignedHeaders, awsCredsFromEnv } from "./aws-sigv4";

/** AWS Signature V4 header construction + env credential resolution. */
const ENV = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

const creds = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" };

test("awsSignedHeaders builds a SigV4 Authorization with the default content type", () => {
  const h = awsSignedHeaders({ host: "kms.eu-west-1.amazonaws.com", region: "eu-west-1", service: "kms", target: "TrentService.Decrypt", body: "{}", creds });
  assert.equal(h["Content-Type"], "application/x-amz-json-1.1");
  assert.equal(h["X-Amz-Target"], "TrentService.Decrypt");
  assert.match(h["Authorization"]!, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/kms\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
  assert.equal(h["X-Amz-Security-Token"], undefined);
});

test("awsSignedHeaders honours a custom content type and includes a session token when present", () => {
  const h = awsSignedHeaders({
    host: "example",
    region: "us-east-1",
    service: "s3",
    target: "T",
    body: "x",
    contentType: "application/json",
    creds: { ...creds, sessionToken: "TOKEN123" },
  });
  assert.equal(h["Content-Type"], "application/json");
  assert.equal(h["X-Amz-Security-Token"], "TOKEN123");
});

test("awsCredsFromEnv reads region + credentials from the environment", () => {
  process.env["AWS_REGION"] = "ap-southeast-2";
  process.env["AWS_ACCESS_KEY_ID"] = "AKID";
  process.env["AWS_SECRET_ACCESS_KEY"] = "sk";
  process.env["AWS_SESSION_TOKEN"] = "st";
  const { region, creds: c } = awsCredsFromEnv();
  assert.equal(region, "ap-southeast-2");
  assert.equal(c.accessKeyId, "AKID");
  assert.equal(c.secretAccessKey, "sk");
  assert.equal(c.sessionToken, "st");
});

test("awsCredsFromEnv defaults region to us-east-1 and leaves creds empty when unset", () => {
  const { region, creds: c } = awsCredsFromEnv();
  assert.equal(region, "us-east-1");
  assert.equal(c.accessKeyId, "");
  assert.equal(c.secretAccessKey, "");
  assert.equal(c.sessionToken, undefined);
});
