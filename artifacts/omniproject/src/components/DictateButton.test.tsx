import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DictateButton } from "./DictateButton";

/**
 * Dictate button: hidden when the local speech engine is unavailable; when present it
 * captures recognised text and feeds it back (audio stays local — no network).
 */
class FakeRecognition {
  lang = ""; continuous = false; interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.onresult?.({ results: [[{ transcript: "show overdue work" }]] }); this.onend?.(); }
  stop() { this.onend?.(); }
}

afterEach(() => { delete (window as unknown as Record<string, unknown>)["SpeechRecognition"]; });

describe("DictateButton", () => {
  it("renders nothing without a speech engine", () => {
    render(<DictateButton onText={() => {}} />);
    expect(screen.queryByTestId("dictate-button")).not.toBeInTheDocument();
  });

  describe("with a local engine", () => {
    beforeEach(() => { (window as unknown as Record<string, unknown>)["SpeechRecognition"] = FakeRecognition; });

    it("captures recognised text via onText", () => {
      const onText = vi.fn();
      render(<DictateButton onText={onText} />);
      fireEvent.click(screen.getByTestId("dictate-button"));
      expect(onText).toHaveBeenCalledWith("show overdue work");
    });
  });
});
