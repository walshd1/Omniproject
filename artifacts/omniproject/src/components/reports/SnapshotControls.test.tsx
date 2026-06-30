import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { SnapshotButton, SnapshotVerifyPanel } from "./SnapshotControls";
import type { SnapshotBundle, SnapshotVerdict } from "../../lib/snapshot";

const bundle: SnapshotBundle = {
  manifest: { id: "s1", scope: "portfolio-financials", label: "March", createdAt: "2026-03-01T00:00:00.000Z", rowCount: 1, contentHash: "abc", hashAlgorithm: "sha256" },
  data: [{ programme: "Platform", budget: 1000 }],
};

afterEach(() => vi.unstubAllGlobals());

/** jsdom's Blob.text() is unreliable, so attach a deterministic reader (as BackupStep's test does). */
function jsonFile(value: unknown, name = "snap.json"): File {
  const content = JSON.stringify(value);
  const file = new File([content], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
  return file;
}

describe("SnapshotButton", () => {
  it("captures the data and downloads the returned bundle", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => bundle } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<SnapshotButton scope="portfolio-financials" label="March" data={{ total: 1 }} />);
    await userEvent.click(screen.getByTestId("snapshot-capture"));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/snapshots/capture")!;
    expect(call).toBeTruthy();
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ scope: "portfolio-financials", data: { total: 1 } });
  });

  it("surfaces a capture error without downloading", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) } as Response));
    renderWithProviders(<SnapshotButton scope="x" label="x" data={{}} />);
    await userEvent.click(screen.getByTestId("snapshot-capture"));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});

describe("SnapshotVerifyPanel", () => {
  function upload(verdict: SnapshotVerdict) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => verdict } as Response));
    renderWithProviders(<SnapshotVerifyPanel />);
    return userEvent.upload(screen.getByLabelText("Snapshot bundle to verify"), jsonFile(bundle));
  }

  it("shows an authentic verdict for an intact bundle", async () => {
    await upload({ ok: true, contentMatches: true, signatureValid: null, reason: "content intact" });
    expect(await screen.findByTestId("snapshot-verdict")).toHaveTextContent("Authentic & unaltered");
  });

  it("shows a failure verdict when the content was altered", async () => {
    await upload({ ok: false, contentMatches: false, signatureValid: null, reason: "content has been altered (hash mismatch)" });
    expect(await screen.findByTestId("snapshot-verdict")).toHaveTextContent("Verification failed");
    expect(screen.getByTestId("snapshot-verdict")).toHaveTextContent("altered");
  });

  it("rejects a non-snapshot JSON file before calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SnapshotVerifyPanel />);
    await userEvent.upload(screen.getByLabelText("Snapshot bundle to verify"), jsonFile({ hello: "world" }, "nope.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't a snapshot bundle");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/snapshots/verify"))).toBe(false);
  });
});
