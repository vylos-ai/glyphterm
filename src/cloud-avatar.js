// The "cloud" avatar: a few hundred characters floating in 3D. Each activity
// is a formation, a place for every particle at every moment: clusters that
// gather and part while thinking, a stream flowing inward while reading,
// rows of text scrolling up while coding, a question mark when it needs the
// user. On a change, every particle flies from its old formation to the new
// one, each a little later than the next, so the cloud regroups instead of
// snapping. Stateless: the same look and time always give the same frame.

// Particles in the cloud; the fine mode (braille dots) has DENSITY times as many.
const COUNT = 500;
export const FINE_DENSITY = 4;
const TAU = Math.PI * 2;

/** A fixed pseudo-random number in [0, 1) for particle `i` and channel `k`. */
function rand(i, k = 0) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const frac = (x) => x - Math.floor(x);

/** Where each of `count` particles rests in the loose cloud: evenly spread through a ball. */
const restingPlaces = (count) =>
  Array.from({ length: count }, (_, i) => {
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

/** Every particle drifts a little, always, so nothing ever looks frozen. */
const drift = (i, t, amount = 0.02) => [
  amount * Math.sin(t * 0.9 + rand(i, 4) * TAU),
  amount * Math.sin(t * 1.1 + rand(i, 5) * TAU),
  amount * Math.sin(t * 0.7 + rand(i, 6) * TAU),
];

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// --- Formations: (i, t) -> { at, bright, char? }, bright 0..1 ----------------

const CLUSTERS = 5;

// Running: two suns on one orbit, always opposite each other around their
// common center (where the tool-call pings start). Each trails a tail like
// the comma of a yin-yang: half a turn long, spiraling out from the orbit
// toward the rim and thinning, so it wraps around the other sun. The plane is
// tilted toward the viewer; the suns turn clockwise.
const ORBIT_SPEED = 1.4; // radians per second; seen from above the plane, positive is clockwise
const ORBIT = 0.42;
const RIM = 0.9; // where a tail ends
const SUN = 0.17;
const TILT = (50 * Math.PI) / 180; // how far the viewer is above the orbital plane

/** A point in the orbital plane at radius `r` and angle `a`, as seen from above it. */
const inOrbit = (r, a) => {
  const [x, z] = [r * Math.cos(a), r * Math.sin(a)];
  return [x, -z * Math.sin(TILT), z * Math.cos(TILT)];
};

/**
 * The formations for a cloud of COUNT × `density` particles: the same shapes
 * at any density, with parts that scale with it (the fine mode is denser).
 */
function makeFormations(density) {
  const count = COUNT * density;
  const BASE = restingPlaces(count);
  const SUN_PARTICLES = 100 * density; // per sun; the rest are the two tails
  const TAIL_LANES = 3 * Math.round(Math.sqrt(density));
  // Rows of text: denser clouds have more, tighter rows of smaller steps.
  const ROWS = 13 * Math.round(Math.sqrt(density));
  const PER_ROW = Math.floor(count / ROWS);
  const CHAR_STEP = 0.034 / Math.sqrt(density);
  const ROW_STEP = 0.115 / Math.sqrt(density);

  function binaryStars(i, t) {
    const a = t * ORBIT_SPEED;
    if (i < 2 * SUN_PARTICLES) {
      // A sun: a disc facing the viewer, filled evenly from the center out
      // (a sunflower spiral), its core drawn as @ and its rim as o.
      const n = i % SUN_PARTICLES;
      const r = SUN * Math.sqrt((n + 0.5) / SUN_PARTICLES);
      const b = n * Math.PI * (3 - Math.sqrt(5));
      const center = inOrbit(ORBIT, a + (i < SUN_PARTICLES ? 0 : Math.PI));
      return { at: add(center, [r * Math.cos(b), r * Math.sin(b), 0]), bright: 1.4, char: r < SUN * 0.6 ? "@" : "o" };
    }
    // A tail: lanes of particles from the sun backward along the spiral, the band narrowing to a point.
    const k = i - 2 * SUN_PARTICLES;
    const per = (count - 2 * SUN_PARTICLES) / 2;
    const side = k < per ? 0 : Math.PI;
    const n = k % per;
    const lane = n % TAIL_LANES;
    const u = Math.floor(n / TAIL_LANES) / (per / TAIL_LANES); // 0 at the sun, 1 at the end
    const width = 0.12 * (1 - u); // as wide as before, though the suns grew
    const across = TAIL_LANES > 1 ? (2 * lane) / (TAIL_LANES - 1) - 1 : 0; // -1..1
    const r = ORBIT + (RIM - ORBIT) * u + across * width;
    const behind = a + side - Math.sign(ORBIT_SPEED) * u * Math.PI;
    return {
      at: inOrbit(r, behind),
      bright: 1.3 * (1 - u * u) + 0.25,
      char: u < 0.3 ? "*" : u < 0.65 ? "+" : "·",
    };
  }

  // Rows of text; while coding they scroll up and the newest line is typed out.
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

  /** The i-th of `count` points spread evenly over a sphere (a golden spiral). */
  function sphere(i, count) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    return [r * Math.cos(a), y, r * Math.sin(a)];
  }

  const formations = {
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
    running: (i, t) => binaryStars(i, t),
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
    done: (i, t) => ({ at: turnY(scale(sphere(i, count), 0.68), t * 50), bright: 1 }),
    sleeping: (i, t) => {
      // Settled to the bottom like dust, now and then a glimmer.
      const [x, , z] = BASE[i];
      const glimmer = frac(t * 0.15 + rand(i, 21)) > 0.96 ? 0.5 : 0;
      return { at: [x * 1.2, -0.6 + 0.02 * Math.sin(t + i), z * 1.2], bright: 0.32 + glimmer };
    },
  };
  return { count, formations };
}

// --- Characters ---------------------------------------------------------------

const GLYPHS = {
  code: "{}[]()<>=+-*/;:.,_|&!?#$%0123456789abcdefxyz",
  prose: "abcdefghijklmnopqrstuvwxyzetaoinshr.,;'",
  loose: "·.:+*~^°abcdefghijklmnopqrstuvwxyz{}<>=/\\|0123456789",
};

function glyph(i, t, activity, chars) {
  const set = chars ?? (activity === "coding" ? GLYPHS.code : activity === "writing" ? GLYPHS.prose : GLYPHS.loose);
  // Each character changes now and then, at its own pace.
  const tick = Math.floor(t * (0.3 + rand(i, 22) * 0.7) + rand(i, 23) * 10);
  return set[Math.floor(rand(i, tick + 30) * set.length)];
}

// Built when first used: the fine mode's denser cloud only if it's asked for.
const clouds = new Map();
function cloudOf(density) {
  if (!clouds.has(density)) clouds.set(density, makeFormations(density));
  return clouds.get(density);
}

const TRANSITION = 0.9; // seconds for a particle to reach its new formation
const STAGGER = 0.45; // spread of the particles' start times

/**
 * The cloud for `look` ({ activity, previous, age, glyphs, fine }) at time
 * `t`: COUNT points `{ at, char, color, bright }`, or FINE_DENSITY times as
 * many if `fine` (drawn as braille dots, so the characters don't matter).
 * `colorOf(activity)` gives the color. `glyphs`, a list of characters (a
 * glyph palette), replaces the cloud's own: code while coding, letters while
 * writing.
 */
export function cloudPoints(
  { activity = "", previous = "", age = Infinity, glyphs = null, fine = false } = {},
  t = 0,
  colorOf = () => null,
) {
  const { count, formations } = cloudOf(fine ? FINE_DENSITY : 1);
  const now = formations[activity] ?? formations.waiting;
  const before = formations[previous];
  const fast = activity === "error"; // a jolt, not a drift
  const [duration, stagger] = fast ? [0.25, 0.1] : [TRANSITION, STAGGER];
  const color = colorOf(activity || "waiting");
  const beforeColor = colorOf(previous) ?? color;

  return Array.from({ length: count }, (_, i) => {
    const target = now(i, t);
    const mix = before ? smoothstep((age - rand(i, 24) * stagger) / duration) : 1;
    // A formation may fix a particle's character (the binary stars' cores).
    if (mix >= 1)
      return { at: target.at, char: target.char ?? glyph(i, t, activity, glyphs), color, bright: target.bright };
    const from = before(i, t);
    return {
      at: from.at.map((v, k) => v + (target.at[k] - v) * mix),
      char: (mix < 0.5 ? from.char : target.char) ?? glyph(i, t, mix < 0.5 ? previous : activity, glyphs),
      color: mix < 0.5 ? beforeColor : color,
      bright: from.bright + (target.bright - from.bright) * mix,
    };
  });
}
