import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ConnectStep } from "./ConnectStep";

// A small harness so the controlled `url` prop updates as the user types.
function Harness({ initial = "", isAdmin = true }: { initial?: string; isAdmin?: boolean }) {
  const [url, setUrl] = useState(initial);
  return <ConnectStep url={url} setUrl={setUrl} isAdmin={isAdmin} />;
}

function mockFetch(payload: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("ConnectStep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
