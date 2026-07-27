import { describe, it, expect, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListResourcePoolQueryKey, type ResourceMember } from "@workspace/api-client-react";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { SkillsGap } from "./SkillsGap";

function member(over: Partial<ResourceMember> = {}): ResourceMember {
  return { id: "r", name: "R", skills: [], ...over } as ResourceMember;
}

function seed(members: ResourceMember[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListResourcePoolQueryKey(), members);
  return qc;
}

afterEach(() => resetFetchMock());

describe("SkillsGap", () => {
  it("rolls per-skill supply across the resource pool", () => {
    renderWithProviders(<SkillsGap />, {
      client: seed([
        member({ id: "a", skills: ["react", "sql"] }),
        member({ id: "b", skills: ["react"] }),
      ]),
    });
    expect(screen.getByTestId("skills-gap")).toBeInTheDocument();
    // react is held by two people (covered); sql by one (single point of failure).
    expect(screen.getByTestId("skill-row-react")).toHaveTextContent("2");
    expect(screen.getByTestId("skill-row-sql")).toHaveTextContent("1");
  });

  it("shows the empty state with no declared skills", () => {
    renderWithProviders(<SkillsGap />, { client: seed([member({ id: "a", skills: [] })]) });
    expect(screen.getByTestId("skills-gap-empty")).toBeInTheDocument();
  });
});
