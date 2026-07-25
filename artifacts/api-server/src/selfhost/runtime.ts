/**
 * Self-host runtime bridge — the ONE place that turns persisted settings into a composition-tier
 * `GatingInput` for a scope. The pure `resolveGating` (capability-gating) stays settings-free and
 * unit-testable; this thin adapter reads live settings so the gateway and the admin/wizard screens
 * resolve self-host adoption identically:
 *
 *   - the mode + org-adopted domains come from `settings.selfHost`;
 *   - programme/project narrowing reuses the EXISTING `programmeFeatures`/`projectFeatures` maps,
 *     filtered to the `selfhost:<domain>` ids — so a PMO/PM governs self-host domains through the
 *     same disable/require/forbid controls as any other governed capability, no parallel store.
 */
import { getSettings } from "../lib/settings";
import { resolveSelfHost } from "../lib/self-host-config";
import { resolveGating, type GatingInput, type SelfHostGating, type SelfHostScopeSelection } from "./capability-gating";
import type { SelfHostDomainId } from "./domains";

/** A resolution scope: a project and/or its programme. Omit both for org-level resolution. */
export interface SelfHostScope {
  programmeId?: string | null;
  projectId?: string | null;
}

const PREFIX = "selfhost:";

/** Strip the `selfhost:` namespace off a governance id list, dropping ids from other planes. */
function selfHostDomainIds(ids: readonly string[] | undefined): SelfHostDomainId[] {
  return (ids ?? []).filter((id) => id.startsWith(PREFIX)).map((id) => id.slice(PREFIX.length) as SelfHostDomainId);
}

/** Build the scope selection for a level from its governance config (disable/require/forbid). */
function selectionFor(cfg: { disabled?: string[]; required?: string[]; forbidden?: string[] } | undefined): SelfHostScopeSelection {
  return {
    disabled: selfHostDomainIds(cfg?.disabled),
    required: selfHostDomainIds(cfg?.required),
    forbidden: selfHostDomainIds(cfg?.forbidden),
  };
}

/** Turn live settings into a `GatingInput` for a scope — the runtime entry to `resolveGating`. */
export function gatingInputFromSettings(scope: SelfHostScope = {}): GatingInput {
  const s = getSettings();
  const selfHost = resolveSelfHost();
  const prog = scope.programmeId ? s.programmeFeatures?.[scope.programmeId] : undefined;
  const proj = scope.projectId ? s.projectFeatures?.[scope.projectId] : undefined;
  return {
    mode: selfHost.mode,
    org: { adopted: selfHost.adopted as SelfHostDomainId[] },
    programme: selectionFor(prog),
    project: selectionFor(proj),
  };
}

/** Resolve the live self-host gating for a scope, straight from settings. */
export function selfHostGatingForScope(scope: SelfHostScope = {}): SelfHostGating {
  return resolveGating(gatingInputFromSettings(scope));
}
