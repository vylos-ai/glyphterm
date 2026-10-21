// Phosphor colors of old monitors, plus a few extras.
// "original" keeps a mesh file's own material colors.

export const PHOSPHOR = "#33ff66";
// Neutral off-white for uncolored primitives and UI accents without a theme color.
export const PAPER = "#e8e4d8";

export const THEMES = {
  original: null,
  phosphor: PHOSPHOR,
  amber: "#ffb000",
  cyan: "#44ffcc",
  magenta: "#ff4fd8",
  ice: "#9ad8ff",
  paper: PAPER,
};

export const THEME_NAMES = Object.keys(THEMES);

/** Accepts a theme name or a #rrggbb color. Returns { name, color } or null. */
export function resolveTheme(value) {
  if (Object.hasOwn(THEMES, value)) return { name: value, color: THEMES[value] };
  if (/^#[0-9a-f]{6}$/i.test(value)) return { name: value.toLowerCase(), color: value.toLowerCase() };
  return null;
}

export function tint(polygons, color) {
  return color ? polygons.map((p) => ({ ...p, color, texture: undefined })) : polygons;
}
