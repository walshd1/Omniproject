import { describe, it, expect, vi, afterEach } from "vitest";
import { isErrorTelemetryEnabled, setErrorTelemetryEnabled, reportClientError } from "./error-telemetry";

afterEach(() => {
  setErrorTelemetryEnabled(false);
  vi.restoreAllMocks();
});

describe("error-telemetry gate", () => {
  it("is off by default", () => {
    expect(isErrorTelemetryEnabled()).toBe(false);
  });

  it("does NOT post while disabled", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    reportClientError({ message: "boom" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts message + page to the internal sink once enabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ recorded: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    setErrorTelemetryEnabled(true);
    reportClientError({ message: "TypeError: x", componentStack: "at <Foo>" });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/client-errors$/);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ message: "TypeError: x", componentStack: "at <Foo>" });
    expect(typeof body.page).toBe("string"); // the page path is included, never user data
  });
});
