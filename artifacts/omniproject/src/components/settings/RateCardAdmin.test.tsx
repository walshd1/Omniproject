import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { rateCardQueryKey, type RateCardConfig } from "../../lib/rate-card";
import { RateCardAdmin } from "./RateCardAdmin";

function config(over: Partial<RateCardConfig> = {}): RateCardConfig {
  return {
    titles: {}, rates: {},
    projectTypes: [{ id: "delivery", label: "Delivery", values: [{ id: "cost", label: "True cost", kind: "cost" }] }],
    uplift: { central: { margin: 0.2, overhead: 0.1 }, programme: {}, project: {} },
    ...over,
  };
}

function seed(role: string | undefined, cfg: RateCardConfig | null): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  if (cfg) qc.setQueryData(rateCardQueryKey, cfg);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("RateCardAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("manager", config()) });
    expect(screen.queryByTestId("rate-card-admin")).not.toBeInTheDocument();
  });

  it("seeds the central uplift and project types from the server", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    expect(screen.getByTestId("rate-card-admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Central margin %")).toHaveValue("20"); // 0.2 → 20%
    expect(screen.getByTestId("rate-card-type-0")).toBeInTheDocument();
    expect(screen.getByTestId("rate-card-col-0-0")).toBeInTheDocument();
  });

  it("adds a project type and a value column in the draft", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    fireEvent.click(screen.getByText("+ project type"));
    expect(screen.getByTestId("rate-card-type-1")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("+ value column")[1]!); // on the new type
    expect(screen.getByTestId("rate-card-col-1-0")).toBeInTheDocument();
  });

  it("saves the edited margin and round-trips the untouched titles/rates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => config() } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config({ titles: { h1: "Engineer" } })) });

    fireEvent.change(screen.getByLabelText("Central margin %"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("Save rate card"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card")!;
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.uplift.margin).toBeCloseTo(0.25);
    expect(body.titles).toEqual({ h1: "Engineer" }); // untouched parts round-tripped
  });

  it("edits the central overhead percentage in the draft", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    fireEvent.change(screen.getByLabelText("Central overhead %"), { target: { value: "15" } });
    expect(screen.getByLabelText("Central overhead %")).toHaveValue("15");
  });

  it("clearing the central margin/overhead falls back to 0 rather than leaving them unset", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    fireEvent.change(screen.getByLabelText("Central margin %"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Central overhead %"), { target: { value: "" } });
    // Central margin/overhead are non-optional (unlike a per-column uplift), so clearing
    // the input resets the underlying value to 0 rather than leaving it undefined.
    expect(screen.getByLabelText("Central margin %")).toHaveValue("0");
    expect(screen.getByLabelText("Central overhead %")).toHaveValue("0");
  });

  it("shows an empty-state hint and no type cards when there are no project types", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config({ projectTypes: [] })) });
    expect(screen.getByTestId("rate-card-no-types")).toBeInTheDocument();
    expect(screen.queryByTestId("rate-card-type-0")).not.toBeInTheDocument();
  });

  it("removes a project type, reverting to the empty-state hint when it was the last one", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    expect(screen.getByTestId("rate-card-type-0")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remove type"));
    expect(screen.queryByTestId("rate-card-type-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("rate-card-no-types")).toBeInTheDocument();
  });

  it("removes a value column from a project type", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    expect(screen.getByTestId("rate-card-col-0-0")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove column 1 from type 1"));
    expect(screen.queryByTestId("rate-card-col-0-0")).not.toBeInTheDocument();
  });

  it("edits a project type's id and label", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    fireEvent.change(screen.getByLabelText("Project type 1 id"), { target: { value: "consulting" } });
    fireEvent.change(screen.getByLabelText("Project type 1 label"), { target: { value: "Consulting" } });
    expect(screen.getByLabelText("Project type 1 id")).toHaveValue("consulting");
    expect(screen.getByLabelText("Project type 1 label")).toHaveValue("Consulting");
  });

  it("edits a value column's id and label", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    fireEvent.change(screen.getByLabelText("Type 1 column 1 id"), { target: { value: "rate" } });
    fireEvent.change(screen.getByLabelText("Type 1 column 1 label"), { target: { value: "Rate" } });
    expect(screen.getByLabelText("Type 1 column 1 id")).toHaveValue("rate");
    expect(screen.getByLabelText("Type 1 column 1 label")).toHaveValue("Rate");
  });

  it("switching a column's kind to charge reveals its margin/overhead inputs, and clearing one keeps the other", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    expect(screen.queryByLabelText("Type 1 column 1 margin %")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Type 1 column 1 kind"), { target: { value: "charge" } });
    expect(screen.getByLabelText("Type 1 column 1 margin %")).toHaveValue("");
    expect(screen.getByLabelText("Type 1 column 1 overhead %")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Type 1 column 1 margin %"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Type 1 column 1 overhead %"), { target: { value: "5" } });
    expect(screen.getByLabelText("Type 1 column 1 margin %")).toHaveValue("10");
    expect(screen.getByLabelText("Type 1 column 1 overhead %")).toHaveValue("5");

    // Clearing margin leaves the already-set overhead untouched (setColumnUplift preserves the other field).
    fireEvent.change(screen.getByLabelText("Type 1 column 1 margin %"), { target: { value: "" } });
    expect(screen.getByLabelText("Type 1 column 1 margin %")).toHaveValue("");
    expect(screen.getByLabelText("Type 1 column 1 overhead %")).toHaveValue("5");
  });

  it("shows Reset once dirty, and reverts the draft to the server value on click", () => {
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });
    expect(screen.queryByText("Reset")).not.toBeInTheDocument();
    expect(screen.getByText("Save rate card")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Central margin %"), { target: { value: "25" } });
    expect(screen.getByText("Save rate card")).toBeEnabled();
    fireEvent.click(screen.getByText("Reset"));

    expect(screen.getByLabelText("Central margin %")).toHaveValue("20"); // back to the server's 0.2
    expect(screen.queryByText("Reset")).not.toBeInTheDocument();
  });

  it("shows the server's error message when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Locked by another editor" }) } as Response));
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });

    fireEvent.change(screen.getByLabelText("Central margin %"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("Save rate card"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Locked by another editor");
  });

  it("shows a Saved confirmation once the save succeeds and the draft is no longer dirty", async () => {
    const saved = config({ uplift: { central: { margin: 0.25, overhead: 0.1 }, programme: {}, project: {} } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => saved } as Response));
    renderWithProviders(<RateCardAdmin />, { client: seed("pmo", config()) });

    fireEvent.change(screen.getByLabelText("Central margin %"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("Save rate card"));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
});
