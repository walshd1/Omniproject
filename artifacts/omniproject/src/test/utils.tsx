import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
// BrandingProvider nests an I18nProvider internally, so this single wrapper
// satisfies both useBranding and useT for any component under test.
import { BrandingProvider } from "../lib/branding";

/**
 * Test render helper. Wraps the UI in the providers the app's data components
 * rely on (a fresh, retry-disabled QueryClient + Radix tooltip context) and
 * returns the QueryClient so a test can pre-seed query caches with
 * `qc.setQueryData(key, data)` instead of hitting the network.
 */
export function renderWithProviders(ui: ReactElement, opts: { client?: QueryClient } = {}) {
  const queryClient =
    opts.client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );

  return { ...render(ui, { wrapper: Wrapper }), queryClient };
}

/**
 * Routes `fetch` by URL pathname to a canned response, for components that hit more than one
 * endpoint in a single test (e.g. a GET the mutation invalidates plus the mutation's own PATCH).
 * Anything not listed falls back to a no-op 200, so a test only needs to describe the one or
 * two endpoints it actually cares about. Installed directly on `globalThis.fetch` rather than
 * via `vi.spyOn`, so restore it yourself between tests if a later test relies on the real
 * (unmocked) fetch stub — `vi.restoreAllMocks()` does not undo a plain assignment.
 */
export function mockFetchRouter(routes: Record<string, { ok: boolean; status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const path = new URL(href, "http://localhost").pathname;
    const route = routes[path] ?? { ok: true, body: {} };
    return {
      ok: route.ok,
      status: route.status ?? (route.ok ? 200 : 500),
      statusText: route.ok ? "OK" : "Error",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(route.body ?? {}),
      text: () => Promise.resolve(JSON.stringify(route.body ?? {})),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}
