import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSttStatus, transcribeClip, isRecordingSupported, startRecording, type SttStatus } from "./stt";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useSttStatus", () => {
  it("reads which speech engine is active", async () => {
    const status: SttStatus = { provider: "whisper", local: false };
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(status), { status: 200, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSttStatus(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toEqual(status);
  });
});

describe("transcribeClip", () => {
  it("base64-encodes the clip, POSTs it, and returns the transcript text", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ text: "hello there" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob(["abc"], { type: "audio/ogg" });
    await expect(transcribeClip(blob)).resolves.toBe("hello there");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/ai/transcribe");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.mime).toBe("audio/ogg");
    expect(typeof body.audio).toBe("string");
    expect(body.audio.length).toBeGreaterThan(0);
    expect(body.audio.startsWith("data:")).toBe(false); // the "data:...;base64," prefix is stripped
  });

  it("defaults the mime to audio/webm when the blob has no type", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ text: "x" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeClip(new Blob(["z"]));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.mime).toBe("audio/webm");
  });

  it("returns empty string when the reply omits text", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(transcribeClip(new Blob(["z"], { type: "audio/webm" }))).resolves.toBe("");
  });

  it("throws the server error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ error: "gate closed" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(transcribeClip(new Blob(["z"], { type: "audio/webm" }))).rejects.toThrow("gate closed");
  });

  it("falls back to a status message when the error body is unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response("<html>", { status: 500 })));
    await expect(transcribeClip(new Blob(["z"], { type: "audio/webm" }))).rejects.toThrow("transcription failed: 500");
  });
});

describe("isRecordingSupported", () => {
  it("is false without MediaRecorder / getUserMedia", () => {
    expect(isRecordingSupported()).toBe(false);
  });

  it("is true when both MediaRecorder and getUserMedia exist", () => {
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });
    (window as unknown as Record<string, unknown>).MediaRecorder = function () { /* noop */ } as unknown;
    try {
      expect(isRecordingSupported()).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>).MediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    }
  });
});

describe("startRecording", () => {
  it("throws a clear error when the platform can't record", async () => {
    await expect(startRecording()).rejects.toThrow("Audio recording is not supported here.");
  });

  it("captures a clip and releases the mic on stop", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { /* recording */ }
      stop() {
        // Deliver one chunk, then fire onstop like a real recorder.
        this.ondataavailable?.({ data: new Blob(["chunk"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    (window as unknown as Record<string, unknown>).MediaRecorder = FakeMediaRecorder as unknown;

    try {
      const rec = await startRecording();
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
      const blob = await rec.stop();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("audio/webm");
      expect(track.stop).toHaveBeenCalled();
    } finally {
      delete (window as unknown as Record<string, unknown>).MediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    }
  });

  it("ignores zero-size chunks and falls back to audio/webm when the recorder has no mimeType", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn(async () => stream) }, configurable: true });

    class FakeMediaRecorder {
      mimeType = ""; // empty ⇒ the `|| "audio/webm"` fallback should apply
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { /* recording */ }
      stop() {
        this.ondataavailable?.({ data: new Blob([]) }); // size 0 ⇒ not pushed
        this.onstop?.();
      }
    }
    (window as unknown as Record<string, unknown>).MediaRecorder = FakeMediaRecorder as unknown;

    try {
      const rec = await startRecording();
      const blob = await rec.stop();
      expect(blob.size).toBe(0); // the empty chunk was skipped
      expect(blob.type).toBe("audio/webm"); // mimeType fallback
    } finally {
      delete (window as unknown as Record<string, unknown>).MediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    }
  });
});
