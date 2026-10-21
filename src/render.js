// One frame: normalized polygons + view settings -> terminal lines.

import { buildRasterizeContext, rasterize, createGlyphCamera, WIREFRAME_PALETTES } from "glyphcss";
import { htmlToLines, overlayText, halfblockPixels, downsamplePixels, pixelsToLines, fg, term } from "./ansi.js";

// Each style is one glyphcss render mode + character encoding. Only the ASCII
// shade and wire use a glyph palette; the others have fixed characters.
export const STYLES = [
  { id: "shade", label: "ascii shade", mode: "solid", charMode: "ascii", glyphs: true },
  { id: "halfblock", label: "half-block", mode: "solid", charMode: "halfblock" },
  { id: "quadrant", label: "quadrant", mode: "solid", charMode: "quadrant" },
  // glyphcss's hidden-line pass drops visible edges in ASCII wireframes, so
  // that style is always x-ray; braille handles hidden lines well.
  { id: "wire", label: "x-ray wire", mode: "wireframe", charMode: "ascii", hiddenLines: "show", glyphs: true },
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
  // Not a glyphcss palette: the cloud drawn as braille dots, one per particle (see renderPoints).
  "fine",
];

/** A palette's characters for drawing with directly (the cloud), or null for "auto". */
export function paletteGlyphs(name) {
  const palette = name === "auto" ? null : WIREFRAME_PALETTES[name];
  // The "core" glyphs include solid blocks, too heavy for loose particles.
  return palette ? palette.normal : null;
}

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
 * `motion` (an avatar's, see avatar.js) then rolls the model in the screen
 * plane, scales it and moves it by `x`/`y` model units. Returns the transform
 * for points and the one for normals, which only rotates.
 */
function viewTransform(yawDeg, pitchDeg, { roll = 0, scale = 1, x: dx = 0, y: dy = 0 } = {}) {
  const a = (yawDeg * Math.PI) / 180;
  const b = (pitchDeg * Math.PI) / 180;
  const r = (roll * Math.PI) / 180;
  const [ca, sa, cb, sb, cr, sr] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(r), Math.sin(r)];
  const view = ([x, y, z]) => {
    const x1 = x * ca + z * sa;
    const z1 = -x * sa + z * ca;
    const y2 = y * cb - z1 * sb;
    return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, y * sb + z1 * cb];
  };
  return {
    rotate: (v) => toGlyph(view(v)),
    place: (v) => {
      const [x, y, z] = view(v);
      return toGlyph([x * scale + dx, y * scale + dy, z * scale]);
    },
  };
}

// Samples per pixel along each axis for half-block rendering.
const SUPERSAMPLE = 2;

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
  motion,
  supersample = SUPERSAMPLE,
  underlay = null,
  points = null,
}) {
  const { rotate, place } = viewTransform(yaw, pitch, motion);
  if (lines) return renderLines({ lines, style, rotate, zoom, cols, rows, color });
  if (points) return renderPoints({ points, place, zoom, cols, rows, color, fine: palette === "fine" });
  const viewed = polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(place),
    shadingNormal: p.shadingNormal && rotate(p.shadingNormal),
  }));
  // The decorative glyphcss default reads poorly for wireframes; plain ASCII
  // plus box-drawing junctions looks like a classic vector display.
  const own = palette !== "auto" && palette !== "fine";
  const glyphPalette = own ? palette : style.mode === "wireframe" ? "ascii" : undefined;
  // Half-blocks are plain pixels, so they can be supersampled: rendered larger
  // and averaged back down, which smooths stair-stepped edges.
  const factor = style.charMode === "halfblock" && color ? supersample : 1;
  const [gridCols, gridRows] = [cols * factor, rows * factor];
  const fit = (0.92 * Math.min(gridCols, gridRows * 2)) / 2;
  const ctx = buildRasterizeContext({
    camera: createGlyphCamera({ rotX: 0, rotY: 0, zoom: fit * zoom }),
    grid: { cols: gridCols, rows: gridRows, cellAspect: 2, cellWidth: 1, cellHeight: 2 },
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
  if (factor > 1 || (underlay && style.charMode === "halfblock" && color)) {
    const pixels = halfblockPixels(rasterize(ctx));
    if (underlay) drawUnderlay(pixels, underlay, place, fit * zoom, factor);
    return pixelsToLines(factor > 1 ? downsamplePixels(pixels, factor) : pixels);
  }
  return htmlToLines(rasterize(ctx), { color });
}

/**
 * Draw `segments` ({ from, to, color } in model space) into the empty pixels
 * of a half-block frame, behind everything rendered: a floor grid, say.
 * glyphcss drops thin polygons seen edge-on, but lines drawn here stay whole,
 * and supersampling smooths them. Lines are `width` pixels wide, so they
 * keep one pixel after downsampling by that factor. Farther parts are dimmer.
 */
function drawUnderlay(pixels, segments, place, scale, width = 1) {
  const [rows, cols] = [pixels.length, pixels[0]?.length ?? 0];
  // What the rasterizer drew; the underlay only fills in around it.
  const covered = pixels.map((row) => row.map(Boolean));
  // Measured glyphcss projection (see the labels in renderLines), in pixels: two per cell row.
  const project = ([gx, gy, gz]) => [cols / 2 + gy * scale, rows / 2 + gx * scale, gz];
  for (const { from, to, color } of segments) {
    const [a, b] = [project(place(from)), project(place(to))];
    const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))) + 1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const [x, y, z] = a.map((v, i) => v + (b[i] - v) * t);
      const shade = dim(color, Math.min(1, Math.max(0.25, 0.6 + z * 0.5)));
      const [x0, y0] = [Math.round(x - width / 2), Math.round(y - width / 2)];
      for (let py = Math.max(0, y0); py < Math.min(rows, y0 + width); py++) {
        for (let px = Math.max(0, x0); px < Math.min(cols, x0 + width); px++) {
          if (!covered[py][px]) pixels[py][px] = shade;
        }
      }
    }
  }
}

/** `hex` darkened to `amount` (0..1) of its brightness. */
function dim(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((c) =>
        Math.round(c * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// --- Points (the glyph cloud) ------------------------------------------------

const FAR_GLYPH = "·";

/**
 * Draw `points` ({ at, char, color, bright, keep }) as characters, each in the
 * cell it projects to; nearer ones cover farther ones. Depth sets the
 * brightness, and the farthest shrink to a dot unless they `keep` their
 * character. The style doesn't apply: the characters are the picture.
 */
function renderPoints({ points, place, zoom, cols, rows, color, fine = false }) {
  const scale = ((0.92 * Math.min(cols, rows * 2)) / 2) * zoom;
  if (fine) return brailleCells({ points, place, scale, cols, rows, color });
  const cells = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const { at, char, color: hex, bright = 1, keep = false } of points) {
    const [gx, gy, gz] = place(at);
    // Measured glyphcss projection (see the labels in renderLines).
    const [row, col] = [Math.floor(rows / 2 + (gx * scale) / 2), Math.floor(cols / 2 + gy * scale)];
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    if (cells[row][col] && cells[row][col].z >= gz) continue;
    const depth = Math.min(1, Math.max(0, (gz + 1) / 2));
    cells[row][col] = {
      z: gz,
      char: gz < -0.45 && !keep ? FAR_GLYPH : char,
      hex: dim(hex ?? "#e8e4d8", Math.min(1, bright * (0.5 + 0.65 * depth))),
    };
  }
  return cells.map((row) => {
    let line = "";
    let active = null;
    for (const cell of row) {
      if (!cell) {
        line += " ";
        continue;
      }
      if (color && cell.hex !== active) {
        line += fg(cell.hex);
        active = cell.hex;
      }
      line += cell.char;
    }
    return line + (color && active ? term.reset : "");
  });
}

// Braille dot bits by position in the cell: [column][row], 2 columns of 4 rows.
const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

/**
 * The fine mode: each point lights the one braille dot it falls on, a grid
 * of 2 × 4 per cell, so shapes are drawn in steps of half a cell across and
 * a quarter down. A cell takes the color of its nearest point, shaded by
 * depth as in renderPoints.
 */
function brailleCells({ points, place, scale, cols, rows, color }) {
  const cells = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const { at, color: hex, bright = 1 } of points) {
    const [gx, gy, gz] = place(at);
    // In dots: two per cell across, four down (the measured projection, finer).
    const [px, py] = [Math.floor((cols / 2 + gy * scale) * 2), Math.floor((rows / 2 + (gx * scale) / 2) * 4)];
    const [row, col] = [Math.floor(py / 4), Math.floor(px / 2)];
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    const cell = (cells[row][col] ??= { bits: 0, z: -Infinity, hex: null });
    cell.bits |= BRAILLE_BITS[px % 2][py % 4];
    if (gz > cell.z) {
      const depth = Math.min(1, Math.max(0, (gz + 1) / 2));
      cell.z = gz;
      cell.hex = dim(hex ?? "#e8e4d8", Math.min(1, bright * (0.5 + 0.65 * depth)));
    }
  }
  return cells.map((row) => {
    let line = "";
    let active = null;
    for (const cell of row) {
      if (!cell) {
        line += " ";
        continue;
      }
      if (color && cell.hex !== active) {
        line += fg(cell.hex);
        active = cell.hex;
      }
      line += String.fromCharCode(0x2800 + cell.bits);
    }
    return line + (color && active ? term.reset : "");
  });
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
