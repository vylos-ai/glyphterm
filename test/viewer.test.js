// The interactive viewer's parts, tested without a terminal: settings,
// input handling, the scene file mapping and the HUD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleLength } from "../src/ansi.js";
import { loadModel, PRIMITIVE_NAMES } from "../src/models.js";
import { STYLE_IDS, renderFrame, findStyle } from "../src/render.js";
import { parseSettings, viewDefaultsFor } from "../src/settings.js";
import { createState } from "../src/state.js";
import { parseInput, handleKey, handleMouse } from "../src/input.js";
import { sceneSnapshot, applyScene, sceneModel } from "../src/scene.js";
import { header, footer, composeFrame } from "../src/hud.js";
import { avatarGeometry, avatarLook } from "../src/avatar.js";

/** Viewer options as the CLI builds them, for `model` with its default view. */
function optionsFor(model) {
  const { values } = parseSettings({
    style: "halfblock",
    palette: "auto",
    color: "phosphor",
    gradient: "synthwave",
    data: "demo",
    ...viewDefaultsFor(model),
  });
  return { ...values, model, fps: 30 };
}

async function stateFor(model = "torus") {
  const options = optionsFor(model);
  const state = createState(options);
  state.model = await loadModel(model);
  return { state, options };
}

test("settings: valid values are resolved and clamped", () => {
  const { values, problems } = parseSettings({
    style: "wire",
    color: "#ABCDEF",
    gradient: ["#000000", "#ffffff"],
    pitch: 200,
    zoom: 0.01,
    wave: { waveform: "saw", lines: 5 },
  });
  assert.deepEqual(problems, []);
  assert.equal(values.style, "wire");
  assert.deepEqual(values.theme, { name: "#abcdef", color: "#abcdef" });
  assert.equal(values.gradient.name, "custom");
  assert.equal(values.pitch, 89);
  assert.equal(values.zoom, 0.2);
  assert.deepEqual(values.wave, { waveform: "saw", lines: 5 });
});

test("settings: invalid values and wrong types are reported with the valid choices", () => {
  const { values, problems } = parseSettings({
    style: "nope",
    color: "chartreuse",
    data: "disk",
    gradient: 7,
    wave: { waveform: "noise", lines: "5" },
    yaw: "45",
    paused: null,
    extra: true,
  });
  assert.deepEqual(values, { wave: {} });
  assert.equal(problems.length, 8);
  assert.match(problems[0], /unknown style "nope" \(shade, halfblock/);
  assert.ok(problems.some((p) => p.startsWith("unknown gradient (synthwave")));
  assert.ok(problems.includes('yaw must be a number, got "45"'));
  assert.ok(problems.includes("paused must be a boolean, got null"));
  assert.ok(problems.includes('wave.lines must be a number, got "5"'));
  assert.deepEqual(parseSettings({ wave: null }).problems, ["wave must be an object, got null"]);
});

test("input: raw bytes split into keys, arrow keys and mouse reports", () => {
  assert.deepEqual(parseInput("a\x1b[D\x1bOA\x1b[<32;10;5Mq"), [
    { key: "a" },
    { key: "\x1b[D" },
    { key: "\x1bOA" },
    { mouse: { button: 32, col: 10, row: 5, released: false } },
    { key: "q" },
  ]);
});

test("input: keys change the state and report the effect", async () => {
  const { state, options } = await stateFor("torus");
  state.message = "old";
  assert.equal(handleKey(state, "x", options), null, "unbound key");
  assert.equal(state.message, "", "any key clears the message");

  assert.equal(handleKey(state, "s", options), "changed");
  assert.equal(state.style, "quadrant");
  handleKey(state, "S", options);
  handleKey(state, "S", options);
  assert.equal(state.style, "shade");
  handleKey(state, "S", options);
  assert.equal(state.style, STYLE_IDS.at(-1), "wraps around");
  handleKey(state, "1", options);
  assert.equal(state.style, STYLE_IDS[0]);

  assert.equal(handleKey(state, "c", options), "colors");
  assert.equal(state.theme.name, "amber");

  for (let i = 0; i < 30; i++) handleKey(state, "k", options);
  assert.equal(state.pitch, 89, "pitch is clamped");
  handleKey(state, "\x1b[C", options);
  assert.equal(state.yaw, 40);
  handleKey(state, "r", options);
  assert.equal(state.pitch, 20);
  assert.equal(state.yaw, 30);

  assert.equal(handleKey(state, "M", options), "model");
  assert.equal(state.sources[state.sourceIdx], PRIMITIVE_NAMES.at(-1), "previous model wraps around");
  assert.equal(handleKey(state, "\x1b", options), "quit");
});

test("input: c cycles the gradient on the field and the theme elsewhere", async () => {
  const { state, options } = await stateFor("field");
  assert.equal(handleKey(state, "c", options), "changed");
  assert.equal(state.gradient.name, "sunset");
  assert.equal(state.theme.name, "phosphor");
  handleKey(state, "d", options);
  assert.equal(state.data, "cpu");
  handleKey(state, "}", options);
  assert.equal(state.wave.lines, 13);
});

test("input: dragging rotates, the wheel zooms", async () => {
  const { state } = await stateFor("torus");
  handleMouse(state, { button: 0, col: 10, row: 10, released: false });
  handleMouse(state, { button: 32, col: 12, row: 11, released: false });
  assert.equal(state.yaw, 38);
  assert.equal(state.pitch, 26);
  handleMouse(state, { button: 0, col: 12, row: 11, released: true });
  assert.equal(state.drag, null);
  handleMouse(state, { button: 64, col: 1, row: 1, released: false });
  assert.ok(state.zoom > 1);
});

test("scene: a snapshot applied to a fresh state reproduces it", async () => {
  const { state } = await stateFor("field");
  Object.assign(state, { yaw: 400, caption: "hi", data: "cpu" });
  const snapshot = sceneSnapshot(state);
  assert.equal(snapshot.yaw, 40, "yaw is normalized");
  assert.equal(snapshot.gradient, "synthwave");

  const { state: other } = await stateFor("field");
  assert.deepEqual(applyScene(other, snapshot), []);
  assert.deepEqual(sceneSnapshot(other), snapshot);
});

test("scene: invalid values are reported and leave the state alone", async () => {
  const { state } = await stateFor("torus");
  const problems = applyScene(state, { style: "nope", zoom: 2 });
  assert.equal(problems.length, 1);
  assert.equal(state.style, "halfblock");
  assert.equal(state.zoom, 2);
});

test("scene: model paths are relative to the scene file", async () => {
  const { state } = await stateFor("torus");
  assert.equal(sceneModel(state, { model: "torus" }, "/a/scene.json"), null, "unchanged");
  assert.equal(sceneModel(state, {}, "/a/scene.json"), null);
  assert.equal(sceneModel(state, { model: "cube" }, "/a/scene.json"), "cube");
  assert.equal(sceneModel(state, { model: "m/x.obj" }, "/a/scene.json"), "/a/m/x.obj");
  assert.equal(sceneModel(state, { model: "/b/x.obj" }, "/a/scene.json"), "/b/x.obj");
});

test("g only works where the glyphs show: the shade and wire styles, and the cloud in any style", async () => {
  const { state } = await stateFor("torus");
  assert.equal(handleKey(state, "g", {}), null, "half-block has fixed characters: g does nothing");
  assert.equal(state.palette, "auto");
  assert.doesNotMatch(footer(state, 200, null), /g glyphs/, "and isn't offered");
  state.style = "wire";
  assert.equal(handleKey(state, "g", {}), "changed");
  assert.equal(state.palette, "ascii");
  assert.match(footer(state, 200, null), /g glyphs/);

  // The cloud is points only: it draws its characters from the palette, whatever the style.
  Object.assign(state, { style: "halfblock", polygons: [], points: [{ at: [0, 0, 0], char: "*" }] });
  assert.equal(handleKey(state, "g", {}), "changed");
  assert.equal(state.message, "");
  // The style doesn't show on the cloud, so s and the number keys do nothing there.
  assert.deepEqual([handleKey(state, "s", {}), handleKey(state, "4", {}), state.style], [null, null, "halfblock"]);
  assert.doesNotMatch(footer(state, 200, null), /s style/);
  assert.doesNotMatch(header(state, 200, null), /half-block/);
  state.palette = "binary";
  const { points } = avatarGeometry("cloud", { ...avatarLook(state), activity: "waiting" }, 1);
  assert.deepEqual([...new Set(points.map((p) => p.char))].sort(), ["0", "1"]);
});

test("fine draws the cloud as braille dots, one per particle, four times as many", async () => {
  const { state } = await stateFor("torus");
  state.style = "wire";
  state.palette = "arrows";
  handleKey(state, "g", {});
  assert.equal(state.palette, "auto", "shade and wire skip fine: glyphcss doesn't know it");

  Object.assign(state, { polygons: [], points: [{ at: [0, 0, 0], char: "*" }], palette: "arrows" });
  handleKey(state, "g", {});
  assert.equal(state.palette, "fine", "the cloud has it as its last palette");
  const look = { ...avatarLook(state), activity: "running" };
  assert.equal(avatarGeometry("cloud", look, 1).points.length, 2000);
  assert.equal(avatarGeometry("cloud", { ...look, fine: false }, 1).points.length, 500);

  // Two points in one cell light two of its dots: top left and bottom right.
  // 20 × 10 cells: 9.2 cells per unit, the origin at the top left dot of cell (10, 5).
  const lines = renderFrame({
    points: [
      { at: [0, 0, 0], color: "#ffffff" },
      { at: [0.08, -0.19, 0], color: "#ffffff" },
    ],
    style: findStyle("halfblock"),
    palette: "fine",
    cols: 20,
    rows: 10,
    color: false,
    pitch: 0,
  });
  const dots = lines.join("").replace(/ /g, "");
  assert.equal([...dots].length, 1, "one cell");
  assert.equal(dots, String.fromCharCode(0x2800 + 0x01 + 0x80));
});

test("hud: bars fill the width exactly and show messages and captions", async () => {
  const { state } = await stateFor("torus");
  for (const cols of [20, 80, 200]) {
    assert.equal(visibleLength(header(state, cols, null)), cols);
    assert.equal(visibleLength(footer(state, cols, null)), cols);
  }
  assert.match(
    header(state, 200, null),
    /torus · half-block · phosphor · spin 40°\/s/,
    "no glyphs: half-block ignores them",
  );
  state.style = "shade";
  assert.match(header(state, 200, null), /torus · ascii shade · glyphs:auto · phosphor/);
  state.style = "halfblock";
  state.message = "scene updated";
  assert.match(footer(state, 80, null), /scene updated/);

  state.caption = "hello";
  const frame = composeFrame(state, ["row"], 40, 10, null);
  assert.match(frame, /» hello/);
  assert.ok(frame.includes("\x1b[9;1H"), "caption sits above the footer");
});
