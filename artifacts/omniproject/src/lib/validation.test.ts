import { describe, it, expect } from "vitest";
import { urlFormatError, envNameError } from "./validation";

describe("urlFormatError", () => {
  it("treats empty/whitespace as valid (use a separate required check)", () => {
    expect(urlFormatError("")).toBeNull();
    expect(urlFormatError("   ")).toBeNull();
  });

  it("accepts absolute http(s) URLs", () => {
    expect(urlFormatError("http://n8n:5678/webhook")).toBeNull();
    expect(urlFormatError("https://example.com/path?q=1")).toBeNull();
  });

  it("rejects non-URLs", () => {
    expect(urlFormatError("not a url")).toMatch(/valid URL/i);
    expect(urlFormatError("example.com")).toMatch(/valid URL/i);
  });

  it("rejects non-http(s) schemes", () => {
    expect(urlFormatError("ftp://example.com")).toMatch(/http/i);
    expect(urlFormatError("file:///etc/passwd")).toMatch(/http/i);
  });
});

describe("envNameError", () => {
  it("requires a non-empty name", () => {
    expect(envNameError("")).toMatch(/Enter an environment name/i);
    expect(envNameError("   ")).toMatch(/Enter an environment name/i);
  });

  it("accepts letters, digits, dash and underscore", () => {
    expect(envNameError("prod-1")).toBeNull();
    expect(envNameError("staging_eu")).toBeNull();
    expect(envNameError("ABC123")).toBeNull();
  });

  it("rejects spaces and other characters", () => {
    expect(envNameError("my env")).toMatch(/letters, numbers/i);
    expect(envNameError("env!")).toMatch(/letters, numbers/i);
    expect(envNameError("a/b")).toMatch(/letters, numbers/i);
  });
});
