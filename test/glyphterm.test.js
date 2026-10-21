import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { htmlToLines, visibleLength } from "../src/ansi.js";
import { loadModel, PRIMITIVE_NAMES, ANIMATED } from "../src/models.js";
import { renderFrame, STYLES } from "../src/render.js";
import { resolveTheme } from "../src/themes.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("htmlToLines translates foreground and background spans", () => {
  const html =
    'a<span style="color:#ff0000">b</span>\n<span style="color:#00ff00;background-color:#0000ff">c</span>&lt;';
  const [first, second] = htmlToLines(html);
  assert.equal(first, "a\x1b[38;2;255;0;0mb\x1b[0m");
  assert.equal(second, "\x1b[38;2;0;255;0m\x1b[48;2;0;0;255mc\x1b[0m<");
  assert.deepEqual(htmlToLines(html, { color: false }), ["ab", "c<"]);
});

test("every primitive renders in every style at the requested size", async () => {
  for (const name of PRIMITIVE_NAMES.filter((n) => !ANIMATED.includes(n))) {
    const { polygons } = await loadModel(name);
    for (const style of STYLES) {
      const lines = renderFrame({ polygons, style, yaw: 30, pitch: 20, cols: 40, rows: 12 });
      assert.equal(lines.length, 12, `${name}/${style.id} rows`);
      for (const line of lines) assert.equal(visibleLength(line), 40, `${name}/${style.id} width`);
      assert.ok(
        lines.some((l) => l.trim()),
        `${name}/${style.id} drew nothing`,
      );
    }
  }
});

test("models are normalized to a bounding radius of 1", async () => {
  for (const source of ["torus", "examples/rocket.obj"]) {
    const { polygons } = await loadModel(source === "torus" ? source : `${root}/${source}`);
    const radius = Math.max(...polygons.flatMap((p) => p.vertices.map((v) => Math.hypot(...v))));
    assert.ok(Math.abs(radius - 1) < 1e-9, `${source}: ${radius}`);
  }
});

test("OBJ files keep y-up orientation (rocket nose on top)", async () => {
  const { polygons } = await loadModel(`${root}/examples/rocket.obj`);
  const top = polygons.reduce((best, p) =>
    Math.max(...p.vertices.map((v) => v[1])) > Math.max(...best.vertices.map((v) => v[1])) ? p : best,
  );
  assert.equal(top.color.toLowerCase(), "#e0402f");
});

test("unknown models produce a helpful error", async () => {
  await assert.rejects(loadModel("teapot"), /Unknown model "teapot"/);
});

test("themes accept names and hex colors", () => {
  assert.deepEqual(resolveTheme("amber"), { name: "amber", color: "#ffb000" });
  assert.deepEqual(resolveTheme("#ABCDEF"), { name: "#abcdef", color: "#abcdef" });
  assert.equal(resolveTheme("chartreuse"), null);
});

test("CLI --once prints a plain frame when piped", () => {
  const out = execFileSync("node", ["bin/glyphterm.js", "cube", "--once", "--cols", "30", "--rows", "10"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.ok(!out.includes("\x1b["), "no escape codes when piped");
  assert.ok(out.trim().length > 0);
  assert.ok(out.split("\n").every((l) => l.length <= 30));
});

test("wave model animates and honors its settings", async () => {
  const { wavePolygons, WAVEFORMS, clampWave } = await import("../src/wave.js");
  const { polygons, animated } = await loadModel("wave");
  assert.ok(animated && polygons.length > 0);
  const traceY = (opts) =>
    wavePolygons({ color: "#33ff66", ...opts })
      .filter((p) => p.color === "#33ff66")
      .map((p) => p.vertices[0][1]);
  assert.notDeepEqual(traceY({ time: 0 }), traceY({ time: 0.3 }), "trace scrolls over time");
  const square = traceY({ waveform: "square" });
  assert.ok(Math.max(...square) > 0 && Math.min(...square) < 0);
  assert.equal(WAVEFORMS.saw(0.25), 0.5);
  assert.deepEqual(clampWave({ waveform: "noise", frequency: 99, amplitude: -1, speed: 0 }), {
    waveform: "sine",
    frequency: 12,
    amplitude: 0,
    speed: 0,
  });
});

test("wave field: separate lines colored along the gradient, front to back", async () => {
  const { fieldLines, resolveGradient } = await import("../src/wave.js");
  const lines = fieldLines({ lines: 3, stops: ["#ff0000", "#0000ff"] });
  assert.equal(lines.length, 3);
  assert.equal(lines[0].color, "#ff0000");
  assert.equal(lines[2].color, "#0000ff");
  assert.ok(lines[0].points[0][2] > lines[2].points[0][2], "first color is in front");
  const height = (line) => line.points.map((p) => p[1]);
  assert.notDeepEqual(height(lines[0]), height(lines[1]), "every line is its own signal");
  assert.equal(resolveGradient("ocean").name, "ocean");
  assert.equal(resolveGradient(["#fff"]), null);
});

test("ridgeline occlusion hides lines behind taller lines in front", async () => {
  const flat = (z, y, color) => ({ color, points: [-0.8, 0, 0.8].map((x) => [x, y, z]) });
  // A tall line in front and a lower line behind it: viewed head-on, the back line is hidden.
  const lines = [flat(0.5, 0.2, "#ff0000"), flat(-0.5, 0, "#0000ff")];
  const draw = (style) =>
    renderFrame({ lines, style: STYLES.find((s) => s.id === style), yaw: 0, pitch: 0, cols: 40, rows: 12 }).join("");
  assert.ok(!draw("braille").includes("38;2;0;0;255"), "back line hidden");
  assert.ok(draw("xray").includes("38;2;0;0;255"), "x-ray shows it");
});

test("CPU sampler records one load value (0..1) per core", async () => {
  const { createCpuSampler } = await import("../src/cpu.js");
  const { cpus } = await import("node:os");
  const sampler = createCpuSampler({ history: 3 });
  for (let i = 0; i < 5; i++) {
    const until = Date.now() + 20;
    while (Date.now() < until);
    sampler.sample();
  }
  assert.equal(sampler.series.length, cpus().length);
  for (const values of sampler.series) {
    assert.equal(values.length, 3, "history is capped");
    assert.ok(values.every((v) => v >= 0 && v <= 1));
  }
});

test("data lines put the newest value at the right edge with labels", async () => {
  const { dataLines } = await import("../src/wave.js");
  const [line] = dataLines({ series: [[0, 0.5, 1]], names: ["cpu0"], history: 3 });
  assert.equal(line.label, "cpu0");
  assert.equal(line.value, "100%");
  const xs = line.points.map((p) => p[0]);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], "time runs left to right");
  assert.ok(line.points[2][1] > line.points[0][1], "higher load is higher");
});

test("overlayText writes into colored lines without changing their width", async () => {
  const { overlayText } = await import("../src/ansi.js");
  const line = "ab\x1b[38;2;255;0;0mcdef\x1b[0mgh";
  const out = overlayText(line, 3, "XY", "#00ff00");
  assert.equal(visibleLength(out), 8);
  assert.ok(out.includes("\x1b[38;2;0;255;0mXY"));
  assert.equal(overlayText("abc", 2, "XYZ", null), "abX");
});
