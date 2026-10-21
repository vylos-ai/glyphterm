// The interactive viewer's state: one plain object that input handlers,
// the scene file and the HUD read and change.

import { PRIMITIVE_NAMES, isPrimitive } from "./models.js";
import { PAPER } from "./themes.js";
import { clampField, defaultsFor } from "./wave.js";

/** `options` are the validated settings from the command line (see settings.js). */
export function createState(options) {
  // The `m` key cycles through the starting model and every primitive.
  const sources = isPrimitive(options.model) ? PRIMITIVE_NAMES : [options.model, ...PRIMITIVE_NAMES];
  return {
    sources,
    sourceIdx: sources.indexOf(options.model),
    source: options.model,
    model: null,
    polygons: [],
    lines: null,
    style: options.style,
    palette: options.palette,
    theme: options.theme,
    yaw: options.yaw,
    pitch: options.pitch,
    zoom: options.zoom,
    spin: options.spin,
    paused: false,
    time: 0,
    // Shared by the "wave" and "field" models; `lines` only matters for the field.
    wave: clampField({ ...defaultsFor(options.model), ...options.wave }),
    gradient: options.gradient,
    // What the field shows: "demo" signals or live "cpu" load per core.
    data: options.data,
    caption: "",
    // The avatar's activity (see avatar.js), when it started (in `time`), and
    // the one a short-lived activity returns to. `sceneActivity` is the scene
    // file's last word, so only a new one restarts an activity.
    activity: options.activity ?? "",
    activitySince: 0,
    activityBefore: "",
    activityShown: "",
    sceneActivity: options.activity ?? "",
    motion: null,
    message: "",
    messageIsError: false,
    fps: 0,
    drag: null,
  };
}

/** Back to the starting view and wave settings; colors and style stay. */
export function resetView(state, options) {
  Object.assign(state, {
    yaw: options.yaw,
    pitch: options.pitch,
    zoom: options.zoom,
    spin: options.spin,
    paused: false,
    wave: clampField({ ...defaultsFor(options.model), ...options.wave }),
  });
}

export const isAnimated = (state) => Boolean(state.model?.animated);
export const isField = (state) => state.source === "field" && isAnimated(state);

/** The theme color, or paper white for "original". */
export const accent = (state) => state.theme.color ?? PAPER;

export function flash(state, message, isError = false) {
  state.message = message;
  state.messageIsError = isError;
}
