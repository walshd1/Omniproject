import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetCapabilitiesQueryKey,
  getGetSettingsQueryKey,
  getGetFieldManifestQueryKey,
  type Capabilities,
  type Settings,
  type FieldManifest,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
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

  it("shows the backend field manifest with discovered custom fields", () => {
    const qc = client("admin");
    qc.setQueryData(getGetFieldManifestQueryKey(), {
      mode: "demo",
      enumerated: [],
      reconciliation: { known: ["title", "status"], unknown: ["customerTier"], missing: [] },
      customFields: [{ key: "customerTier", label: "Customer tier", type: "string", surface: true, store: false }],
      relationshipCandidates: [],
    } as unknown as FieldManifest);
    renderWithProviders(<TranslationLayer />, { client: qc });
    const manifest = screen.getByTestId("field-manifest");
    expect(manifest).toHaveTextContent("2 mapped");
    expect(manifest).toHaveTextContent("1 custom");
    expect(manifest).toHaveTextContent("customerTier");
  });

  it("filters the field list by the search box", () => {
    renderWithProviders(<TranslationLayer />, { client: client("admin") });
    expect(screen.getByText("title")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter fields"), { target: { value: "story" } });
    expect(screen.getByText("storyPoints")).toBeInTheDocument();
    expect(screen.queryByText("title")).toBeNull();
  });

  it("overrides an entity, edits its toggles, and clears all overrides", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationLayer />, { client: client("admin") });

    await user.click(screen.getByRole("button", { name: "Override project" }));
    const storeToggle = screen.getByLabelText("project store");
    // project's effective store is false; flip it on via onSet.
    expect(storeToggle).not.toBeChecked();
    fireEvent.click(storeToggle);
    expect(screen.getByLabelText("project store")).toBeChecked();
    expect(screen.getByText(/1 override/)).toBeInTheDocument();

    // Clear-all wipes both maps and disables itself again.
    const clearAll = screen.getByRole("button", { name: "Clear all" });
    fireEvent.click(clearAll);
    expect(screen.getByText(/0 overrides/)).toBeInTheDocument();
    expect(clearAll).toBeDisabled();
    expect(screen.queryByLabelText("project store")).toBeNull();
  });

  it("clears a single override with its ✕ button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TranslationLayer />, { client: client("admin") });
    await user.click(screen.getByRole("button", { name: "Override storyPoints" }));
    expect(screen.getByText(/1 override/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Clear override for storyPoints"));
    expect(screen.getByText(/0 overrides/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Override storyPoints" })).toBeInTheDocument();
  });

  describe("save", () => {
    afterEach(() => resetFetchMock());

    it("PATCHes the overrides to /api/settings on Save", async () => {
      const calls = mockFetchRouter({
        "PATCH /api/settings": { ok: true, body: SETTINGS },
        "/api/settings": { ok: true, body: SETTINGS },
        "/api/capabilities": { ok: true, body: CAPS },
        "/api/fields/manifest": { ok: false, status: 500 },
      });
      const user = userEvent.setup();
      renderWithProviders(<TranslationLayer />, { client: client("admin") });
      await user.click(screen.getByRole("button", { name: "Override project" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        const patch = calls.find((c) => c.url.includes("/api/settings") && (c.init?.method ?? "").toUpperCase() === "PATCH");
        expect(patch).toBeTruthy();
        expect(JSON.parse(String(patch!.init?.body)).fieldOverrides.entities.project).toBeTruthy();
      });
    });

    it("handles a 403 save rejection without crashing (admin-only branch)", async () => {
      mockFetchRouter({
        "PATCH /api/settings": { ok: false, status: 403 },
        "/api/settings": { ok: true, body: SETTINGS },
        "/api/capabilities": { ok: true, body: CAPS },
        "/api/fields/manifest": { ok: false, status: 500 },
      });
      const user = userEvent.setup();
      renderWithProviders(<TranslationLayer />, { client: client("admin") });
      await user.click(screen.getByRole("button", { name: "Override project" }));
      const saveBtn = screen.getByRole("button", { name: "Save" });
      fireEvent.click(saveBtn);
      await waitFor(() => expect(saveBtn).toBeEnabled());
      expect(saveBtn).toHaveTextContent("Save");
    });
  });
});
