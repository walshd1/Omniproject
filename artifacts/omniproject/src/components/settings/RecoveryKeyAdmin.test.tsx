import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { RecoveryKeyAdmin } from "./RecoveryKeyAdmin";
import * as rk from "../../lib/recovery-key";

let status: unknown = { available: true, revealed: false, fingerprint: "abc123" };
vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role: "admin" } }), roleAtLeast: actual.roleAtLeast };
});
vi.mock("../../lib/step-up", () => ({ withStepUp: (fn: () => unknown) => fn() }));
vi.mock("../../lib/recovery-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recovery-key")>();
  return { ...actual, useRecoveryKeyStatus: () => ({ data: status }) };
});

afterEach(() => vi.restoreAllMocks());
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

describe("RecoveryKeyAdmin", () => {
  it("hides when there's no encrypted store", () => {
    status = { available: false, revealed: false, fingerprint: null };
    const { container } = renderWithProviders(<RecoveryKeyAdmin />, { client: client() });
    expect(container.querySelector('[data-testid="recovery-key-admin"]')).toBeNull();
  });

  it("warns hard, reveals once, and shows the key to save", async () => {
    status = { available: true, revealed: false, fingerprint: "abc123" };
    vi.spyOn(rk, "revealRecoveryKey").mockResolvedValue({ key: "BASE64KEY==", fingerprint: "abc123" });
    renderWithProviders(<RecoveryKeyAdmin />, { client: client() });

    expect(screen.getByTestId("recovery-key-warning")).toHaveTextContent(/only thing that can open an encrypted backup/i);
    fireEvent.click(screen.getByTestId("recovery-key-reveal"));
    await waitFor(() => expect(screen.getByTestId("recovery-key-value")).toHaveTextContent("BASE64KEY=="));
  });

  it("once revealed, the reveal button is gone (offers rotate instead)", () => {
    status = { available: true, revealed: true, fingerprint: "abc123" };
    renderWithProviders(<RecoveryKeyAdmin />, { client: client() });
    expect(screen.queryByTestId("recovery-key-reveal")).toBeNull();
    expect(screen.getByTestId("recovery-key-rotate")).toBeInTheDocument();
  });
});
