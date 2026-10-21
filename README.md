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

glyphterm is made to be driven by AI agents. An agent can't watch an animation, but it can
read a frame as text and steer a viewer that you watch.

### The agent skill

`skills/glyphterm/SKILL.md` teaches an agent the whole workflow below. For Claude Code,
copy it into your skills folder:

```sh
mkdir -p ~/.claude/skills && cp -r skills/glyphterm ~/.claude/skills/
```

Other agents that support Agent Skills take the same folder.

### One frame as plain text

```sh
glyphterm examples/rocket.obj --once --cols 60 --rows 20     # plain ASCII when piped
glyphterm torus --once --ansi > frame.ans                    # force 24-bit color
glyphterm --list --json                                      # every choice and limit
```

### A live view the agent steers

```sh
glyphterm open examples/rocket.obj --watch scene.json
```

`open` starts the viewer in a new pane next to the agent's terminal, through the terminal's
own CLI: tmux, WezTerm, kitty (with `allow_remote_control`) or Windows Terminal. Anywhere
else (Konsole, GNOME Terminal, iTerm2, …) it exits with code 3 and prints the command for
you to run in a second terminal: `glyphterm examples/rocket.obj --watch scene.json`.

The agent then edits the scene file:

```json
{
  "model": "examples/rocket.obj",
  "style": "quadrant",
  "color": "amber",
  "yaw": 30,
  "pitch": 15,
  "spin": 0,
  "caption": "Here is the rocket you asked for"
}
```

- **Every key is optional.** The full format is the JSON Schema in
  `schema/scene.schema.json`.
- **Model paths are relative to the scene file.**
- **Your own keypresses are written back,** so the file always holds the current view.
- **The viewer reports to `scene.status.json`:** whether it's running, the size of the scene
  area, and any problems with the last edit, such as an unknown style, a value of the wrong
  type, or a misspelled key. The footer shows the same problems, and the valid fields still
  apply.
- **`glyphterm --scene scene.json --plain --cols 80 --rows 24` renders what the viewer
  shows,** without one running, and exits with code 2 listing every problem.

With `"model": "field"`, `"data": "cpu"` switches to live CPU load. With `"model": "wave"`,
a `wave` object sets the oscilloscope:
`{"waveform": "square", "frequency": 2, "amplitude": 0.8, "speed": 0.5}`.

Exit codes: 0 success, 2 invalid arguments or scene, 3 `open` couldn't open a pane.

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
- `src/models.js` and `src/geometry.js`: primitives, file loading, what each model draws
- `src/settings.js`: validation shared by the command line and the scene file
- `src/viewer.js`: render loop and scene-file watching, with `state.js`, `input.js`,
  `scene.js` and `hud.js` for the parts
- `src/open.js`: opening a pane in tmux, WezTerm, kitty or Windows Terminal
- `bin/glyphterm.js`: CLI

Notes:

- glyphcss's file parsers produce a z-up world, which `models.js` rotates back to y-up.
- glyphcss's own `encodeGlyphAnsi` drops background colors, which half-block and quadrant
  styles need, so `src/ansi.js` does the translation instead.
- glyphcss's hidden-line removal drops real edges in ASCII wireframes, so the `wire` style
  is always x-ray.

`npm test` runs the test suite, `npm run lint` checks style, and `npm run schema`
regenerates the scene schema.
