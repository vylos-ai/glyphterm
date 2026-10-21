// Interactive full-screen viewer: render loop, HUD, keyboard/mouse input and
// an optional watched scene file that other programs (e.g. AI agents) can
// write to steer the view.

import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { term, fg, bg, visibleLength } from "./ansi.js";
import { loadModel, PRIMITIVE_NAMES, isPrimitive } from "./models.js";
import { renderFrame, STYLES, PALETTES, findStyle } from "./render.js";
import { THEME_NAMES, resolveTheme, tint } from "./themes.js";
import { createCpuSampler } from "./cpu.js";
import {
  wavePolygons,
  fieldLines,
  dataLines,
  clampField,
  defaultsFor,
  WAVEFORM_NAMES,
  GRADIENT_NAMES,
  resolveGradient,
} from "./wave.js";

const HEADER_BG = "#141414";
const DIM = "#7a7a7a";
const ERROR = "#ff5555";

export async function runViewer(options) {
  const out = process.stdout;
  const sources = isPrimitive(options.model) ? PRIMITIVE_NAMES : [options.model, ...PRIMITIVE_NAMES];

  const initial = {
    yaw: options.yaw,
    pitch: options.pitch,
    zoom: options.zoom,
    spin: options.spin,
  };
  const state = {
    sourceIdx: sources.indexOf(options.model),
    source: options.model,
    model: null,
    polygons: [],
    lines: null,
    styleIdx: STYLES.indexOf(findStyle(options.style)),
    paletteIdx: PALETTES.indexOf(options.palette),
    theme: resolveTheme(options.color),
    ...initial,
    paused: false,
    time: 0,
    // Shared by the "wave" and "field" models; `lines` only matters for the field.
    wave: clampField({ ...defaultsFor(options.model), ...options.wave }),
    gradient: resolveGradient(options.gradient ?? "synthwave"),
    // What the field shows: "demo" signals or live "cpu" load per core.
    data: options.data ?? "demo",
    caption: "",
    message: "",
    messageIsError: false,
    fps: 0,
    drag: null,
  };

  function flash(message, isError = false) {
    state.message = message;
    state.messageIsError = isError;
  }

  let loadToken = 0;
  async function setModel(source) {
    const token = ++loadToken;
    try {
      const model = await loadModel(source);
      if (token !== loadToken) return;
      state.source = source;
      state.model = model;
      applyColors();
      if (model.warnings.length) flash(model.warnings[0]);
    } catch (err) {
      flash(err.message, true);
    }
  }

  function applyColors() {
    if (!state.model) return;
    if (state.model.animated) return animate();
    state.lines = null;
    // Primitives have no colors of their own; "original" shows them in paper white.
    const color = state.theme.color ?? (isPrimitive(state.source) ? "#e8e4d8" : null);
    state.polygons = tint(state.model.polygons, color);
  }

  // Animated models are rebuilt from the clock. The scope trace takes the
  // theme color; the field takes its own gradient.
  let sampler = null;

  // The CPU sampler only runs while the field shows CPU data.
  function syncSampler() {
    const wanted = state.source === "field" && state.data === "cpu";
    if (wanted && !sampler) sampler = createCpuSampler().start();
    if (!wanted && sampler) {
      sampler.stop();
      sampler = null;
    }
  }

  function animate() {
    syncSampler();
    if (state.source === "field") {
      state.polygons = [];
      state.lines = sampler
        ? dataLines({
            series: sampler.series,
            names: sampler.series.map((_, i) => `cpu${i}`),
            history: sampler.history,
            // Freezing stops the scroll; sampling continues in the background.
            progress: state.paused ? 0 : sampler.progress(),
            stops: state.gradient.stops,
            amplitude: state.wave.amplitude,
          })
        : fieldLines({ time: state.time, stops: state.gradient.stops, ...state.wave });
    } else {
      state.lines = null;
      state.polygons = wavePolygons({ time: state.time, color: state.theme.color ?? "#33ff66", ...state.wave });
    }
  }

  const isWave = () => Boolean(state.model?.animated);
  const isField = () => state.source === "field" && isWave();

  const cycle = (length, idx, step) => (idx + step + length) % length;

  // --- Scene file (agent interface) ------------------------------------

  const watchPath = options.watch ? resolve(options.watch) : null;

  function sceneSnapshot() {
    return {
      model: state.source,
      style: STYLES[state.styleIdx].id,
      palette: PALETTES[state.paletteIdx],
      color: state.theme.name,
      yaw: Math.round(((state.yaw % 360) + 360) % 360),
      pitch: Math.round(state.pitch),
      zoom: Number(state.zoom.toFixed(2)),
      spin: state.spin,
      paused: state.paused,
      caption: state.caption,
      ...(isWave() && { wave: { ...state.wave } }),
      ...(isField() && {
        gradient: state.gradient.name === "custom" ? state.gradient.stops : state.gradient.name,
        data: state.data,
      }),
    };
  }

  async function applyScene() {
    let scene;
    try {
      scene = JSON.parse(readFileSync(watchPath, "utf8"));
    } catch (err) {
      flash(`scene file: ${err.message}`, true);
      return;
    }
    const problems = [];
    if (typeof scene.style === "string") {
      const style = findStyle(scene.style);
      if (style) state.styleIdx = STYLES.indexOf(style);
      else problems.push(`unknown style "${scene.style}"`);
    }
    if (typeof scene.palette === "string") {
      if (PALETTES.includes(scene.palette)) state.paletteIdx = PALETTES.indexOf(scene.palette);
      else problems.push(`unknown palette "${scene.palette}"`);
    }
    if (typeof scene.color === "string") {
      const theme = resolveTheme(scene.color);
      if (theme) state.theme = theme;
      else problems.push(`unknown color "${scene.color}"`);
    }
    for (const key of ["yaw", "pitch", "zoom", "spin"]) {
      if (Number.isFinite(scene[key])) state[key] = scene[key];
    }
    state.pitch = clampPitch(state.pitch);
    state.zoom = clampZoom(state.zoom);
    if (typeof scene.paused === "boolean") state.paused = scene.paused;
    if (typeof scene.caption === "string") state.caption = scene.caption;
    if (scene.wave && typeof scene.wave === "object") {
      const { waveform, ...numbers } = scene.wave;
      if (typeof waveform === "string") {
        if (WAVEFORM_NAMES.includes(waveform)) state.wave.waveform = waveform;
        else problems.push(`unknown waveform "${waveform}" (${WAVEFORM_NAMES.join(", ")})`);
      }
      for (const key of ["frequency", "amplitude", "speed", "lines"]) {
        if (Number.isFinite(numbers[key])) state.wave[key] = numbers[key];
      }
      state.wave = clampField(state.wave);
    }
    if (typeof scene.data === "string") {
      if (["demo", "cpu"].includes(scene.data)) state.data = scene.data;
      else problems.push(`unknown data "${scene.data}" (demo, cpu)`);
    }
    if (scene.gradient !== undefined) {
      const gradient = resolveGradient(scene.gradient);
      if (gradient) state.gradient = gradient;
      else problems.push(`unknown gradient (${GRADIENT_NAMES.join(", ")}, or a list of #rrggbb)`);
    }
    if (problems.length) flash(`scene file: ${problems.join(", ")}`, true);
    else flash("scene updated");

    if (typeof scene.model === "string" && scene.model !== state.source) {
      const source =
        isPrimitive(scene.model) || isAbsolute(scene.model) ? scene.model : resolve(dirname(watchPath), scene.model);
      await setModel(source);
    } else {
      applyColors();
    }
  }

  // --- Drawing ---------------------------------------------------------

  function bar(segments, cols, background) {
    // segments: [text, color]; truncated to fit, padded with the bar background.
    let line = bg(background);
    let used = 0;
    for (const [text, color] of segments) {
      if (used >= cols) break;
      const chars = [...text].slice(0, cols - used);
      line += fg(color) + chars.join("");
      used += chars.length;
    }
    return line + " ".repeat(Math.max(0, cols - used)) + term.reset;
  }

  function header(cols) {
    const accent = state.theme.color ?? "#e8e4d8";
    const style = STYLES[state.styleIdx];
    const info = [
      state.model?.name ?? "loading…",
      style.label,
      `glyphs:${PALETTES[state.paletteIdx]}`,
      isField() ? `gradient:${state.gradient.name}` : state.theme.name,
      ...(isWave()
        ? sampler
          ? [
              `cpu · ${sampler.series.length} cores · avg ${Math.round(sampler.average() * 100)}%`,
              state.paused ? "frozen" : "live",
            ]
          : [
              `${isField() ? `${state.wave.lines} lines · ` : ""}${state.wave.waveform} ×${state.wave.frequency}`,
              state.paused ? "frozen" : `scroll ${state.wave.speed}/s`,
            ]
        : [state.paused ? "paused" : `spin ${state.spin}°/s`]),
    ].join(" · ");
    const right = `${Math.round(state.fps)} fps `;
    const left = ` ${info} `;
    const title = " ▓▒░ GLYPHTERM ░▒▓ ";
    const gap = Math.max(1, cols - title.length - left.length - right.length);
    return bar(
      [
        [title, accent],
        [left, "#d0d0d0"],
        [" ".repeat(gap), DIM],
        [right, DIM],
      ],
      cols,
      HEADER_BG,
    );
  }

  function footer(cols) {
    if (state.message) {
      return bar(
        [[` ${state.message}`, state.messageIsError ? ERROR : (state.theme.color ?? "#e8e4d8")]],
        cols,
        HEADER_BG,
      );
    }
    const hints = sampler
      ? "d demo data · c gradient · ; ' height · space freeze · drag rotate · +- zoom · m model · q quit"
      : isField()
        ? "d cpu data · c gradient · w waveform · , . frequency · ; ' amplitude · { } lines · [ ] scroll · space freeze · drag rotate · m model · q quit"
        : isWave()
          ? "w waveform · , . frequency · ; ' amplitude · [ ] scroll · space freeze · drag rotate · c color · m model · q quit"
          : "drag/←↑↓→ rotate · wheel/+- zoom · s style · g glyphs · c color · m model · space pause · [ ] speed · r reset · q quit";
    return bar([[` ${hints}`, DIM]], cols, HEADER_BG);
  }

  function draw() {
    const cols = out.columns || 80;
    const rows = out.rows || 24;
    const captionRows = state.caption ? 1 : 0;
    const sceneRows = Math.max(1, rows - 2 - captionRows);

    let lines = [];
    if (state.polygons.length || state.lines) {
      try {
        lines = renderFrame({
          polygons: state.polygons,
          lines: state.lines,
          style: STYLES[state.styleIdx],
          palette: PALETTES[state.paletteIdx],
          yaw: state.yaw,
          pitch: state.pitch,
          zoom: state.zoom,
          glow: isWave(),
          cols,
          rows: sceneRows,
        });
      } catch (err) {
        flash(`render failed: ${err.message}`, true);
      }
    }

    let frame = term.syncStart + term.moveTo(1, 1) + header(cols);
    for (let r = 0; r < sceneRows; r++) {
      const line = lines[r] ?? "";
      frame += term.moveTo(r + 2, 1) + line + term.reset + (visibleLength(line) < cols ? term.clearToEol : "");
    }
    if (captionRows) {
      const text = [...` » ${state.caption}`].slice(0, cols).join("");
      frame += term.moveTo(rows - 1, 1) + fg(state.theme.color ?? "#e8e4d8") + text + term.reset + term.clearToEol;
    }
    frame += term.moveTo(rows, 1) + footer(cols) + term.syncEnd;
    out.write(frame);
  }

  // --- Input -----------------------------------------------------------

  const clampPitch = (p) => Math.max(-89, Math.min(89, p));
  const clampZoom = (z) => Math.max(0.2, Math.min(8, z));

  function onKey(key) {
    state.message = "";
    switch (key) {
      case "q":
      case "Q":
      case "\x03":
      case "\x1b":
        return quit();
      case "\x1b[D":
      case "\x1bOD":
      case "h":
        state.yaw -= 10;
        break;
      case "\x1b[C":
      case "\x1bOC":
      case "l":
        state.yaw += 10;
        break;
      case "\x1b[A":
      case "\x1bOA":
      case "k":
        state.pitch = clampPitch(state.pitch + 5);
        break;
      case "\x1b[B":
      case "\x1bOB":
      case "j":
        state.pitch = clampPitch(state.pitch - 5);
        break;
      case "+":
      case "=":
        state.zoom = clampZoom(state.zoom * 1.1);
        break;
      case "-":
      case "_":
        state.zoom = clampZoom(state.zoom / 1.1);
        break;
      case "s":
      case "S":
        state.styleIdx = cycle(STYLES.length, state.styleIdx, key === "s" ? 1 : -1);
        break;
      case "g":
      case "G":
        state.paletteIdx = cycle(PALETTES.length, state.paletteIdx, key === "g" ? 1 : -1);
        break;
      case "c":
      case "C": {
        if (isField()) {
          const next = cycle(GRADIENT_NAMES.length, GRADIENT_NAMES.indexOf(state.gradient.name), key === "c" ? 1 : -1);
          state.gradient = resolveGradient(GRADIENT_NAMES[next]);
          break;
        }
        const idx = THEME_NAMES.indexOf(state.theme.name);
        state.theme = resolveTheme(THEME_NAMES[cycle(THEME_NAMES.length, Math.max(0, idx), key === "c" ? 1 : -1)]);
        applyColors();
        break;
      }
      case "m":
      case "M":
        state.sourceIdx = cycle(sources.length, state.sourceIdx, key === "m" ? 1 : -1);
        setModel(sources[state.sourceIdx]);
        break;
      case " ":
        state.paused = !state.paused;
        break;
      case "]":
      case "[": {
        const step = key === "]" ? 1 : -1;
        if (isWave())
          state.wave = clampField({ ...state.wave, speed: Number((state.wave.speed + step * 0.25).toFixed(2)) });
        else state.spin = Math.max(-720, Math.min(720, state.spin + step * 10));
        break;
      }
      case "w":
      case "W":
        state.wave.waveform =
          WAVEFORM_NAMES[
            cycle(WAVEFORM_NAMES.length, WAVEFORM_NAMES.indexOf(state.wave.waveform), key === "w" ? 1 : -1)
          ];
        break;
      case "d":
      case "D":
        if (isField()) state.data = state.data === "cpu" ? "demo" : "cpu";
        break;
      case "{":
      case "}":
        state.wave = clampField({ ...state.wave, lines: state.wave.lines + (key === "}" ? 1 : -1) });
        break;
      case ",":
      case ".":
        state.wave = clampField({ ...state.wave, frequency: state.wave.frequency + (key === "." ? 0.5 : -0.5) });
        break;
      case ";":
      case "'":
        state.wave = clampField({
          ...state.wave,
          amplitude: Number((state.wave.amplitude + (key === "'" ? 0.1 : -0.1)).toFixed(2)),
        });
        break;
      case "r":
      case "R":
        Object.assign(state, initial, {
          paused: false,
          wave: clampField({ ...defaultsFor(options.model), ...options.wave }),
        });
        break;
      default:
        if (key >= "1" && key <= String(STYLES.length)) state.styleIdx = Number(key) - 1;
        else return;
    }
    if (watchPath) writeScene();
  }

  function onMouse(button, col, row, released) {
    if (button === 64 || button === 65) {
      state.zoom = clampZoom(state.zoom * (button === 64 ? 1.1 : 1 / 1.1));
    } else if (released) {
      state.drag = null;
    } else if (button === 0) {
      state.drag = { col, row };
    } else if (button === 32 && state.drag) {
      state.yaw += (col - state.drag.col) * 4;
      state.pitch = clampPitch(state.pitch + (row - state.drag.row) * 6);
      state.drag = { col, row };
    }
  }

  const TOKEN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])|\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/g;
  function onData(data) {
    for (const [token, button, col, row, kind] of data.toString("utf8").matchAll(TOKEN)) {
      if (button !== undefined) onMouse(Number(button), Number(col), Number(row), kind === "m");
      else onKey(token);
    }
  }

  // Keystrokes are mirrored into the scene file so an agent always reads the
  // current view. Our own writes are ignored by the watcher via `lastWritten`.
  let lastWritten = "";
  function writeScene() {
    lastWritten = JSON.stringify(sceneSnapshot(), null, 2) + "\n";
    try {
      writeFileSync(watchPath, lastWritten);
    } catch (err) {
      flash(`scene file: ${err.message}`, true);
    }
  }

  // --- Lifecycle -------------------------------------------------------

  let timer = null;
  let running = true;
  let finish;
  const finished = new Promise((resolve) => (finish = resolve));

  function restoreTerminal() {
    out.write(term.mouseOff + term.reset + term.cursorShow + term.altScreenOff);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  function quit() {
    if (!running) return;
    running = false;
    clearTimeout(timer);
    sampler?.stop();
    if (watchPath) unwatchFile(watchPath);
    process.stdin.off("data", onData);
    process.stdin.pause();
    restoreTerminal();
    finish();
  }

  process.once("exit", () => running && restoreTerminal());
  process.on("SIGTERM", () => {
    quit();
    process.exit(0);
  });

  out.write(term.altScreenOn + term.cursorHide + term.clear + term.mouseOn);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);
  out.on("resize", () => out.write(term.clear));

  await setModel(options.model);

  if (watchPath) {
    if (existsSync(watchPath)) {
      lastWritten = readFileSync(watchPath, "utf8");
      await applyScene();
    } else {
      writeScene();
      flash(`created scene file ${options.watch}`);
    }
    watchFile(watchPath, { interval: 200 }, () => {
      let text;
      try {
        text = readFileSync(watchPath, "utf8");
      } catch {
        return;
      }
      if (text !== lastWritten) {
        lastWritten = text;
        applyScene();
      }
    });
  }

  const frameMs = 1000 / options.fps;
  let last = performance.now();
  function tick() {
    if (!running) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    if (!state.paused && !state.drag) state.yaw += state.spin * dt;
    if (!state.paused) state.time += dt;
    if (isWave()) animate();
    state.fps = state.fps ? state.fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1 : options.fps;
    draw();
    timer = setTimeout(tick, Math.max(0, frameMs - (performance.now() - now)));
  }
  tick();
  return finished;
}
