import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, resetFetchMock, mockBlobDownload } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { attachmentsQueryKey, type Attachment } from "../../lib/attachments";
import { AttachmentsPanel } from "./AttachmentsPanel";

/** AttachmentsPanel renders the room's pointers (seeded via the query cache) + an upload control. */
describe("AttachmentsPanel", () => {
  function seed(roomId: string, attachments: Attachment[]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    qc.setQueryData(attachmentsQueryKey(roomId), attachments);
    return qc;
  }

  const ATT: Attachment = {
    id: "a1",
    roomId: "issue:p1:i1",
    filename: "spec.pdf",
    contentType: "application/pdf",
    size: 2048,
    sha256: "f".repeat(64),
    storageKey: "abc123",
    author: { sub: "u", label: "Alice" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  /** Capture-and-canned fetch stub; supports a blob() for the download route. */
  function stubFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown; blob?: Blob }) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = handler(String(url), init);
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(r.body ?? {}),
        text: () => Promise.resolve(JSON.stringify(r.body ?? {})),
        blob: () => Promise.resolve(r.blob ?? new Blob(["x"])),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  afterEach(() => resetFetchMock());

  it("renders the seeded attachments with filename, size and a delete control", () => {
    renderWithProviders(<AttachmentsPanel roomId="issue:p1:i1" />, { client: seed("issue:p1:i1", [ATT]) });
    expect(screen.getByRole("button", { name: /spec\.pdf/ })).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete attachment" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no attachments", () => {
    renderWithProviders(<AttachmentsPanel roomId="issue:p1:i2" />, { client: seed("issue:p1:i2", []) });
    expect(screen.getByText(/No attachments yet/)).toBeInTheDocument();
  });

  it("uploads a chosen file as a raw body with an x-filename header", async () => {
    const calls = stubFetch((url) =>
      url.includes("/api/attachments") ? { ok: true, body: { attachment: ATT } } : { ok: true, body: { attachments: [] } },
    );
    renderWithProviders(<AttachmentsPanel roomId="issue:p1:i1" />, { client: seed("issue:p1:i1", []) });
    const input = screen.getByLabelText("Upload attachment") as HTMLInputElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const post = calls.find((c) => (c.init?.method ?? "GET") === "POST");
      expect(post).toBeTruthy();
      const headers = new Headers(post!.init!.headers);
      expect(headers.get("x-filename")).toBe("notes.txt");
      expect(post!.init!.body).toBe(file); // raw file body, not JSON
    });
  });

  it("deletes an attachment through the delete endpoint", async () => {
    const calls = stubFetch(() => ({ ok: true, body: { attachments: [] } }));
    renderWithProviders(<AttachmentsPanel roomId="issue:p1:i1" />, { client: seed("issue:p1:i1", [ATT]) });
    fireEvent.click(screen.getByRole("button", { name: "Delete attachment" }));
    await waitFor(() => {
      const del = calls.find((c) => (c.init?.method ?? "GET") === "DELETE");
      expect(del).toBeTruthy();
      expect(del!.url).toContain("a1");
    });
  });

  it("downloads the bytes when the filename is clicked", async () => {
    const dl = mockBlobDownload();
    try {
      stubFetch(() => ({ ok: true, blob: new Blob(["PDF"]) }));
      renderWithProviders(<AttachmentsPanel roomId="issue:p1:i1" />, { client: seed("issue:p1:i1", [ATT]) });
      fireEvent.click(screen.getByRole("button", { name: /spec\.pdf/ }));
      await waitFor(() => expect(dl.click).toHaveBeenCalled());
    } finally {
      dl.restore();
    }
  });

  it("surfaces an error toast when the upload fails", async () => {
    stubFetch((url) =>
      url.includes("/api/attachments") ? { ok: false, status: 502, body: { error: "sidecar down" } } : { ok: true, body: { attachments: [] } },
    );
    renderWithProviders(<><AttachmentsPanel roomId="issue:p1:i1" /><Toaster /></>, { client: seed("issue:p1:i1", []) });
    const input = screen.getByLabelText("Upload attachment") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "f.bin", { type: "application/octet-stream" })] } });
    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(await screen.findByText("sidecar down")).toBeInTheDocument();
  });
});
