// Terminal escape sequences and the glyphcss HTML -> ANSI bridge.
//
// glyphcss renders a frame as the inner HTML of a <pre>: plain characters
// interleaved with `<span style="color:#rrggbb[;background-color:#rrggbb]">`
// runs. Its own `encodeGlyphAnsi` ignores background colors, which the
// half-block and quadrant styles rely on (two colors per cell), so we
// translate the markup ourselves.

const CSI = "\x1b[";

export const term = {
  altScreenOn: `${CSI}?1049h`,
  altScreenOff: `${CSI}?1049l`,
  cursorHide: `${CSI}?25l`,
  cursorShow: `${CSI}?25h`,
  clear: `${CSI}2J`,
  clearToEol: `${CSI}K`,
  // Synchronized output: the terminal paints the whole frame at once (no tearing).
  syncStart: `${CSI}?2026h`,
  syncEnd: `${CSI}?2026l`,
  // Button-event mouse tracking with SGR coordinates (works in Konsole and Windows Terminal).
  mouseOn: `${CSI}?1002h${CSI}?1006h`,
  mouseOff: `${CSI}?1002l${CSI}?1006l`,
  reset: `${CSI}0m`,
  moveTo: (row, col) => `${CSI}${row};${col}H`,
};

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const fg = (hex) => `${CSI}38;2;${hexToRgb(hex).join(";")}m`;
export const bg = (hex) => `${CSI}48;2;${hexToRgb(hex).join(";")}m`;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, body) => {
    if (body[0] !== "#") return ENTITIES[body.toLowerCase()] ?? match;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

function styleToSgr(style) {
  let sgr = "";
  const color = /(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i.exec(style);
  const background = /background-color:\s*(#[0-9a-f]{6})/i.exec(style);
  if (color) sgr += fg(color[1]);
  if (background) sgr += bg(background[1]);
  return sgr;
}

/**
 * Convert glyphcss <pre> inner HTML into one string per row.
 * With `color: false` the markup is stripped and only the glyphs remain.
 */
export function htmlToLines(html, { color = true } = {}) {
  const lines = [""];
  let styled = false;
  let hadBackground = false;
  const append = (text, sgr) => {
    const parts = decodeEntities(text).split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        if (styled) lines[lines.length - 1] += term.reset;
        styled = hadBackground = false;
        lines.push("");
      }
      if (!part) return;
      if (color) {
        if (sgr) {
          // A new foreground overrides the old one; only a background has to be reset.
          lines[lines.length - 1] += (hadBackground ? term.reset : "") + sgr;
          styled = true;
          hadBackground = sgr.includes("[48;");
        } else if (styled) {
          lines[lines.length - 1] += term.reset;
          styled = hadBackground = false;
        }
      }
      lines[lines.length - 1] += part;
    });
  };

  const token = /<span\s+style="([^"]*)">([^<]*)<\/span>|<[^>]+>|([^<]+)/g;
  for (const [match, style, spanText, plainText] of html.matchAll(token)) {
    if (style !== undefined) append(spanText, styleToSgr(style));
    else if (plainText !== undefined) append(plainText, "");
    else if (match.startsWith("<br")) append("\n", "");
  }
  if (styled) lines[lines.length - 1] += term.reset;
  // A trailing newline in the markup leaves an empty final row; drop it.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Visible width of a line, ignoring escape sequences (all our glyphs are single-width). */
export function visibleLength(line) {
  return [...line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")].length;
}

/**
 * Write `text` into an ANSI-colored line starting at visible column `col`,
 * in color `hex` (or plain when `hex` is null). Cells outside the line are
 * dropped; colors of the untouched cells are preserved.
 */
export function overlayText(line, col, text, hex) {
  // Split into cells, each remembering the SGR state it was drawn with.
  const cells = [];
  let sgr = "";
  for (const [token] of line.matchAll(/\x1b\[[0-9;?]*m|[\s\S]/gu)) {
    if (token.startsWith("\x1b[")) sgr = token === term.reset ? "" : sgr + token;
    else cells.push({ ch: token, sgr });
  }
  [...text].forEach((ch, i) => {
    const at = col + i;
    if (at >= 0 && at < cells.length) cells[at] = { ch, sgr: hex ? fg(hex) : "" };
  });
  let out = "";
  let active = "";
  for (const { ch, sgr: cellSgr } of cells) {
    if (cellSgr !== active) {
      out += term.reset + cellSgr;
      active = cellSgr;
    }
    out += ch;
  }
  return out + (active ? term.reset : "");
}
