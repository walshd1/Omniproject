import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { Toaster } from "./ui/toaster";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { TASKS_KEY, type Task, type TaskComment, type TaskAttachment } from "../lib/tasks";

const TASK: Task = { id: "task-1", title: "Review the SOW", status: "next", context: "@computer", description: "Check clause 7." };
let comments = [{ id: "c1", taskId: "task-1", body: "Flagged clause 7.", author: "pat@demo", createdAt: "2026-07-12T10:00:00Z" }];

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  comments = [{ id: "c1", taskId: "task-1", body: "Flagged clause 7.", author: "pat@demo", createdAt: "2026-07-12T10:00:00Z" }];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/comments") && init?.method === "POST") { const b = JSON.parse(String(init.body)); comments = [...comments, { id: "c2", taskId: "task-1", body: b.body, author: "me", createdAt: "2026-07-12T11:00:00Z" }]; return Promise.resolve(json(comments[comments.length - 1])); }
    if (url.endsWith("/comments")) return Promise.resolve(json(comments));
    if (url.endsWith("/attachments")) return Promise.resolve(json([]));
    return Promise.resolve(json({}, false));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("TaskDetailDialog", () => {
  it("shows the task's fields and comments thread", async () => {
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Flagged clause 7.")).toBeInTheDocument();
    expect(screen.getByText("Check clause 7.")).toBeInTheDocument();
    expect(screen.getByText("@computer")).toBeInTheDocument();
  });

  it("posting a comment hits the comments endpoint", async () => {
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />);
    await screen.findByText("Flagged clause 7.");
    fireEvent.change(screen.getByPlaceholderText("Add a comment…"), { target: { value: "Legal signed off" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/tasks/task-1/comments") && c[1]?.method === "POST");
      expect(JSON.parse(String(post![1].body)).body).toBe("Legal signed off");
    });
  });

  it("posts a comment when Enter is pressed in the input", async () => {
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />);
    await screen.findByText("Flagged clause 7.");
    const input = screen.getByPlaceholderText("Add a comment…");
    fireEvent.change(input, { target: { value: "via enter" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/tasks/task-1/comments") && c[1]?.method === "POST");
      expect(JSON.parse(String(post![1].body)).body).toBe("via enter");
    });
  });

  it("renders nothing when there is no task", () => {
    const { container } = renderWithProviders(<TaskDetailDialog task={null} open onOpenChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * Attachment rendering + add/change flows and the priority patch — these seed the read queries
 * via the cache so only the mutation under test hits fetch, letting each assertion pin one call.
 */
describe("TaskDetailDialog attachments + fields", () => {
  const TASK: Task = { id: "task-1", title: "Review the SOW", status: "next", priority: "high", assignee: "pat", dueDate: "2026-08-01" };

  function seededClient(attachments: TaskAttachment[], comments: TaskComment[] = []): QueryClient {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    qc.setQueryData([...TASKS_KEY, "task-1", "comments"], comments);
    qc.setQueryData([...TASKS_KEY, "task-1", "attachments"], attachments);
    return qc;
  }

  function stubFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = handler(String(url), init);
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        statusText: r.ok ? "OK" : "Error",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(r.body ?? {}),
        text: () => Promise.resolve(JSON.stringify(r.body ?? {})),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  afterEach(() => {
    // @ts-expect-error test-only cleanup of the fetch stub
    delete globalThis.fetch;
  });

  it("shows the task's optional field chips (assignee, due date)", () => {
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />, { client: seededClient([]) });
    expect(screen.getByText("pat")).toBeInTheDocument();
    expect(screen.getByText("due 2026-08-01")).toBeInTheDocument();
  });

  it("renders an attachment as a link (with url) and its content type, plus a plain reference", () => {
    stubFetch(() => ({ ok: true, body: [] }));
    renderWithProviders(
      <TaskDetailDialog task={TASK} open onOpenChange={() => {}} />,
      {
        client: seededClient([
          { id: "a1", taskId: "task-1", filename: "sow.pdf", url: "https://x/sow.pdf", contentType: "application/pdf", addedAt: "2026-07-12T10:00:00Z" },
          { id: "a2", taskId: "task-1", filename: "notes.txt", url: null, addedAt: "2026-07-12T10:00:00Z" },
        ]),
      },
    );
    const link = screen.getByRole("link", { name: "sow.pdf" });
    expect(link).toHaveAttribute("href", "https://x/sow.pdf");
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
    // The url-less attachment renders as plain text, not a link.
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "notes.txt" })).toBeNull();
  });

  it("shows the empty attachment state", () => {
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />, { client: seededClient([]) });
    expect(screen.getByText("No attachments.")).toBeInTheDocument();
  });

  it("adds an attachment with a filename and url, then clears the inputs", async () => {
    // GET refetches (triggered by the success invalidation) must stay array-shaped.
    const calls = stubFetch((_url, init) =>
      (init?.method ?? "GET") === "GET" ? { ok: true, body: [] } : { ok: true, body: { id: "a9", taskId: "task-1", filename: "spec.md", addedAt: "" } },
    );
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />, { client: seededClient([]) });
    const fname = screen.getByPlaceholderText("filename") as HTMLInputElement;
    const furl = screen.getByPlaceholderText("https://…") as HTMLInputElement;
    fireEvent.change(fname, { target: { value: "  spec.md  " } });
    fireEvent.change(furl, { target: { value: " https://x/spec.md " } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/attachments") && c.init?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post!.init!.body));
      expect(body.filename).toBe("spec.md"); // trimmed
      expect(body.url).toBe("https://x/spec.md"); // trimmed
    });
    await waitFor(() => expect(fname.value).toBe(""));
    expect(furl.value).toBe("");
  });

  it("omits the url field when only a filename is given", async () => {
    const calls = stubFetch((_url, init) =>
      (init?.method ?? "GET") === "GET" ? { ok: true, body: [] } : { ok: true, body: { id: "a9", taskId: "task-1", filename: "bare.txt", addedAt: "" } },
    );
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />, { client: seededClient([]) });
    fireEvent.change(screen.getByPlaceholderText("filename"), { target: { value: "bare.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/attachments") && c.init?.method === "POST");
      const body = JSON.parse(String(post!.init!.body));
      expect(body.filename).toBe("bare.txt");
      expect("url" in body).toBe(false); // no empty url key sent
    });
  });

  it("shows a COULDN'T ATTACH toast when the backend rejects the attachment", async () => {
    stubFetch(() => ({ ok: false, status: 501, body: { error: "attachments unsupported" } }));
    renderWithProviders(<><TaskDetailDialog task={TASK} open onOpenChange={() => {}} /><Toaster /></>, { client: seededClient([]) });
    fireEvent.change(screen.getByPlaceholderText("filename"), { target: { value: "x.bin" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(await screen.findByText("COULDN'T ATTACH")).toBeInTheDocument();
    expect(await screen.findByText("attachments unsupported")).toBeInTheDocument();
  });

  it("patches the task priority when the priority select changes", async () => {
    const calls = stubFetch((_url, init) =>
      (init?.method ?? "GET") === "GET" ? { ok: true, body: [] } : { ok: true, body: { ...TASK, priority: "urgent" } },
    );
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />, { client: seededClient([]) });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "urgent" } });
    await waitFor(() => {
      const patch = calls.find((c) => c.url.endsWith("/tasks/task-1") && c.init?.method === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch!.init!.body)).priority).toBe("urgent");
    });
  });
});
