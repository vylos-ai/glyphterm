# glyphterm

Retro 3D model viewer for the terminal, built on the [glyphcss](https://glyphcss.com)
rasterizer (npm `glyphcss` / `@glyphcss/core` 0.3.x, pre-1.0, so APIs may shift). This is a
proof of concept that grew out of the question "how do I render richer output in Konsole
and Windows Terminal?". The README covers usage; this file covers how the code works and
what was learned building it.

## Commands

- `npm test`: node:test suite in `test/` (fast, no terminal needed)
- `npm run lint`: ESLint + Prettier check; `npm run format` rewrites formatting
- `npm run schema`: regenerates `schema/scene.schema.json` from the code (a test fails
  when it's stale)
- `node bin/glyphterm.js <model> [--style …] [--watch scene.json]`: interactive viewer
- `node bin/glyphterm.js <model> --once --cols 80 --rows 24`: one frame to stdout. Plain
  text when piped, which is how an agent "sees" a render.
- `node examples/generate.js`: regenerates the example OBJ files

## Architecture

| File               | Role                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `bin/glyphterm.js` | CLI: argument parsing, `--once` path                                                     |
| `src/settings.js`  | Limits, per-model default views, `parseSettings()` shared by CLI flags and scene         |
| `src/geometry.js`  | `modelGeometry()`: loaded model → colored polygons, or polylines for the field           |
| `src/viewer.js`    | Interactive loop: terminal setup, model loading, CPU sampler, scene-file watching        |
| `src/state.js`     | The viewer state object and small helpers (`isField`, `accent`, `resetView`)             |
| `src/input.js`     | Terminal input → key/mouse events → state changes; key table, returns effects            |
| `src/scene.js`     | Scene file ⇄ state: `sceneSnapshot()`, `applyScene()`, model path resolution             |
| `src/hud.js`       | Header, footer, caption and the full-frame composition                                   |
| `src/render.js`    | `renderFrame()`: view transform, lighting, styles, polyline/ridgeline renderer           |
| `src/ansi.js`      | Escape codes, glyphcss HTML → ANSI (fg and bg), `overlayText()` for labels               |
| `src/models.js`    | Primitives, mesh-file loading (OBJ+MTL/STL/glTF/VOX), normalization                      |
| `src/wave.js`      | Animated models: `wave` (oscilloscope) and `field` (ridgeline, demo or data)             |
| `src/cpu.js`       | Per-core CPU load sampler (`os.cpus()`, cross-platform)                                  |
| `src/open.js`      | `glyphterm open`: split a pane via tmux/WezTerm/kitty/Windows Terminal CLIs, else exit 3 |
| `src/themes.js`    | Phosphor color themes, `PHOSPHOR`/`PAPER` constants, tinting                             |

Data flow: model polygons (y-up, bounding radius 1) → `renderFrame` rotates them by
yaw/pitch → glyphcss `rasterize()` → `<pre>` HTML → `htmlToLines` → ANSI lines → the
viewer composes the header and footer and redraws the whole frame (alternate screen,
synchronized output).

The `field` model is not polygons. It is polylines (`{ points, color, label?, value?,
labelAt? }`) passed as `lines` to `renderFrame`, which hides lines itself and hands
glyphcss explicit `wireframe` edges.

## glyphcss quirks (verified the hard way)

- **Axes:** with an unrotated camera, glyph space is screen-down = +x, screen-right = +y,
  toward the viewer = +z (`toGlyph` in render.js).
- **File parsers are z-up:** a file's (x, y, z) comes out as (z, x, y).
  `models.js#fromParserSpace` rotates it back. Primitives are already y-up.
- **Zoom:** with `cellWidth: 1, cellHeight: 2, cellAspect: 2`, camera zoom = character
  columns per world unit.
- **Camera objects capture zoom in a closure.** Create a new camera per frame; don't spread
  or copy one.
- **Projection to a cell** (orthographic, unrotated): `col ≈ floor(cols/2 + y·zoom)`,
  `row ≈ floor(rows/2 + x·zoom/2)`. Used to place labels.
- **Lighting is fixed in world space.** We rotate the geometry ourselves and keep the camera
  fixed, so the light stays attached to the viewer. Line-like models use "glow" lighting
  (mostly ambient) or their thin tubes speckle dark.
- **`encodeGlyphAnsi` drops `background-color`,** which half-block and quadrant styles need,
  so we translate the HTML ourselves.
- **Hidden-line removal (`hiddenLines: "hide"`)** drops real edges in ASCII wireframes and
  barely hides anything for explicit edges. The `wire` style is x-ray. The field does its
  own ridgeline occlusion (horizon buffer in screen space, lines drawn front to back).
- **The `default` wireframe palette is decorative symbols** (◆⊕∴). Wireframes use `ascii`.

## Conventions

- ES modules, no build step, no runtime dependencies beyond glyphcss (Prettier and ESLint
  are dev-only). Node ≥ 20.
- Keep viewer logic out of `viewer.js` where possible: handlers in `input.js`, `scene.js` and
  `hud.js` take the state object and return values, so `test/viewer.test.js` can cover them.
- Every model is normalized to a bounding radius of 1 so one fit/zoom works for all.
- Colors are `#rrggbb` everywhere. Gradients run front (index 0) to back.
- Watch out for default parameters receiving `undefined`: `renderFrame({ color: undefined })`
  falls back to the default `true`. Coerce with `Boolean(...)` (this already caused a bug once).

## Agent interface

glyphterm is meant to be driven by AI agents; `skills/glyphterm/SKILL.md` is the
user-facing skill for that (keep it in sync with CLI changes). The pieces:
`--list --json`, `--once --scene <file>` (preview and validation; flags beat the scene,
which beats defaults), the viewer's `<scene>.status.json` (running, size, problems), the
JSON Schema, and `glyphterm open`. Exit codes: 2 invalid input, 3 no supported way to open
a pane. `open` must only use a terminal's documented CLI. Never drive terminals through
side channels (Konsole's D-Bus `runCommand`/`sendText` is deliberately disabled by
default).

The viewer keeps file model paths absolute; scene files name them relative to the scene
file when they sit below it (`sceneModelName`).

## Working with the user's live viewer

The user runs `node bin/glyphterm.js <model> --watch scene.json` in Konsole, and Claude
steers it by editing `scene.json` (gitignored). Keypresses are mirrored back into the file,
so **read it before editing**. Claude can't see the animation; preview with `--once`.
After code changes, the running viewer must be restarted. Update `scene.json` first,
because it is applied on top of the command line at startup.

## Verifying visual changes

- `--once --plain` shows shape. Color-dependent styles (half-block, gradients) need a
  color check.
- **Live test:** run the viewer in a pty with `pty.fork`, feed keys, and emulate the screen
  with `pyte` (in a throwaway venv) to snapshot frames. Exit must restore the alternate
  screen and the cursor.
- **Color check:** pipe `--once --ansi` through pyte → HTML → a browser screenshot. Serve it
  over a local HTTP server; the Playwright MCP blocks `file://` URLs.

## Ideas for refinement

- **More data sources for the field:** memory, network rx/tx, disk I/O, a CSV file, stdin
  (`some-cmd | glyphterm field --data -`), Prometheus.
- **Chart polish:** axis/time ticks, a max-value scale, a faint baseline for history not yet
  filled, adjustable history length.
- **Windows Terminal:** test it. Mouse/VT input under ConPTY is the riskiest part, and
  `fs.watchFile` polling should be fine.
- **Agent integration:** an MCP server exposing `show_model` / `set_scene` / `snapshot`
  instead of hand-editing JSON, or a Claude Code mod with a live pane.
- **Performance:** frame diffing (only rewrite changed rows), caching static geometry per
  model, a worker thread for rasterizing at large sizes.
- **Formats:** test `.glb` and `.vox` with real files. Textures are currently ignored, and
  only material colors are used.
- **Sixel/kitty graphics** as an optional high-resolution backend next to the text styles.
- **Packaging:** `npm link` / publishing, a git repository, CI running `npm test`.
