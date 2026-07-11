import { test } from "node:test";
import assert from "node:assert/strict";
import { importSpecifier, stripComments, codeLines } from "./ts-source";

test("importSpecifier catches static, bare, dynamic and require forms", () => {
  assert.equal(importSpecifier(`import { x } from "./broker/reference-broker";`), "./broker/reference-broker");
  assert.equal(importSpecifier(`import "./side-effect";`), "./side-effect");
  assert.equal(importSpecifier(`const b = await import("./broker/reference-broker");`), "./broker/reference-broker");
  assert.equal(importSpecifier(`const pg = require("pg");`), "pg");
  assert.equal(importSpecifier(`import pkg from 'ioredis'`), "ioredis");
  assert.equal(importSpecifier(`const y = 2 + 2;`), null);
});

test("stripComments removes line comments but keeps string bodies containing //", () => {
  // The G1 bug: a naive indexOf('//') truncates this string at the scheme's slashes.
  const src = `const url = "https://n8n.cloud"; // real comment`;
  const out = stripComments(src);
  assert.ok(out.includes("n8n.cloud"), "vendor token inside the string must survive");
  assert.ok(!out.includes("real comment"), "the trailing line comment must be stripped");
});

test("stripComments strips block comments and keeps line numbers aligned", () => {
  const src = ["a();", "/* block", "   still comment */ b();", "c();"].join("\n");
  const lines = codeLines(src);
  assert.equal(lines.length, 4);
  assert.match(lines[0]!.text, /a\(\)/);
  assert.equal(lines[1]!.text.trim(), ""); // fully inside the block comment
  assert.match(lines[2]!.text, /b\(\)/); // code after the block-comment close survives
  assert.match(lines[3]!.text, /c\(\)/);
});

test("stripComments does not treat // or /* inside strings as comments", () => {
  assert.ok(stripComments(`x = "a /* not a block */ b";`).includes("/* not a block */"));
  assert.ok(stripComments("y = `t //still text`;").includes("//still text"));
  // Escaped quote inside a string must not end the string early.
  assert.ok(stripComments(`z = "he said \\"hi//\\" ok"; // gone`).includes("hi//"));
  assert.ok(!stripComments(`z = "ok"; // gone`).includes("gone"));
});
