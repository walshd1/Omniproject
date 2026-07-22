import { configResource } from "./config-resource";

/**
 * Content pages client — a named, flat, ordered list of unified-library component ids (reports +
 * widgets, see @workspace/backend-catalogue componentsFor("content")) a customer composes into
 * free-form content. Same shared-config shape as customReports: any authed user reads (so a saved
 * page renders for everyone); authoring is PMO-gated server-side. Never project data.
 */
export interface ContentPageDef {
  id: string;
  name: string;
  /** Library component ids, in display order (e.g. ["report:evm", "widget:portfolioHealth"]). */
  componentIds: string[];
}

export const contentPagesQueryKey = ["content-pages"] as const;

const resource = configResource<ContentPageDef[]>({
  queryKey: contentPagesQueryKey,
  path: "/api/content-pages",
  envelopeKey: "contentPages",
  reconcile: "set-from-response", // pmo-gated; the endpoint echoes the saved list back
});
/** The saved content-page definitions. */
export const useContentPages = resource.useResource;
/** Persist the full content-page list (pmo). */
export const useSaveContentPages = resource.useSaveResource;
