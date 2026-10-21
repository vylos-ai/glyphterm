// The scene file: a JSON mirror of the viewer state that other programs
// (e.g. AI agents) edit to steer the view. Reading, writing and watching the
// file happens in viewer.js; these functions only translate.

import { dirname, resolve, relative, isAbsolute } from "node:path";
import { isPrimitive } from "./models.js";
import { parseSettings, unknownSceneKeys } from "./settings.js";
import { clampField } from "./wave.js";
import { isAnimated, isField } from "./state.js";
import { setActivity } from "./avatar.js";

/**
 * How a scene file names `source`: primitives by name, files relative to the
 * scene file when they sit below it, else absolute (as the viewer keeps them).
 */
export function sceneModelName(source, scenePath) {
  if (isPrimitive(source)) return source;
  const path = relative(dirname(scenePath), source);
  return path.startsWith("..") || isAbsolute(path) ? source : path;
}

/** The current view as a scene file object for the file at `scenePath`. */
export function sceneSnapshot(state, scenePath) {
  return {
    model: sceneModelName(state.source, scenePath),
    style: state.style,
    palette: state.palette,
    color: state.theme.name,
    yaw: Math.round(((state.yaw % 360) + 360) % 360),
    pitch: Math.round(state.pitch),
    zoom: Number(state.zoom.toFixed(2)),
    spin: state.spin,
    paused: state.paused,
    caption: state.caption,
    ...(state.activity && { activity: state.activity }),
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
  const { wave, activity, ...plain } = values;
  Object.assign(state, plain);
  if (wave) state.wave = clampField({ ...state.wave, ...wave });
  // Other edits to the file leave a running activity alone.
  if (activity !== undefined && activity !== state.sceneActivity) {
    state.sceneActivity = activity;
    setActivity(state, activity);
  }
  return [...problems, ...unknownSceneKeys(scene)];
}

/** A scene's model: a primitive name, or a path relative to the scene file. */
export function resolveSceneModel(model, scenePath) {
  return isPrimitive(model) || isAbsolute(model) ? model : resolve(dirname(scenePath), model);
}

/** The model a scene asks for, or null if it doesn't change it. */
export function sceneModel(state, scene, scenePath) {
  if (typeof scene.model !== "string") return null;
  const source = resolveSceneModel(scene.model, scenePath);
  return source === state.source ? null : source;
}

/** Where the viewer reports on a scene file: scene.json -> scene.status.json. */
export function statusPath(scenePath) {
  return scenePath.replace(/(\.json)?$/i, ".status.json");
}
