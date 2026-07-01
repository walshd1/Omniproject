import { describe, it, expect } from "vitest";
import { safeParseJson } from "./safe-json";

describe("safeParseJson", () => {
  it("parses valid JSON like JSON.parse", () => {
    expect(safeParseJson('{"a":1,"b":[2,3],"c":"x"}')).toEqual({ a: 1, b: [2, 3], c: "x" });
    expect(safeParseJson("42")).toBe(42);
  });

  it("throws on invalid JSON", () => {
    expect(() => safeParseJson("{not json}")).toThrow();
  });

  it("strips a top-level __proto__ so a later merge cannot pollute Object.prototype", () => {
    const parsed = safeParseJson<Record<string, unknown>>('{"__proto__":{"polluted":true},"ok":1}');
    const merged = { ...parsed };
    expect((merged as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined(); // global prototype clean
    expect(parsed["ok"]).toBe(1);
  });

  it("strips nested constructor/prototype keys at any depth (own props removed)", () => {
    const parsed = safeParseJson<Record<string, unknown>>('{"a":{"constructor":{"prototype":{"x":1}}},"b":2}');
    const a = parsed["a"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(a, "constructor")).toBe(false);
    expect(Object.keys(a)).toEqual([]); // the malicious constructor key is gone
    expect(parsed["b"]).toBe(2);
  });

  it("does not pollute via the classic attack payload", () => {
    safeParseJson('{"__proto__":{"isAdmin":true}}');
    expect(({} as Record<string, unknown>)["isAdmin"]).toBeUndefined();
  });
});
