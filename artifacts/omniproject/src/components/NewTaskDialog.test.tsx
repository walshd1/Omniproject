import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getListProjectMembersQueryKey,
  type Project,
  type ProjectMember,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
import { Toaster } from "./ui/toaster";
import { NewTaskDialog } from "./NewTaskDialog";

function seeded(
  projects: Partial<Project>[] = [{ id: "p1", name: "Alpha" }],
  membersByProject: Record<string, ProjectMember[]> = {},
): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects as unknown as Project[]);
  for (const p of projects) {
    if (p.id) qc.setQueryData(getListProjectMembersQueryKey(p.id), membersByProject[p.id] ?? []);
  }
  return qc;
}

afterEach(resetFetchMock);

describe("NewTaskDialog", () => {
  it("requires a title; defaults the project to the first one", async () => {
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded(),
    });
    expect(screen.getByRole("heading", { name: /New Task/i })).toBeInTheDocument();
    // project defaulted, but title empty → submit disabled
    expect(screen.getByRole("button", { name: /Create task/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Title"), "Wire the callback");
    expect(screen.getByRole("button", { name: /Create task/i })).toBeEnabled();
  });

  it("blocks task creation when there are no projects (a task must belong to one)", () => {
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, { client: seeded([]) });
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create task/i })).toBeNull();
  });

  it("offers only write-access members in the assignee picker", () => {
    const members = [
      { id: "u1", name: "Writer One", access: "write" },
      { id: "u2", name: "Reader Two", access: "read" },
    ] as unknown as ProjectMember[];
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded([{ id: "p1", name: "Alpha" }], { p1: members }),
    });
    // The assignee picker is present (write-access members exist)…
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
    expect(screen.getByText(/Only people with write access/i)).toBeInTheDocument();
  });

  it("falls back to email, then id, for an assignable member with no display name", async () => {
    const members = [
      { id: "u3", email: "u3@example.com", access: "write" },
      { id: "u4", access: "write" },
    ] as unknown as ProjectMember[];
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded([{ id: "p1", name: "Alpha" }], { p1: members }),
    });
    await userEvent.click(screen.getByLabelText("Assignee"));
    expect(await screen.findByRole("option", { name: "u3@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "u4" })).toBeInTheDocument();
  });

  it("hides the assignee picker when no members have write access", () => {
    const members = [{ id: "u2", name: "Reader Two", access: "read" }] as unknown as ProjectMember[];
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded([{ id: "p1", name: "Alpha" }], { p1: members }),
    });
    expect(screen.queryByLabelText("Assignee")).toBeNull();
  });

  it("creates a task, toasts, resets and closes on success", async () => {
    const calls = mockFetchRouter({
      "POST /api/projects/p1/issues": { ok: true, body: { id: "i1", title: "Wire the callback" } },
      "/api/projects": { ok: true, body: [{ id: "p1", name: "Alpha" }] },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(<><NewTaskDialog open onOpenChange={onOpenChange} /><Toaster /></>, {
      client: seeded(),
    });

    await userEvent.type(screen.getByLabelText("Title"), "Wire the callback");
    await userEvent.click(screen.getByRole("button", { name: /Create task/i }));

    expect(await screen.findByText("TASK CREATED")).toBeInTheDocument();
    expect(screen.getByText("Wire the callback")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    const post = calls.find((c) => c.init?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post!.init!.body))).toEqual({
      title: "Wire the callback",
      status: "todo",
      priority: "none",
      assignee: null,
    });
  });

  it("shows an error toast and keeps the dialog open when creation fails", async () => {
    mockFetchRouter({ "POST /api/projects/p1/issues": { ok: false, status: 500, body: { error: "boom" } } });
    const onOpenChange = vi.fn();
    renderWithProviders(<><NewTaskDialog open onOpenChange={onOpenChange} /><Toaster /></>, {
      client: seeded(),
    });

    await userEvent.type(screen.getByLabelText("Title"), "Wire the callback");
    await userEvent.click(screen.getByRole("button", { name: /Create task/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Could not create the task.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("cancelling closes the dialog without creating anything", async () => {
    const calls = mockFetchRouter({});
    const onOpenChange = vi.fn();
    renderWithProviders(<NewTaskDialog open onOpenChange={onOpenChange} />, {
      client: seeded(),
    });

    await userEvent.type(screen.getByLabelText("Title"), "Wire the callback");
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls.find((c) => c.init?.method === "POST")).toBeUndefined();
  });

  it("submits the chosen status, priority and assignee", async () => {
    const members = [{ id: "u1", name: "Writer One", access: "write" }] as unknown as ProjectMember[];
    const calls = mockFetchRouter({
      "POST /api/projects/p1/issues": { ok: true, body: { id: "i1", title: "Wire the callback" } },
      "/api/projects": { ok: true, body: [{ id: "p1", name: "Alpha" }] },
    });
    const user = userEvent.setup();
    renderWithProviders(<><NewTaskDialog open onOpenChange={() => {}} /><Toaster /></>, {
      client: seeded([{ id: "p1", name: "Alpha" }], { p1: members }),
    });

    await user.type(screen.getByLabelText("Title"), "Wire the callback");
    await user.click(screen.getByLabelText("Status"));
    await user.click(await screen.findByRole("option", { name: "IN PROGRESS" }));
    await user.click(screen.getByLabelText("Priority"));
    await user.click(await screen.findByRole("option", { name: "HIGH" }));
    await user.click(screen.getByLabelText("Assignee"));
    await user.click(await screen.findByRole("option", { name: "Writer One" }));
    await user.click(screen.getByRole("button", { name: /Create task/i }));

    await screen.findByText("TASK CREATED");
    const post = calls.find((c) => c.init?.method === "POST");
    expect(JSON.parse(String(post!.init!.body))).toEqual({
      title: "Wire the callback",
      status: "in_progress",
      priority: "high",
      assignee: "u1",
    });
  });

  it("resets the assignee selection when the project is changed", async () => {
    const membersByProject = {
      p1: [{ id: "u1", name: "Writer One", access: "write" }] as unknown as ProjectMember[],
      p2: [{ id: "u2", name: "Writer Two", access: "write" }] as unknown as ProjectMember[],
    };
    const user = userEvent.setup();
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded([{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }], membersByProject),
    });

    await user.click(screen.getByLabelText("Assignee"));
    await user.click(await screen.findByRole("option", { name: "Writer One" }));
    expect(screen.getByLabelText("Assignee")).toHaveTextContent("Writer One");

    await user.click(screen.getByLabelText("Project"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    expect(screen.getByLabelText("Assignee")).toHaveTextContent("Unassigned");
  });

  it("doesn't crash while closed", () => {
    renderWithProviders(<NewTaskDialog open={false} onOpenChange={() => {}} />, {
      client: seeded(),
    });
    expect(screen.queryByRole("heading", { name: /New Task/i })).not.toBeInTheDocument();
  });

  it("guards against submission with an invalid title even if the form is submitted directly", () => {
    // The submit button is disabled while titleError is set, but the form's own submit handler
    // still guards against it directly (defence in depth against a bypassed/direct form submit).
    const calls = mockFetchRouter({});
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded(),
    });
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    expect(calls.find((c) => c.init?.method === "POST")).toBeUndefined();
  });

  it("flags a whitespace-only title as invalid", async () => {
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded(),
    });
    await userEvent.type(screen.getByLabelText("Title"), "   ");
    expect(screen.getByRole("alert")).toHaveTextContent("Title is required");
    expect(screen.getByRole("button", { name: /Create task/i })).toBeDisabled();
  });

  it("shows a pending label while creating, then settles", async () => {
    let resolveFetch!: (res: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded(),
    });

    await userEvent.type(screen.getByLabelText("Title"), "Wire the callback");
    await userEvent.click(screen.getByRole("button", { name: /Create task/i }));

    expect(await screen.findByRole("button", { name: /Creating…/i })).toBeDisabled();

    resolveFetch({ ok: true, json: () => Promise.resolve({ id: "i1", title: "Wire the callback" }) } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: /Create task/i })).toBeInTheDocument());
  });

  it("auto-splits a multi-line paste and creates one issue per line, parsing inline sigils", async () => {
    const calls = mockFetchRouter({
      "POST /api/projects/p1/issues": { ok: true, body: { id: "i1", title: "x" } },
      "/api/projects": { ok: true, body: [{ id: "p1", name: "Alpha" }] },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(<><NewTaskDialog open onOpenChange={onOpenChange} /><Toaster /></>, { client: seeded() });

    const title = screen.getByLabelText("Title");
    fireEvent.paste(title, { clipboardData: { getData: () => "wire the callback #api !p1\nwrite the migration\nreview the PR ^tomorrow" } });
    expect(await screen.findByText("3 tasks detected")).toBeInTheDocument();
    // Nothing is created until the split is confirmed.
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Create 3 tasks" }));
    await waitFor(() => expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(3));
    const bodies = calls.filter((c) => c.init?.method === "POST").map((c) => JSON.parse(String(c.init!.body)));
    const byTitle = Object.fromEntries(bodies.map((b) => [b.title, b]));
    expect(byTitle["wire the callback"].priority).toBe("urgent");   // !p1
    expect(byTitle["wire the callback"].labels).toEqual(["api"]);    // #api → labels
    expect(byTitle["write the migration"].status).toBe("todo");      // dialog status shared
    expect(byTitle["review the PR"].dueDate).toBeTruthy();           // ^tomorrow → dueDate
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("'Add as one' collapses the paste into the title instead of splitting the issue", async () => {
    const calls = mockFetchRouter({ "/api/projects": { ok: true, body: [{ id: "p1", name: "Alpha" }] } });
    renderWithProviders(<><NewTaskDialog open onOpenChange={() => {}} /><Toaster /></>, { client: seeded() });
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.paste(title, { clipboardData: { getData: () => "first\nsecond" } });
    await userEvent.click(await screen.findByRole("button", { name: "Add as one" }));
    expect(screen.queryByText("2 tasks detected")).toBeNull();
    expect(title.value).toBe("first second");
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
  });
});
