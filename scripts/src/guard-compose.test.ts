import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { isPinnedImage, auditComposeDoc, auditRepoCompose, COMPOSE_FILES } from "./guard-compose";

/**
 * Compose correctness guard — invariants `docker compose config` can't see: healthcheck-backed
 * depends_on, pinned images, gateway hardening, no insecure Traefik dashboard.
 */

test("isPinnedImage accepts explicit tags + digests, rejects latest/untagged", () => {
  assert.equal(isPinnedImage("traefik:v3.7.5"), true);
  assert.equal(isPinnedImage("postgres:16.14-alpine"), true);
  assert.equal(isPinnedImage("img@sha256:abc"), true);
  assert.equal(isPinnedImage("nginx:latest"), false);
  assert.equal(isPinnedImage("nginx"), false);
  // A registry with a port but no image tag is still unpinned.
  assert.equal(isPinnedImage("registry:5000/app"), false);
});

test("flags a depends_on that waits on a service with no healthcheck", () => {
  const doc = parse(`
services:
  app:
    image: app:1.0
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
`);
  const issues = auditComposeDoc("x.yml", doc);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /defines no healthcheck/);
});

test("accepts a depends_on when the target has a healthcheck", () => {
  const doc = parse(`
services:
  app:
    image: app:1.0
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
`);
  assert.deepEqual(auditComposeDoc("x.yml", doc), []);
});

test("flags an unpinned image and an insecure Traefik dashboard", () => {
  const doc = parse(`
services:
  proxy:
    image: traefik:latest
    command:
      - "--api.insecure=true"
`);
  const issues = auditComposeDoc("x.yml", doc);
  assert.ok(issues.some((i) => /not pinned/.test(i.message)));
  assert.ok(issues.some((i) => /--api.insecure/.test(i.message)));
});

test("prod hardening: flags a gateway missing read_only / cap_drop / no-new-privileges", () => {
  const doc = parse(`
services:
  omni-shell:
    image: omniproject-shell:0.2.0
`);
  const issues = auditComposeDoc("prod.yml", doc, { prod: true });
  assert.ok(issues.some((i) => /read_only/.test(i.message)));
  assert.ok(issues.some((i) => /cap_drop/.test(i.message)));
  assert.ok(issues.some((i) => /no-new-privileges/.test(i.message)));
});

test("prod hardening: fails closed when no gateway service resolves (renamed/removed)", () => {
  // A prod compose whose gateway service is renamed away from both known names must NOT
  // silently pass the hardening checks — the guard has to flag that it can't verify them.
  const doc = parse(`
services:
  web:
    image: omniproject-shell:0.2.0
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    read_only: true
`);
  const issues = auditComposeDoc("prod.yml", doc, { prod: true });
  assert.ok(issues.some((i) => /defines no 'omni-shell' or 'gateway' service/.test(i.message)));
});

test("prod hardening passes for a properly locked-down gateway", () => {
  const doc = parse(`
services:
  omni-shell:
    image: omniproject-shell:0.2.0
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    read_only: true
`);
  assert.deepEqual(auditComposeDoc("prod.yml", doc, { prod: true }), []);
});

test("the repo's real compose files satisfy every invariant", () => {
  // This is the live guard over the actual files — it must stay green.
  assert.deepEqual(auditRepoCompose(), []);
});

test("the slim (small-org) profile is registered as production-intent", () => {
  const slim = COMPOSE_FILES.find((f) => f.file === "docker-compose.slim.yml");
  assert.ok(slim, "docker-compose.slim.yml must be registered in COMPOSE_FILES");
  assert.equal(slim!.prod, true, "slim is a real deploy target, not a dev/test rig — must get gateway hardening");
});
