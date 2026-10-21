// What the avatar shows of the session: pings for tool calls, satellites for
// subagents, and the spectrum analyzer the e key toggles.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSettings, viewDefaultsFor } from "../src/settings.js";
import { createState } from "../src/state.js";
import { handleKey } from "../src/input.js";
import { applyScene, sceneSnapshot } from "../src/scene.js";
import { trackSession, signalGeometry, withSignals, spectrumBars } from "../src/signals.js";
import { spectrumRows, sceneRows, composeFrame, SPECTRUM_ROWS } from "../src/hud.js";
import { visibleLength } from "../src/ansi.js";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function cloudState(options = {}) {
  const { values } = parseSettings({
    style: "halfblock",
    palette: "auto",
    color: "original",
    gradient: "synthwave",
    data: "demo",
    ...viewDefaultsFor("cloud"),
    ...options,
  });
  return createState({ ...values, model: "cloud" });
}

test("pings: new calls and calls that turn out to fail, but nothing from the first version", () => {
  const state = cloudState({ session: { calls: [[1000, "read", 0, ""]] } });
  assert.deepEqual(state.signals.pings, [], "a viewer starting up doesn't replay old calls");

  state.time = 10;
  trackSession(state, {
    calls: [
      [1000, "read", 0, ""],
      [2000, "bash", 0, ""],
      [2001, "edit", 0, ""],
    ],
  });
  assert.deepEqual(
    state.signals.pings.map((p) => [p.at, p.failed]),
    [
      [10, false],
      [10.12, false],
    ],
    "rings that arrive together are staggered",
  );

  state.time = 11;
  trackSession(state, {
    calls: [
      [1000, "read", 0, ""],
      [2000, "bash", 1, ""],
      [2001, "edit", 0, ""],
    ],
  });
  assert.equal(state.signals.pings.at(-1).failed, true, "the failure rings again, in red");
  assert.equal(state.signals.pings.length, 3);

  // Rings fade after a moment and are dropped.
  signalGeometry(state.signals, 20, true);
  assert.deepEqual(state.signals.pings, []);
});

test("satellites launch for running subagents and come home when they finish", () => {
  const state = cloudState({ session: { satellites: [["old", 1]] } });
  const born = state.signals.satellites.get("old").born;
  assert.ok(born < 0, "already out when the viewer starts");

  state.time = 5;
  trackSession(state, {
    satellites: [
      ["old", 1],
      ["new", 2],
    ],
  });
  const added = state.signals.satellites.get("new");
  assert.deepEqual([added.slot, added.born, added.gone], [1, 5, null]);

  const near = (t) => {
    const { points } = signalGeometry(state.signals, t, true);
    const core = points.filter((p) => p.char === "@");
    return core.map((p) => Math.hypot(...p.at).toFixed(2));
  };
  assert.deepEqual(near(5), ["1.02", "0.00"], "the new one starts at the center");
  assert.deepEqual(near(6), ["1.02", "1.02"], "and reaches its orbit");

  state.time = 7;
  trackSession(state, { satellites: [["old", 1]] });
  assert.equal(state.signals.satellites.get("new").gone, 7);
  assert.deepEqual(near(8.5), ["1.02"], "home and gone");
  assert.equal(state.signals.satellites.size, 1);

  // A session without the key leaves the satellites alone.
  trackSession(state, { calls: [] });
  assert.equal(state.signals.satellites.size, 1);
});

test("signals join the cloud as points, and polygon avatars as octahedra and rings behind", () => {
  const state = cloudState({ session: { satellites: [["a", 1]] } });
  state.time = 3;
  trackSession(state, { calls: [[1, "read", 0, ""]], satellites: [["a", 1]] });
  state.time = 3.3;

  const cloud = withSignals(
    { polygons: [], points: [{ at: [0, 0, 0], char: "x" }], underlay: null },
    state.signals,
    3.3,
  );
  assert.ok(cloud.points.length > 1 + 14, "the cloud's own point, a satellite and a ring");
  assert.ok(
    cloud.points.some((p) => p.char === "@" && p.keep),
    "satellites keep their characters far away",
  );

  const core = withSignals(
    { polygons: [{ vertices: [], color: "#fff" }], points: null, underlay: null },
    state.signals,
    3.3,
  );
  assert.equal(core.polygons.length, 1 + 8, "one octahedron");
  assert.equal(core.underlay.length, 96, "one ring of segments");
});

test("the spectrum: bars by tool group that fall back, peaks that hold, red names after a failure", () => {
  const now = 1_000_000;
  const state = cloudState();
  state.session = {
    calls: [
      [now, "bash", 0, ""],
      [now, "bash", 0, ""],
      [now, "bash", 1, ""],
      [now - 5000, "read", 0, ""],
      [now - 600_000, "edit", 0, ""],
    ],
  };
  const lit = (bars) => Object.fromEntries(bars.map((b) => [b.id, b.lit]));
  const first = spectrumBars(state, now);
  assert.deepEqual(lit(first), { read: 2, find: 0, edit: 0, write: 0, bash: 5, web: 0, agent: 0, other: 0 });
  assert.equal(first.find((b) => b.id === "bash").failed, true);

  const later = spectrumBars(state, now + 30_000);
  const bash = later.find((b) => b.id === "bash");
  assert.deepEqual([bash.lit, bash.top, bash.failed], [0, 0, false], "fallen back; the peak has fallen too");

  // Shortly after a drop the peak still marks where the bar was.
  state.signals.peaks = {};
  spectrumBars(state, now);
  const drop = spectrumBars(state, now + 8000).find((b) => b.id === "bash");
  assert.ok(drop.top > drop.lit, "the peak marker holds above the bar");
});

test("e toggles the spectrum, which takes its rows from the scene", () => {
  const state = cloudState();
  assert.equal(state.spectrum, false);
  handleKey(state, "e", {});
  assert.equal(state.spectrum, true);
  assert.equal(sceneSnapshot(state, "/a/avatar.json").spectrum, true);
  assert.equal(sceneRows(state, 30), 30 - 2 - SPECTRUM_ROWS);

  const rows = spectrumRows(state, 80, 0);
  assert.equal(rows.length, SPECTRUM_ROWS);
  for (const cols of [20, 80]) for (const row of spectrumRows(state, cols, 0)) assert.equal(visibleLength(row), cols);
  assert.equal(strip(rows.at(-1)).trim(), "READ  FIND  EDIT  WRITE BASH  WEB   AGENT OTHER");
  assert.equal(strip(spectrumRows(state, 20, 0).at(-1)).trim(), "R F E W B W A O", "narrower bars, shorter names");

  state.stats = true;
  const frame = composeFrame(state, [], 80, 30, null, 0);
  assert.ok(frame.includes(`\x1b[${30 - 1 - 1 - SPECTRUM_ROWS};1H`), "the spectrum sits above the stats line");
  handleKey(state, "E", {});
  assert.equal(state.spectrum, false);
});

test("the scene file keeps only well-formed calls and satellites", () => {
  const { values } = parseSettings({
    spectrum: true,
    session: {
      calls: [[1, "read", 0, ""], [2, "nope", 0, ""], [3, "bash", 2, ""], ["x"], [4, "web", 1, "agent-1"]],
      satellites: [["a", 1], ["", 2], ["b", -1], "c"],
    },
  });
  assert.deepEqual(values, {
    spectrum: true,
    session: {
      calls: [
        [1, "read", 0, ""],
        [4, "web", 1, "agent-1"],
      ],
      satellites: [["a", 1]],
    },
  });
  const state = cloudState();
  assert.deepEqual(applyScene(state, { session: values.session }), []);
  assert.equal(state.signals.started, true);
});
