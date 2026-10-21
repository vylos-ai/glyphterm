// What renderFrame draws for a loaded model: colored polygons, or polylines
// for the field. Shared by the interactive viewer and `--once`.

import { isPrimitive } from "./models.js";
import { PAPER, PHOSPHOR, tint } from "./themes.js";
import { wavePolygons, fieldLines, dataLines, GRADIENTS } from "./wave.js";

/**
 * `theme` colors meshes and the scope trace; the field uses the gradient `stops`.
 * For the field, `samples` ({ series, history?, progress? }) switches from the
 * demo signals to real data. Animated models depend on `time`.
 */
export function modelGeometry(model, { theme, stops = GRADIENTS.synthwave, wave = {}, time = 0, samples = null } = {}) {
  const color = theme?.color ?? null;
  if (model.animated && model.name === "field") {
    const lines = samples
      ? dataLines({
          ...samples,
          names: samples.series.map((_, i) => `cpu${i}`),
          stops,
          amplitude: wave.amplitude ?? 1,
        })
      : fieldLines({ ...wave, time, stops });
    return { polygons: [], lines };
  }
  if (model.animated) {
    return { polygons: wavePolygons({ ...wave, time, color: color ?? PHOSPHOR }), lines: null };
  }
  // Primitives have no colors of their own; "original" shows them in paper white.
  return { polygons: tint(model.polygons, color ?? (isPrimitive(model.name) ? PAPER : null)), lines: null };
}
