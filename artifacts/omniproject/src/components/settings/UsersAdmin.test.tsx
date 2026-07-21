import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { Role } from "../../lib/auth";
import type { LocalUserView } from "../../lib/users";

/**
 * The in-app users admin panel composes several seams (the roster read hook, four mutation helpers,
 * the RBAC gate, and prompt/confirm-driven password + delete flows). Each seam is stubbed behind a
 * mutable module-level knob (the house pattern — see Whiteboards.test.tsx) so we can assert the
 * panel's own branching: the admin + availability gates, the roster/empty/badge rendering, and the
 * create / toggle-active / reset-password / delete handlers with both success and error outcomes.
 * `roleAtLeast` is kept REAL (importOriginal) so the shipping gate logic is what's exercised.
 */

// --- Per-test knobs (reset in beforeEach), closed over by the vi.mock factories below. ---
let role: Role = "admin";
let usersData: { available: boolean; users: LocalUserView[] } | undefined = { available: true, users: [] };
let addMode: "ok" | "err" = "ok";
let updateMode: "ok" | "err" = "ok";
let pwMode: "ok" | "err" = "ok";
let delMode: "ok" | "err" = "ok";
let errValue: unknown = new Error("boom");

const toast = vi.fn();
const createUser = vi.fn(async (_input: unknown) => { if (addMode === "err") throw errValue; });
const updateUser = vi.fn(async (_id: string, _patch: unknown) => { if (updateMode === "err") throw errValue; });
const setUserPassword = vi.fn(async (_id: string, _pw: string) => { if (pwMode === "err") throw errValue; });
const deleteUser = vi.fn(async (_id: string) => { if (delMode === "err") throw errValue; });

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role } }) };
});

vi.mock("../../lib/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/users")>();
  return {
    ...actual,
    useUsers: () => ({ data: usersData }),
    createUser: (input: unknown) => createUser(input),
    updateUser: (id: string, patch: unknown) => updateUser(id, patch),
    setUserPassword: (id: string, pw: string) => setUserPassword(id, pw),
    deleteUser: (id: string) => deleteUser(id),
  };
});

const { UsersAdmin } = await import("./UsersAdmin");

function user(over: Partial<LocalUserView> = {}): LocalUserView {
  return {
    id: "local:1", userName: "root", displayName: "Root", email: "", groups: ["omni-admins"],
    active: true, hasPassword: true, createdAt: "", updatedAt: "", ...over,
  };
}

beforeEach(() => {
  role = "admin";
  usersData = { available: true, users: [] };
  addMode = updateMode = pwMode = delMode = "ok";
  errValue = new Error("boom");
  toast.mockClear();
  createUser.mockClear();
  updateUser.mockClear();
  setUserPassword.mockClear();
  deleteUser.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("UsersAdmin — gates", () => {
  it("renders nothing for a non-admin", () => {
    role = "manager";
    const { container } = renderWithProviders(<UsersAdmin />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the feature is unavailable (no encrypted store)", () => {
    usersData = { available: false, users: [] };
    const { container } = renderWithProviders(<UsersAdmin />);
    expect(container.querySelector('[data-testid="users-admin"]')).toBeNull();
  });

  it("renders nothing while the roster query is still loading (no data)", () => {
    usersData = undefined;
    const { container } = renderWithProviders(<UsersAdmin />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("UsersAdmin — roster", () => {
  it("shows the empty state when there are no users", () => {
    renderWithProviders(<UsersAdmin />);
    expect(screen.getByText("No in-app users yet.")).toBeInTheDocument();
  });

  it("lists a user with its group, inactive and no-password badges", () => {
    usersData = { available: true, users: [user({ userName: "alice", displayName: "Alice", groups: ["viewers"], active: false, hasPassword: false })] };
    renderWithProviders(<UsersAdmin />);
    const row = screen.getByTestId("user-row-alice");
    expect(row).toHaveTextContent("Alice");
    expect(row).toHaveTextContent("viewers");
    expect(row).toHaveTextContent("inactive");
    expect(row).toHaveTextContent("no password");
  });
});

describe("UsersAdmin — create", () => {
  it("creates a user, parsing groups and dropping blank optional fields, then toasts + refreshes", async () => {
    const client = renderWithProviders(<UsersAdmin />).queryClient;
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByTestId("new-user-username"), { target: { value: " alice " } });
    fireEvent.change(screen.getByTestId("new-user-groups"), { target: { value: "omni-members, viewers ," } });
    fireEvent.click(screen.getByTestId("new-user-add"));
    await waitFor(() => expect(createUser).toHaveBeenCalled());
    expect(createUser).toHaveBeenCalledWith({ userName: "alice", displayName: undefined, email: undefined, groups: ["omni-members", "viewers"], password: undefined });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "USER ADDED" })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["users"] });
    // form cleared
    expect((screen.getByTestId("new-user-username") as HTMLInputElement).value).toBe("");
  });

  it("passes the filled optional fields through when provided", async () => {
    renderWithProviders(<UsersAdmin />);
    fireEvent.change(screen.getByTestId("new-user-username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByTestId("new-user-password"), { target: { value: "hunter2!" } });
    // display name + email inputs (no testid) — grab by placeholder
    fireEvent.change(screen.getByPlaceholderText("display name"), { target: { value: "Bob" } });
    fireEvent.change(screen.getByPlaceholderText("email (optional)"), { target: { value: "bob@x" } });
    fireEvent.click(screen.getByTestId("new-user-add"));
    await waitFor(() => expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ userName: "bob", displayName: "Bob", email: "bob@x", password: "hunter2!" })));
  });

  it("disables Add until a username is entered", () => {
    renderWithProviders(<UsersAdmin />);
    expect(screen.getByTestId("new-user-add")).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-user-username"), { target: { value: "x" } });
    expect(screen.getByTestId("new-user-add")).toBeEnabled();
  });

  it("toasts a destructive error when create fails", async () => {
    addMode = "err";
    renderWithProviders(<UsersAdmin />);
    fireEvent.change(screen.getByTestId("new-user-username"), { target: { value: "alice" } });
    fireEvent.click(screen.getByTestId("new-user-add"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT ADD USER", description: "boom", variant: "destructive" })));
  });

  it("falls back to a generic message when create rejects with a non-Error", async () => {
    addMode = "err";
    errValue = "weird";
    renderWithProviders(<UsersAdmin />);
    fireEvent.change(screen.getByTestId("new-user-username"), { target: { value: "alice" } });
    fireEvent.click(screen.getByTestId("new-user-add"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT ADD USER", description: "Try again." })));
  });
});

describe("UsersAdmin — toggle active", () => {
  it("deactivates an active user via updateUser and refreshes", async () => {
    usersData = { available: true, users: [user({ userName: "alice", active: true })] };
    const client = renderWithProviders(<UsersAdmin />).queryClient;
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith("local:1", { active: false }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["users"] });
  });

  it("activates an inactive user (Activate label)", async () => {
    usersData = { available: true, users: [user({ userName: "alice", active: false })] };
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith("local:1", { active: true }));
  });

  it("toasts UPDATE FAILED when the toggle fails", async () => {
    updateMode = "err";
    usersData = { available: true, users: [user({ userName: "alice", active: true })] };
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "UPDATE FAILED", variant: "destructive" })));
  });
});

describe("UsersAdmin — reset password", () => {
  beforeEach(() => {
    usersData = { available: true, users: [user({ userName: "alice" })] };
  });

  it("sets the password when the prompt returns one", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("newpass12");
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByTestId("user-pw-alice"));
    await waitFor(() => expect(setUserPassword).toHaveBeenCalledWith("local:1", "newpass12"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "PASSWORD SET" }));
  });

  it("does nothing when the prompt is cancelled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByTestId("user-pw-alice"));
    expect(setUserPassword).not.toHaveBeenCalled();
  });

  it("toasts a destructive error when setting the password fails", async () => {
    pwMode = "err";
    vi.spyOn(window, "prompt").mockReturnValue("newpass12");
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByTestId("user-pw-alice"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SET PASSWORD", variant: "destructive" })));
  });
});

describe("UsersAdmin — delete", () => {
  beforeEach(() => {
    usersData = { available: true, users: [user({ userName: "alice" })] };
  });

  it("deletes a user after confirmation and toasts", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByTestId("user-del-alice"));
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith("local:1"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "USER DELETED" }));
  });

  it("does nothing when the confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByTestId("user-del-alice"));
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("toasts DELETE FAILED when the delete fails", async () => {
    delMode = "err";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(screen.getByTestId("user-del-alice"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "DELETE FAILED", variant: "destructive" })));
  });
});
