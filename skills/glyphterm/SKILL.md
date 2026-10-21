---
name: glyphterm
description: Render 3D models (OBJ, STL, glTF/GLB, VOX, built-in primitives) and animated line charts as text in the terminal with the glyphterm CLI, look at them yourself as plain text, and steer a live viewer the user watches through a JSON scene file. Use when the user wants to see, show, preview, inspect or present a 3D model or a live chart in the terminal, or mentions glyphterm.
---

# glyphterm

glyphterm draws 3D models with text characters. You can't watch the live
viewer, but you can render any view as plain text and read it, and you can
steer a viewer the user watches by editing a JSON file.

Run it as `glyphterm` if that command exists, otherwise `npx github:vylos-ai/glyphterm`.
Inside a checkout of the glyphterm repository, use `node bin/glyphterm.js`.

## Look at a model yourself

```sh
glyphterm examples/rocket.obj --once --plain --cols 80 --rows 24
```

- **Styles:** without color, `--plain` output uses the `shade` style, which
  shades surfaces by how they face the light. `--style wire` shows edges as
  box-drawing lines (`│ ─ ┼`), with a few `*` `+` `x` that vary from run
  to run.
- **Angles:** `--yaw 0 --pitch 0` looks at the model's front, with its top
  up. Yaw turns it around the vertical axis (`--yaw 90` shows the side).
  Positive pitch tips the top toward you, and `--pitch 89` looks from above.
  Meshes start at yaw 30, pitch 20.
- **Zoom:** every model is scaled to fit, so `--zoom 1` shows the whole
  model.
- **Colors:** plain text can't show colors. Validation confirms a color is
  valid, but you won't see it.
- **Discovery:** `glyphterm --list --json` lists every model, style,
  palette, color, gradient and limit.

## Show the user a live view

1. **Is a viewer already running?** If a scene file is in use (often
   `scene.json` in the current folder) and its `scene.status.json` says
   `"running": true`, steer that one instead of opening another.
2. **Ask the user first.** Then open a pane next to them:

   ```sh
   glyphterm open <model> --watch scene.json
   ```

   If `scene.json` already exists, the viewer applies it on top of the
   command line, so the file's `model` wins.

3. Check the exit code:
   - **0:** the pane is open. This works in tmux, WezTerm, kitty (with
     remote control enabled) and Windows Terminal.
   - **3:** this terminal offers no supported way to split. Pass on the
     command printed on stderr so the user can run it in a second terminal,
     and wait for them to say it's running.
   - **2:** something in your arguments is wrong. The message says what.

   Don't try other ways to type into or control the user's terminal (such as
   D-Bus, AppleScript or sending keystrokes). If the supported route isn't
   available, the user starts the viewer.

## Steer the live view

The viewer watches the scene file and reports back in the status file next
to it: `scene.json` → `scene.status.json`.

1. **Read the scene file before you edit it.** The user's keypresses in the
   viewer are written into it, so it is always the current view.
2. Change only the keys you need. The format is in `schema/scene.schema.json`
   (its path is in `--list --json` as `sceneSchema`): `model`, `style`,
   `palette`, `color`, `yaw`, `pitch`, `zoom`, `spin`, `paused`, `caption`,
   `stats`, `contextLimit`, `wave`, `gradient`, `data` (and `activity`, `session`, which the
   avatar's hooks write). A `model` path is either absolute or relative
   to the scene file.
3. **Read the status file** after about half a second:
   - **`running: false`, or no update:** the viewer isn't running.
   - **`problems`:** what was wrong with your last edit. Fix it, since bad
     values are ignored.
   - **`size`:** the scene area in characters.
4. **Preview what the user sees:**

   ```sh
   glyphterm --scene scene.json --once --plain --cols <size.cols> --rows <size.rows>
   ```

   - **Without a running viewer,** use `--cols 80 --rows 24`.
   - **The preview is only the scene area:** the header, footer and caption
     aren't in it.
   - **It also validates the file.** Exit code 2 lists every problem.

Useful scene edits:

- `"spin": 0` stops the rotation so the user can look at one angle. Set
  `yaw`/`pitch` to the angle you want.
- `"caption": "..."` puts a line of text under the model. Use it to point
  out what the user is looking at. `""` removes it.
- `"color": "original"` shows a file's own material colors. Themes like
  `phosphor` or `amber` tint everything one color.
- `"style": "halfblock"` is the most detailed in color, `braille` is fine
  line art, and `xray` shows hidden edges.

## The avatar

`glyphterm avatar` shows a mascot that acts out what a coding agent does
(thinking, reading, coding, writing, running, needs-you, waiting, error,
done, sleeping). Usually Claude Code hooks set these by themselves
(`glyphterm avatar --print-hooks` prints the settings; only add them when
the user asks). Then don't set routine activities yourself; they would be
overwritten anyway. Two are worth a call of your own:

```sh
glyphterm avatar done --detail "tests pass"   # after finishing something the user asked for
glyphterm avatar error --detail "build broke" # when you're stuck
```

These are silent and exit 0. Unknown activities exit 2.

The hooks also write the session's stats (model, context, cache share, output tokens, tool calls, failed calls) to the avatar file as
`session`. `"stats": true` (or the `i` key) shows them under the avatar; leave
that switch to the user. `contextLimit` (tokens, default 200000) is the window
its context meter fills up to.

## Animated models

- **`wave`:** an oscilloscope. Its trace is set in `wave`: `waveform`,
  `frequency`, `amplitude`, `speed`. It starts front-on (yaw 0, pitch 0).
- **`field`:** a ridgeline chart. `"data": "cpu"` plots live load per CPU
  core, `"data": "demo"` plots synthetic signals. Colors come from
  `gradient` (a preset or a list of `#rrggbb`). `wave.lines` sets the line
  count for demo data.
