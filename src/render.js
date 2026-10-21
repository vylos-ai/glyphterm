// One frame: normalized polygons + view settings -> terminal lines.

import { buildRasterizeContext, rasterize, createGlyphCamera } from "glyphcss";
import { htmlToLines, overlayText } from "./ansi.js";

// Each style is one glyphcss render mode + character encoding.
export const STYLES = [
  { id: "shade", label: "ascii shade", mode: "solid", charMode: "ascii" },
  { id: "halfblock", label: "half-block", mode: "solid", charMode: "halfblock" },
  { id: "quadrant", label: "quadrant", mode: "solid", charMode: "quadrant" },
  // glyphcss's hidden-line pass drops visible edges in ASCII wireframes, so
  // that style is always x-ray; braille handles hidden lines well.
  { id: "wire", label: "x-ray wire", mode: "wireframe", charMode: "ascii", hiddenLines: "show" },
  { id: "braille", label: "braille wire", mode: "wireframe", charMode: "braille", hiddenLines: "hide" },
  { id: "xray", label: "braille x-ray", mode: "wireframe", charMode: "braille", hiddenLines: "show" },
  { id: "ink", label: "ink outline", mode: "ink", charMode: "ascii" },
];

export const STYLE_IDS = STYLES.map((s) => s.id);

// glyphcss glyph palettes; "auto" lets each style use its own default.
export const PALETTES = [
  "auto",
  "ascii",
  "detail",
  "dense",
  "lines",
  "blocks",
  "dots",
  "stars",
  "braille",
  "runes",
  "math",
  "binary",
  "hex",
  "arrows",
];

export function findStyle(id) {
  return STYLES.find((s) => s.id === id);
}

// We rotate the model ourselves and keep glyphcss's camera fixed, so the light
// stays attached to the viewer instead of the world (no dark side while
// orbiting). With an unrotated glyphcss camera, screen-down is +x,
// screen-right is +y and +z points at the viewer.
const toGlyph = ([x, y, z]) => [-y, x, z];
const LIGHT = { direction: unit(toGlyph([-0.5, 0.6, 0.8])), intensity: 0.75 };
const AMBIENT = { intensity: 0.15 };
// "Glow" lighting for line-like models (oscilloscope traces): mostly ambient, so
// thin tubes keep their color on every side instead of speckling dark.
const GLOW_LIGHT = { ...LIGHT, intensity: 0.35 };
const GLOW_AMBIENT = { intensity: 0.75 };

function unit(v) {
  const len = Math.hypot(...v);
  return v.map((c) => c / len);
}

/**
 * Model space is the usual y-up / z-toward-viewer convention (OBJ, glTF).
 * `yaw` spins around the vertical axis, `pitch` tips the top toward the viewer.
 */
function viewTransform(yawDeg, pitchDeg) {
  const a = (yawDeg * Math.PI) / 180;
  const b = (pitchDeg * Math.PI) / 180;
  const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  return ([x, y, z]) => {
    const x1 = x * ca + z * sa;
    const z1 = -x * sa + z * ca;
    return toGlyph([x1, y * cb - z1 * sb, y * sb + z1 * cb]);
  };
}

/**
 * Render `polygons` (bounding radius 1) into `rows` lines of `cols` cells.
 * Terminal cells are about twice as tall as wide, which glyphcss compensates
 * for via cellAspect; with cellWidth=1 the camera zoom is "cells per unit".
 */
export function renderFrame({
  polygons = [],
  lines = null,
  style,
  palette = "auto",
  yaw = 0,
  pitch = 20,
  zoom = 1,
  cols,
  rows,
  color = true,
  glow = false,
}) {
  const rotate = viewTransform(yaw, pitch);
  if (lines) return renderLines({ lines, style, rotate, zoom, cols, rows, color });
  const viewed = polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(rotate),
    shadingNormal: p.shadingNormal && rotate(p.shadingNormal),
  }));
  // The decorative glyphcss default reads poorly for wireframes; plain ASCII
  // plus box-drawing junctions looks like a classic vector display.
  const glyphPalette = palette !== "auto" ? palette : style.mode === "wireframe" ? "ascii" : undefined;
  const fit = (0.92 * Math.min(cols, rows * 2)) / 2;
  const ctx = buildRasterizeContext({
    camera: createGlyphCamera({ rotX: 0, rotY: 0, zoom: fit * zoom }),
    grid: { cols, rows, cellAspect: 2, cellWidth: 1, cellHeight: 2 },
    polygons: viewed,
    mode: style.mode,
    charMode: style.charMode,
    glyphPalette,
    directionalLight: glow ? GLOW_LIGHT : LIGHT,
    ambientLight: glow ? GLOW_AMBIENT : AMBIENT,
    hiddenLines: style.hiddenLines ?? "show",
    wireframeJunctions: style.mode === "wireframe" && style.charMode === "ascii" && glyphPalette === "ascii",
    useColors: color,
  });
  return htmlToLines(rasterize(ctx), { color });
}

// --- Polylines (data-visualization models) -----------------------------------

const HORIZON_BUCKETS = 1200;

/**
 * Draw polylines as crisp line art. Unless the style is x-ray, lines hide
 * each other like a ridgeline plot: each line has an invisible curtain
 * hanging below it, so only the parts that rise above every line in front of
 * it are drawn. The camera is orthographic, so this works in screen space:
 * glyph-space y is screen-right and -x is screen-up.
 */
function renderLines({ lines, style, rotate, zoom, cols, rows, color }) {
  const projected = lines.map(({ points, color: lineColor, label, value, labelAt }) => {
    const pts = points.map(rotate);
    const depth = pts.reduce((sum, p) => sum + p[2], 0) / pts.length;
    return { pts, color: lineColor, depth, label, value, labelAt: labelAt ? rotate(labelAt) : pts[0] };
  });
  projected.sort((a, b) => b.depth - a.depth); // nearest first

  const occlude = style.id !== "xray";
  const horizon = new Float64Array(HORIZON_BUCKETS).fill(-Infinity);
  const bucket = (screenX) => Math.round(((screenX + 1.5) / 3) * (HORIZON_BUCKETS - 1));
  const edges = [];

  for (const { pts, color: lineColor } of projected) {
    const visible = (p) => {
      if (!occlude) return true;
      const b = bucket(p[1]);
      return b < 0 || b >= HORIZON_BUCKETS || -p[0] > horizon[b] + 1e-4;
    };
    for (let i = 0; i < pts.length - 1; i++) {
      // Split each segment finely enough that partial visibility looks right.
      const [a, b] = [pts[i], pts[i + 1]];
      const steps = Math.max(1, Math.ceil(Math.abs(bucket(b[1]) - bucket(a[1]))));
      let runStart = null;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = a.map((v, j) => v + (b[j] - v) * t);
        if (visible(p)) runStart ??= p;
        else if (runStart) {
          edges.push({ from: runStart, to: p, color: lineColor, weight: 2 });
          runStart = null;
        }
        if (k === steps && runStart && runStart !== p)
          edges.push({ from: runStart, to: p, color: lineColor, weight: 2 });
      }
    }
    if (occlude) raiseHorizon(horizon, pts, bucket);
  }

  const fit = (0.92 * Math.min(cols, rows * 2)) / 2;
  const scale = fit * zoom;
  const ctx = buildRasterizeContext({
    camera: createGlyphCamera({ rotX: 0, rotY: 0, zoom: scale }),
    grid: { cols, rows, cellAspect: 2, cellWidth: 1, cellHeight: 2 },
    wireframe: edges,
    mode: "wireframe",
    charMode: style.id === "wire" ? "ascii" : "braille",
    glyphPalette: "ascii",
    wireframeJunctions: style.id === "wire",
    useColors: color,
  });
  const out = htmlToLines(rasterize(ctx), { color });

  // Labels go at the line ends: name on the left, value on the right.
  // Measured glyphcss projection (orthographic, unrotated camera).
  const cell = ([gx, gy]) => [Math.floor(rows / 2 + (gx * scale) / 2), Math.floor(cols / 2 + gy * scale)];
  for (const { pts, color: lineColor, label, value, labelAt } of projected) {
    const textColor = color ? lineColor : null;
    if (label) {
      const [row, col] = cell(labelAt);
      if (out[row] !== undefined) out[row] = overlayText(out[row], col - label.length - 1, label, textColor);
    }
    if (value) {
      const [row, col] = cell(pts.at(-1));
      if (out[row] !== undefined) out[row] = overlayText(out[row], col + 2, value, textColor);
    }
  }
  return out;
}

/** After a line is drawn, nothing behind it may show below its height. */
function raiseHorizon(horizon, pts, bucket) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const [ba, bb] = [bucket(a[1]), bucket(b[1])];
    const [lo, hi] = ba <= bb ? [ba, bb] : [bb, ba];
    for (let k = Math.max(0, lo); k <= Math.min(HORIZON_BUCKETS - 1, hi); k++) {
      const t = hi === lo ? 0 : (k - ba) / (bb - ba);
      horizon[k] = Math.max(horizon[k], -(a[0] + (b[0] - a[0]) * t));
    }
  }
}
