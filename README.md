# glyphterm

Spin 3D models in your terminal, drawn entirely with text: shaded ASCII, half-block and
quadrant pixels, braille wireframes. It's built on [glyphcss](https://glyphcss.com)'s
rasterizer, so no GPU, canvas, or image protocol is needed. It works in any terminal with
24-bit color: Konsole, Windows Terminal, kitty, and so on.

```
                      ⢀⣀⣀⣀⣠⣤⠤⠤⣶⣶⡄
                   ⣠⣾⣿⣭⣉⠉     ⢡⢿⠹⣄
                 ⢀⡴⠋⣿⡙⠉⡛⠶⣄   ⢀⡞⡞ ⠘⣆
                ⣠⠞  ⡇    ⠈⠙⠲⢤⣴⡀⡇  ⠈⢧⡀
              ⢀⡼⠃  ⢠⠇      ⠈⠙⣚⣿⡷⢶⣄⡀ ⢳⡀
             ⣠⣯    ⢸      ⣠⡴⠚⠉ ⡇ ⠈⠙⣳⣦⣽⡄
             ⠹⠛⢯⣘⠐ ⢾⢠ ⢀⣠⠴⠋⠁    ⡇     ⢈⠇
              ⠙⣆⠈⠓⠦⣼⣧⡖⠋        ⡇   ⢀⡴⠋
               ⠘⢦  ⢸⠙⠲⢤⣀       ⡇  ⣠⠞⠁
                ⠈⢳⡀⢸⡀  ⠈⠙⠲⢤⣀   ⡇⢀⡴⠃
                  ⠳⡄⣧      ⠈⠙⠲⢾⣧⠏
                   ⠹⠿⠯⠖⠒⠒⠒⠋⠉⠉⠉
```

## Quick start

```sh
npm install
node bin/glyphterm.js                          # spinning torus, half-block style
node bin/glyphterm.js examples/computer.obj    # a retro computer
node bin/glyphterm.js star --style braille --color amber
node bin/glyphterm.js --list                   # every primitive, style, palette, color
```

Run `npm link` to get a global `glyphterm` command.

### Controls

| Input                      | Action                                                      |
| -------------------------- | ----------------------------------------------------------- |
| mouse drag, arrows, `hjkl` | rotate                                                      |
| mouse wheel, `+` / `-`     | zoom                                                        |
| `s` / `S`, `1`–`7`         | next / previous / pick style                                |
| `g` / `G`                  | glyph palette (ascii, lines, blocks, runes, hex, …)         |
| `c` / `C`                  | color: phosphor, amber, cyan, magenta, ice, paper, original |
| `m` / `M`                  | next / previous model                                       |
| `space`                    | pause auto-rotation                                         |
| `[` / `]`                  | spin slower / faster                                        |
| `r`                        | reset view                                                  |
| `q`, `Esc`, `Ctrl-C`       | quit                                                        |

### Styles

| id          | look                                                             |
| ----------- | ---------------------------------------------------------------- |
| `shade`     | classic ASCII shading ramp                                       |
| `halfblock` | `▀▄█` with two colors per cell, so twice the vertical resolution |
| `quadrant`  | `▖▗▘▝▚▞…`: 2×2 sub-pixels per cell                               |
| `wire`      | ASCII x-ray wireframe with box-drawing junctions                 |
| `braille`   | braille-dot wireframe with hidden lines removed                  |
| `xray`      | braille-dot wireframe showing all edges                          |
| `ink`       | silhouette and crease outlines only                              |

### Oscilloscope

`glyphterm wave` shows an animated oscilloscope: a phosphor trace scrolling across a
graticule. The trace takes the theme color (`c`), and the screen and grid are darker shades
of it.

| Key       | Action                                        |
| --------- | --------------------------------------------- |
| `w` / `W` | waveform: sine, square, triangle, saw         |
| `,` / `.` | frequency (periods across the screen)         |
| `;` / `'` | amplitude                                     |
| `[` / `]` | scroll speed (negative scrolls the other way) |
| `space`   | freeze the trace                              |

You can also set these from the command line (`--waveform`, `--frequency`, `--amplitude`,
`--scroll`) or with a `wave` object in the scene file (see below).

### Wave field

`glyphterm field` is a ridgeline chart (think Joy Division's _Unknown Pleasures_). It shows
a stack of separate, thin braille lines, each its own animated signal: a quiet baseline with
a burst of peaks. Lines are colored along a gradient from front to back, and each line hides
whatever is behind it. Choose the `xray` style (`6`) to see every line in full.

It uses the same wave keys as the oscilloscope, plus `c` to cycle gradients (synthwave,
sunset, ocean, aurora, fire, phosphor) and `{` / `}` to change the number of lines. From
the command line, use `--gradient sunset --lines 20`. In the scene file, use
`"gradient": "ocean"` or your own stops, e.g. `"gradient": ["#ff00aa", "#00ffee"]`.

### Live CPU load

`glyphterm field --data cpu` (or `d` inside the field) turns the field into a live monitor:
one labeled line per CPU core (`cpu0` in front), showing load over the last 30 seconds. It
scrolls left as new samples arrive four times a second, with each core's current load at
the right end. The header shows the average. Load comes from Node's `os.cpus()`, so this
also works on Windows and macOS. `--once --data cpu` samples for two seconds and prints one
frame, which is handy for agents.

### Models

- **Primitives:** torus, sphere, cube, icosahedron, dodecahedron, octahedron,
  cuboctahedron, football, star, great-star, cone, cylinder, pyramid, antiprism,
  and the animated `wave` oscilloscope and `field` of waves
- **Files:** `.obj` (with `.mtl` colors), `.stl`, `.glb` / `.gltf`, and MagicaVoxel `.vox`.
  Each model is centered and scaled to fit the terminal. Textures are ignored; material
  colors are used instead.
- The examples in `examples/` are generated by `node examples/generate.js`.

## For AI agents and scripts

An agent's shell output comes back to it as text, so glyphterm offers two interfaces.

**1. One frame as plain text.** The agent can read this output itself:

```sh
glyphterm examples/rocket.obj --once --cols 60 --rows 20     # plain ASCII when piped
glyphterm torus --once --ansi > frame.ans                    # force 24-bit color
```

**2. A live view the agent steers.** You run the viewer in a terminal split, and the agent
edits a JSON file:

```sh
glyphterm --watch scene.json
```

```json
{
  "model": "examples/rocket.obj",
  "style": "quadrant",
  "palette": "auto",
  "color": "amber",
  "yaw": 30,
  "pitch": 15,
  "zoom": 1,
  "spin": 20,
  "paused": false,
  "caption": "Here is the rocket you asked for"
}
```

With `"model": "field"`, `"data": "cpu"` switches to live CPU load. With `"model": "wave"`, a `wave` object sets the oscilloscope:
`{"waveform": "square", "frequency": 2, "amplitude": 0.8, "speed": 0.5}`.

All fields are optional. A relative `model` path is resolved against the scene file's
folder. Invalid values show up as an error in the footer, while the valid fields still
apply. Your own keypresses are written back to the file, so the agent can always read the
current view.

## How it works

```
mesh file / primitive ──► normalize (center, radius 1, y-up)
                     ──► rotate by yaw/pitch (light stays fixed to the viewer)
                     ──► glyphcss rasterize() → <pre> HTML with color spans
                     ──► src/ansi.js → 24-bit ANSI (fg and bg, for half-blocks)
                     ──► synchronized full-frame redraw on the alternate screen
```

- `src/render.js`: styles, view transform, lighting and fit-to-terminal
- `src/ansi.js`: escape codes and the glyphcss HTML → ANSI translation
- `src/models.js`: primitives and file loading
- `src/viewer.js`: render loop, HUD, keyboard and mouse input, scene-file watching
- `bin/glyphterm.js`: CLI

Notes:

- glyphcss's file parsers produce a z-up world, which `models.js` rotates back to y-up.
- glyphcss's own `encodeGlyphAnsi` drops background colors, which half-block and quadrant
  styles need, so `src/ansi.js` does the translation instead.
- glyphcss's hidden-line removal drops real edges in ASCII wireframes, so the `wire` style
  is always x-ray.

`npm test` runs the test suite.
