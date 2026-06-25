import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey, type Settings } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { LoggingSinkSettings } from "./LoggingSinkSettings";

function settings(over: Partial<Settings> = {}): Settings {
  return {
    brokerUrl: null, aiProvider: "none", aiModel: null, backendSource: "all", oidcIssuerUrl: null,
    loggingSink: { enabled: false, url: null, acknowledgedWarranty: false },
    ...over,
  } as Settings;
}

function seeded(s: Settings): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetSettingsQueryKey(), s);
  return qc;
}

describe("LoggingSinkSettings", () => {
  it("renders Off by default and disables Enable until url + acknowledgement are given", async () => {
    renderWithProviders(<LoggingSinkSettings />, { client: seeded(settings()) });
    expect(screen.getByText("Off")).toBeInTheDocument();
    const enable = screen.getByTestId("logging-sink-enable") as HTMLButtonElement;
    expect(enable).toBeDisabled();

    // A valid URL alone is not enough — the warranty acknowledgement is required.
    await userEvent.type(screen.getByLabelText(/logging server url/i), "https://logs.internal:9200/ingest");
    expect(enable).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/outside OmniProject's warranty/i));
    expect(enable).not.toBeDisabled();
  });

  it("shows the Disable control when already enabled", () => {
    renderWithProviders(<LoggingSinkSettings />, {
      client: seeded(settings({ loggingSink: { enabled: true, url: "https://logs.internal/ingest", acknowledgedWarranty: true } })),
    });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByTestId("logging-sink-disable")).toBeInTheDocument();
  });
});
