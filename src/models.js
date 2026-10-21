// Model sources: built-in primitives and mesh files (OBJ, STL, glTF/GLB, VOX).
// Every model is normalized to sit at the origin with a bounding radius of 1,
// so the renderer can fit any of them to the terminal the same way.

import { readFile } from "node:fs/promises";
import { extname, basename, dirname, resolve } from "node:path";
import * as core from "@glyphcss/core";
import { PAPER } from "./themes.js";
import { buddyPolygons } from "./avatar.js";

const O = [0, 0, 0];

export const PRIMITIVES = {
  torus: (color) =>
    core.torusPolygons({ center: O, majorRadius: 1, minorRadius: 0.42, segments: 40, sides: 20, color }),
  sphere: (color) => core.spherePolygons({ center: O, size: 2, subdivisions: 3, color }),
  cube: (color) => core.cubePolygons({ center: O, size: 1, color }),
  icosahedron: (color) => core.icosahedronPolygons({ center: O, size: 1, color }),
  dodecahedron: (color) => core.dodecahedronPolygons({ center: O, size: 1, color }),
  octahedron: (color) => core.octahedronPolygons({ center: O, size: 1, color }),
  cuboctahedron: (color) => core.cuboctahedronPolygons({ center: O, size: 1, color }),
  football: (color) => core.truncatedIcosahedronPolygons({ center: O, size: 1, color }),
  star: (color) => core.smallStellatedDodecahedronPolygons({ center: O, size: 1, color }),
  "great-star": (color) => core.greatStellatedDodecahedronPolygons({ center: O, size: 1, color }),
  cone: (color) => core.conePolygons({ center: O, radius: 1, height: 2, sides: 32, color }),
  cylinder: (color) => core.cylinderPolygons({ center: O, radius: 1, height: 2, sides: 32, color }),
  pyramid: (color) => core.pyramidPolygons({ center: O, radius: 1, height: 1.6, sides: 4, color }),
  antiprism: (color) => core.antiprismPolygons({ center: O, radius: 1, height: 1, sides: 8, color }),
};

// Animated models are rebuilt every frame instead of being loaded once.
export const ANIMATED = ["wave", "field"];

// The avatar mascot changes its pose with the activity (see avatar.js) and has colors of its own.
export const POSABLE = ["buddy"];

export const PRIMITIVE_NAMES = [...Object.keys(PRIMITIVES), ...POSABLE, ...ANIMATED];

const FILE_PARSERS = {
  ".obj": async (path) => {
    const text = await readFile(path, "utf8");
    return core.parseObj(text, { materialColors: await objMaterialColors(text, path) });
  },
  ".stl": async (path) => core.parseStl(await readFile(path)),
  ".glb": async (path) => core.parseGltf(await readFile(path)),
  ".gltf": async (path) => core.parseGltf(await readFile(path)),
  ".vox": async (path) => {
    const buf = await readFile(path);
    return core.parseVox(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  },
};

export const SUPPORTED_EXTENSIONS = Object.keys(FILE_PARSERS);

export function isPrimitive(name) {
  return Object.hasOwn(PRIMITIVES, name) || POSABLE.includes(name) || ANIMATED.includes(name);
}

/** Load a model by primitive name or file path. Colors are applied later (see themes.js). */
export async function loadModel(source) {
  if (ANIMATED.includes(source)) {
    // Animated models are rebuilt every frame (see geometry.js).
    return { name: source, animated: true, polygons: [], warnings: [] };
  }
  if (POSABLE.includes(source)) {
    // Built already fitted; geometry.js rebuilds it in the current pose.
    return { name: source, posable: true, polygons: buddyPolygons(), warnings: [] };
  }
  if (isPrimitive(source)) {
    return { name: source, polygons: normalize(PRIMITIVES[source](PAPER)), warnings: [] };
  }

  const ext = extname(source).toLowerCase();
  const parse = FILE_PARSERS[ext];
  if (!parse) {
    throw new Error(
      `Unknown model "${source}". Use a primitive (${PRIMITIVE_NAMES.join(", ")}) ` +
        `or a file ending in ${SUPPORTED_EXTENSIONS.join(", ")}.`,
    );
  }

  const result = await parse(source);
  const visible = result.polygons.filter((p) => !p.hidden && p.vertices.length >= 3);
  if (visible.length === 0) throw new Error(`"${source}" contains no renderable polygons.`);
  return { name: basename(source), polygons: normalize(visible.map(fromParserSpace)), warnings: result.warnings ?? [] };
}

/**
 * glyphcss's file parsers emit a z-up world where a file's (x, y, z) becomes
 * (z, x, y). Primitives (and our renderer) use the files' own y-up convention,
 * so rotate parsed meshes back.
 */
function fromParserSpace(polygon) {
  const back = ([gx, gy, gz]) => [gy, gz, gx];
  return {
    ...polygon,
    vertices: polygon.vertices.map(back),
    shadingNormal: polygon.shadingNormal && back(polygon.shadingNormal),
  };
}

/** Collect `Kd` colors from the .mtl files an OBJ references (missing files are skipped). */
async function objMaterialColors(text, path) {
  const colors = {};
  for (const [, name] of text.matchAll(/^mtllib\s+(.+?)\s*$/gm)) {
    try {
      Object.assign(colors, core.parseMtl(await readFile(resolve(dirname(path), name), "utf8")).colors);
    } catch {
      // Without the .mtl, glyphcss falls back to hex material names or its palette.
    }
  }
  return colors;
}

/** Center on the origin and scale uniformly to a bounding radius of 1. */
function normalize(polygons) {
  const centered = core.recenterPolygons(polygons);
  let radius = 0;
  for (const p of centered) for (const [x, y, z] of p.vertices) radius = Math.max(radius, Math.hypot(x, y, z));
  const s = radius > 0 ? 1 / radius : 1;
  return centered.map(({ objectVertices, ...p }) => ({
    ...p,
    vertices: p.vertices.map(([x, y, z]) => [x * s, y * s, z * s]),
  }));
}
