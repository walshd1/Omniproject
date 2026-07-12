import type { ComponentType } from "react";
import type { ViewId } from "../../lib/views";
import { VIEW_RENDERERS } from "./view-renderers";

/**
 * Maps each registered methodology view id to its renderer. Derived from the VIEW_RENDERERS registry
 * (the view-analogue of REPORT_RENDERERS) so there's a single renderer binding: built-in views are
 * read-only JSON definitions in the catalogue, each bound to a registered renderer here. `flow`
 * renders issues through the generic view engine; the rest are the specialized methodology renderers.
 */
export const VIEW_COMPONENTS: Record<ViewId, ComponentType<{ projectId: string }>> = VIEW_RENDERERS;
