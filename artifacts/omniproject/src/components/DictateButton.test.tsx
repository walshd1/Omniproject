import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { DictateButton } from "./DictateButton";
import type { SttStatus } from "../lib/stt";

/**
 * Dictate button: provider-pluggable speech-to-text.
 *  - "browser": on-device engine; hidden when unavailable; audio stays local.
 *  - "whisper": records locally then uploads the clip to the gateway for transcription.
 */
class FakeRecognition {
  lang = ""; continuous = false; interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.onresult?.({ results: [[{ transcript: "show overdue work" }]] }); this.onend?.(); }
  stop() { this.onend?.(); }
}

function seeded(status: SttStatus): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["ai-stt"], status);
  return qc;
}

const win = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete win["SpeechRecognition"];
  delete win["MediaRecorder"];
  vi.restoreAllMocks();
});

describe("DictateButton (browser engine)", () => {
  it("renders nothing without a local speech engine", () => {
    renderWithProviders(<DictateButton onText={() => {}} />, { client: seeded({ provider: "browser", local: true }) });
    expect(screen.queryByTestId("dictate-button")).not.toBeInTheDocument();
  });

  describe("with a local engine", () => {
    beforeEach(() => { win["SpeechRecognition"] = FakeRecognition; });

    it("captures recognised text via onText, on device", () => {
      const onText = vi.fn();
      renderWithProviders(<DictateButton onText={onText} />, { client: seeded({ provider: "browser", local: true }) });
      fireEvent.click(screen.getByTestId("dictate-button"));
      expect(onText).toHaveBeenCalledWith("show overdue work");
    });
  });
});

describe("DictateButton (whisper engine)", () => {
  it("renders nothing when recording is unsupported", () => {
    renderWithProviders(<DictateButton onText={() => {}} />, { client: seeded({ provider: "whisper", local: false }) });
    expect(screen.queryByTestId("dictate-button")).not.toBeInTheDocument();
  });

  it("records locally, uploads the clip, and feeds back the transcript", async () => {
    // Minimal MediaRecorder + getUserMedia fakes.
    const stop = vi.fn();
    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() { this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); this.onstop?.(); }
    }
    win["MediaRecorder"] = FakeMediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "hello from whisper" }) });
    vi.stubGlobal("fetch", fetchMock);

    const onText = vi.fn();
    renderWithProviders(<DictateButton onText={onText} />, { client: seeded({ provider: "whisper", local: false }) });

    const btn = screen.getByTestId("dictate-button");
    fireEvent.click(btn); // start recording
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(btn); // stop → upload → transcribe

    await waitFor(() => expect(onText).toHaveBeenCalledWith("hello from whisper"));
    expect(fetchMock).toHaveBeenCalledWith("/api/ai/transcribe", expect.objectContaining({ method: "POST" }));
    expect(stop).toHaveBeenCalled(); // mic released
  });

  it("releases the microphone if it unmounts while still recording (no use-after-unmount leak)", async () => {
    // Regression: the unmount cleanup used to stop only the browser dictation, leaving a live
    // Whisper MediaRecorder — the mic stayed open after the component was gone.
    const stop = vi.fn();
    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() { this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); this.onstop?.(); }
    }
    win["MediaRecorder"] = FakeMediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
    });

    const { unmount } = renderWithProviders(<DictateButton onText={() => {}} />, { client: seeded({ provider: "whisper", local: false }) });
    const btn = screen.getByTestId("dictate-button");
    fireEvent.click(btn); // start recording — mic is now live
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "true"));

    unmount(); // leave WITHOUT tapping stop
    expect(stop).toHaveBeenCalled(); // the mic track was released on unmount
  });
});
