// The scene file: a JSON mirror of the viewer state that other programs
// (e.g. AI agents) edit to steer the view. Reading, writing and watching the
// file happens in viewer.js; these functions only translate.

import { dirname, resolve, isAbsolute } from "node:path";
import { isPrimitive } from "./models.js";
import { parseSettings } from "./settings.js";
import { clampField } from "./wave.js";
import { isAnimated, isField } from "./state.js";

/** The current view as a scene file object. */
export function sceneSnapshot(state) {
  return {
    model: state.source,
    style: state.style,
    palette: state.palette,
    color: state.theme.name,
    yaw: Math.round(((state.yaw % 360) + 360) % 360),
    pitch: Math.round(state.pitch),
    zoom: Number(state.zoom.toFixed(2)),
    spin: state.spin,
    paused: state.paused,
    caption: state.caption,
    ...(isAnimated(state) && { wave: { ...state.wave } }),
    ...(isField(state) && {
      gradient: state.gradient.name === "custom" ? state.gradient.stops : state.gradient.name,
      data: state.data,
    }),
  };
}

/**
 * Apply a parsed scene file to `state`, except the model, which has to be
 * loaded. Returns the problems found; invalid values leave the state alone.
 */
export function applyScene(state, scene) {
  // Parsed settings use the state's own names, so they apply directly.
  const { values, problems } = parseSettings(scene);
  const { wave, ...plain } = values;
  Object.assign(state, plain);
  if (wave) state.wave = clampField({ ...state.wave, ...wave });
  return problems;
}

/**
 * The model a scene asks for, or null if it doesn't change it. Relative paths
 * are relative to the scene file.
 */
export function sceneModel(state, scene, scenePath) {
  if (typeof scene.model !== "string" || scene.model === state.source) return null;
  if (isPrimitive(scene.model) || isAbsolute(scene.model)) return scene.model;
  return resolve(dirname(scenePath), scene.model);
}
