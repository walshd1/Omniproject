import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetCapabilitiesQueryKey,
  getGetSettingsQueryKey,
  type Capabilities,
  type Settings,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { TranslationLayer } from "./TranslationLayer";

const CAPS = {
  mode: "demo",
  fields: { title: { surface: true, store: true }, storyPoints: { surface: true, store: true } },
  entities: { project: { surface: true, store: false } },
} as unknown as Capabilities;

const SETTINGS = { aiProvider: "none", backendSource: "all", fieldOverrides: { fields: {}, entities: {} } } as unknown as Settings;

function client(role: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: null, role });
  qc.setQueryData(getGetCapabilitiesQueryKey(), CAPS);
  qc.setQueryData(getGetSettingsQueryKey(), SETTINGS);
  return qc;
}

describe("TranslationLayer", () => {
  it("is hidden for non-admins", () => {
    renderWithProviders(<TranslationLayer />, { client: client("contributor") });
    expect(screen.queryByTestId("translation-layer")).toBeNull();
  });

  it("lists fields and entities for an admin", () => {
    renderWithProviders(<TranslationLayer />, { client: client("admin") });
    expect(screen.getByTestId("translation-layer")).toBeInTheDocument();
    expect(screen.getByText("storyPoints")).toBeInTheDocument();
    expect(screen.getByText("project")).toBeInTheDocument();
  });

  it("reveals surface/store toggles when a row is overridden", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationLayer />, { client: client("admin") });
    expect(screen.queryByLabelText("storyPoints surface")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Override storyPoints" }));
    expect(screen.getByLabelText("storyPoints surface")).toBeInTheDocument();
    expect(screen.getByLabelText("storyPoints store")).toBeInTheDocument();
    // The override counter reflects it.
    expect(screen.getByText(/1 override/)).toBeInTheDocument();
  });
});
