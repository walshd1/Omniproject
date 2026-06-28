import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLocalPath } from "./auth";

/** Open-redirect guard for the post-auth `returnTo` (CWE-601). */
test("safeLocalPath keeps a same-origin path", () => {
  assert.equal(safeLocalPath("/projects"), "/projects");
  assert.equal(safeLocalPath("/a/b?c=d#e"), "/a/b?c=d#e");
});

test("safeLocalPath rejects absolute, protocol-relative and scheme URLs", () => {
  for (const evil of [
    "https://evil.example/phish",
    "http://evil.example",
    "//evil.example",            // protocol-relative
    "/\\evil.example",           // backslash trick (browsers normalise to //)
    "javascript:alert(1)",
    "data:text/html,x",
    "evil.example",              // no leading slash
    "",
    null,
    undefined,
    123,
  ]) {
    assert.equal(safeLocalPath(evil as unknown), "/", String(evil));
  }
});

test("safeLocalPath strips control-char (CR/LF/tab) smuggling", () => {
  assert.equal(safeLocalPath("/ok\r\nSet-Cookie: x=1"), "/");
  assert.equal(safeLocalPath("/ok\tx"), "/");
});
