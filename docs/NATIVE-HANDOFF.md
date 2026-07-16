# Native handoff (companion-app bridge)

**Status:** design (not yet built). See `docs/FEATURE-ROADMAP.md` → "Native handoff".

## The idea

OmniProject renders many artifacts *inline* — whiteboards, docs, sheets, boards, gantts,
dashboards. Those inline versions are deliberately "good enough", not best-in-class. When a
user hits their limit, a **"Use native"** button hands off to the specialist SaaS tool that a
connected backend already fronts (Miro for whiteboards, Notion for docs, MS Project for
schedules, Power BI for dashboards, …). The user works there under **their own login**, and the
artifact comes back **through the broker** as a reference (or, opt-in, enriched content).

This is the sharpest expression of the product thesis — *your tools stay the single source of
truth; nothing syncs, nothing migrates.* We don't rebuild Miro; we hand off to it and keep a
link. And because the return path is the **broker seam**, the feature inherits every existing
data-seam control instead of creating a new one:

- outbound calls go through `safeFetch` (SSRF guard + `EGRESS_ALLOWLIST` pinning);
- a residency policy fails the hop closed with **451** before egress;
- credentials live in the **vault** (`storeCredential`) — the user's own OAuth token, so scope is
  **never widened**;
- returned data is **sanitised**, **provenance-stamped** (`source: <vendor>`), and **audited**;
- the write-back of the reference is a normal RBAC-scoped, non-silent broker write.

It is a new **connector capability**, not a new security boundary.

## Positioning — the objection-killer

This is the commercial point, not just a feature. Every *"but your system doesn't do X"* in an
eval gets one answer: *"our native X is improving — and if you already run Miro / Notion /
Smartsheet / MS Project / Power BI, you keep using it, and it flows back through the broker."* It
flips OmniProject's thinness from a weakness into the strategy: **we never have to win on feature
parity — we defer to whatever the customer already owns and absorb its output.** It's the stateless
thesis extended from *data* to *tools*. It also de-risks half of Phase 2 (whiteboards, docs,
proofing don't need best-in-class parity — "good enough inline + hand off to the real tool" clears
the bar).

**Be honest about the two levels** (don't over-promise in a demo):

- **Reference-level — universal.** Any artifact, any vendor: hand off, and a link/reference comes
  back through the broker, provenanced + audited. Always true (Slice 1).
- **Content-level — per-connector.** Pulling the artifact's *contents* back (items, doc body,
  thumbnail) needs that vendor's API + OAuth connector — real, but vendor-by-vendor (Slices 2–3).

Sales-safe phrasing: *"anything your SaaS produces, you can reference, govern and keep in context
here — and for the connectors we've built the deep bridge for, we pull the content itself."*

## Generalised — every SaaS backend, every artifact kind

This is cross-cutting, not whiteboard-specific. A connector advertises the native surfaces it
fronts; the SPA lights up "Use native (\<vendor\>)" on any artifact whose `kind` a connected
backend advertises. It plugs into planes we already have:

- **Connector catalogue** (`@workspace/backend-catalogue` vendors) — each vendor declares its
  `nativeSurfaces`.
- **Capability resolver** — `resolveCapabilities` already unions capabilities across connected
  backends, so "which native surfaces exist for this artifact kind" is one more capability query
  (capability-gates the button).
- **Primitive store** — the `kind` a native surface binds to is one of our primitive/artifact
  kinds (whiteboard, table, gantt, document, board, dashboard).
- **Attachments** — the returned reference is a `TaskAttachment { url }` (references only; no file
  storage), attached to the anchoring work item.

Illustrative mappings (all driven by what's connected, nothing hard-coded):

| Our inline artifact | "Use native" opens |
|---|---|
| whiteboard | Miro · Lucid · Figma |
| document / content page | Notion · Confluence · Google Docs |
| sheet / table | Smartsheet · Google Sheets · Airtable |
| board | Jira · Monday |
| gantt / schedule | MS Project · Smartsheet |
| dashboard | Power BI · Tableau · Looker |

## The contract (interface sketch)

Proposed additions to the shared broker types (`artifacts/api-server/src/broker/types.ts`) and
the connector catalogue. **Sketch only** — not yet wired in.

```ts
/** An artifact type OmniProject renders inline and a backend can front natively. Matches our
 *  primitive/artifact kinds so the SPA can offer "Use native" on the right surfaces. */
export type NativeSurfaceKind =
  | "whiteboard" | "document" | "diagram" | "sheet" | "board"
  | "schedule" | "dashboard" | "report" | "form" | "wiki";

/** What a connected backend advertises it can do natively for a given artifact kind. Pure
 *  metadata — no secrets, no URLs (URLs are minted per-request by `nativeHandoff`, host-
 *  allowlisted server-side). Declared in the connector catalogue; surfaced via capabilities. */
export interface NativeSurface {
  kind: NativeSurfaceKind;
  vendor: string;                 // catalogue vendor id, e.g. "miro", "notion", "smartsheet"
  label: string;                  // "Open in Miro"
  actions: Array<"open" | "create" | "embed">;
  /** Bring-back cost/mechanism:
   *   - "reference"  — a bare link (cheapest, zero-at-rest); always available.
   *   - "content"    — pull the artifact's data via the vendor API (vault credential + egress).
   *   - "screenshot" — for vendors with NO usable API: capture an image of the artifact and let an AI
   *                    vision model interpret it into a thumbnail + extracted text/structured summary. */
  importMode: "reference" | "content" | "screenshot";
}

/** Anchor: WHAT OmniProject entity the native surface is bound to, so the reimport attaches back. */
export interface NativeContextRef {
  projectId?: string;
  issueId?: string;
  entity?: string;                // e.g. "issue" | "programme"
  id?: string;
}

export interface NativeHandoffRequest {
  kind: NativeSurfaceKind;
  vendor: string;
  action: "open" | "create" | "embed";
  contextRef?: NativeContextRef;
  externalRef?: string;           // for "open": deep-link to an artifact from a prior import
}

/** The vetted, connector-minted handoff. `url` is built by the connector against the vendor's
 *  REAL domain (host-allowlisted) — never from user input. `embedUrl` is the vendor's official
 *  sandboxed Live-Embed, if offered (Tier 2). `handoffId` correlates the later import. */
export interface NativeHandoff {
  url: string;
  embedUrl?: string;
  handoffId: string;
}

export interface NativeImportRequest {
  kind: NativeSurfaceKind;
  vendor: string;
  handoffId?: string;             // correlate a just-completed handoff…
  externalRef?: string;           // …or import a known external artifact by id/url
  target: { projectId: string; issueId?: string };   // where the returned reference attaches
}

// ── Broker seam additions (all OPTIONAL — a connector implements only what it fronts) ──────────
interface Broker {
  // …existing methods…

  /** The native surfaces this backend fronts. Unioned across connected backends by
   *  `resolveCapabilities`, capability-gating the SPA's "Use native" affordance. */
  nativeSurfaces?(ctx: ActorContext): Promise<NativeSurface[]>;

  /** Mint the vetted vendor handoff URL. The connector builds it against the vendor's real
   *  domain (host-allowlisted); the user opens it in THEIR OWN browser and authenticates to the
   *  vendor directly — we never wrap the vendor's auth screen. */
  nativeHandoff?(ctx: ActorContext, req: NativeHandoffRequest): Promise<NativeHandoff>;

  /** Bring the native artifact back THROUGH the broker: a reference (importMode "reference") or
   *  enriched content (importMode "content", via `safeFetch` under the user's vaulted token).
   *  Returns the attachment written to `target`; sanitised + provenance-stamped + audited. */
  nativeImport?(ctx: ActorContext, req: NativeImportRequest): Promise<TaskAttachment>;
}
```

### Connector-catalogue declaration (metadata)

```ts
// in a vendor's catalogue entry
nativeSurfaces: [
  { kind: "whiteboard", vendor: "miro", label: "Open in Miro",
    actions: ["open", "create", "embed"], importMode: "reference" },
]
```

### SPA affordance (sketch)

One reusable, capability-gated control — no per-vendor UI:

```tsx
// <UseNative kind="whiteboard" contextRef={{ projectId, issueId }} />
// 1. reads nativeSurfaces from the resolved capabilities → renders a button per matching vendor
// 2. on click → POST /api/native/handoff → open { url } in a new browser tab (or { embedUrl } inline)
// 3. on return → POST /api/native/import → the reference lands as an attachment on contextRef
```

Routes are thin shells over the broker methods (like every other broker passthrough), RBAC-gated
(contributor+ to attach), audited.

## Screenshot + AI fallback (when the vendor API is lacking)

Some tools have no usable read API, or a board type the API can't export. For those, a third import
mechanism: **capture an image of the artifact and let an AI vision model interpret it** — returning a
thumbnail plus extracted text / a structured summary that lands as the attachment's metadata.

- **Capture** runs server-side in the pre-installed **headless Chromium** (Playwright), navigating the
  artifact URL under the user's own session/token — never a service account, so scope isn't widened.
- **The capture is an egress event** → the headless browser's navigation is subject to the same
  SSRF/egress/residency posture (host-allowlisted to the vendor's domains; residency-gated).
- **Interpretation goes through the existing AI plane** → the image + prompt run through the single
  `aiChat`/vision chokepoint, so it inherits the **AI kill switch, per-role model allowlist, token budget,
  and — critically — DLP redaction** (a screenshot can carry secrets/PII; redact before egress) and
  **AI·GENERATED provenance** on whatever it extracts.
- **Reference-first, still.** The screenshot + AI summary are *derived metadata* on a reference; the board
  itself stays in the vendor. It's the graceful-degradation path — "no API? we still capture and understand
  it" — not a replacement for the reference model.

This is the honest answer to "your API is lacking": we can still take it in, just via pixels + AI instead
of a clean API pull.

## Security invariants (vendor-agnostic — hold by construction)

1. **Connector-minted URLs, host-allowlisted.** Handoff URLs and API hosts come from the
   connector, per-vendor allowlisted — never user-typed. "Vendor X" can only deep-link and call
   vendor X's real domains → no open redirect, no SSRF pivot.
2. **Reimport is a broker read.** `safeFetch` (egress/SSRF), residency 451 fail-closed, vault
   credential = the user's own OAuth token (**scope never widened**), sanitiser, provenance,
   audit.
3. **Reference-only by default** (zero-at-rest, nothing migrates). Content pull is opt-in and
   capability-gated (`importMode: "content"`).
4. **Login stays in the user's real browser.** The broker only ever talks to the vendor's **API**,
   never wraps its auth screen (no credential-interception surface).
5. **RBAC + edit-policy** gate who may hand off / import; the write-back is non-silent + audited.

## Non-goals / avoid

- No embedded webview around a vendor **auth** screen — content-embed (Tier 2) only, via the
  vendor's official sandboxed SDK with a CSP `frame-src` allowlist.
- No server-side bulk copy / migration of the artifact — reference, don't replicate.
- No credential proxying; OAuth or pure browser handoff only.

## Slices

1. **Reference handoff** — `nativeSurfaces` + `nativeHandoff` + `nativeImport(importMode:"reference")`
   + the `<UseNative>` button. Open in the user's browser, reference lands as an attachment. No API
   egress needed for the bare-reference path.
2. **Embed preview** — inline sandboxed vendor Live-Embed (Tier 2).
3. **Content import** — OAuth connection (vault) + `importMode:"content"` metadata/thumbnail pull
   via `safeFetch`, capability-gated.
4. **Screenshot + AI fallback** — `importMode:"screenshot"` for vendors with no usable API: headless
   Chromium capture (user session, egress/residency-guarded) → AI vision interpretation through the governed
   `aiChat` chokepoint (DLP-redacted, provenance-stamped).
