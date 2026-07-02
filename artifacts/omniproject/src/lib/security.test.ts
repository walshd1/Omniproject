import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { revokeKey, revokeUserSessions } from "./security";

/**
 * Regression test for the silent-failure bug: revokeKey/revokeUserSessions used to skip the
 * res.ok check every sibling mutation client applies, so a FAILED revoke resolved as success.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("fetch", (fetchMock = vi.fn()));
});
afterEach(() => vi.unstubAllGlobals());

describe("revokeKey", () => {
  it("resolves on a 2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    await expect(revokeKey("session", "rotate")).resolves.toBeUndefined();
  });

  it("throws instead of silently resolving on a failed response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) });
    await expect(revokeKey("session", "rotate")).rejects.toThrow("forbidden");
  });
});

describe("revokeUserSessions", () => {
  it("resolves on a 2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    await expect(revokeUserSessions("user-1")).resolves.toBeUndefined();
  });

  it("throws instead of silently resolving on a failed response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    await expect(revokeUserSessions("user-1")).rejects.toThrow("Failed (500)");
  });
});
