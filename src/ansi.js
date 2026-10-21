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

// --- Half-block pixels (supersampling) ---------------------------------------

/**
 * Read glyphcss half-block HTML as pixels: each cell is a top and a bottom
 * pixel, a `#rrggbb` color or null where nothing was drawn. Returns rows of
 * pixels, two per cell row.
 */
export function halfblockPixels(html) {
  const rows = [[], []];
  const token = /<span\s+style="([^"]*)">([^<]*)<\/span>|<br\s*\/?>|<[^>]+>|([^<]+)/g;
  const add = (text, style = "") => {
    const color = /(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i.exec(style)?.[1].toLowerCase() ?? null;
    const background = /background-color:\s*(#[0-9a-f]{6})/i.exec(style)?.[1].toLowerCase() ?? null;
    for (const ch of decodeEntities(text)) {
      if (ch === "\n") {
        rows.push([], []);
        continue;
      }
      const [top, bottom] = rows.slice(-2);
      const [t, b] =
        ch === "▀"
          ? [color, background]
          : ch === "▄"
            ? [background, color]
            : ch === "█"
              ? [color, color]
              : [background, background];
      top.push(t);
      bottom.push(b);
    }
  };
  for (const [match, style, spanText, plainText] of html.matchAll(token)) {
    if (style !== undefined) add(spanText, style);
    else if (plainText !== undefined) add(plainText);
    else if (match.startsWith("<br")) add("\n");
  }
  // A trailing newline leaves an empty pair of rows.
  while (rows.length > 2 && rows.at(-1).length === 0) rows.splice(-2, 2);
  return rows;
}

/**
 * Shrink pixel rows by `factor` in both directions. Each new pixel is the
 * average of the drawn pixels in its block, so edges between colors blend;
 * it stays empty unless at least half the block was drawn.
 */
export function downsamplePixels(rows, factor) {
  const out = [];
  for (let y = 0; y + factor <= rows.length; y += factor) {
    const row = [];
    const width = Math.min(...rows.slice(y, y + factor).map((r) => r.length));
    for (let x = 0; x + factor <= width; x += factor) {
      let [r, g, b, n] = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const hex = rows[y + dy][x + dx];
          if (!hex) continue;
          const [cr, cg, cb] = hexToRgb(hex);
          r += cr;
          g += cg;
          b += cb;
          n++;
        }
      }
      row.push(n * 2 < factor * factor ? null : rgbToHex(r / n, g / n, b / n));
    }
    out.push(row);
  }
  return out;
}

const rgbToHex = (...rgb) => "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

/** Pixel rows (two per text row) as half-block ANSI lines. */
export function pixelsToLines(rows) {
  const lines = [];
  for (let y = 0; y + 1 < rows.length; y += 2) {
    let line = "";
    let active = "";
    rows[y].forEach((top, x) => {
      const bottom = rows[y + 1][x];
      let ch = " ";
      let sgr = "";
      if (top && bottom) [ch, sgr] = top === bottom ? ["█", fg(top)] : ["▀", fg(top) + bg(bottom)];
      else if (top) [ch, sgr] = ["▀", fg(top)];
      else if (bottom) [ch, sgr] = ["▄", fg(bottom)];
      if (sgr !== active) {
        line += (active ? term.reset : "") + sgr;
        active = sgr;
      }
      line += ch;
    });
    lines.push(line + (active ? term.reset : ""));
  }
  return lines;
}
