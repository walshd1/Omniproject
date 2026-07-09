# Demo recording script (~75s)

A shot-by-shot script to record **once** and reuse: a ~75-second hero video for
the README/posts, plus a ~12-second silent GIF loop for the top of the README.
The goal is to make the claims *visceral* — especially "dry-run verify, no side
effects" and "your methodology, one dataset."

Captions are written as **on-screen text overlays** because most embeds (GIFs,
muted autoplay) have no sound. Keep each on screen ~2–3s.

---

## Before you hit record

- **Run in demo mode** (zero config, sample data — nothing real on screen):
  ```bash
  pnpm install
  PORT=8080 node artifacts/api-server/dist/index.mjs
  ```
- **Window:** 1280×800 (or 1440×900), browser zoom ~110–125% so text is legible
  when scaled down. Hide bookmarks bar and any personal tabs.
- **Cursor:** enable a click-highlight (e.g. ScreenStudio, or Keystroke/Cursor
  highlighter) so taps are visible.
- **One caveat — the Verify shot needs an n8n endpoint.** The green per-action
  checklist (Scene 2) only lights up when `BROKER_URL` points at an n8n that
  implements the contract (your own, or import a blueprint into a free n8n
  instance). If you don't have one handy, use the **demo-mode alternative** noted
  in Scene 2 — everything else films in pure demo mode.

## Tools

- **Record:** ScreenStudio (Mac, auto-zoom + captions, easiest), or OBS / QuickTime.
- **GIF:** `ffmpeg` + `gifski` (sharp, small), or Gifski app. Keep the README GIF
  **< ~5 MB** so GitHub renders it inline.
- **Host:** commit the file under `docs/assets/` and reference it with a relative
  path, or attach to the latest GitHub Release and hotlink. Repo-hosted is more durable.

---

## The 75-second hero video

| Time | On screen / action | Caption overlay |
| ---- | ------------------ | --------------- |
| 0:00–0:06 | Cold open on the dashboard (brutalist UI, sample portfolio). Slow, confident. | **OmniProject — programme management with no database.** |
| 0:06–0:10 | Stay on dashboard; cursor rests on a RAG card with a `SAMPLE`/`DERIVED` badge. | *Your tools stay the source of truth. This is just a view.* |
| 0:10–0:24 | **The trust shot.** Go to **Configurator → Verify** and click **Verify**. Let the per-action checklist tick **green** row by row. | **Dry-run verify — probes your n8n, never touches the backend.** |
| 0:24–0:36 | **Programmes** → a programme-wide rollup (portfolio RAG), then click into one project. | **Roll programmes up → drill into a project.** |
| 0:36–0:50 | On that project, use the **view switcher**: Kanban → Scrum (burndown) → Gantt → PRINCE2. Pause ~2s on each. | **One dataset, your methodology — Kanban / Scrum / Gantt / PRINCE2 / RAID.** |
| 0:50–1:02 | **Reports**: Portfolio RAG cards → Resource heatmap (an over-allocated row) → EVM chart (CPI/SPI). | **Finance (EVM), time & resources — read-through from your backends.** |
| 1:02–1:10 | **Configurator**: show the backend list + "Generate workflow". | **n8n is the only broker — connect to anything, nothing to sync.** |
| 1:10–1:15 | Cut to logo + tagline on a clean background. | **Apache-2.0 · self-hostable · try it read-only → github.com/walshd1/Omniproject** |

**Pacing notes:** let the Verify checklist (0:10–0:24) breathe — it's the most
persuasive 14 seconds in the whole video. Everything else can move briskly.

### Scene 2 demo-mode alternative (no n8n on hand)

If you can't wire n8n for the green checklist, swap 0:10–0:24 for: hover several
figures showing the **`SAMPLE` / `DERIVED` provenance badges**, then open
**Setup** to show the status reading **demo mode / stateless**. Caption:
**"Provenance-badged — it never shows demo or computed numbers as backend fact."**
(Then film the real Verify shot later, once you've pointed it at an n8n, and slot
it in.)

---

## The 12-second README loop (silent GIF)

A tight, no-caption loop for the very top of the README — pure motion that says
"this is real and fast":

1. Dashboard (1s) →
2. **Setup → Verify → checklist ticks green** (5s) →
3. View switcher: Kanban → Gantt → PRINCE2 (4s) →
4. Back to dashboard (2s), loop.

Export ~12s, 1280×800 → scale to ~960px wide, < 5 MB.

### Embed in the README

Once recorded, commit the GIF to `docs/assets/` (create the folder — it doesn't exist yet) and embed
it right under the hero blockquote. The path below is written **relative to the repo-root README**,
where this snippet is pasted (not relative to this file):

```markdown
![OmniProject demo](docs/assets/omniproject-demo.gif)
```

And in the Reddit/HN posts, lead with the GIF or a link to the hero video — a
working visual outperforms any paragraph of copy.

---

## Recording checklist

- [ ] Demo mode running; no real/personal data anywhere on screen.
- [ ] (For the Verify shot) `BROKER_URL` pointed at a contract-implementing n8n.
- [ ] Click-highlight on; zoom ~110–125%; clean browser chrome.
- [ ] Record the 75s hero in one take (re-do scenes as needed, stitch later).
- [ ] Export the 12s GIF < 5 MB; commit to `docs/assets/`.
- [ ] Drop the GIF into the README hero and link the hero video from LAUNCH posts.
