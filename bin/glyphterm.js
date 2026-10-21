#!/usr/bin/env node
// glyphterm: a retro 3D model viewer for the terminal.

import { parseArgs } from "node:util";
import { loadModel, PRIMITIVE_NAMES, SUPPORTED_EXTENSIONS } from "../src/models.js";
import { renderFrame, STYLES, STYLE_IDS, PALETTES, findStyle } from "../src/render.js";
import { THEME_NAMES } from "../src/themes.js";
import { term } from "../src/ansi.js";
import { runViewer } from "../src/viewer.js";
import { createCpuSampler } from "../src/cpu.js";
import { modelGeometry } from "../src/geometry.js";
import { parseSettings, viewDefaultsFor, clamp, LIMITS } from "../src/settings.js";
import { WAVEFORM_NAMES, GRADIENT_NAMES } from "../src/wave.js";

const HELP = `glyphterm: spin 3D models in your terminal, drawn with text.

Usage
  glyphterm [model] [options]

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
  -w, --watch <file>    interactive viewer steered by a JSON scene file (created if missing)

Other
      --list            list primitives, styles, glyph palettes and colors
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
      glyphs: { type: "string", short: "g", default: "auto" },
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
      list: { type: "boolean" },
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

if (args.list) {
  console.log(`primitives  ${PRIMITIVE_NAMES.join(", ")}`);
  console.log(`styles      ${STYLES.map((s) => `${s.id} (${s.label})`).join(", ")}`);
  console.log(`glyphs      ${PALETTES.join(", ")}`);
  console.log(`colors      ${THEME_NAMES.join(", ")}, or any #rrggbb`);
  console.log(`files       ${SUPPORTED_EXTENSIONS.join(", ")}`);
  process.exit(0);
}

if (positionals.length > 1) fail(`expected one model, got ${positionals.length}`);
const model = positionals[0] ?? "torus";

const interactive = process.stdin.isTTY && process.stdout.isTTY;
const once = args.once || !interactive;
const color = Boolean(args.ansi || (!args.plain && process.stdout.isTTY && !process.env.NO_COLOR));
const isFile = !PRIMITIVE_NAMES.includes(model);
// Animated models have their own best view; explicit flags still win.
const view = viewDefaultsFor(model);

const { values: settings, problems } = parseSettings({
  // Without color, half-blocks are bare silhouettes; shaded ASCII carries the form.
  style: args.style ?? (model === "field" ? "braille" : once && !color ? "shade" : "halfblock"),
  palette: args.glyphs,
  color: args.color ?? (isFile ? "original" : "phosphor"),
  gradient: args.gradient ?? "synthwave",
  data: args.data ?? "demo",
  yaw: number(args.yaw, "yaw", view.yaw),
  pitch: number(args.pitch, "pitch", view.pitch),
  zoom: number(args.zoom, "zoom", view.zoom),
  spin: number(args.spin, "spin", view.spin),
  wave: {
    waveform: args.waveform,
    frequency: number(args.frequency, "frequency"),
    amplitude: number(args.amplitude, "amplitude"),
    speed: number(args.scroll, "scroll"),
    lines: number(args.lines, "lines"),
  },
});
if (problems.length) fail(problems[0]);

const options = { ...settings, model, fps: clamp(number(args.fps, "fps", 30), LIMITS.fps), watch: args.watch };

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
