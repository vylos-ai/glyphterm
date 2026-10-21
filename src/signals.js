// What the avatar shows of the session's tool calls and subagents, on top of
// its activity: a ping ring for every new tool call (red when one fails), a
// satellite orbiting the avatar for every running subagent, and the spectrum
// analyzer's bars. The hooks write the session (see session.js); this turns
// each new version of it into events with a start time, and those into
// geometry and bar levels frame by frame.

import { TOOL_GROUPS, zoneColor, unlit } from "./session.js";

const TAU = Math.PI * 2;
const PING_TIME = 0.9; // seconds for a ring to spread and fade
const PING_STAGGER = 0.12; // between rings that arrive together
const MAX_PINGS = 6;
const FLIGHT = 0.9; // seconds for a satellite to reach its orbit, or to come back
const PING_COLOR = "#5ce1e6";
const FAIL_COLOR = "#ff3b30";
const SATELLITE_COLOR = "#d9a6ff";

export const SPECTRUM_SEGMENTS = 6;
const SPECTRUM_DECAY = 8000; // ms for a call's weight to fall to 1/e
const PEAK_HOLD = 5000; // ms a peak stays before it falls
const PEAK_FALL = 2000; // ms per segment as it falls: slower than the bars, so it shows how busy it was
const FAIL_SHOWN = 10_000; // ms a bar's label stays red after a failed call

export const createSignals = () => ({ started: false, seen: new Map(), pings: [], satellites: new Map(), peaks: {} });

/**
 * Take in a new version of the session at viewer time `time`: calls not
 * seen before start a ping, and so do seen calls that turned out to fail;
 * new subagents launch a satellite, finished ones start their way home. The
 * first version is taken in quietly, so starting the viewer sets nothing off.
 */
export function trackSession(state, session, time = state.time) {
  const signals = state.signals;
  const quiet = !signals.started;
  signals.started = true;
  if (session.calls) {
    const seen = new Map();
    for (const [at, , failed, agent] of session.calls) {
      const key = `${at}|${agent}`;
      const before = signals.seen.get(key);
      seen.set(key, failed);
      if (quiet || before === failed) continue;
      const queued = signals.pings.filter((p) => p.at >= time).length;
      signals.pings.push({ at: time + queued * PING_STAGGER, failed: failed === 1, agent });
    }
    signals.seen = seen;
    signals.pings = signals.pings.slice(-MAX_PINGS);
  }
  if (session.satellites) {
    const running = new Set(session.satellites.map(([id]) => id));
    for (const id of running) {
      const known = signals.satellites.get(id);
      if (known && known.gone === null) continue;
      const used = new Set([...signals.satellites.values()].map((s) => s.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      signals.satellites.set(id, { slot: known?.slot ?? slot, born: quiet ? time - FLIGHT : time, gone: null });
    }
    for (const [id, satellite] of signals.satellites) {
      if (satellite.gone === null && !running.has(id)) satellite.gone = time;
    }
  }
}

/** Drop rings that have faded and satellites that are home. */
function prune(signals, time) {
  signals.pings = signals.pings.filter((p) => time - p.at < PING_TIME);
  for (const [id, s] of signals.satellites)
    if (s.gone !== null && time - s.gone > FLIGHT) signals.satellites.delete(id);
}

const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function rand(i, k = 0) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Each slot has its own tilted orbit, so satellites don't collide.
const TILTS = [18, -28, 40, -12, 30, -42, 6, 24];

/** Where satellite `slot` is at `time`: on its orbit, or on the way there or back. */
function satellitePosition({ slot, born, gone }, time) {
  const out = smoothstep((time - born) / FLIGHT) * (gone === null ? 1 : 1 - smoothstep((time - gone) / FLIGHT));
  const a = time * 0.8 + slot * 2.4;
  const tilt = (TILTS[slot % TILTS.length] * Math.PI) / 180;
  const node = slot * 2.4;
  // A circle of radius 1 in the x-z plane, tilted about x, then turned about y.
  const [x, y, z] = [Math.cos(a), -Math.sin(a) * Math.sin(tilt), Math.sin(a) * Math.cos(tilt)];
  const r = 1.02 * out;
  return [r * (x * Math.cos(node) + z * Math.sin(node)), r * y, r * (-x * Math.sin(node) + z * Math.cos(node))];
}

/** A ring's center and radius at its age: from the avatar, or from the satellite whose agent made the call. */
function ringOf(ping, signals, time) {
  const satellite = ping.agent && signals.satellites.get(ping.agent);
  const spread = smoothstep((time - ping.at) / PING_TIME);
  return satellite
    ? { center: satellitePosition(satellite, time), radius: 0.06 + 0.3 * spread, count: 24 }
    : // In front of the cloud, so the ring stays bright and is never hidden.
      { center: [0, 0, 0.55], radius: 0.3 + 0.62 * spread, count: 96 };
}

/** `hex` scaled to `amount` (0..1) of its brightness. */
const fade = (hex, amount) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(parseInt(hex.slice(i, i + 2), 16) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/**
 * The signals as geometry to add to an avatar's at `time`: `points` for the
 * cloud (rings and satellites made of characters), or `polygons` (small
 * octahedra) and `underlay` segments (rings, half-block only) for avatars
 * made of polygons.
 */
export function signalGeometry(signals, time, asPoints) {
  prune(signals, time);
  const points = [];
  const polygons = [];
  const underlay = [];
  for (const ping of signals.pings) {
    const age = (time - ping.at) / PING_TIME;
    if (age < 0) continue;
    const { center, radius, count } = ringOf(ping, signals, time);
    const color = ping.failed ? FAIL_COLOR : PING_COLOR;
    const bright = 1 - age;
    // Upright, facing the viewer: a pulse spreading on the screen.
    const at = (k) => {
      const a = (k / count) * TAU;
      return [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a), center[2]];
    };
    for (let k = 0; k < count; k++) {
      if (asPoints) points.push({ at: at(k), char: bright > 0.45 ? "o" : "·", color, bright: 0.4 + bright });
      else underlay.push({ from: at(k), to: at(k + 1), color: fade(color, bright) });
    }
  }
  for (const satellite of signals.satellites.values()) {
    const c = satellitePosition(satellite, time);
    if (asPoints) {
      for (let k = 0; k < 14; k++) {
        const a = rand(satellite.slot * 31 + k, 1) * TAU + time * 2;
        const r = k ? 0.04 + 0.06 * rand(k, 2) : 0;
        const at = [c[0] + r * Math.cos(a), c[1] + r * (rand(k, 3) - 0.5), c[2] + r * Math.sin(a)];
        points.push({ at, char: k ? "*+x."[k % 4] : "@", color: SATELLITE_COLOR, bright: 1.2, keep: true });
      }
    } else {
      polygons.push(...octahedron(c, 0.08, time * 3 + satellite.slot, SATELLITE_COLOR));
    }
  }
  return { points, polygons, underlay };
}

/** An octahedron of radius `size` at `c`, turned by `spin` about y. */
function octahedron(c, size, spin, color) {
  const [cos, sin] = [Math.cos(spin), Math.sin(spin)];
  const v = [
    [1, 0, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, 0, -1],
  ].map(([x, , z]) => [c[0] + size * (x * cos + z * sin), c[1], c[2] + size * (-x * sin + z * cos)]);
  const [top, bottom] = [
    [c[0], c[1] + size, c[2]],
    [c[0], c[1] - size, c[2]],
  ];
  const faces = [];
  for (let k = 0; k < 4; k++) {
    const [a, b] = [v[k], v[(k + 1) % 4]];
    faces.push({ vertices: [top, b, a], color }, { vertices: [bottom, a, b], color });
  }
  return faces;
}

/** An avatar's geometry with the signals added. */
export function withSignals(geometry, signals, time) {
  const fx = signalGeometry(signals, time, Boolean(geometry.points));
  if (geometry.points) return { ...geometry, points: [...geometry.points, ...fx.points] };
  return {
    ...geometry,
    polygons: [...geometry.polygons, ...fx.polygons],
    underlay: geometry.underlay || fx.underlay.length ? [...(geometry.underlay ?? []), ...fx.underlay] : null,
  };
}

/**
 * The spectrum analyzer at wall-clock `now` (ms): for each tool group, how
 * many of its SPECTRUM_SEGMENTS are lit, where its peak marker is, and
 * whether a call in it failed lately. Each call weighs 1 when made and fades
 * from there, so bars fall back while the agent waits. Peaks hold a moment,
 * then fall one segment at a time; they live in `state.signals.peaks`.
 */
export function spectrumBars(state, now = Date.now()) {
  const calls = state.session?.calls ?? [];
  const peaks = state.signals.peaks;
  return TOOL_GROUPS.map(({ id, label }) => {
    let energy = 0;
    let failed = false;
    for (const [at, group, fail] of calls) {
      if (group !== id || at > now) continue;
      energy += Math.exp(-(now - at) / SPECTRUM_DECAY);
      if (fail && now - at < FAIL_SHOWN) failed = true;
    }
    const lit = Math.round(SPECTRUM_SEGMENTS * (1 - Math.exp(-energy / 1.5)));
    const peak = peaks[id] ?? { top: 0, at: now };
    const falling = Math.max(0, peak.top - Math.floor(Math.max(0, now - peak.at - PEAK_HOLD) / PEAK_FALL));
    peaks[id] = lit >= falling ? { top: lit, at: now } : peak;
    return { id, label, lit, top: Math.max(lit, falling), failed };
  });
}

/** A segment's color: green, amber, red from the bottom up, dark when unlit. */
export const segmentColor = (index, on) => {
  const color = zoneColor((index + 0.5) / SPECTRUM_SEGMENTS);
  return on ? color : unlit(color);
};
