#!/usr/bin/env node
// glyphterm: a retro 3D model viewer for the terminal.

import { parseArgs } from "node:util";
import { loadModel, PRIMITIVE_NAMES, SUPPORTED_EXTENSIONS } from "../src/models.js";
import { renderFrame, STYLES, STYLE_IDS, PALETTES, findStyle } from "../src/render.js";
import { THEME_NAMES, resolveTheme, tint } from "../src/themes.js";
import { runViewer } from "../src/viewer.js";
import { createCpuSampler } from "../src/cpu.js";
import { wavePolygons, fieldLines, dataLines, resolveGradient, WAVE_VIEW, FIELD_VIEW, WAVEFORM_NAMES, GRADIENT_NAMES } from "../src/wave.js";

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
// Without color, half-blocks are bare silhouettes; shaded ASCII carries the form.
args.style ??= positionals[0] === "field" ? "braille" : once && !color ? "shade" : "halfblock";

if (!findStyle(args.style)) fail(`unknown style "${args.style}" (${STYLE_IDS.join(", ")})`);
if (!PALETTES.includes(args.glyphs)) fail(`unknown glyph palette "${args.glyphs}" (${PALETTES.join(", ")})`);

const isFile = !PRIMITIVE_NAMES.includes(model);
const colorName = args.color ?? (isFile ? "original" : "phosphor");
const theme = resolveTheme(colorName);
if (!theme) fail(`unknown color "${colorName}" (${THEME_NAMES.join(", ")}, or #rrggbb)`);

if (args.waveform !== undefined && !WAVEFORM_NAMES.includes(args.waveform)) {
  fail(`unknown waveform "${args.waveform}" (${WAVEFORM_NAMES.join(", ")})`);
}
if (args.data !== undefined && !["demo", "cpu"].includes(args.data)) fail(`unknown data "${args.data}" (demo, cpu)`);
if (args.gradient !== undefined && !resolveGradient(args.gradient)) {
  fail(`unknown gradient "${args.gradient}" (${GRADIENT_NAMES.join(", ")})`);
}
// Animated models have their own best view; explicit flags still win.
const viewDefaults = { wave: WAVE_VIEW, field: FIELD_VIEW }[model] ?? { yaw: 30, pitch: 20, zoom: 1, spin: 40 };

const options = {
  model,
  style: args.style,
  palette: args.glyphs,
  color: theme.name,
  yaw: number(args.yaw, "yaw", viewDefaults.yaw),
  pitch: Math.max(-89, Math.min(89, number(args.pitch, "pitch", viewDefaults.pitch))),
  zoom: Math.max(0.2, Math.min(8, number(args.zoom, "zoom", viewDefaults.zoom))),
  spin: number(args.spin, "spin", viewDefaults.spin),
  fps: Math.max(1, Math.min(120, number(args.fps, "fps", 30))),
  watch: args.watch,
  gradient: args.gradient,
  data: args.data,
  wave: Object.fromEntries(
    Object.entries({
      waveform: args.waveform,
      frequency: number(args.frequency, "frequency"),
      amplitude: number(args.amplitude, "amplitude"),
      speed: number(args.scroll, "scroll"),
      lines: number(args.lines, "lines"),
    }).filter(([, v]) => v !== undefined),
  ),
};

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
  let polygons = [];
  let lines = null;
  const stops = resolveGradient(args.gradient ?? "synthwave").stops;
  if (model === "field" && args.data === "cpu") {
    // One frame needs some history: sample for a moment, then draw it across the full width.
    const sampler = createCpuSampler({ interval: 100 }).start();
    await new Promise((done) => setTimeout(done, 2000));
    sampler.stop();
    const names = sampler.series.map((_, i) => `cpu${i}`);
    lines = dataLines({ series: sampler.series, names, stops, amplitude: options.wave.amplitude ?? 1 });
  } else if (model === "field") lines = fieldLines({ ...options.wave, stops });
  else if (model === "wave") polygons = wavePolygons({ ...options.wave, color: theme.color ?? "#33ff66" });
  else polygons = tint(loaded.polygons, theme.color ?? (isFile ? null : "#e8e4d8"));
  const frame = renderFrame({ ...options, polygons, lines, style: findStyle(options.style), cols, rows, color, glow: Boolean(loaded.animated) });
  // Trailing blanks carry no information for a reader; trim them in plain mode.
  const text = color ? frame.join("\n") : frame.map((l) => l.trimEnd()).join("\n").replace(/^\n+|\n+$/g, "");
  process.stdout.write(text + "\n");
} else {
  try {
    await runViewer(options);
  } catch (err) {
    process.stdout.write("\x1b[?1002l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l");
    fail(err.message);
  }
}
