import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useRecoveryKeyStatus,
  revealRecoveryKey,
  rotateRecoveryKey,
  downloadPortableBackup,
  restorePortableBackup,
  recoveryKeyStatusKey,
} from "./recovery-key";

/**
 * Instance Recovery Key (IRK) + portable backup helpers. The status query and the reveal/rotate/restore
 * mutations go through the shared fetch helpers; the portable-backup download drives the anchor-click file
 * save (URL.createObjectURL isn't in jsdom, so it's stubbed).
 */

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe("recoveryKeyStatusKey", () => {
  it("is a stable query key", () => {
    expect(recoveryKeyStatusKey).toEqual(["recovery-key", "status"]);
  });
});

describe("useRecoveryKeyStatus", () => {
  it("returns the instance-key status on success", async () => {
    const status = { available: true, revealed: false, fingerprint: "ab:cd" };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(status), { status: 200 }))));
    const { result } = renderHook(() => useRecoveryKeyStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(status);
  });

  it("surfaces an error (throwing the status code) on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 403 }))));
    const { result } = renderHook(() => useRecoveryKeyStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("403"));
  });
});

describe("revealRecoveryKey / rotateRecoveryKey", () => {
  it("reveals the key once (POST → { key, fingerprint })", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ key: "K", fingerprint: "FP" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await revealRecoveryKey()).toEqual({ key: "K", fingerprint: "FP" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/setup/instance-key/reveal");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("rotates the key (POST → new { key, fingerprint })", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ key: "K2", fingerprint: "FP2" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await rotateRecoveryKey()).toEqual({ key: "K2", fingerprint: "FP2" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/setup/instance-key/rotate");
  });

  it("throws the server error when reveal is refused (409, already revealed)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "already revealed" }), { status: 409 }))));
    await expect(revealRecoveryKey()).rejects.toThrow("already revealed");
  });

  it("falls back to the supplied message when rotate fails with no error field", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 500 }))));
    await expect(rotateRecoveryKey()).rejects.toThrow("Could not rotate the key.");
  });
});

describe("restorePortableBackup", () => {
  it("posts the bundle + old key and returns the rotated new key", async () => {
    const reply = { restored: true, newKey: "NEW", warnings: ["w1"] };
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(reply), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await restorePortableBackup({ some: "bundle" }, "OLD")).toEqual(reply);
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ bundle: { some: "bundle" }, key: "OLD" });
  });

  it("throws the fallback message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 400 }))));
    await expect(restorePortableBackup({}, "OLD")).rejects.toThrow("Restore failed.");
  });
});

describe("downloadPortableBackup", () => {
  it("fetches the sealed backup and triggers an anchor download", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ x: 1 }), { status: 200 }))));

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, "appendChild");

    await expect(downloadPortableBackup()).resolves.toBeUndefined();

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    const anchor = appendSpy.mock.calls[0]![0] as HTMLAnchorElement;
    expect(anchor.download).toBe("omniproject-portable-backup.json");
    expect(anchor.href).toContain("blob:mock-url");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    // The anchor is removed from the DOM after the click.
    expect(document.body.contains(anchor)).toBe(false);
  });

  it("throws when the backup cannot be built", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))));
    await expect(downloadPortableBackup()).rejects.toThrow("Could not build the backup.");
  });
});
