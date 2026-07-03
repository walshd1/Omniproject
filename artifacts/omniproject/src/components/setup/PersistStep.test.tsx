import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { PersistStep } from "./PersistStep";

function mockExport(text: string, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 403,
    text: () => Promise.resolve(text),
  }) as unknown as typeof fetch;
}

describe("PersistStep", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders heading, format tabs and the loaded snippet", async () => {
    mockExport("BROKER_URL=https://n8n");
    const { getByRole, findByText } = renderWithProviders(<PersistStep brokerUrlSet={true} />);
    expect(getByRole("heading", { name: /Make it permanent/ })).toBeInTheDocument();
    expect(getByRole("button", { name: ".env" })).toBeInTheDocument();
    expect(getByRole("button", { name: "docker-compose" })).toBeInTheDocument();
    expect(getByRole("button", { name: "k8s" })).toBeInTheDocument();
    expect(await findByText("BROKER_URL=https://n8n")).toBeInTheDocument();
  });

  it("re-fetches when switching format", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("snippet") });
    globalThis.fetch = fn as unknown as typeof fetch;
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<PersistStep brokerUrlSet={true} />);
    await findByText("snippet");
    await user.click(getByRole("button", { name: "docker-compose" }));
    expect(fn).toHaveBeenCalledWith(expect.stringContaining("format=compose"), expect.anything());
  });

  it("shows a fallback when the export fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("denied")) as unknown as typeof fetch;
    const { findByText } = renderWithProviders(<PersistStep brokerUrlSet={false} />);
    expect(await findByText(/could not load config/)).toBeInTheDocument();
  });

  it("copies the snippet to the clipboard", async () => {
    mockExport("COPY_ME");
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { findByText, getByRole } = renderWithProviders(<PersistStep brokerUrlSet={true} />);
    await findByText("COPY_ME");
    await user.click(getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith("COPY_ME");
  });
});
