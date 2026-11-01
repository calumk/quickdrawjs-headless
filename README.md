# @quickdrawjs/headless

Server-side PNG renderer for Quickdraw documents. Takes a snapshot from
`store.getSnapshot()` and returns a PNG `Buffer` — with **no browser, no
Chromium, no Puppeteer/Playwright, no DOM**. The drawing backend is
[`skia-canvas`](https://github.com/samizdatco/skia-canvas) (native Skia), and
every shape is painted by the core engine's own `drawShape()`, so server
output tracks the editor instead of reimplementing it.

```javascript
import { renderPng } from '@quickdrawjs/headless'
import { writeFile } from 'node:fs/promises'

const png = await renderPng(snapshot, {
  width: 1920,
  height: 1080,
  theme: 'light',
  background: 'transparent',
  fit: 'content',
  padding: 40,
})

await writeFile('output.png', png) // png is a Node.js Buffer
```

## Install

Requires **Node.js 18+**. `skia-canvas` ships prebuilt binaries for macOS,
Linux and Windows — no build step on supported platforms (see its docs for
missing-lib errors on minimal Linux images).

```bash
npm install @quickdrawjs/headless
```

From this monorepo:

```bash
npm install
npm run example --workspace=@quickdrawjs/headless
npx vitest run packages/headless
```

## API

### `renderPng(snapshot, options?) → Promise<Buffer>`

`snapshot` is the object returned by `store.getSnapshot()`:
`{ document: { store: { id: record } } }`. Asset records for embedded images
must be included (they are, when the snapshot comes from the same store).

| Option | Default | Meaning |
|---|---|---|
| `width` | `1920` | Output pixels, integer 1–8192. |
| `height` | `1080` | Output pixels, integer 1–8192. |
| `theme` | `'light'` | `'light'` or `'dark'`. |
| `background` | `'transparent'` | `'transparent'`, `'theme'` (paper color), or any CSS color (`'#ff0000'`, `'white'`, …). |
| `fit` | `'content'` | `'content'` fits every shape; `'viewport'` fits `viewport` exactly. |
| `viewport` | — | `{ x, y, w, h }` page-space rect. Required with `fit: 'viewport'`, rejected otherwise. |
| `padding` | `40` | Output-pixel margin around the fitted rect (`0` allowed). |

The promise resolves **after** every image asset is decoded and all drawing
is complete. Output dimensions always equal `width × height`.

### Viewport modes

- **Content fit (default):** the union of all shape bounds (rotation
  included), expanded by a 48-page-unit safety margin so strokes, arrowheads
  and shadows are never clipped, is scaled and centered into the padded
  output area. Content-fit zoom is capped at 8× so single-point drawings stay
  sensible. Negative coordinates, huge drawings and rotated shapes just work.
- **Explicit viewport:** the given page-space rect is fitted into the padded
  output area, even when shapes extend beyond it (they clip at the rect edge,
  as in the editor).

### Empty documents & invalid input

- **Empty document** (no shapes): renders a blank image — background only —
  at the exact requested size. This is the documented policy, not an error.
- **Invalid input** throws `RenderError` (an `Error` with a stable `code`):

| Code | Cause |
|---|---|
| `INVALID_SNAPSHOT` | Not a `{ document: { store } }` envelope. |
| `INVALID_DIMENSIONS` | Bad width/height, or over 48M output pixels. |
| `INVALID_THEME` | Not `'light'`/`'dark'`. |
| `INVALID_BACKGROUND` | Not `'transparent'`/`'theme'`/valid CSS color. |
| `INVALID_FIT` / `INVALID_VIEWPORT` / `INVALID_PADDING` | Bad fit, viewport or padding. |
| `SNAPSHOT_TOO_LARGE` | Over 100k records. |
| `ASSET_MISSING` | Image shape whose asset record is absent. |
| `ASSET_EXTERNAL_URL` | `http(s)`/non-data URI — never fetched. |
| `ASSET_INVALID` | Not an embedded `data:image/…` asset. |
| `ASSET_DECODE_FAILED` | Bytes Skia cannot decode. |
| `ASSET_TOO_LARGE` / `TOO_MANY_IMAGES` | Over 48MB per asset / 200 images. |

External image URLs are **never fetched** — embed images as data URLs
(exactly what the editor stores) to render them.

## What renders

Everything the editor draws from the document: freehand pen strokes (with
pressure), highlighters, rectangles/ellipses/triangles/diamonds/hexagons/
stars/clouds, lines and bent arrows, text, sticky notes, embedded images —
including rotation, scaling, opacity, dash styles, patterned/semi/solid fills
and shadows. Stacking matches the editor: **highlighters paint beneath other
shapes**, each group ordered by z-index (shared `sortShapesForRender` helper,
so the two cannot drift). Editor-only chrome — selection handles, hover
states, the text editor, laser-pointer scribbles — is not in the snapshot and
is never drawn.

## Known rendering differences (browser vs server)

- **Fonts.** The hand font (`Quickdraw Hand` / Libre Baskerville, OFL —
  `packages/core/src/fonts/`) is registered with Skia before measuring, so
  wrapping and layout use the real face and match the browser to 0.1px on
  probe strings. Two skia-canvas quirks force the server onto a different
  packaging of the same outlines: it cannot shape from woff2 (reads metadata,
  renders a fallback), multi-word family names never match inside font lists,
  and for a multi-file family only the last file serves text. So the server
  registers one merged `libre-baskerville-500.ttf` (latin+latin-ext) under the
  single-word alias `QuickdrawHand`, which heads the shared font stack;
  browsers match either name to byte-identical woff2 files via
  `quickdraw.css`, so nothing they render changes. The `sans`/`serif`/`mono`
  stacks still fall back to Skia defaults, which differ from macOS/iOS system
  fonts. Antialiasing also differs slightly (Skia vs CoreGraphics/DirectWrite),
  so server text rasterizes a touch lighter than CoreText at the same weight.
- **Highlighters on transparency.** Multiply blending is designed for paper;
  on a transparent background the band composites against nothing, so it reads
  denser than on the board. Prefer `background: 'theme'` for paper-faithful
  highlights.

## Architecture

The core engine needed one small, backward-compatible seam
(`packages/core/src/shapes.js`, `editor.js`, `index.js`):

- `setShapePlatform({ Path2D, measureCtx, tileCanvas })` — explicit backend
  injection. The browser never calls it, so its path is byte-for-byte
  unchanged; **no `window`/`document`/`Path2D`/`Image` monkey-patching**.
  Only stateless pieces are shared (path class, measure context, tile
  factory). Per-render state — decoded images, hatch-pattern cache — travels
  on `drawShape`'s `opts` (`{ images, patternCache, Path2D }`), so concurrent
  renders of different snapshots cannot contaminate each other.
- `sortShapesForRender()` — the highlighter-beneath ordering, now shared by
  `Editor.shapesSorted()` and the headless pass.
- `drawShape()` honors `opts.images` (pre-decoded bitmaps, bypassing the
  browser `Image` loader) and per-render pattern caches.

The headless pass itself (`packages/headless/src/`):

- `render.js` — validate → `Store.loadSnapshot` → sort → decode assets →
  viewport transform → `drawShape` loop → PNG `Buffer`.
- `platform.js` — installs the Skia backend once (idempotent).
- `fonts.js` — registers the bundled woff2 faces via `FontLibrary`.
- `assets.js` — data-URL-only decoding with limits; clear errors otherwise.

## Tests

```bash
npx vitest run packages/headless   # 23 tests, Node env (no jsdom)
npx vitest run packages/core packages/headless
```

Coverage: blank snapshots, every shape type, z-order, highlighter-beneath,
wrapped text + notes, embedded images (pixels verified, not just “a buffer
was returned”), rotation/scale, pattern fills, negative coordinates,
content-fit centering, transparency, both themes, exact dimensions,
deterministic re-renders, concurrent renders, invalid-input codes — and a
clean-process test proving `window`/`document`/`OffscreenCanvas`/`Image`/
`Path2D` are all absent during rendering.

## Example

`examples/` holds a generator, a realistic 12-record document and its render:

```bash
node packages/headless/examples/make-board.mjs  # regenerate board.json
node packages/headless/examples/basic.mjs        # render board.json -> board.png
```

`basic.mjs` is the clean-install path: load snapshot JSON → `renderPng` →
write PNG.
