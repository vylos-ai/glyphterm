// The "cloud" avatar: a few hundred characters floating in 3D. Each activity
// is a formation, a place for every particle at every moment: clusters that
// gather and part while thinking, a stream flowing inward while reading,
// rows of text scrolling up while coding, a question mark when it needs the
// user. On a change, every particle flies from its old formation to the new
// one, each a little later than the next, so the cloud regroups instead of
// snapping. Stateless: the same look and time always give the same frame.

const COUNT = 500;
const TAU = Math.PI * 2;

/** A fixed pseudo-random number in [0, 1) for particle `i` and channel `k`. */
function rand(i, k = 0) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const frac = (x) => x - Math.floor(x);

// Where each particle rests in the loose cloud: evenly spread through a ball.
const BASE = Array.from({ length: COUNT }, (_, i) => {
  const z = 2 * rand(i, 1) - 1;
  const phi = TAU * rand(i, 2);
  const r = 0.72 * Math.cbrt(rand(i, 3));
  const s = Math.sqrt(1 - z * z);
  return [r * s * Math.cos(phi), r * z, r * s * Math.sin(phi)];
});

function turnY([x, y, z], deg) {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}

function turnX([x, y, z], deg) {
  const a = (deg * Math.PI) / 180;
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

/** Every particle drifts a little, always, so nothing ever looks frozen. */
const drift = (i, t, amount = 0.02) => [
  amount * Math.sin(t * 0.9 + rand(i, 4) * TAU),
  amount * Math.sin(t * 1.1 + rand(i, 5) * TAU),
  amount * Math.sin(t * 0.7 + rand(i, 6) * TAU),
];

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// --- Formations: (i, t) -> { at, bright }, bright 0..1 ------------------------

const CLUSTERS = 5;

// Rows of text; while coding they scroll up and the newest line is typed out.
const ROWS = 13;
const PER_ROW = Math.floor(COUNT / ROWS);
const CHAR_STEP = 0.034;
const ROW_STEP = 0.115;

function textRows(i, t, { rate, indent }) {
  const line = i % ROWS;
  const k = Math.floor(i / ROWS);
  const length = Math.floor(PER_ROW * (0.35 + 0.6 * rand(line, 7)));
  const offset = indent ? Math.floor(rand(line, 8) * 4) * 2 : 0;
  // The slot runs from ROWS - 1 (bottom, just typed) up to 0 (top), then wraps.
  const slot = (((line - t * rate) % ROWS) + ROWS) % ROWS;
  const typed = Math.min(1, Math.max(0, ROWS - 1 - slot));
  if (k >= length || k / length > typed) {
    // Characters not on a line hang back as a faint haze.
    return { at: add([BASE[i][0] * 1.2, BASE[i][1], -0.55 + BASE[i][2] * 0.3], drift(i, t, 0.03)), bright: 0.18 };
  }
  const at = [-0.68 + (offset + k) * CHAR_STEP, 0.69 - slot * ROW_STEP, 0];
  // Lines fade out as they reach the top.
  return { at: add(at, drift(i, t, 0.004)), bright: 0.45 + 0.55 * Math.min(1, slot) };
}

/** Points along a question mark facing the viewer: an arc, a stem and a dot. */
function questionMark(i) {
  const s = rand(i, 10);
  const jitter = [(rand(i, 11) - 0.5) * 0.05, (rand(i, 12) - 0.5) * 0.05, (rand(i, 13) - 0.5) * 0.08];
  let at;
  if (s < 0.62) {
    // From the left, over the top, down the right and back to the middle.
    const a = ((150 - (s / 0.62) * 260) * Math.PI) / 180;
    at = [0.3 * Math.cos(a), 0.36 + 0.3 * Math.sin(a), 0];
  } else if (s < 0.86) {
    at = [0, 0.06 - ((s - 0.62) / 0.24) * 0.3, 0];
  } else {
    const a = rand(i, 14) * TAU;
    const r = 0.05 * Math.sqrt(rand(i, 15));
    at = [r * Math.cos(a), -0.48 + r * Math.sin(a), 0];
  }
  return add(at, jitter);
}

/** The i-th of COUNT points spread evenly over a sphere (a golden spiral). */
function sphere(i) {
  const y = 1 - (2 * (i + 0.5)) / COUNT;
  const r = Math.sqrt(1 - y * y);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

const FORMATIONS = {
  waiting: (i, t) => ({
    at: add(turnY(scale(BASE[i], 1 + 0.04 * Math.sin(t * 1.5)), t * 8), drift(i, t)),
    bright: 0.9,
  }),
  thinking: (i, t) => {
    // Clusters wander over a sphere, come together and drift apart.
    const c = i % CLUSTERS;
    const theta = t * 0.35 + (c * TAU) / CLUSTERS;
    const phi = 1.1 * Math.sin(t * 0.23 + c * 2.3);
    const r = 0.3 + 0.38 * (0.5 + 0.5 * Math.sin(t * 0.5 + c * 1.7));
    const center = [r * Math.cos(phi) * Math.cos(theta), r * Math.sin(phi), r * Math.cos(phi) * Math.sin(theta)];
    return { at: add(add(center, scale(BASE[i], 0.2)), drift(i, t, 0.03)), bright: 1 };
  },
  reading: (i, t) => {
    // Streaming in from all sides, swirling a little, brightening at the center.
    const s = frac(t * 0.3 + rand(i, 16));
    const r = 0.95 * Math.pow(1 - s, 1.2) + 0.06;
    const dir = scale(BASE[i], 1 / (Math.hypot(...BASE[i]) || 1));
    return { at: turnY(scale(dir, r), s * 80), bright: 0.35 + 0.65 * s };
  },
  coding: (i, t) => textRows(i, t, { rate: 1.1, indent: true }),
  writing: (i, t) => textRows(i, t, { rate: 0.6, indent: false }),
  running: (i, t) => {
    // A fast, tight vortex.
    const a = rand(i, 17) * TAU + t * (3 + rand(i, 18));
    const r = 0.3 + 0.38 * rand(i, 19);
    const y = (rand(i, 18) - 0.5) * 0.22 + 0.06 * Math.sin(a * 2);
    return { at: turnX([r * Math.cos(a), y, r * Math.sin(a)], 18), bright: 0.9 };
  },
  "needs-you": (i, t) => {
    const pulse = 1 + 0.06 * Math.sin(t * 6);
    return { at: add(scale(questionMark(i), 1.2 * pulse), drift(i, t, 0.01)), bright: 1 };
  },
  error: (i, t) => {
    // Thrown outward, shuddering.
    const out = scale(BASE[i], 1.1 + 0.25 * rand(i, 20));
    const shake = 0.03 * Math.sin(t * 40 + i);
    return { at: add(out, [shake, 0, 0]), bright: 0.9 };
  },
  done: (i, t) => ({ at: turnY(scale(sphere(i), 0.68), t * 50), bright: 1 }),
  sleeping: (i, t) => {
    // Settled to the bottom like dust, now and then a glimmer.
    const [x, , z] = BASE[i];
    const glimmer = frac(t * 0.15 + rand(i, 21)) > 0.96 ? 0.5 : 0;
    return { at: [x * 1.2, -0.6 + 0.02 * Math.sin(t + i), z * 1.2], bright: 0.32 + glimmer };
  },
};

// --- Characters ---------------------------------------------------------------

const GLYPHS = {
  code: "{}[]()<>=+-*/;:.,_|&!?#$%0123456789abcdefxyz",
  prose: "abcdefghijklmnopqrstuvwxyzetaoinshr.,;'",
  loose: "·.:+*~^°abcdefghijklmnopqrstuvwxyz{}<>=/\\|0123456789",
};

function glyph(i, t, activity) {
  const set = activity === "coding" ? GLYPHS.code : activity === "writing" ? GLYPHS.prose : GLYPHS.loose;
  // Each character changes now and then, at its own pace.
  const tick = Math.floor(t * (0.3 + rand(i, 22) * 0.7) + rand(i, 23) * 10);
  return set[Math.floor(rand(i, tick + 30) * set.length)];
}

const TRANSITION = 0.9; // seconds for a particle to reach its new formation
const STAGGER = 0.45; // spread of the particles' start times

/**
 * The cloud for `look` ({ activity, previous, age }) at time `t`: COUNT
 * points `{ at, char, color, bright }`. `colorOf(activity)` gives the color.
 */
export function cloudPoints({ activity = "", previous = "", age = Infinity } = {}, t = 0, colorOf = () => null) {
  const now = FORMATIONS[activity] ?? FORMATIONS.waiting;
  const before = FORMATIONS[previous];
  const fast = activity === "error"; // a jolt, not a drift
  const [duration, stagger] = fast ? [0.25, 0.1] : [TRANSITION, STAGGER];
  const color = colorOf(activity || "waiting");
  const beforeColor = colorOf(previous) ?? color;

  return BASE.map((_, i) => {
    const target = now(i, t);
    const mix = before ? smoothstep((age - rand(i, 24) * stagger) / duration) : 1;
    if (mix >= 1) return { at: target.at, char: glyph(i, t, activity), color, bright: target.bright };
    const from = before(i, t);
    return {
      at: from.at.map((v, k) => v + (target.at[k] - v) * mix),
      char: glyph(i, t, mix < 0.5 ? previous : activity),
      color: mix < 0.5 ? beforeColor : color,
      bright: from.bright + (target.bright - from.bright) * mix,
    };
  });
}
