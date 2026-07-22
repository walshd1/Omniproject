import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ConnectStep } from "./ConnectStep";

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

// A small harness so the controlled `url`/`backendId` props update as the user interacts.
function Harness({ initial = "", isAdmin = true }: { initial?: string; isAdmin?: boolean }) {
  const [url, setUrl] = useState(initial);
  const [backendId, setBackendId] = useState("");
  return <ConnectStep url={url} setUrl={setUrl} backendId={backendId} setBackendId={setBackendId} isAdmin={isAdmin} />;
}

// The backend/broker pickers fetch /api/setup/backends and /api/setup/brokers
// independently of the broker test call (/api/setup/test-broker) — branch by URL so
// each gets its own shaped response.
function mockFetch(testBrokerPayload: unknown, opts: { settingsOk?: boolean } = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/setup/backends") || url.includes("/api/setup/brokers")) {
      return { ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve([]), text: () => Promise.resolve("[]") };
    }
    // The "Apply for this session" mutation PATCHes /api/settings.
    if (url.includes("/api/settings") && (init?.method ?? "").toUpperCase() === "PATCH") {
      const ok = opts.settingsOk !== false;
      return {
        ok, status: ok ? 200 : 500, statusText: ok ? "OK" : "Error", headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(ok ? { brokerUrl: "x" } : { error: "denied" }),
        text: () => Promise.resolve(ok ? "{}" : '{"error":"denied"}'),
      };
    }
    return { ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve(testBrokerPayload), text: () => Promise.resolve(JSON.stringify(testBrokerPayload)) };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("ConnectStep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastSpy.mockClear();
  });

  it("renders the step heading and url field", () => {
    const { getByRole, getByLabelText } = renderWithProviders(<Harness />);
    expect(getByRole("heading", { name: "Connect your project tool" })).toBeInTheDocument();
    expect(getByLabelText(/Connection address/)).toBeInTheDocument();
  });

  it("shows the admin-only warning when not admin and disables Test", () => {
    const { getByText, getByRole } = renderWithProviders(<Harness initial="https://x.com/webhook" isAdmin={false} />);
    expect(getByText(/Only an admin can test or apply/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Test/ })).toBeDisabled();
  });

  it("flags an invalid URL with an inline error", async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByRole } = renderWithProviders(<Harness />);
    const input = getByLabelText(/Connection address/);
    await user.type(input, "not-a-url");
    expect(getByRole("alert")).toHaveTextContent(/valid URL/);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("runs a reachable test and shows the apply button for admins", async () => {
    const user = userEvent.setup();
    mockFetch({ reachable: true, ok: true, implementsCapabilities: true });
    const { getByLabelText, getByRole, findByText } = renderWithProviders(
      <Harness isAdmin={true} />,
    );
    await user.type(getByLabelText(/Connection address/), "https://broker.example.com/webhook/op");
    await user.click(getByRole("button", { name: /Test/ }));
    expect(await findByText(/Connected — it's responding correctly/)).toBeInTheDocument();
    expect(await findByText(/It told us what it can do/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Apply for this session/ })).toBeInTheDocument();
  });

  it("renders an unreachable result", async () => {
    const user = userEvent.setup();
    mockFetch({ reachable: false, error: "boom" });
    const { getByLabelText, getByRole, findByText } = renderWithProviders(<Harness />);
    await user.type(getByLabelText(/Connection address/), "https://broker.example.com/webhook/op");
    await user.click(getByRole("button", { name: /Test/ }));
    expect(await findByText(/Couldn't reach it — boom/)).toBeInTheDocument();
  });

  it("renders a reachable-but-error status and capability tip", async () => {
    const user = userEvent.setup();
    mockFetch({ reachable: true, ok: false, status: 502, implementsCapabilities: false });
    const { getByLabelText, getByRole, findByText } = renderWithProviders(<Harness />);
    await user.type(getByLabelText(/Connection address/), "https://broker.example.com/webhook/op");
    await user.click(getByRole("button", { name: /Test/ }));
    expect(await findByText(/answered oddly \(code 502\)/)).toBeInTheDocument();
    expect(await findByText(/doesn't yet report what it can do/)).toBeInTheDocument();
  });

  it("handles a thrown test request", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch;
    const { getByLabelText, getByRole, findByText } = renderWithProviders(<Harness />);
    await user.type(getByLabelText(/Connection address/), "https://broker.example.com/webhook/op");
    await user.click(getByRole("button", { name: /Test/ }));
    await waitFor(() => expect(getByRole("button", { name: /Test/ })).not.toBeDisabled());
    expect(await findByText(/Test request failed/)).toBeInTheDocument();
  });

  it("applies the connection for the session and toasts on success", async () => {
    const user = userEvent.setup();
    mockFetch({ reachable: true, ok: true, implementsCapabilities: true }, { settingsOk: true });
    const { getByLabelText, getByRole, findByRole } = renderWithProviders(<Harness isAdmin={true} />);
    await user.type(getByLabelText(/Connection address/), "https://broker.example.com/webhook/op");
    await user.click(getByRole("button", { name: /Test/ }));
    const apply = await findByRole("button", { name: /Apply for this session/ });
    await user.click(apply);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Connected for this session" })),
    );
  });

  it("toasts a destructive error when applying the connection fails", async () => {
    const user = userEvent.setup();
    mockFetch({ reachable: true, ok: true, implementsCapabilities: true }, { settingsOk: false });
    const { getByLabelText, getByRole, findByRole } = renderWithProviders(<Harness isAdmin={true} />);
    await user.type(getByLabelText(/Connection address/), "https://broker.example.com/webhook/op");
    await user.click(getByRole("button", { name: /Test/ }));
    const apply = await findByRole("button", { name: /Apply for this session/ });
    await user.click(apply);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't apply that", variant: "destructive" })),
    );
  });
});
