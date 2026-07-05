import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getListProgrammesQueryKey, type Programme } from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
import { Toaster } from "./ui/toaster";
import { NewProjectDialog } from "./NewProjectDialog";

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProgrammesQueryKey(), [
    { id: "prog-1", name: "Platform" },
  ] as unknown as Programme[]);
  return qc;
}

afterEach(resetFetchMock);

describe("NewProjectDialog", () => {
  it("renders the create form with name required", async () => {
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });
    expect(screen.getByRole("heading", { name: /New Project/i })).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /Create project/i });
    // empty name → submit disabled
    expect(submit).toBeDisabled();
  });

  it("enables submit once a name is entered and surfaces existing programmes", async () => {
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });
    await userEvent.type(screen.getByLabelText("Name"), "Apollo");
    expect(screen.getByRole("button", { name: /Create project/i })).toBeEnabled();
    // the programme datalist offers the existing programme
    expect(screen.getByText("Platform")).toBeInTheDocument();
  });

  it("flags a whitespace-only name as invalid", async () => {
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });
    await userEvent.type(screen.getByLabelText("Name"), "   ");
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(screen.getByRole("button", { name: /Create project/i })).toBeDisabled();
  });

  it("guards against submission with an invalid name even if the form is submitted directly", () => {
    // The submit button is disabled while nameError is set, but the form's own submit handler
    // still guards against it directly (defence in depth against a bypassed/direct form submit).
    const calls = mockFetchRouter({});
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
    expect(calls.find((c) => c.init?.method === "POST")).toBeUndefined();
  });

  it("doesn't crash the programme datalist while the programmes query hasn't resolved yet", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); // no seeded programmes data
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: qc });
    expect(screen.getByLabelText("Programme (optional — pick or name a new one)")).toBeInTheDocument();
  });

  it("shows a pending label while the create request is in flight, then settles", async () => {
    let resolveFetch!: (res: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });

    await userEvent.type(screen.getByLabelText("Name"), "Apollo");
    await userEvent.click(screen.getByRole("button", { name: /Create project/i }));

    expect(await screen.findByRole("button", { name: /Creating…/i })).toBeDisabled();

    resolveFetch({ ok: true, json: () => Promise.resolve({ id: "proj-9", name: "Apollo" }) } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: /Create project/i })).toBeInTheDocument());
  });

  it("cancelling resets the draft and closes without creating anything", async () => {
    const calls = mockFetchRouter({});
    const onOpenChange = vi.fn();
    renderWithProviders(<NewProjectDialog open onOpenChange={onOpenChange} />, { client: seeded() });

    await userEvent.type(screen.getByLabelText("Name"), "Apollo");
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls.find((c) => c.init?.method === "POST")).toBeUndefined();
  });

  it("submits the trimmed name/identifier/description, converting blanks to null, and toasts + resets + closes on success", async () => {
    const calls = mockFetchRouter({
      "/api/projects": { ok: true, body: { id: "proj-9", name: "Apollo" } },
      // The success handler invalidates ["programmes"] too; the refetch must still resolve to an array.
      "/api/programmes": { ok: true, body: [{ id: "prog-1", name: "Platform" }] },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(<><NewProjectDialog open onOpenChange={onOpenChange} /><Toaster /></>, { client: seeded() });

    await userEvent.type(screen.getByLabelText("Name"), "  Apollo  ");
    await userEvent.type(screen.getByLabelText("Identifier (optional)"), " APOLLO ");
    // Description and Programme left blank.
    await userEvent.click(screen.getByRole("button", { name: /Create project/i }));

    expect(await screen.findByText("PROJECT CREATED")).toBeInTheDocument();
    expect(screen.getByText("Apollo was created.")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    const postCall = calls.find((c) => c.init?.method === "POST");
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall!.init!.body))).toEqual({
      name: "Apollo",
      identifier: "APOLLO",
      description: null,
      programmeId: null,
    });
  });

  it("shows an error toast and keeps the dialog open when creation fails", async () => {
    mockFetchRouter({ "/api/projects": { ok: false, status: 500, body: { error: "boom" } } });
    const onOpenChange = vi.fn();
    renderWithProviders(<><NewProjectDialog open onOpenChange={onOpenChange} /><Toaster /></>, { client: seeded() });

    await userEvent.type(screen.getByLabelText("Name"), "Apollo");
    await userEvent.click(screen.getByRole("button", { name: /Create project/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Could not create the project.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("wires the description and programme fields into the submitted payload", async () => {
    const calls = mockFetchRouter({
      "/api/projects": { ok: true, body: { id: "proj-9", name: "Apollo" } },
      "/api/programmes": { ok: true, body: [{ id: "prog-1", name: "Platform" }] },
    });
    renderWithProviders(<><NewProjectDialog open onOpenChange={() => {}} /><Toaster /></>, { client: seeded() });

    await userEvent.type(screen.getByLabelText("Name"), "Apollo");
    await userEvent.type(screen.getByLabelText("Description (optional)"), "Platform modernisation");
    await userEvent.type(screen.getByLabelText("Programme (optional — pick or name a new one)"), "prog-1");
    await userEvent.click(screen.getByRole("button", { name: /Create project/i }));

    await waitFor(() => expect(calls.find((c) => c.init?.method === "POST")).toBeTruthy());
    const postCall = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(postCall.init!.body))).toMatchObject({
      description: "Platform modernisation",
      programmeId: "prog-1",
    });
  });
});
