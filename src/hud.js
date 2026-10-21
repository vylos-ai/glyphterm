// The viewer's frame around the rendered scene: header, caption and footer.

import { term, fg, bg, visibleLength } from "./ansi.js";
import { findStyle } from "./render.js";
import { isAnimated, isField, accent } from "./state.js";
import { ACTIVITIES, currentActivity } from "./avatar.js";

const HEADER_BG = "#141414";
const TEXT = "#d0d0d0";
const DIM = "#7a7a7a";
const ERROR = "#ff5555";
const TITLE = " ▓▒░ GLYPHTERM ░▒▓ ";

/** A full-width bar of `[text, color]` segments, truncated to fit and padded with the background, if any. */
function bar(segments, cols, background) {
  let line = background ? bg(background) : "";
  let used = 0;
  for (const [text, color] of segments) {
    if (used >= cols) break;
    const chars = [...text].slice(0, cols - used);
    line += fg(color) + chars.join("");
    used += chars.length;
  }
  return line + " ".repeat(Math.max(0, cols - used)) + term.reset;
}

/** `cpu` is the running CPU sampler, if the field shows CPU data. */
export function header(state, cols, cpu) {
  let status;
  if (cpu) {
    status = [
      `cpu · ${cpu.series.length} cores · avg ${Math.round(cpu.average() * 100)}%`,
      state.paused ? "frozen" : "live",
    ];
  } else if (isAnimated(state)) {
    const lines = isField(state) ? `${state.wave.lines} lines · ` : "";
    status = [
      `${lines}${state.wave.waveform} ×${state.wave.frequency}`,
      state.paused ? "frozen" : `scroll ${state.wave.speed}/s`,
    ];
  } else {
    status = [state.paused ? "paused" : `spin ${state.spin}°/s`];
  }
  const info = [
    state.model?.name ?? "loading…",
    findStyle(state.style).label,
    `glyphs:${state.palette}`,
    isField(state) ? `gradient:${state.gradient.name}` : state.theme.name,
    ...status,
  ].join(" · ");
  const left = ` ${info} `;
  const right = `${Math.round(state.fps)} fps `;
  const gap = Math.max(1, cols - TITLE.length - left.length - right.length);
  return bar(
    [
      [TITLE, accent(state)],
      [left, TEXT],
      [" ".repeat(gap), DIM],
      [right, DIM],
    ],
    cols,
    HEADER_BG,
  );
}

const HINTS = {
  cpu: "d demo data · c gradient · ; ' height · space freeze · drag rotate · +- zoom · m model · q quit",
  field:
    "d cpu data · c gradient · w waveform · , . frequency · ; ' amplitude · { } lines · [ ] scroll · space freeze · drag rotate · m model · q quit",
  wave: "w waveform · , . frequency · ; ' amplitude · [ ] scroll · space freeze · drag rotate · c color · m model · q quit",
  model:
    "drag/←↑↓→ rotate · wheel/+- zoom · s style · g glyphs · c color · m model · a avatar · space pause · [ ] speed · r reset · q quit",
};

/** The last message, or the keys that matter for the current model. */
export function footer(state, cols, cpu) {
  if (state.message) {
    return bar([[` ${state.message}`, state.messageIsError ? ERROR : accent(state)]], cols, HEADER_BG);
  }
  const hints = cpu ? HINTS.cpu : isField(state) ? HINTS.field : isAnimated(state) ? HINTS.wave : HINTS.model;
  return bar([[` ${hints}`, DIM]], cols, HEADER_BG);
}

/** The avatar's activity as a badge, then the caption; null when there is neither. */
export function captionLine(state, cols) {
  const activity = ACTIVITIES[currentActivity(state)];
  if (!activity && !state.caption) return null;
  const segments = [];
  if (activity) segments.push([` ● ${activity.label.toUpperCase()} `, activity.color]);
  if (state.caption) segments.push([` » ${state.caption}`, activity ? TEXT : accent(state)]);
  return bar(segments, cols);
}

const hasCaptionLine = (state) => Boolean(state.caption || state.activity);

/** Rows left for the scene between the header, the optional caption line and the footer. */
export const sceneRows = (state, rows) => Math.max(1, rows - 2 - (hasCaptionLine(state) ? 1 : 0));

/** The whole screen as one write, painted at once with synchronized output. */
export function composeFrame(state, scene, cols, rows, cpu) {
  let frame = term.syncStart + term.moveTo(1, 1) + header(state, cols, cpu);
  for (let r = 0; r < sceneRows(state, rows); r++) {
    const line = scene[r] ?? "";
    frame += term.moveTo(r + 2, 1) + line + term.reset + (visibleLength(line) < cols ? term.clearToEol : "");
  }
  if (hasCaptionLine(state)) frame += term.moveTo(rows - 1, 1) + (captionLine(state, cols) ?? term.clearToEol);
  return frame + term.moveTo(rows, 1) + footer(state, cols, cpu) + term.syncEnd;
}
