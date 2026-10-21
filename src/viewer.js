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
import { sceneSnapshot, sceneModelName, applyScene, sceneModel, statusPath } from "./scene.js";
import { parseInput, handleKey, handleMouse } from "./input.js";
import { composeFrame, sceneRows } from "./hud.js";
import { activityMotion, avatarLook, smoothMotion } from "./avatar.js";
import { withSignals } from "./signals.js";

export async function runViewer(options) {
  const out = process.stdout;
  const state = createState(options);

  let loadToken = 0;
  /** Returns an error message if the model failed to load. */
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
      return err.message;
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

  // Static models only change with the color; animated and posable ones every frame.
  function refreshGeometry() {
    if (!state.model) return;
    syncSampler();
    const samples = sampler && {
      series: sampler.series,
      history: sampler.history,
      // Freezing stops the scroll; sampling continues in the background.
      progress: state.paused ? 0 : sampler.progress(),
    };
    const geometry = modelGeometry(state.model, {
      theme: state.theme,
      stops: state.gradient.stops,
      wave: state.wave,
      time: state.time,
      samples,
      look: state.model.posable ? avatarLook(state) : undefined,
    });
    // Avatars also show the session's tool calls and subagents.
    Object.assign(state, state.model.posable ? withSignals(geometry, state.signals, state.time) : geometry);
  }

  // --- Scene file (agent interface) ------------------------------------

  const watchPath = options.watch ? resolve(options.watch) : null;

  async function loadScene() {
    let scene;
    try {
      scene = JSON.parse(readFileSync(watchPath, "utf8"));
    } catch (err) {
      flash(state, `scene file: ${err.message}`, true);
      return writeStatus([`scene file: ${err.message}`]);
    }
    const problems = applyScene(state, scene);
    if (problems.length) flash(state, `scene file: ${problems.join(", ")}`, true);
    // The avatar changes all the time; its caption line says what's new.
    else if (!options.avatar) flash(state, "scene updated");

    const source = sceneModel(state, scene, watchPath);
    const loadError = source ? await setModel(source) : refreshGeometry();
    writeStatus(loadError ? [...problems, loadError] : problems);
  }

  // The status file tells whoever edits the scene whether the viewer runs,
  // what it shows, at which size, and what was wrong with the last edit.
  let lastProblems = [];
  function writeStatus(problems = lastProblems, running = true) {
    lastProblems = problems;
    const status = {
      running,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
      model: sceneModelName(state.source, watchPath),
      problems,
      // The scene area, for previews with --once --cols --rows.
      size: { cols: out.columns || 80, rows: sceneRows(state, out.rows || 24) },
    };
    try {
      writeFileSync(statusPath(watchPath), JSON.stringify(status, null, 2) + "\n");
    } catch {
      // A read-only folder only costs the status; the footer still shows problems.
    }
  }

  // Keystrokes are mirrored into the scene file so an agent always reads the
  // current view. Our own writes are ignored by the watcher via `lastWritten`.
  let lastWritten = "";
  function writeScene() {
    // What the file says now is the activity that runs (a short one may have ended).
    state.sceneActivity = state.activity;
    lastWritten = JSON.stringify(sceneSnapshot(state, watchPath), null, 2) + "\n";
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
      if (effect === "model") {
        // The scene file names the new model once it has loaded; written
        // earlier, the next reload of the file would switch back.
        setModel(state.sources[state.sourceIdx]).then(() => {
          if (!watchPath) return;
          writeScene();
          writeStatus();
        });
        continue;
      }
      if (effect === "colors") refreshGeometry();
      if (effect && watchPath) writeScene();
    }
  }

  // --- Drawing ---------------------------------------------------------

  function draw() {
    const cols = out.columns || 80;
    const rows = out.rows || 24;
    let scene = [];
    if (state.polygons.length || state.lines || state.points) {
      try {
        scene = renderFrame({
          polygons: state.polygons,
          lines: state.lines,
          style: findStyle(state.style),
          palette: state.palette,
          yaw: state.yaw + (state.motion?.yaw ?? 0),
          pitch: state.pitch + (state.motion?.pitch ?? 0),
          zoom: state.zoom,
          motion: state.motion,
          underlay: state.underlay,
          points: state.points,
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
    if (watchPath) {
      unwatchFile(watchPath);
      writeStatus(lastProblems, false);
    }
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
  out.on("resize", () => {
    out.write(term.clear);
    if (watchPath) writeStatus();
  });

  await setModel(options.model);

  if (watchPath) {
    if (existsSync(watchPath)) {
      lastWritten = readFileSync(watchPath, "utf8");
      await loadScene();
    } else {
      writeScene();
      if (!options.avatar) flash(state, `created scene file ${options.watch}`);
      writeStatus([]);
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
    state.motion = smoothMotion(state.motion, activityMotion(state), dt);
    if (isAnimated(state) || state.model?.posable) refreshGeometry();
    state.fps = state.fps ? state.fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1 : options.fps;
    draw();
    timer = setTimeout(tick, Math.max(0, frameMs - (performance.now() - now)));
  }
  tick();
  return finished;
}
