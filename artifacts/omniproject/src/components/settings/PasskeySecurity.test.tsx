import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { PasskeySecurity } from "./PasskeySecurity";
import * as passkey from "../../lib/passkey";

let authState: unknown = { authenticated: true, user: { sub: "local:1" }, strongAuth: false, local: true };
vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: authState }) };
});

afterEach(() => vi.restoreAllMocks());
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

describe("PasskeySecurity", () => {
  it("shows the weak-auth prompt and steps up via the passkey helper", async () => {
    authState = { authenticated: true, user: { sub: "local:1" }, strongAuth: false, local: true };
    vi.spyOn(passkey, "passkeySupported").mockReturnValue(true);
    const stepUp = vi.spyOn(passkey, "passkeyStepUp").mockResolvedValue({ ok: true });
    renderWithProviders(<PasskeySecurity />, { client: client() });

    expect(screen.getByTestId("passkey-weak")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("passkey-stepup"));
    await waitFor(() => expect(stepUp).toHaveBeenCalled());
  });

  it("shows the satisfied state and disables step-up when already strong", () => {
    authState = { authenticated: true, user: { sub: "local:1" }, strongAuth: true, local: true };
    vi.spyOn(passkey, "passkeySupported").mockReturnValue(true);
    renderWithProviders(<PasskeySecurity />, { client: client() });
    expect(screen.getByTestId("passkey-strong")).toBeInTheDocument();
    expect(screen.getByTestId("passkey-stepup")).toBeDisabled();
  });
});
