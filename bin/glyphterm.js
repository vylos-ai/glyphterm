#!/usr/bin/env node
// glyphterm: a retro 3D model viewer for the terminal.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel, PRIMITIVE_NAMES, SUPPORTED_EXTENSIONS } from "../src/models.js";
import { renderFrame, STYLES, STYLE_IDS, PALETTES, findStyle } from "../src/render.js";
import { THEME_NAMES } from "../src/themes.js";
import { term } from "../src/ansi.js";
import { runViewer } from "../src/viewer.js";
import { createCpuSampler } from "../src/cpu.js";
import { modelGeometry } from "../src/geometry.js";
import { parseSettings, viewDefaultsFor, clamp, LIMITS, DATA_SOURCES, SCENE_KEYS } from "../src/settings.js";
import { unknownSceneKeys } from "../src/settings.js";
import { resolveSceneModel } from "../src/scene.js";
import { openPane, shellCommand } from "../src/open.js";
import { ACTIVITIES, ACTIVITY_IDS } from "../src/avatar.js";
import { avatarFile, hookActivity, writeActivity, readActivity, hooksConfig } from "../src/hooks.js";
import { ANIMATED, POSABLE } from "../src/models.js";
import { WAVEFORM_NAMES, GRADIENT_NAMES, WAVE_LIMITS, LINE_LIMITS } from "../src/wave.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SCHEMA_PATH = fileURLToPath(new URL("../schema/scene.schema.json", import.meta.url));

const HELP = `glyphterm: spin 3D models in your terminal, drawn with text.

Usage
  glyphterm [model] [options]
  glyphterm open [model] [options]   start the viewer in a new pane (tmux, WezTerm, kitty, Windows Terminal)
  glyphterm avatar [model] [options] a mascot showing what your coding agent does (see Avatar)

  model                 a primitive (${PRIMITIVE_NAMES.slice(0, 4).join(", ")}, …; see --list)
                        or a mesh file (${SUPPORTED_EXTENSIONS.join(" ")}). Default: torus

View
  -s, --style <id>      ${STYLE_IDS.join(" | ")}   (default: halfblock; shade when printing without color)
  -g, --glyphs <name>   glyph palette, e.g. auto | ascii | lines | blocks | runes   (default: auto)
  -c, --color <name>    ${THEME_NAMES.join(" | ")} | #rrggbb   (default: phosphor; files: original)
      --yaw <deg>       start rotation around the vertical axis   (default: 30)
      --pitch <deg>     tilt toward the viewer   (default: 20)
      --zoom <factor>   (default: 1)
      --spin <deg/s>    auto-rotation speed, 0 to stop   (default: 40)
      --fps <n>         frame rate cap   (default: 30)

Oscilloscope ("wave") and wave field ("field")
      --waveform <name> ${WAVEFORM_NAMES.join(" | ")}   (default: sine)
      --frequency <n>   periods across the screen   (default: 3)
      --amplitude <n>   0 to 1.3   (default: 1)
      --scroll <n>      periods per second the trace moves   (default: 0.5)
      --lines <n>       field only: number of wave lines   (default: 12)
      --data <source>   field only: demo | cpu (live load per CPU core)   (default: demo)
      --gradient <name> field only: ${GRADIENT_NAMES.join(" | ")}   (default: synthwave)

Agents & scripts
      --once            print a single frame to stdout and exit (default when stdout is not a terminal)
      --cols <n>        width for --once   (default: terminal width or 80)
      --rows <n>        height for --once   (default: terminal height - 1 or 24)
      --plain           no colors (default when piped or NO_COLOR is set)
      --ansi            force 24-bit colors even when piped
  -w, --watch <file>    interactive viewer steered by a JSON scene file (created if missing);
                        it reports to the status file next to it, scene.json -> scene.status.json
                        (running, size, problems)
      --scene <file>    print one frame of what the viewer shows for this scene file (implies
                        --once; the scene area only, without header or caption), or exit 2
                        listing every problem in the file

Avatar
  glyphterm avatar                   start the avatar viewer (model: buddy, or any model)
  glyphterm avatar <activity>        set what it shows: ${ACTIVITY_IDS.join(", ")}, or none
      --detail <text>   with an activity: a short note shown next to it, e.g. a file name
      --hook            read a Claude Code hook event on stdin and set the matching activity
      --print-hooks     print the Claude Code settings that run --hook on every event
  The avatar's file is ${shellCommand([avatarFile()])}
  (GLYPHTERM_AVATAR or --watch choose another). error and done are short and end by themselves.

Other
      --list            list primitives, styles, glyph palettes and colors
      --json            with --list: everything as JSON, including value limits
  -h, --help

Keys
  drag / arrows / hjkl rotate · wheel / + - zoom · s style · g glyphs · c color
  m next model · space pause · [ ] spin speed · 1-7 pick style · r reset · q quit
`;

function fail(message) {
  console.error(`glyphterm: ${message}\nTry 'glyphterm --help'.`);
  process.exit(2);
}

function number(value, name, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`--${name} expects a number, got "${value}"`);
  return n;
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      style: { type: "string", short: "s" },
      glyphs: { type: "string", short: "g" },
      color: { type: "string", short: "c" },
      yaw: { type: "string" },
      pitch: { type: "string" },
      zoom: { type: "string" },
      spin: { type: "string" },
      fps: { type: "string" },
      waveform: { type: "string" },
      frequency: { type: "string" },
      amplitude: { type: "string" },
      scroll: { type: "string" },
      lines: { type: "string" },
      gradient: { type: "string" },
      data: { type: "string" },
      once: { type: "boolean" },
      cols: { type: "string" },
      rows: { type: "string" },
      plain: { type: "boolean" },
      ansi: { type: "boolean" },
      watch: { type: "string", short: "w" },
      scene: { type: "string" },
      detail: { type: "string" },
      hook: { type: "boolean" },
      "print-hooks": { type: "boolean" },
      list: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (err) {
  fail(err.message);
}

const { values: args, positionals } = parsed;

if (args.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (args.list && args.json) {
  const listing = {
    models: {
      primitives: PRIMITIVE_NAMES.filter((name) => !ANIMATED.includes(name)),
      animated: ANIMATED,
      fileExtensions: SUPPORTED_EXTENSIONS,
    },
    styles: STYLES.map(({ id, label }) => ({ id, label })),
    palettes: PALETTES,
    colors: { themes: THEME_NAMES, custom: "#rrggbb" },
    gradients: { presets: GRADIENT_NAMES, custom: "array of 2 or more #rrggbb" },
    waveforms: WAVEFORM_NAMES,
    dataSources: DATA_SOURCES,
    limits: { ...LIMITS, ...WAVE_LIMITS, lines: LINE_LIMITS },
    activities: ACTIVITY_IDS.map((id) => ({
      id,
      label: ACTIVITIES[id].label,
      ...(ACTIVITIES[id].duration && { seconds: ACTIVITIES[id].duration }),
    })),
    avatarFile: avatarFile(),
    sceneKeys: SCENE_KEYS,
    sceneSchema: SCHEMA_PATH,
  };
  process.stdout.write(JSON.stringify(listing, null, 2) + "\n");
  process.exit(0);
}

if (args.list) {
  console.log(`primitives  ${PRIMITIVE_NAMES.join(", ")}`);
  console.log(`styles      ${STYLES.map((s) => `${s.id} (${s.label})`).join(", ")}`);
  console.log(`glyphs      ${PALETTES.join(", ")}`);
  console.log(`colors      ${THEME_NAMES.join(", ")}, or any #rrggbb`);
  console.log(`files       ${SUPPORTED_EXTENSIONS.join(", ")}`);
  process.exit(0);
}

const opening = positionals[0] === "open";
if (opening) positionals.shift();

// `avatar <activity>`, `--hook` and `--print-hooks` only touch the avatar's
// file; plain `avatar` starts the viewer on it with the buddy.
const avatar = positionals[0] === "avatar";
if (avatar) {
  positionals.shift();
  const file = resolve(args.watch ?? avatarFile());
  if (args.hook) {
    // A hook must never get in the agent's way: no output, always exit 0.
    try {
      const change = hookActivity(JSON.parse(readFileSync(0, "utf8")), readActivity(file));
      if (change) writeActivity(file, change.activity, change.detail);
    } catch {
      // Malformed input or an unwritable file: the avatar just doesn't change.
    }
    process.exit(0);
  }
  if (args["print-hooks"]) {
    const command = shellCommand([process.execPath, fileURLToPath(import.meta.url), "avatar", "--hook"]);
    const target = args.watch ? ` --watch ${shellCommand([file])}` : "";
    process.stdout.write(JSON.stringify(hooksConfig(command + target), null, 2) + "\n");
    process.exit(0);
  }
  const word = positionals[0];
  if (word !== undefined && !extname(word) && !PRIMITIVE_NAMES.includes(word)) {
    if (word !== "none" && !ACTIVITY_IDS.includes(word)) {
      fail(`unknown activity "${word}" (${ACTIVITY_IDS.join(", ")}, or none)`);
    }
    try {
      writeActivity(file, word, args.detail);
    } catch (err) {
      fail(`avatar file: ${err.message}`);
    }
    process.exit(0);
  }
  if (args.detail !== undefined) fail("--detail goes with an activity, e.g. glyphterm avatar coding --detail app.js");
  positionals[0] ??= "buddy";
  if (!args.once) args.watch = file;
}
if (positionals.length > 1) fail(`expected one model, got ${positionals.length}`);
if (opening && args.once) fail("open starts the interactive viewer; it can't be combined with --once");
if (!avatar && (args.hook || args["print-hooks"] || args.detail !== undefined)) {
  fail("--hook, --print-hooks and --detail belong to glyphterm avatar");
}
if (args.scene && (opening || args.watch)) fail("--scene is for previews with --once; the viewer uses --watch");

// With --scene, the scene file decides everything it sets, the model included.
let scene = {};
if (args.scene) {
  try {
    scene = JSON.parse(readFileSync(args.scene, "utf8"));
  } catch (err) {
    fail(`scene file: ${err.message}`);
  }
  if (!isObject(scene)) fail("scene file: expected a JSON object");
}
// File paths are kept absolute, so the scene file can name them relative to itself.
const named = positionals[0] ?? "torus";
const model =
  typeof scene.model === "string"
    ? resolveSceneModel(scene.model, args.scene)
    : extname(named)
      ? resolve(named)
      : named;

const interactive = opening || (process.stdin.isTTY && process.stdout.isTTY);
const once = !opening && (args.once || args.scene !== undefined || !interactive);
const color = Boolean(args.ansi || (!args.plain && process.stdout.isTTY && !process.env.NO_COLOR));
// Files and the avatar mascot have colors of their own.
const ownColors = !PRIMITIVE_NAMES.includes(model) || POSABLE.includes(model);
// Animated models have their own best view; explicit flags still win.
const view = viewDefaultsFor(model);

const defined = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
// Precedence: explicit flags, then the scene file, then defaults.
const flags = defined({
  style: args.style,
  palette: args.glyphs,
  color: args.color,
  gradient: args.gradient,
  data: args.data,
  yaw: number(args.yaw, "yaw"),
  pitch: number(args.pitch, "pitch"),
  zoom: number(args.zoom, "zoom"),
  spin: number(args.spin, "spin"),
});
const flagWave = defined({
  waveform: args.waveform,
  frequency: number(args.frequency, "frequency"),
  amplitude: number(args.amplitude, "amplitude"),
  speed: number(args.scroll, "scroll"),
  lines: number(args.lines, "lines"),
});
const defaults = {
  style: model === "field" ? "braille" : "halfblock",
  palette: "auto",
  color: ownColors ? "original" : "phosphor",
  gradient: "synthwave",
  data: "demo",
  ...view,
  ...(avatar && { activity: "waiting" }),
};
const input = { ...defaults, ...scene, ...flags };
// A malformed scene wave is passed on as is, to be reported.
input.wave = scene.wave === undefined || isObject(scene.wave) ? { ...scene.wave, ...flagWave } : scene.wave;
// Without color, half-blocks are bare silhouettes; shaded ASCII carries the form.
if (once && !color && !args.style && ["halfblock", "quadrant"].includes(input.style)) input.style = "shade";
const { values: settings, problems } = parseSettings(input);
// Scene files are checked completely, so one run reports every mistake.
const allProblems = args.scene ? [...problems, ...unknownSceneKeys(scene)] : problems;
if (allProblems.length) fail(allProblems.join("\n  "));

const options = {
  ...settings,
  model,
  fps: clamp(number(args.fps, "fps", 30), LIMITS.fps),
  watch: args.watch,
  avatar,
};

if (opening) {
  // The arguments are valid (checked above); the new pane runs them without "open".
  const rest = process.argv.slice(2);
  rest.splice(rest.indexOf("open"), 1);
  const { ok, message } = openPane([process.execPath, fileURLToPath(import.meta.url), ...rest]);
  if (ok) console.log(`glyphterm: ${message}`);
  else console.error(`glyphterm: ${message}`);
  // 3: nothing is wrong with the request, but the user has to start the viewer.
  process.exit(ok ? 0 : 3);
}

if (once) {
  if (args.watch) fail("--watch needs an interactive terminal");
  const cols = Math.round(number(args.cols, "cols", process.stdout.columns || 80));
  const rows = Math.round(number(args.rows, "rows", process.stdout.rows ? process.stdout.rows - 1 : 24));
  if (cols < 4 || rows < 2) fail("--cols must be at least 4 and --rows at least 2");

  let loaded;
  try {
    loaded = await loadModel(model);
  } catch (err) {
    fail(err.message);
  }
  let samples = null;
  if (model === "field" && options.data === "cpu") {
    // One frame needs some history: sample for a moment, then draw it across the full width.
    const sampler = createCpuSampler({ interval: 100 }).start();
    await new Promise((done) => setTimeout(done, 2000));
    sampler.stop();
    samples = { series: sampler.series };
  }
  const { polygons, lines } = modelGeometry(loaded, {
    theme: options.theme,
    stops: options.gradient.stops,
    wave: options.wave,
    samples,
    // A still of the avatar shows its activity's pose, without the motion.
    pose: ACTIVITIES[options.activity]?.pose,
  });
  const frame = renderFrame({
    ...options,
    polygons,
    lines,
    style: findStyle(options.style),
    cols,
    rows,
    color,
    glow: Boolean(loaded.animated),
  });
  // Trailing blanks carry no information for a reader; trim them in plain mode.
  const text = color
    ? frame.join("\n")
    : frame
        .map((l) => l.trimEnd())
        .join("\n")
        .replace(/^\n+|\n+$/g, "");
  process.stdout.write(text + "\n");
} else {
  try {
    await runViewer(options);
  } catch (err) {
    process.stdout.write(term.mouseOff + term.reset + term.cursorShow + term.altScreenOff);
    fail(err.message);
  }
}
