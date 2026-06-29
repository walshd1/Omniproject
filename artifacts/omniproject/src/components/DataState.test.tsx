import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataState } from "./DataState";

describe("DataState", () => {
  it("renders children when settled (transparent pass-through)", () => {
    render(
      <DataState>
        <div>real content</div>
      </DataState>,
    );
    expect(screen.getByText("real content")).toBeInTheDocument();
  });

  it("renders a loading placeholder and hides children while loading", () => {
    render(
      <DataState isLoading>
        <div>real content</div>
      </DataState>,
    );
    expect(screen.queryByText("real content")).not.toBeInTheDocument();
  });

  it("renders a content-shaped skeleton (not the text placeholder) while loading when given one", () => {
    render(
      <DataState isLoading skeleton={<div data-testid="my-skeleton">loading rows…</div>}>
        <div>real content</div>
      </DataState>,
    );
    expect(screen.getByTestId("my-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("real content")).not.toBeInTheDocument();
    expect(screen.queryByText("LOADING…")).not.toBeInTheDocument(); // skeleton replaces the text loader
  });

  it("shows an alert with the error message and a Retry button on error", () => {
    render(
      <DataState isError error={new Error("boom from backend")} onRetry={() => {}}>
        <div>real content</div>
      </DataState>,
    );
    // The error branch must NOT render children (the bug it fixes: error looked like empty).
    expect(screen.queryByText("real content")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("boom from backend")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onRetry when the Retry button is activated", async () => {
    const onRetry = vi.fn();
    render(
      <DataState isError error="failed" onRetry={onRetry}>
        <div />
      </DataState>,
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("falls back to a generic message for a non-Error, non-string error", () => {
    render(
      <DataState isError error={{ weird: true }}>
        <div />
      </DataState>,
    );
    expect(screen.getByText(/the request failed/i)).toBeInTheDocument();
  });
});
