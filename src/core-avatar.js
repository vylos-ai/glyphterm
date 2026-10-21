// The "core" avatar: a floating polyhedron over a grid floor, with an orbit
// ring. Each activity has its own form and color; a change snaps to the new
// form with a short flash. It moves on its own (spin, bob, pulse), so the
// floor stays put and the generic activity motions don't apply.

import * as core from "@glyphcss/core";

const O = [0, 0, 0];
/** Scaled to a radius of 1. */
function unit(polygons) {
  const radius = Math.max(...polygons.flatMap((p) => p.vertices.map((v) => Math.hypot(...v))));
  return polygons.map((p) => ({ vertices: p.vertices.map((v) => v.map((c) => c / radius)) }));
}

// The forms, from glyphcss, built once.
const FORMS = {
  icosahedron: unit(core.icosahedronPolygons({ center: O, size: 1 })),
  dodecahedron: unit(core.dodecahedronPolygons({ center: O, size: 1 })),
  octahedron: unit(core.octahedronPolygons({ center: O, size: 1 })),
  cuboctahedron: unit(core.cuboctahedronPolygons({ center: O, size: 1 })),
  cube: unit(core.cubePolygons({ center: O, size: 1 })),
  star: unit(core.smallStellatedDodecahedronPolygons({ center: O, size: 1 })),
  ball: unit(core.truncatedIcosahedronPolygons({ center: O, size: 1 })),
};
const RING = core.torusPolygons({ center: O, majorRadius: 1, minorRadius: 0.035, segments: 48, sides: 6 });

const GRID = "#2a8fb8";
const FLOOR_Y = -0.62;
const FLASH = 0.35; // seconds of the white flash after a change of form

const wave = (t, speed, amount) => amount * Math.sin(t * speed);

/**
 * Per activity: the form, its color (the activity's badge color), how fast
 * it spins (degrees per second), and `move(t)` for a bob (y), a size pulse
 * (scale) and the orbit ring's tilt and height. `ring: "scan"` sweeps the
 * ring up and down instead of orbiting.
 */
const LOOKS = {
  waiting: { form: "icosahedron", color: "#44ffcc", spin: 20, move: (t) => ({ y: wave(t, 1.5, 0.03) }) },
  thinking: {
    form: "dodecahedron",
    color: "#b48cff",
    spin: 45,
    move: (t) => ({ y: wave(t, 2, 0.04), scale: 1 + wave(t, 3, 0.06) }),
  },
  reading: { form: "icosahedron", color: "#9ad8ff", spin: 15, ring: "scan", move: () => ({}) },
  coding: { form: "cuboctahedron", color: "#33ff66", spin: 160, move: (t) => ({ y: wave(t, 9, 0.02) }) },
  writing: { form: "cuboctahedron", color: "#e8e4d8", spin: 90, move: (t) => ({ y: wave(t, 4, 0.02) }) },
  running: {
    form: "cube",
    color: "#ffb000",
    spin: 240,
    move: (t) => ({ y: Math.abs(Math.sin(t * 6)) * 0.1 }),
  },
  "needs-you": {
    form: "octahedron",
    color: "#ff4fd8",
    spin: 30,
    move: (t) => ({ y: Math.abs(Math.sin(t * 4)) * 0.12, scale: 1 + wave(t, 8, 0.07) }),
  },
  error: {
    form: "star",
    color: "#ff5555",
    spin: 0,
    move: (t) => ({ x: wave(t, 30, 0.06 * Math.exp(-t * 1.5)), scale: 1 + 0.15 * Math.exp(-t * 3) }),
  },
  done: {
    form: "ball",
    color: "#ffd75e",
    spin: 200,
    move: (t) => ({ y: t < 1 ? 0.18 * Math.sin(t * Math.PI) : 0, scale: 1 + 0.1 * Math.exp(-t * 2) }),
  },
  sleeping: {
    form: "icosahedron",
    color: "#2f5566",
    spin: 4,
    move: (t) => ({ y: -0.12, scale: 0.7 + wave(t, 0.8, 0.02) }),
  },
};

/** `hex` mixed toward white by `amount` (0..1). */
function brighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("");
}

/** Rotation by `yaw` around the vertical axis and `tilt` around the depth axis, in degrees. */
function turn(yaw, tilt = 0) {
  const [a, b] = [(yaw * Math.PI) / 180, (tilt * Math.PI) / 180];
  const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  return ([x, y, z]) => {
    const [x1, z1] = [x * ca + z * sa, -x * sa + z * ca];
    return [x1 * cb - y * sb, x1 * sb + y * cb, z1];
  };
}

const place = (polygons, transform, color) => polygons.map((p) => ({ vertices: p.vertices.map(transform), color }));

/**
 * The floor: a square grid of lines under the core, drawn behind it in
 * half-block styles (renderFrame's `underlay`); other styles leave it out.
 */
export const CORE_FLOOR = [];
for (let k = -0.7; k <= 0.7 + 1e-9; k += 0.35) {
  CORE_FLOOR.push({ from: [-0.7, FLOOR_Y, k], to: [0.7, FLOOR_Y, k], color: GRID });
  CORE_FLOOR.push({ from: [k, FLOOR_Y, -0.7], to: [k, FLOOR_Y, 0.7], color: GRID });
}

/**
 * The core for `activity` at time `t`, `age` seconds after the activity
 * began (for the flash). Radius about 1, like every model.
 */
export function corePolygons(activity, t = 0, age = Infinity) {
  const look = LOOKS[activity] ?? LOOKS.waiting;
  const { x = 0, y = 0, scale = 1 } = look.move(age === Infinity ? t : age);
  const flash = Math.max(0, 1 - age / FLASH);
  const color = flash > 0 ? brighten(look.color, flash * 0.8) : look.color;
  const size = 0.5 * scale * (1 + 0.25 * flash);
  const lift = 0.12 + y;

  const spin = turn(look.spin * t, 12);
  const body = place(
    FORMS[look.form],
    (v) => {
      const [vx, vy, vz] = spin(v);
      return [x + vx * size, lift + vy * size, vz * size];
    },
    color,
  );

  // The ring orbits tilted, or sweeps up and down the form while reading.
  const ringColor = brighten(look.color, 0.35);
  const ring =
    look.ring === "scan"
      ? place(RING, ([rx, ry, rz]) => [rx * 0.62, lift + ry + 0.45 * Math.sin(t * 2.2), rz * 0.62], ringColor)
      : place(
          RING,
          (v) => {
            // Tilted first, then turned: the ring precesses around the form.
            const [rx, ry, rz] = turn(-look.spin * t * 0.5)(turn(0, 72)(v));
            return [rx * 0.78, lift + ry * 0.78, rz * 0.78];
          },
          ringColor,
        );

  return [...body, ...(activity === "sleeping" ? [] : ring)];
}
