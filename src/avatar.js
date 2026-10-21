// The avatar: a character in the viewer that shows what a coding agent is
// doing. An activity ("thinking", "coding", …) sets a motion that works on any
// model and, for the built-in "buddy", a pose (arms, eyes). Activities are
// set by one word in the scene file, from Claude Code hooks or by the agent.

/** How long the viewer may sit at "waiting" before the avatar falls asleep, in seconds. */
export const SLEEP_AFTER = 300;

const wave = (t, speed, amount) => amount * Math.sin(t * speed);
const bounce = (t, speed, height) => height * Math.abs(Math.sin(t * speed));

/**
 * Each activity: a label and color for the caption line, `motion(t)` giving
 * offsets from the base view (yaw/pitch/roll in degrees, x/y in model units,
 * scale), and the buddy's `pose`. Short-lived ones have a `duration` in
 * seconds and then return to what came before them (or to `then`).
 */
export const ACTIVITIES = {
  thinking: {
    label: "thinking",
    color: "#b48cff",
    motion: (t) => ({ yaw: wave(t, 0.7, 25), roll: wave(t, 1.3, 6), y: wave(t, 2, 0.03) }),
    pose: { arms: "chin", eyes: "up" },
  },
  reading: {
    label: "reading",
    color: "#9ad8ff",
    motion: (t) => ({ yaw: wave(t, 0.9, 18), pitch: -6 }),
    pose: { arms: "rest", eyes: "scan" },
  },
  coding: {
    label: "coding",
    color: "#33ff66",
    motion: (t) => ({ y: bounce(t, 9, 0.025), yaw: wave(t, 0.5, 8) }),
    pose: { arms: "typing", eyes: "open" },
  },
  writing: {
    label: "writing",
    color: "#e8e4d8",
    motion: (t) => ({ roll: wave(t, 1.6, 5), y: bounce(t, 4, 0.02) }),
    pose: { arms: "typing", eyes: "open" },
  },
  running: {
    label: "running",
    color: "#ffb000",
    motion: (t) => ({ y: bounce(t, 7, 0.07), roll: wave(t, 7, 4) }),
    pose: { arms: "swing", legs: "run", eyes: "open" },
  },
  "needs-you": {
    label: "needs you",
    color: "#ff4fd8",
    motion: (t) => ({ y: bounce(t, 4, 0.08), scale: 1 + wave(t, 8, 0.03) }),
    pose: { arms: "wave", eyes: "wide" },
  },
  waiting: {
    label: "waiting for you",
    color: "#44ffcc",
    motion: (t) => ({ y: wave(t, 1.5, 0.02), scale: 1 + wave(t, 1.5, 0.01) }),
    pose: { arms: "rest", eyes: "blink" },
  },
  error: {
    label: "error",
    color: "#ff5555",
    duration: 2.5,
    motion: (t) => ({ yaw: wave(t, 22, 25 * Math.exp(-t * 1.5)), roll: -5 }),
    pose: { arms: "rest", eyes: "cross" },
  },
  done: {
    label: "done",
    color: "#ffd75e",
    duration: 3,
    then: "waiting",
    // One hop with a full turn, then a smaller happy bounce.
    motion: (t) => ({ y: t < 1 ? 0.2 * Math.sin(t * Math.PI) : bounce(t, 5, 0.04), yaw: t < 1 ? 360 * t : 0 }),
    pose: { arms: "up", eyes: "happy" },
  },
  sleeping: {
    label: "sleeping",
    color: "#6f7fa8",
    motion: (t) => ({ pitch: 8, roll: 4, scale: 1 + wave(t, 0.8, 0.02) }),
    pose: { arms: "rest", eyes: "closed" },
  },
};

export const ACTIVITY_IDS = Object.keys(ACTIVITIES);

const NO_MOTION = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, scale: 1 };

/**
 * Switch to `activity` at `time` (state.time). Short-lived activities
 * remember what to return to. "" clears the activity.
 */
export function setActivity(state, activity, time = state.time) {
  if (activity === state.activity) return;
  const { duration } = ACTIVITIES[activity] ?? {};
  // A short one interrupting another short one returns to the long one before
  // both. Anything happening means the agent is no longer blocked on the user.
  const before = state.activity === "needs-you" ? "thinking" : state.activity;
  state.activityBefore = duration ? (ACTIVITIES[state.activity]?.duration ? state.activityBefore : before) : "";
  state.activity = activity;
  state.activitySince = time;
}

/**
 * The activity to show at `time`: short-lived ones end by themselves, and a
 * long wait turns into sleep. Ends an expired activity in `state`.
 */
export function currentActivity(state, time = state.time) {
  const spec = ACTIVITIES[state.activity];
  if (!spec) return null;
  const elapsed = time - state.activitySince;
  if (spec.duration && elapsed > spec.duration) {
    // Its detail (the caption) ends with it.
    state.caption = "";
    setActivity(state, spec.then ?? state.activityBefore ?? "", state.activitySince + spec.duration);
    return currentActivity(state, time);
  }
  if (state.activity === "waiting" && elapsed > SLEEP_AFTER) return "sleeping";
  return state.activity;
}

/** Offsets from the base view for the current activity, or none. */
export function activityMotion(state, time = state.time) {
  const id = currentActivity(state, time);
  if (!id) return NO_MOTION;
  const since = id === "sleeping" ? state.activitySince + SLEEP_AFTER : state.activitySince;
  return { ...NO_MOTION, ...ACTIVITIES[id].motion(time - since) };
}

const SMOOTHING = 15; // per second; higher follows the motion more tightly

/**
 * Ease `current` toward `target` over `dt` seconds, so switching activities
 * doesn't jump. Angles take the short way round (a finished turn is 0°).
 */
export function smoothMotion(current, target, dt) {
  if (!current) return target;
  const k = 1 - Math.exp(-SMOOTHING * dt);
  const toward = (key, angle) => {
    let diff = target[key] - current[key];
    if (angle) diff = ((((diff + 180) % 360) + 360) % 360) - 180;
    return current[key] + diff * k;
  };
  return {
    yaw: toward("yaw", true),
    pitch: toward("pitch", true),
    roll: toward("roll", true),
    x: toward("x"),
    y: toward("y"),
    scale: toward("scale"),
  };
}

// --- The buddy: glyphterm's own mascot --------------------------------------
//
// A little retro computer on legs: a beige case whose green-on-black screen is
// its face. Built from boxes in a y-up space and fitted to a bounding radius
// of 1 like every other model (with fixed numbers, so poses don't rescale it).

const CASE = "#c9c2ad";
const TRIM = "#8f8875";
const SCREEN = "#0d2414";
const EYE = "#66ff8f";
const LIMB = "#8a8473";
const ARM = "#b3ac98";

/** A box from corner `a` to corner `b`, optionally turned by `transform`, as six outward-facing quads. */
function box(color, [x0, y0, z0], [x1, y1, z1], transform = (v) => v) {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ].map(transform);
  const faces = [
    [4, 5, 6, 7], // front (+z)
    [1, 0, 3, 2], // back
    [5, 1, 2, 6], // right
    [0, 4, 7, 3], // left
    [7, 6, 2, 3], // top
    [0, 1, 5, 4], // bottom
  ];
  return faces.map((face) => ({ vertices: face.map((i) => v[i]), color }));
}

/** Rotation by `deg` around the z axis (in the screen plane) about `pivot`. */
function turnZ(deg, [px, py]) {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return ([x, y, z]) => [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c, z];
}

/** Rotation by `deg` around the x axis (forward/back) about the height `py` and depth `pz`. */
function turnX(deg, [py, pz]) {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return ([x, y, z]) => [x, py + (y - py) * c - (z - pz) * s, pz + (y - py) * s + (z - pz) * c];
}

const FRONT = 0.42; // the screen's surface

/** Eye shapes as [half width, half height, x offset, y offset] per eye, or boxes of their own. */
function eyes(kind, t) {
  const eye = (w, h, dx = 0, dy = 0) =>
    [-1, 1].flatMap((side) =>
      box(EYE, [side * 0.2 - w + dx, 0.5 - h + dy, FRONT], [side * 0.2 + w + dx, 0.5 + h + dy, FRONT + 0.03]),
    );
  switch (kind) {
    case "closed":
      return eye(0.1, 0.03, 0, -0.05);
    case "wide":
      return eye(0.1, 0.16);
    case "up":
      return eye(0.08, 0.1, 0.05, 0.06);
    case "scan":
      return eye(0.08, 0.08, 0.08 * Math.sin(t * 2.4), -0.05);
    case "happy":
      // Upturned arcs: two short bars per eye, meeting in a peak.
      return [-1, 1].flatMap((side) =>
        [-1, 1].flatMap((half) =>
          box(
            EYE,
            [side * 0.2 + half * 0.05 - 0.07, 0.49, FRONT],
            [side * 0.2 + half * 0.05 + 0.07, 0.54, FRONT + 0.03],
            turnZ(-half * 55, [side * 0.2 + half * 0.05, 0.515]),
          ),
        ),
      );
    case "cross":
      return [-1, 1].flatMap((side) =>
        [45, -45].flatMap((deg) =>
          box(
            "#ff5555",
            [side * 0.2 - 0.11, 0.475, FRONT],
            [side * 0.2 + 0.11, 0.525, FRONT + 0.03],
            turnZ(deg, [side * 0.2, 0.5]),
          ),
        ),
      );
    case "blink":
      // Open, with a short blink every four seconds.
      return t % 4 > 3.85 ? eye(0.09, 0.03) : eye(0.08, 0.12);
    default:
      return eye(0.08, 0.12);
  }
}

/** Arm angles in degrees from hanging down (positive lifts the arm out to its side), per side. */
function armAngles(kind, t) {
  switch (kind) {
    case "up":
      return [150, 150];
    case "wave":
      return [40, 140 + 25 * Math.sin(t * 9)];
    case "chin":
      return [25, 115];
    case "swing":
      return [30 + 25 * Math.sin(t * 7), 30 - 25 * Math.sin(t * 7)];
    default:
      return [15, 15];
  }
}

/** The buddy in `pose` ({ arms, legs, eyes }) at time `t`, before fitting. */
function buddyParts({ arms = "rest", legs = "stand", eyes: eyeKind = "open" } = {}, t = 0) {
  const parts = [
    // Case, screen bezel and the screen itself.
    ...box(CASE, [-0.62, 0.05, -0.4], [0.62, 0.95, 0.4]),
    ...box(TRIM, [-0.52, 0.15, 0.38], [0.52, 0.85, FRONT - 0.01]),
    ...box(SCREEN, [-0.46, 0.2, FRONT - 0.01], [0.46, 0.8, FRONT]),
    // A floppy slot under the screen and a small antenna on top.
    ...box(TRIM, [0.15, 0.08, 0.38], [0.45, 0.11, FRONT]),
    ...box(LIMB, [0.32, 0.95, -0.03], [0.36, 1.12, 0.01]),
    ...box(EYE, [0.3, 1.12, -0.05], [0.38, 1.18, 0.03]),
    ...eyes(eyeKind, t),
  ];

  // Legs with feet; running swings them forward and back.
  for (const side of [-1, 1]) {
    const swing = legs === "run" ? side * 35 * Math.sin(t * 7) : 0;
    const hip = turnX(swing, [0.05, 0]);
    parts.push(...box(LIMB, [side * 0.28 - 0.06, -0.45, -0.06], [side * 0.28 + 0.06, 0.05, 0.06], hip));
    parts.push(...box(TRIM, [side * 0.28 - 0.1, -0.52, -0.1], [side * 0.28 + 0.1, -0.45, 0.16], hip));
  }

  // Arms hang from the case's sides; typing holds them forward, tapping.
  const [left, right] = armAngles(arms, t);
  for (const [side, angle] of [
    [-1, left],
    [1, right],
  ]) {
    const shoulder = [side * 0.62, 0.55];
    const forward = arms === "typing" ? turnX(-70 + 12 * Math.sin(t * 14 + side), [0.55, 0]) : (v) => v;
    const lift = turnZ(side * angle, shoulder);
    const arm = (v) => lift(forward(v));
    const x = side * 0.69;
    parts.push(...box(ARM, [x - 0.07, 0.17, -0.07], [x + 0.07, 0.6, 0.07], arm));
    parts.push(...box(TRIM, [x - 0.1, 0.05, -0.1], [x + 0.1, 0.17, 0.1], arm));
  }
  return parts;
}

// Fitted once from the standing pose: centered between feet and antenna.
const CENTER_Y = (1.18 - 0.52) / 2;
const SCALE = 1 / 1.1;

/** The buddy's polygons for `pose` at time `t`, centered with a radius of about 1. */
export function buddyPolygons(pose, t = 0) {
  const fit = ([x, y, z]) => [x * SCALE, (y - CENTER_Y) * SCALE, z * SCALE];
  return buddyParts(pose, t).map((p) => ({ ...p, vertices: p.vertices.map(fit) }));
}

/** The buddy's pose for the activity shown at `time`. */
export function buddyPose(state, time = state.time) {
  return ACTIVITIES[currentActivity(state, time)]?.pose ?? { arms: "rest", eyes: "blink" };
}
