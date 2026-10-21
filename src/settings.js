// View settings shared by the command line and the scene file: their limits,
// per-model defaults, and one validator so both accept exactly the same values.

import { STYLE_IDS, PALETTES } from "./render.js";
import { THEME_NAMES, resolveTheme } from "./themes.js";
import { WAVEFORM_NAMES, GRADIENT_NAMES, WAVE_VIEW, FIELD_VIEW, resolveGradient } from "./wave.js";

export const LIMITS = {
  pitch: [-89, 89],
  zoom: [0.2, 8],
  spin: [-720, 720],
  fps: [1, 120],
};

export const clamp = (value, [min, max]) => Math.max(min, Math.min(max, value));

/** What the field model shows: demo signals or live load per CPU core. */
export const DATA_SOURCES = ["demo", "cpu"];

const DEFAULT_VIEW = { yaw: 30, pitch: 20, zoom: 1, spin: 40 };

/** Animated models have their own best view. */
export function viewDefaultsFor(model) {
  return { wave: WAVE_VIEW, field: FIELD_VIEW }[model] ?? DEFAULT_VIEW;
}

const WAVE_NUMBERS = ["frequency", "amplitude", "speed", "lines"];

/**
 * Check a partial set of settings (parsed flags or a scene file). Returns
 * `values` with every valid setting, resolved and clamped, plus `problems`
 * describing the rejected ones. Unknown keys and keys of the wrong type are
 * ignored, so a scene file can carry extra fields.
 */
export function parseSettings(input) {
  const values = {};
  const problems = [];
  const pick = (key, valid, list) => {
    if (typeof input[key] !== "string") return;
    if (valid(input[key])) values[key] = input[key];
    else problems.push(`unknown ${key} "${input[key]}" (${list})`);
  };

  pick("style", (id) => STYLE_IDS.includes(id), STYLE_IDS.join(", "));
  pick("palette", (name) => PALETTES.includes(name), PALETTES.join(", "));
  pick("data", (name) => DATA_SOURCES.includes(name), DATA_SOURCES.join(", "));

  if (typeof input.color === "string") {
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
    if (Number.isFinite(input[key])) values[key] = LIMITS[key] ? clamp(input[key], LIMITS[key]) : input[key];
  }
  if (typeof input.paused === "boolean") values.paused = input.paused;
  if (typeof input.caption === "string") values.caption = input.caption;

  // Wave settings are merged into the current ones and clamped there (see clampField).
  if (input.wave && typeof input.wave === "object") {
    const wave = {};
    const { waveform } = input.wave;
    if (typeof waveform === "string") {
      if (WAVEFORM_NAMES.includes(waveform)) wave.waveform = waveform;
      else problems.push(`unknown waveform "${waveform}" (${WAVEFORM_NAMES.join(", ")})`);
    }
    for (const key of WAVE_NUMBERS) {
      if (Number.isFinite(input.wave[key])) wave[key] = input.wave[key];
    }
    values.wave = wave;
  }

  return { values, problems };
}
