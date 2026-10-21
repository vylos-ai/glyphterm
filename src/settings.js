// View settings shared by the command line and the scene file: their limits,
// per-model defaults, and one validator so both accept exactly the same values.

import { STYLE_IDS, PALETTES } from "./render.js";
import { THEME_NAMES, resolveTheme } from "./themes.js";
import { WAVEFORM_NAMES, GRADIENT_NAMES, WAVE_VIEW, FIELD_VIEW, resolveGradient } from "./wave.js";
import { ACTIVITY_IDS } from "./avatar.js";
import { SESSION_NUMBERS, TOOL_GROUP_IDS, RECENT_CALLS } from "./session.js";

export const LIMITS = {
  pitch: [-89, 89],
  zoom: [0.2, 8],
  spin: [-720, 720],
  fps: [1, 120],
  contextLimit: [10_000, 10_000_000],
};

// More running subagents than this are drawn as this many.
export const MAX_SATELLITES = 8;

export const clamp = (value, [min, max]) => Math.max(min, Math.min(max, value));

/** What the field model shows: demo signals or live load per CPU core. */
export const DATA_SOURCES = ["demo", "cpu"];

const DEFAULT_VIEW = { yaw: 30, pitch: 20, zoom: 1, spin: 40 };
// Avatars stand still, with room to hop; the core is seen a little from above, for its floor.
const BUDDY_VIEW = { yaw: 20, pitch: 8, zoom: 0.9, spin: 0 };
const CORE_VIEW = { yaw: 30, pitch: 28, zoom: 1, spin: 0 };
const CLOUD_VIEW = { yaw: 0, pitch: 10, zoom: 1, spin: 0 };

/** Animated models and the avatar have their own best view. */
export function viewDefaultsFor(model) {
  return (
    { wave: WAVE_VIEW, field: FIELD_VIEW, buddy: BUDDY_VIEW, core: CORE_VIEW, cloud: CLOUD_VIEW }[model] ?? DEFAULT_VIEW
  );
}

const WAVE_NUMBERS = ["frequency", "amplitude", "speed", "lines"];

/** Every key a scene file may have; anything else is most likely a typo. */
export const SCENE_KEYS = [
  "model",
  "style",
  "palette",
  "color",
  "yaw",
  "pitch",
  "zoom",
  "spin",
  "paused",
  "caption",
  "activity",
  "stats",
  "spectrum",
  "contextLimit",
  "session",
  "wave",
  "gradient",
  "data",
];
const WAVE_KEYS = ["waveform", ...WAVE_NUMBERS];

/** Problems for keys a scene file doesn't know, at the top level and in `wave`. */
export function unknownSceneKeys(scene) {
  const unknown = Object.keys(scene).filter((key) => !SCENE_KEYS.includes(key));
  if (scene.wave && typeof scene.wave === "object") {
    unknown.push(
      ...Object.keys(scene.wave)
        .filter((key) => !WAVE_KEYS.includes(key))
        .map((key) => `wave.${key}`),
    );
  }
  return unknown.map((key) => `unknown key "${key}" (${SCENE_KEYS.join(", ")}; wave: ${WAVE_KEYS.join(", ")})`);
}

/**
 * Check a partial set of settings (parsed flags or a scene file). Returns
 * `values` with every valid setting, resolved and clamped, plus `problems`
 * describing the rejected ones, including values of the wrong type. Keys it
 * doesn't know are ignored here (see `unknownSceneKeys`); `undefined` means unset.
 */
export function parseSettings(input) {
  const values = {};
  const problems = [];
  const typeIs = (key, value, type) => {
    if (value === undefined) return false;
    const ok =
      type === "number"
        ? Number.isFinite(value)
        : type === "object"
          ? value !== null && typeof value === "object" && !Array.isArray(value)
          : typeof value === type;
    if (ok) return true;
    problems.push(`${key} must be ${type === "object" ? "an" : "a"} ${type}, got ${JSON.stringify(value)}`);
    return false;
  };
  const pick = (key, valid, list) => {
    if (!typeIs(key, input[key], "string")) return;
    if (valid(input[key])) values[key] = input[key];
    else problems.push(`unknown ${key} "${input[key]}" (${list})`);
  };

  pick("style", (id) => STYLE_IDS.includes(id), STYLE_IDS.join(", "));
  pick("palette", (name) => PALETTES.includes(name), PALETTES.join(", "));
  pick("data", (name) => DATA_SOURCES.includes(name), DATA_SOURCES.join(", "));

  if (typeIs("color", input.color, "string")) {
    const theme = resolveTheme(input.color);
    if (theme) values.theme = theme;
    else problems.push(`unknown color "${input.color}" (${THEME_NAMES.join(", ")}, or #rrggbb)`);
  }
  if (input.gradient !== undefined) {
    const gradient = resolveGradient(input.gradient);
    if (gradient) values.gradient = gradient;
    else {
      const shown = typeof input.gradient === "string" ? ` "${input.gradient}"` : "";
      problems.push(`unknown gradient${shown} (${GRADIENT_NAMES.join(", ")}, or a list of #rrggbb)`);
    }
  }

  for (const key of ["yaw", "pitch", "zoom", "spin"]) {
    if (typeIs(key, input[key], "number")) values[key] = LIMITS[key] ? clamp(input[key], LIMITS[key]) : input[key];
  }
  if (typeIs("paused", input.paused, "boolean")) values.paused = input.paused;
  if (typeIs("caption", input.caption, "string")) values.caption = input.caption;
  // "" clears the activity.
  pick("activity", (id) => id === "" || ACTIVITY_IDS.includes(id), `${ACTIVITY_IDS.join(", ")}, or "" for none`);

  if (typeIs("stats", input.stats, "boolean")) values.stats = input.stats;
  if (typeIs("spectrum", input.spectrum, "boolean")) values.spectrum = input.spectrum;
  if (typeIs("contextLimit", input.contextLimit, "number")) {
    values.contextLimit = Math.round(clamp(input.contextLimit, LIMITS.contextLimit));
  }
  // Written by the hooks (see session.js); fields of the wrong type are dropped.
  if (typeIs("session", input.session, "object")) {
    const { model, calls, satellites } = input.session;
    const count = (n) => Number.isFinite(n) && n >= 0;
    const call = (c) =>
      Array.isArray(c) &&
      count(c[0]) &&
      TOOL_GROUP_IDS.includes(c[1]) &&
      (c[2] === 0 || c[2] === 1) &&
      typeof c[3] === "string";
    const satellite = (a) => Array.isArray(a) && typeof a[0] === "string" && a[0] && count(a[1]);
    values.session = {
      ...(typeof model === "string" && { model }),
      ...(Array.isArray(calls) && { calls: calls.filter(call).slice(-RECENT_CALLS) }),
      ...(Array.isArray(satellites) && { satellites: satellites.filter(satellite).slice(0, MAX_SATELLITES) }),
      ...Object.fromEntries(
        SESSION_NUMBERS.filter((key) => count(input.session[key])).map((key) => [key, input.session[key]]),
      ),
    };
  }

  // Wave settings are merged into the current ones and clamped there (see clampField).
  if (typeIs("wave", input.wave, "object")) {
    const wave = {};
    const { waveform } = input.wave;
    if (typeIs("wave.waveform", waveform, "string")) {
      if (WAVEFORM_NAMES.includes(waveform)) wave.waveform = waveform;
      else problems.push(`unknown waveform "${waveform}" (${WAVEFORM_NAMES.join(", ")})`);
    }
    for (const key of WAVE_NUMBERS) {
      if (typeIs(`wave.${key}`, input.wave[key], "number")) wave[key] = input.wave[key];
    }
    values.wave = wave;
  }

  return { values, problems };
}
