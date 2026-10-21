// An animated oscilloscope: a phosphor trace in front of a graticule.
// Unlike other models it is rebuilt every frame from the current time and
// wave settings. Coordinates are pre-scaled so the screen's corners sit at
// radius 1, matching the normalization of every other model.

import { hexToRgb } from "./ansi.js";
import { PHOSPHOR } from "./themes.js";

export const WAVEFORMS = {
  sine: (u) => Math.sin(2 * Math.PI * u),
  square: (u) => (Math.sin(2 * Math.PI * u) >= 0 ? 1 : -1),
  triangle: (u) => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * u)),
  saw: (u) => 2 * (u - Math.floor(u + 0.5)),
};

export const WAVEFORM_NAMES = Object.keys(WAVEFORMS);

export const WAVE_DEFAULTS = { waveform: "sine", frequency: 3, amplitude: 1, speed: 0.5 };
export const WAVE_LIMITS = { frequency: [0.25, 12], amplitude: [0, 1.3], speed: [-5, 5] };

// A front-facing view suits a scope better than the usual three-quarter spin.
export const WAVE_VIEW = { yaw: 0, pitch: 0, spin: 0, zoom: 1.5 };

const HALF_WIDTH = 3.2;
const HALF_HEIGHT = 1.6;
const SCALE = 1 / Math.hypot(HALF_WIDTH, HALF_HEIGHT, 0.36);
const SAMPLES = 320;
const TUBE_SIDES = 6;
const TUBE_RADIUS = 0.09;

export function clampWave(settings) {
  const out = { ...settings };
  for (const [key, [min, max]] of Object.entries(WAVE_LIMITS)) out[key] = Math.max(min, Math.min(max, out[key]));
  if (!WAVEFORMS[out.waveform]) out.waveform = WAVE_DEFAULTS.waveform;
  return out;
}

const scaled = (v) => v.map((c) => c * SCALE);

function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function box(color, [x0, y0, z0], [x1, y1, z1]) {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ].map(scaled);
  // Counter-clockwise when seen from outside.
  const faces = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [0, 4, 7, 3],
    [5, 1, 2, 6],
    [7, 6, 2, 3],
    [0, 1, 5, 4],
  ];
  return faces.map((f) => ({ vertices: f.map((i) => v[i]), color }));
}

const screenCache = new Map();

/** The static screen and graticule, cached per trace color. */
function screen(color) {
  if (screenCache.has(color)) return screenCache.get(color);
  const grid = shade(color, 0.25);
  const axis = shade(color, 0.45);
  const polygons = box(shade(color, 0.06), [-HALF_WIDTH, -HALF_HEIGHT, -0.36], [HALF_WIDTH, HALF_HEIGHT, -0.3]);
  for (let i = -6; i <= 6; i++) {
    const x = i * 0.5;
    polygons.push(...box(i === 0 ? axis : grid, [x - 0.015, -1.5, -0.3], [x + 0.015, 1.5, -0.28]));
  }
  for (let i = -3; i <= 3; i++) {
    const y = i * 0.5;
    polygons.push(...box(i === 0 ? axis : grid, [-3, y - 0.015, -0.3], [3, y + 0.015, -0.28]));
  }
  screenCache.set(color, polygons);
  return polygons;
}

/** The trace as a thin tube along y = f(x), so it reads from any angle. */
function trace(color, { waveform, frequency, amplitude }, phase) {
  const f = WAVEFORMS[waveform];
  const points = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    points.push([-3 + 6 * t, 1.1 * amplitude * f(t * frequency - phase)]);
  }
  const rings = points.map(([x, y], i) => {
    const [ax, ay] = points[Math.max(0, i - 1)];
    const [bx, by] = points[Math.min(SAMPLES, i + 1)];
    const len = Math.hypot(bx - ax, by - ay);
    const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
    return Array.from({ length: TUBE_SIDES }, (_, s) => {
      const a = (s / TUBE_SIDES) * Math.PI * 2;
      const [c, d] = [Math.cos(a) * TUBE_RADIUS, Math.sin(a) * TUBE_RADIUS];
      return scaled([x + nx * c, y + ny * c, d]);
    });
  });
  const polygons = [];
  for (let i = 0; i < SAMPLES; i++) {
    for (let s = 0; s < TUBE_SIDES; s++) {
      const n = (s + 1) % TUBE_SIDES;
      polygons.push({ vertices: [rings[i][s], rings[i][n], rings[i + 1][n], rings[i + 1][s]], color });
    }
  }
  return polygons;
}

/** Full scene at `time` seconds; the trace scrolls `speed` periods per second. */
export function wavePolygons({ time = 0, color = PHOSPHOR, ...settings }) {
  const wave = clampWave({ ...WAVE_DEFAULTS, ...settings });
  return [...screen(color), ...trace(color, wave, time * wave.speed)];
}

// --- Wave field ------------------------------------------------------------
// Rows of traces lined up front to back, each row one color of a gradient.
// Rows are offset in phase so the crests travel diagonally across the field.

export const GRADIENTS = {
  synthwave: ["#ff3cac", "#784ba0", "#2b86c5"],
  sunset: ["#ffe259", "#ff7a3d", "#c2185b"],
  ocean: ["#a8fff0", "#2ec5ff", "#1238a8"],
  aurora: ["#7cffcb", "#4f9dff", "#b84fff"],
  fire: ["#fff3b0", "#ff8c1a", "#b3001b"],
  phosphor: ["#b6ff3b", "#33ff66", "#0b5c2a"],
};

export const GRADIENT_NAMES = Object.keys(GRADIENTS);

export const FIELD_DEFAULTS = { ...WAVE_DEFAULTS, frequency: 1, speed: 0.15, lines: 12 };
export const FIELD_VIEW = { yaw: 0, pitch: 40, spin: 0, zoom: 1.3 };

const FIELD_HALF_WIDTH = 3;
const FIELD_HALF_DEPTH = 3;
const FIELD_PEAK = 1.5;
const FIELD_SCALE = 1 / Math.hypot(FIELD_HALF_WIDTH, FIELD_HALF_DEPTH, FIELD_PEAK / 2);
const FIELD_SAMPLES = 160;

/** Accepts a preset name or an array of #rrggbb stops. Returns { name, stops } or null. */
export function resolveGradient(value) {
  if (typeof value === "string" && Object.hasOwn(GRADIENTS, value)) return { name: value, stops: GRADIENTS[value] };
  if (Array.isArray(value) && value.length >= 2 && value.every((c) => /^#[0-9a-f]{6}$/i.test(c))) {
    return { name: "custom", stops: value.map((c) => c.toLowerCase()) };
  }
  return null;
}

/** Color at position t (0 = front, 1 = back) along the gradient stops. */
function gradientAt(stops, t) {
  const pos = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(pos);
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const mix = a.map((c, k) => Math.round(c + (b[k] - c) * (pos - i)));
  return `#${((1 << 24) | (mix[0] << 16) | (mix[1] << 8) | mix[2]).toString(16).slice(1)}`;
}

/** Default wave settings for an animated model ("wave" or "field"). */
export function defaultsFor(model) {
  return model === "field" ? FIELD_DEFAULTS : { ...WAVE_DEFAULTS, lines: FIELD_DEFAULTS.lines };
}

export function clampField(settings) {
  const out = clampWave(settings);
  out.lines = Math.round(Math.max(2, Math.min(40, Number.isFinite(out.lines) ? out.lines : FIELD_DEFAULTS.lines)));
  return out;
}

/** Deterministic pseudo-random number in [0, 1) for a row and a slot. */
function hash(row, slot) {
  const v = Math.sin(row * 12.9898 + slot * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The field as polylines, one per row, front row first. Each row is its own
 * "signal": a quiet baseline with a burst of peaks in the middle, built from a
 * few components whose frequencies and phases are unique to the row.
 */
export function fieldLines({ time = 0, stops = GRADIENTS.synthwave, series = null, ...settings }) {
  if (series) return dataLines({ series, stops, ...settings });
  const { waveform, frequency, amplitude, speed, lines } = clampField({ ...FIELD_DEFAULTS, ...settings });
  const f = WAVEFORMS[waveform];
  const out = [];
  for (let row = 0; row < lines; row++) {
    const depth = lines === 1 ? 0 : row / (lines - 1); // 0 = front
    const z = FIELD_HALF_DEPTH - 2 * FIELD_HALF_DEPTH * depth;
    const components = [0, 1, 2].map((k) => ({
      freq: frequency * (0.8 + 2.6 * hash(row, k)),
      phase: hash(row, k + 3),
      drift: speed * (0.6 + 0.8 * hash(row, k + 6)) * (k % 2 ? -1 : 1),
      weight: [0.55, 0.3, 0.15][k],
    }));
    const center = 1.2 * (hash(row, 9) - 0.5);
    const points = [];
    for (let i = 0; i <= FIELD_SAMPLES; i++) {
      const x = -FIELD_HALF_WIDTH + (2 * FIELD_HALF_WIDTH * i) / FIELD_SAMPLES;
      const envelope = Math.exp(-(((x - center) / 1.25) ** 2));
      let signal = 0;
      for (const c of components) signal += c.weight * f(c.freq * x * 0.5 + c.phase - time * c.drift);
      const ripple = 0.012 * f(frequency * 4.3 * x + row - time * speed * 2);
      const y = amplitude * (ripple + envelope * FIELD_PEAK * Math.max(0, signal + 0.25));
      points.push([x * FIELD_SCALE, (y - FIELD_PEAK / 2) * FIELD_SCALE, z * FIELD_SCALE]);
    }
    out.push({ points, color: gradientAt(stops, depth) });
  }
  return out;
}

/**
 * The field from real data: one line per series (values 0..1, oldest first),
 * front series first. Time runs left to right with the newest value at the
 * right edge; `progress` (0..1 toward the next sample) scrolls the lines
 * smoothly left between samples.
 */
export function dataLines({ series, names = [], stops = GRADIENTS.synthwave, history, progress = 0, amplitude = 1 }) {
  const capacity = Math.max(2, history ?? Math.max(...series.map((s) => s.length)));
  const step = (2 * FIELD_HALF_WIDTH) / (capacity - 1);
  return series
    .map((values, row) => {
      const depth = series.length === 1 ? 0 : row / (series.length - 1);
      const z = FIELD_HALF_DEPTH - 2 * FIELD_HALF_DEPTH * depth;
      const points = [];
      values.forEach((value, j) => {
        const x = FIELD_HALF_WIDTH - (values.length - 1 - j + progress) * step;
        if (x < -FIELD_HALF_WIDTH) return;
        const y = Math.min(1.3, amplitude) * FIELD_PEAK * value;
        points.push([x * FIELD_SCALE, (y - FIELD_PEAK / 2) * FIELD_SCALE, z * FIELD_SCALE]);
      });
      const latest = values.at(-1);
      return {
        points,
        color: gradientAt(stops, depth),
        label: names[row],
        // Labels stay at the chart's left edge even while history is still short.
        labelAt: [-FIELD_HALF_WIDTH * FIELD_SCALE, (-FIELD_PEAK / 2) * FIELD_SCALE, z * FIELD_SCALE],
        value: latest === undefined ? undefined : `${Math.round(latest * 100)}%`,
      };
    })
    .filter((line) => line.points.length >= 2);
}
