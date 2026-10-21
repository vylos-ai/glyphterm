// Keyboard and mouse input: terminal bytes -> events -> state changes.
// Handlers change `state` and return an effect for the viewer to carry out,
// so they can be tested without a terminal.

import { STYLE_IDS, PALETTES } from "./render.js";
import { THEME_NAMES, resolveTheme } from "./themes.js";
import { clampField, WAVEFORM_NAMES, GRADIENT_NAMES, resolveGradient } from "./wave.js";
import { clamp, LIMITS, viewDefaultsFor } from "./settings.js";
import { AVATAR_NAMES, DEFAULT_AVATAR } from "./avatar.js";
import { isAnimated, isField, resetView } from "./state.js";

// SGR mouse reports, CSI and SS3 sequences (arrow keys), a lone Esc, or any single character.
const TOKEN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])|\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/g;

/** Split raw terminal input into `{ key }` and `{ mouse: { button, col, row, released } }` events. */
export function parseInput(text) {
  return [...text.matchAll(TOKEN)].map(([token, button, col, row, kind]) =>
    button === undefined
      ? { key: token }
      : { mouse: { button: Number(button), col: Number(col), row: Number(row), released: kind === "m" } },
  );
}

/** The entry `step` places after `current` in `list`, wrapping around. */
function cycle(list, current, step) {
  const idx = Math.max(0, list.indexOf(current));
  return list[(idx + step + list.length) % list.length];
}

const pitchBy = (state, delta) => (state.pitch = clamp(state.pitch + delta, LIMITS.pitch));
const zoomBy = (state, factor) => (state.zoom = clamp(state.zoom * factor, LIMITS.zoom));
const waveBy = (state, key, delta) =>
  (state.wave = clampField({ ...state.wave, [key]: Number((state.wave[key] + delta).toFixed(2)) }));

// Lowercase steps forward, uppercase (or the left key of a pair) back.
const KEYS = [
  { keys: ["q", "Q", "\x03", "\x1b"], run: () => "quit" },
  { keys: ["\x1b[D", "\x1bOD", "h"], run: (s) => void (s.yaw -= 10) },
  { keys: ["\x1b[C", "\x1bOC", "l"], run: (s) => void (s.yaw += 10) },
  { keys: ["\x1b[A", "\x1bOA", "k"], run: (s) => void pitchBy(s, 5) },
  { keys: ["\x1b[B", "\x1bOB", "j"], run: (s) => void pitchBy(s, -5) },
  { keys: ["+", "="], run: (s) => void zoomBy(s, 1.1) },
  { keys: ["-", "_"], run: (s) => void zoomBy(s, 1 / 1.1) },
  { keys: ["s", "S"], run: (s, key) => void (s.style = cycle(STYLE_IDS, s.style, key === "s" ? 1 : -1)) },
  { keys: ["g", "G"], run: (s, key) => void (s.palette = cycle(PALETTES, s.palette, key === "g" ? 1 : -1)) },
  {
    keys: ["c", "C"],
    run: (s, key) => {
      const step = key === "c" ? 1 : -1;
      // The field is colored by its gradient and rebuilt every frame anyway.
      if (isField(s)) return void (s.gradient = resolveGradient(cycle(GRADIENT_NAMES, s.gradient.name, step)));
      s.theme = resolveTheme(cycle(THEME_NAMES, s.theme.name, step));
      return "colors";
    },
  },
  {
    keys: ["m", "M"],
    run: (s, key) => {
      s.sourceIdx = (s.sourceIdx + (key === "m" ? 1 : -1) + s.sources.length) % s.sources.length;
      return "model";
    },
  },
  {
    // Avatars only, each with its own view; from any other model, the default avatar.
    keys: ["a", "A"],
    run: (s, key) => {
      const current = AVATAR_NAMES.indexOf(s.source);
      const next =
        current < 0
          ? DEFAULT_AVATAR
          : AVATAR_NAMES[(current + (key === "a" ? 1 : -1) + AVATAR_NAMES.length) % AVATAR_NAMES.length];
      s.sourceIdx = s.sources.indexOf(next);
      Object.assign(s, viewDefaultsFor(next));
      return "model";
    },
  },
  { keys: [" "], run: (s) => void (s.paused = !s.paused) },
  { keys: ["i", "I"], run: (s) => void (s.stats = !s.stats) },
  {
    keys: ["[", "]"],
    run: (s, key) => {
      const step = key === "]" ? 1 : -1;
      if (isAnimated(s)) waveBy(s, "speed", step * 0.25);
      else s.spin = clamp(s.spin + step * 10, LIMITS.spin);
    },
  },
  {
    keys: ["w", "W"],
    run: (s, key) => void (s.wave.waveform = cycle(WAVEFORM_NAMES, s.wave.waveform, key === "w" ? 1 : -1)),
  },
  { keys: ["d", "D"], run: (s) => void (isField(s) && (s.data = s.data === "cpu" ? "demo" : "cpu")) },
  { keys: ["{", "}"], run: (s, key) => void waveBy(s, "lines", key === "}" ? 1 : -1) },
  { keys: [",", "."], run: (s, key) => void waveBy(s, "frequency", key === "." ? 0.5 : -0.5) },
  { keys: [";", "'"], run: (s, key) => void waveBy(s, "amplitude", key === "'" ? 0.1 : -0.1) },
  { keys: ["r", "R"], run: (s, key, options) => void resetView(s, options) },
  ...STYLE_IDS.map((id, i) => ({ keys: [String(i + 1)], run: (s) => void (s.style = id) })),
];

const BY_KEY = new Map(KEYS.flatMap((binding) => binding.keys.map((key) => [key, binding])));

/**
 * Apply one key to `state`. Returns null for unbound keys, otherwise the
 * effect the viewer has to carry out: "quit", "model" (load
 * `state.sources[state.sourceIdx]`), "colors" (recolor the model) or
 * "changed" (nothing beyond redrawing).
 */
export function handleKey(state, key, options) {
  state.message = "";
  const binding = BY_KEY.get(key);
  if (!binding) return null;
  return binding.run(state, key, options) ?? "changed";
}

/** Wheel zooms; dragging with the left button rotates. */
export function handleMouse(state, { button, col, row, released }) {
  if (button === 64 || button === 65) {
    zoomBy(state, button === 64 ? 1.1 : 1 / 1.1);
  } else if (released) {
    state.drag = null;
  } else if (button === 0) {
    state.drag = { col, row };
  } else if (button === 32 && state.drag) {
    state.yaw += (col - state.drag.col) * 4;
    pitchBy(state, (row - state.drag.row) * 6);
    state.drag = { col, row };
  }
}
