// Interactive full-screen viewer: terminal setup, the render loop, model
// loading and the optional watched scene file that other programs (e.g. AI
// agents) write to steer the view.

import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";
import { term } from "./ansi.js";
import { loadModel } from "./models.js";
import { renderFrame, findStyle } from "./render.js";
import { createCpuSampler } from "./cpu.js";
import { modelGeometry } from "./geometry.js";
import { createState, isAnimated, flash } from "./state.js";
import { sceneSnapshot, applyScene, sceneModel } from "./scene.js";
import { parseInput, handleKey, handleMouse } from "./input.js";
import { composeFrame, sceneRows } from "./hud.js";

export async function runViewer(options) {
  const out = process.stdout;
  const state = createState(options);

  let loadToken = 0;
  async function setModel(source) {
    const token = ++loadToken;
    try {
      const model = await loadModel(source);
      if (token !== loadToken) return;
      state.source = source;
      state.model = model;
      refreshGeometry();
      if (model.warnings.length) flash(state, model.warnings[0]);
    } catch (err) {
      flash(state, err.message, true);
    }
  }

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

  // Static models only change with the color; animated ones every frame.
  function refreshGeometry() {
    if (!state.model) return;
    syncSampler();
    const samples = sampler && {
      series: sampler.series,
      history: sampler.history,
      // Freezing stops the scroll; sampling continues in the background.
      progress: state.paused ? 0 : sampler.progress(),
    };
    Object.assign(
      state,
      modelGeometry(state.model, {
        theme: state.theme,
        stops: state.gradient.stops,
        wave: state.wave,
        time: state.time,
        samples,
      }),
    );
  }

  // --- Scene file (agent interface) ------------------------------------

  const watchPath = options.watch ? resolve(options.watch) : null;

  async function loadScene() {
    let scene;
    try {
      scene = JSON.parse(readFileSync(watchPath, "utf8"));
    } catch (err) {
      flash(state, `scene file: ${err.message}`, true);
      return;
    }
    const problems = applyScene(state, scene);
    if (problems.length) flash(state, `scene file: ${problems.join(", ")}`, true);
    else flash(state, "scene updated");

    const source = sceneModel(state, scene, watchPath);
    if (source) await setModel(source);
    else refreshGeometry();
  }

  // Keystrokes are mirrored into the scene file so an agent always reads the
  // current view. Our own writes are ignored by the watcher via `lastWritten`.
  let lastWritten = "";
  function writeScene() {
    lastWritten = JSON.stringify(sceneSnapshot(state), null, 2) + "\n";
    try {
      writeFileSync(watchPath, lastWritten);
    } catch (err) {
      flash(state, `scene file: ${err.message}`, true);
    }
  }

  // --- Input -----------------------------------------------------------

  function onData(data) {
    for (const event of parseInput(data.toString("utf8"))) {
      if (event.mouse) {
        handleMouse(state, event.mouse);
        continue;
      }
      const effect = handleKey(state, event.key, options);
      if (effect === "quit") return quit();
      if (effect === "model") setModel(state.sources[state.sourceIdx]);
      if (effect === "colors") refreshGeometry();
      if (effect && watchPath) writeScene();
    }
  }

  // --- Drawing ---------------------------------------------------------

  function draw() {
    const cols = out.columns || 80;
    const rows = out.rows || 24;
    let scene = [];
    if (state.polygons.length || state.lines) {
      try {
        scene = renderFrame({
          polygons: state.polygons,
          lines: state.lines,
          style: findStyle(state.style),
          palette: state.palette,
          yaw: state.yaw,
          pitch: state.pitch,
          zoom: state.zoom,
          glow: isAnimated(state),
          cols,
          rows: sceneRows(state, rows),
        });
      } catch (err) {
        flash(state, `render failed: ${err.message}`, true);
      }
    }
    out.write(composeFrame(state, scene, cols, rows, sampler));
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
      await loadScene();
    } else {
      writeScene();
      flash(state, `created scene file ${options.watch}`);
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
        loadScene();
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
    if (isAnimated(state)) refreshGeometry();
    state.fps = state.fps ? state.fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1 : options.fps;
    draw();
    timer = setTimeout(tick, Math.max(0, frameMs - (performance.now() - now)));
  }
  tick();
  return finished;
}
