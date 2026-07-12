import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BuiltinBroker, SidecarStore, makeBuiltinBroker } from "./index";
import { BrokerError, type ActorContext } from "../types";

/**
 * SidecarStore — the built-in broker over the DB sidecar vendor (the `sql` backend). A mock sidecar
 * stands in for a real one: it records the per-action requests and proves the store maps CRUD ops to
 * the sidecar contract, unwraps `{ success, data }`, and honours the 409/404 optimistic-concurrency
 * and not-found signals. (A live PostgreSQL sidecar is "verify against your instance".)
 */
const ctx: ActorContext = { sub: "founder", email: "f@charity.test", role: "admin" };
const seen: Array<{ url: string; auth: string | undefined; body: unknown }> = [];
let server: http.Server;
let base: string;

/** A tiny in-memory sidecar exposing the per-action endpoints the SidecarStore calls. */
function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const action = (req.url ?? "").replace(/^\//, "");
    const payload = (JSON.parse(raw || "{}") as { payload?: Record<string, unknown> }).payload ?? {};
    seen.push({ url: req.url ?? "", auth: req.headers["authorization"] as string | undefined, body: payload });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: status < 300, data })); // {success,data} envelope
    };
    switch (action) {
      case "list_projects": return send(200, [{ id: "p1", name: "Existing" }]);
      case "create_project": return send(200, { id: "p2", name: payload["name"] });
      case "create_issue": return send(200, { id: "i1", projectId: payload["projectId"], title: payload["title"], status: "todo", version: 1 });
      case "update_issue":
        // Simulate optimistic concurrency: expectedVersion 999 is stale → 409 with the current row.
        if (payload["expectedVersion"] === 999) return send(409, { version: 1 });
        return send(200, { id: payload["issueId"], projectId: payload["projectId"], title: "x", status: payload["status"], version: 2 });
      case "delete_issue": return send(payload["issueId"] === "nope" ? 404 : 200, null);
      case "list_issues": return send(200, [{ id: "i1", projectId: payload["projectId"], title: "x", status: "todo" }]);
      case "list_raid": return send(200, []);
      case "add_raid": return send(200, { id: "r1", projectId: payload["projectId"], title: payload["title"] });
      default: return send(404, null);
    }
  });
}

before(async () => {
  server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

const broker = () => new BuiltinBroker(new SidecarStore(base, "sidecar-token"));

test("kind reflects the sidecar store and it is a live backend", () => {
  const b = broker();
  assert.equal(b.kind, "builtin:sidecar");
  assert.equal(b.live, true);
});

test("reads and writes map to the sidecar's per-action endpoints (with the bearer token)", async () => {
  seen.length = 0;
  const b = broker();
  assert.deepEqual((await b.listProjects(ctx)).map((p) => p.name), ["Existing"]);
  const created = await b.writeIssue(ctx, "create", { projectId: "p1", title: "Find a venue" });
  assert.equal(created!.id, "i1");

  const listCall = seen.find((s) => s.url === "/list_projects");
  const createCall = seen.find((s) => s.url === "/create_issue");
  assert.ok(listCall && createCall, "expected per-action endpoints to be hit");
  assert.equal(listCall!.auth, "Bearer sidecar-token"); // the sidecar token is forwarded
  assert.equal((createCall!.body as Record<string, unknown>)["title"], "Find a venue");
});

test("store selection: BUILTIN_BROKER=sql picks the sidecar when SQL_SIDECAR_URL is set, else falls back to memory", () => {
  const prev = { b: process.env["BUILTIN_BROKER"], u: process.env["SQL_SIDECAR_URL"] };
  try {
    process.env["BUILTIN_BROKER"] = "sql";
    process.env["SQL_SIDECAR_URL"] = base;
    assert.equal(makeBuiltinBroker().kind, "builtin:sidecar");
    // A sidecar requested but no URL ⇒ safe fallback to the non-persistent memory store (never
    // silently "persist" into nowhere).
    delete process.env["SQL_SIDECAR_URL"];
    assert.equal(makeBuiltinBroker().kind, "builtin:memory");
  } finally {
    if (prev.b === undefined) delete process.env["BUILTIN_BROKER"]; else process.env["BUILTIN_BROKER"] = prev.b;
    if (prev.u === undefined) delete process.env["SQL_SIDECAR_URL"]; else process.env["SQL_SIDECAR_URL"] = prev.u;
  }
});

test("optimistic concurrency: a 409 from the sidecar surfaces as a conflict; a 404 as not_found", async () => {
  const b = broker();
  await assert.rejects(
    () => b.writeIssue(ctx, "update", { projectId: "p1", issueId: "i1", status: "done", expectedVersion: 999 }),
    (e: unknown) => e instanceof BrokerError && e.code === "conflict",
  );
  await assert.rejects(
    () => b.writeIssue(ctx, "delete", { projectId: "p1", issueId: "nope" }),
    (e: unknown) => e instanceof BrokerError && e.code === "not_found",
  );
});
