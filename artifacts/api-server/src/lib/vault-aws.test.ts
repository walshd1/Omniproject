import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { awsSecretsStore } from "./vault-aws";
import { __setEgressTransportForTest, __setEgressLookupForTest, type LookupFn } from "./egress";

/**
 * AWS Secrets Manager vault store — all keys in one secret as a JSON map. The single JSON
 * endpoint selects the operation via X-Amz-Target. The store calls lib/egress safeFetch (undici),
 * so intercept via the egress transport seam + a deterministic resolver (no real DNS/network).
 */
const ENV = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "VAULT_AWS_SECRET_ID"];
const BENIGN_LOOKUP = (async () => [{ address: "93.184.216.34", family: 4 }]) as LookupFn;

beforeEach(() => {
  process.env["AWS_REGION"] = "eu-west-2";
  process.env["AWS_ACCESS_KEY_ID"] = "AKID";
  process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
});
afterEach(() => {
  __setEgressTransportForTest(null);
  __setEgressLookupForTest(null);
  for (const k of ENV) delete process.env[k];
});

const notFound = () => new Response(JSON.stringify({ __type: "ResourceNotFoundException" }), { status: 400 });

/** Route each call by its X-Amz-Target operation. */
function mock(handler: (target: string, body: unknown) => Response): { targets: string[] } {
  const targets: string[] = [];
  __setEgressLookupForTest(BENIGN_LOOKUP);
  __setEgressTransportForTest((async (_url: string | URL | Request, init?: RequestInit) => {
    const target = new Headers(init?.headers).get("X-Amz-Target") ?? "";
    targets.push(target);
    return handler(target, JSON.parse(String(init?.body)));
  }) as typeof fetch);
  return { targets };
}

test("load: parses the SecretString JSON map", async () => {
  mock(() => new Response(JSON.stringify({ SecretString: JSON.stringify({ "openai:default": "sk" }) }), { status: 200 }));
  const store = awsSecretsStore();
  assert.equal(store.id, "aws");
  assert.deepEqual(await store.load(), { "openai:default": "sk" });
});

test("load: a not-found secret (400 ResourceNotFoundException) is an empty map", async () => {
  mock(() => notFound());
  assert.deepEqual(await awsSecretsStore().load(), {});
});

test("load: no SecretString field is an empty map", async () => {
  mock(() => new Response(JSON.stringify({}), { status: 200 }));
  assert.deepEqual(await awsSecretsStore().load(), {});
});

test("load: a non-JSON SecretString degrades to an empty map", async () => {
  mock(() => new Response(JSON.stringify({ SecretString: "{oops" }), { status: 200 }));
  assert.deepEqual(await awsSecretsStore().load(), {});
});

test("load: a 400 that is NOT a not-found error throws", async () => {
  mock(() => new Response(JSON.stringify({ __type: "InvalidParameterException" }), { status: 400 }));
  await assert.rejects(() => awsSecretsStore().load(), /AWS GetSecretValue 400/);
});

test("load: a 500 throws", async () => {
  mock(() => new Response("boom", { status: 500 }));
  await assert.rejects(() => awsSecretsStore().load(), /AWS GetSecretValue 500/);
});

test("put: read-modify-writes via PutSecretValue", async () => {
  let put: unknown = null;
  const { targets } = mock((target, body) => {
    if (target.endsWith("GetSecretValue")) return new Response(JSON.stringify({ SecretString: JSON.stringify({ a: "1" }) }), { status: 200 });
    put = body;
    return new Response("", { status: 200 });
  });
  await awsSecretsStore().put("b", "2");
  assert.deepEqual(JSON.parse((put as { SecretString: string }).SecretString), { a: "1", b: "2" });
  assert.ok(targets.some((t) => t.endsWith("PutSecretValue")));
});

test("put: when the secret doesn't exist yet, PutSecretValue 404 falls back to CreateSecret", async () => {
  const { targets } = mock((target) => {
    if (target.endsWith("GetSecretValue")) return new Response(JSON.stringify({ SecretString: JSON.stringify({}) }), { status: 200 });
    if (target.endsWith("PutSecretValue")) return notFound();
    return new Response("", { status: 200 }); // CreateSecret
  });
  await awsSecretsStore().put("k", "v");
  assert.ok(targets.some((t) => t.endsWith("CreateSecret")));
});

test("put: a non-ok write throws", async () => {
  mock((target) =>
    target.endsWith("GetSecretValue")
      ? new Response(JSON.stringify({ SecretString: JSON.stringify({}) }), { status: 200 })
      : new Response("denied", { status: 403 }),
  );
  await assert.rejects(() => awsSecretsStore().put("k", "v"), /AWS PutSecretValue 403/);
});

test("del: removes an existing ref (write) and no-ops for an absent one", async () => {
  let writes = 0;
  mock((target) => {
    if (target.endsWith("GetSecretValue")) return new Response(JSON.stringify({ SecretString: JSON.stringify({ keep: "1", drop: "2" }) }), { status: 200 });
    writes += 1;
    return new Response("", { status: 200 });
  });
  await awsSecretsStore().del("drop");
  assert.equal(writes, 1);
  await awsSecretsStore().del("absent");
  assert.equal(writes, 1);
});

test("isNotFound tolerates a non-JSON error body (treated as not-not-found)", async () => {
  mock(() => new Response("<html>gateway error</html>", { status: 400 }));
  await assert.rejects(() => awsSecretsStore().load(), /AWS GetSecretValue 400/);
});
