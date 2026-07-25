import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The client data-quality signal: the shared customFetch response observer feeds the store the repair count
 * the gateway reports in `X-OmniProject-Data-Repaired`, so the UI can flag a dirty backend. We mock the
 * api-client-react seam to CAPTURE the observer function the module registers, then drive it directly to
 * exercise every header-parsing branch.
 */
const { setObs } = vi.hoisted(() => ({ setObs: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ setResponseObserver: setObs }));

import { useDataQuality, installDataQualityObserver } from "./data-quality";

type Observer = (meta: { url: string; method: string; status: number; headers: Headers }) => void;
let observer: Observer;

/** Build the meta the observer receives, with an optional repair-count header. */
function meta(repaired?: string): { url: string; method: string; status: number; headers: Headers } {
  const headers = new Headers();
  if (repaired !== undefined) headers.set("X-OmniProject-Data-Repaired", repaired);
  return { url: "/api/x", method: "GET", status: 200, headers };
}

beforeEach(() => {
  useDataQuality.setState({ everRepaired: false, lastRepaired: 0 });
});

describe("installDataQualityObserver", () => {
  it("registers the response observer exactly once (idempotent)", () => {
    installDataQualityObserver();
    expect(setObs).toHaveBeenCalledTimes(1);
    observer = setObs.mock.calls[0]![0] as Observer;
    // A second install is a no-op — the guard prevents a duplicate registration.
    installDataQualityObserver();
    expect(setObs).toHaveBeenCalledTimes(1);
    expect(observer).toBeTypeOf("function");
  });
});

describe("the registered observer", () => {
  it("notes a positive repair count into the store", () => {
    observer(meta("3"));
    expect(useDataQuality.getState().everRepaired).toBe(true);
    expect(useDataQuality.getState().lastRepaired).toBe(3);
  });

  it("ignores a response with no repair header", () => {
    observer(meta());
    expect(useDataQuality.getState().everRepaired).toBe(false);
    expect(useDataQuality.getState().lastRepaired).toBe(0);
  });

  it("ignores a zero repair count (nothing was repaired)", () => {
    observer(meta("0"));
    expect(useDataQuality.getState().everRepaired).toBe(false);
  });

  it("ignores a non-numeric (non-finite) header value", () => {
    observer(meta("not-a-number"));
    expect(useDataQuality.getState().everRepaired).toBe(false);
  });
});

describe("useDataQuality.note", () => {
  it("flips the sticky flag and records the latest count", () => {
    useDataQuality.getState().note(7);
    expect(useDataQuality.getState()).toMatchObject({ everRepaired: true, lastRepaired: 7 });
  });
});
