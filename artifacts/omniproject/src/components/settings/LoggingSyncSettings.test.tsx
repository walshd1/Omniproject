import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useToast } from "@/hooks/use-toast";
import { QueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey, type Settings } from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { LoggingSyncSettings } from "./LoggingSyncSettings";

function settings(over: Partial<Settings> = {}): Settings {
  return {
    brokerUrl: null, aiProvider: "none", aiModel: null, backendSource: "all", oidcIssuerUrl: null,
    loggingSync: { enabled: false, url: null, acknowledgedWarranty: false },
    ...over,
  } as Settings;
}

function seeded(s: Settings): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(getGetSettingsQueryKey(), s);
  return qc;
}

afterEach(() => resetFetchMock());

describe("LoggingSyncSettings", () => {
  it("renders Off by default and disables Enable until url + acknowledgement are given", async () => {
    renderWithProviders(<LoggingSyncSettings />, { client: seeded(settings()) });
    expect(screen.getByText("Off")).toBeInTheDocument();
    const enable = screen.getByTestId("logging-sync-enable") as HTMLButtonElement;
    expect(enable).toBeDisabled();

    // A valid URL alone is not enough — the warranty acknowledgement is required.
    await userEvent.type(screen.getByLabelText(/logging server url/i), "https://logs.internal:9200/ingest");
    expect(enable).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/outside OmniProject's warranty/i));
    expect(enable).not.toBeDisabled();
  });

  it("shows the Disable control when already enabled", () => {
    renderWithProviders(<LoggingSyncSettings />, {
      client: seeded(settings({ loggingSync: { enabled: true, url: "https://logs.internal/ingest", acknowledgedWarranty: true } })),
    });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByTestId("logging-sync-disable")).toBeInTheDocument();
  });

  it("flags a malformed URL and keeps Enable disabled even with the acknowledgement", () => {
    renderWithProviders(<LoggingSyncSettings />, { client: seeded(settings()) });
    fireEvent.change(screen.getByLabelText(/logging server url/i), { target: { value: "not a url" } });
    fireEvent.click(screen.getByLabelText(/outside OmniProject's warranty/i));
    // The URL error alert appears and the input is marked invalid.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText(/logging server url/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("logging-sync-enable")).toBeDisabled();
  });

  it("enables egress: PATCHes the settings and shows the success toast", async () => {
    const { result } = renderHook(() => useToast());
    const calls = mockFetchRouter({ "PATCH /api/settings": { ok: true, body: {} } });
    renderWithProviders(<LoggingSyncSettings />, { client: seeded(settings()) });
    fireEvent.change(screen.getByLabelText(/logging server url/i), { target: { value: "https://logs.internal:9200/ingest" } });
    fireEvent.click(screen.getByLabelText(/outside OmniProject's warranty/i));
    fireEvent.click(screen.getByTestId("logging-sync-enable"));
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/settings") && c.init?.method === "PATCH");
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call!.init?.body));
      expect(body.loggingSync).toEqual({ enabled: true, url: "https://logs.internal:9200/ingest", acknowledgedWarranty: true });
    });
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "LOGGING SYNC ENABLED")).toBe(true));
  });

  it("disabling egress from the enabled state PATCHes enabled:false and toasts disabled", async () => {
    const { result } = renderHook(() => useToast());
    const calls = mockFetchRouter({ "PATCH /api/settings": { ok: true, body: {} } });
    renderWithProviders(<LoggingSyncSettings />, {
      client: seeded(settings({ loggingSync: { enabled: true, url: "https://logs.internal/ingest", acknowledgedWarranty: true } })),
    });
    fireEvent.click(screen.getByTestId("logging-sync-disable"));
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/settings") && c.init?.method === "PATCH");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call!.init?.body)).loggingSync.enabled).toBe(false);
    });
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "LOGGING SYNC DISABLED")).toBe(true));
  });

  it("surfaces a destructive toast when the save fails", async () => {
    const { result } = renderHook(() => useToast());
    mockFetchRouter({ "PATCH /api/settings": { ok: false, status: 500 } });
    renderWithProviders(<LoggingSyncSettings />, { client: seeded(settings()) });
    fireEvent.change(screen.getByLabelText(/logging server url/i), { target: { value: "https://logs.internal/ingest" } });
    fireEvent.click(screen.getByLabelText(/outside OmniProject's warranty/i));
    fireEvent.click(screen.getByTestId("logging-sync-enable"));
    await waitFor(() =>
      expect(result.current.toasts.some((t) => t.title === "COULD NOT SAVE" && t.variant === "destructive")).toBe(true),
    );
  });
});
