#!/usr/bin/env node
// Builds schema/scene.schema.json from the code's own lists and limits.
// `npm run schema` rewrites the file; the tests fail when it is out of date.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STYLE_IDS, PALETTES } from "../src/render.js";
import { THEME_NAMES } from "../src/themes.js";
import { GRADIENT_NAMES, WAVEFORM_NAMES, WAVE_LIMITS, LINE_LIMITS } from "../src/wave.js";
import { LIMITS, DATA_SOURCES, MAX_SATELLITES } from "../src/settings.js";
import { TOOL_GROUP_IDS, RECENT_CALLS } from "../src/session.js";
import { PRIMITIVE_NAMES, SUPPORTED_EXTENSIONS } from "../src/models.js";
import { ACTIVITY_IDS } from "../src/avatar.js";

export const SCHEMA_FILE = fileURLToPath(new URL("../schema/scene.schema.json", import.meta.url));

const HEX = "^#[0-9a-fA-F]{6}$";

const range = ([minimum, maximum], description) => ({
  type: "number",
  minimum,
  maximum,
  description: `${description} Values outside ${minimum}..${maximum} are clamped.`,
});

export function sceneSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "glyphterm scene",
    description:
      "The scene file a running viewer watches (glyphterm --watch <file>). Every key is optional; " +
      "the viewer applies the ones present on top of its current state and reports problems in <file>.status.json.",
    type: "object",
    additionalProperties: false,
    properties: {
      model: {
        type: "string",
        description:
          `A primitive (${PRIMITIVE_NAMES.join(", ")}) or a mesh file (${SUPPORTED_EXTENSIONS.join(", ")}), ` +
          "relative to the scene file or absolute.",
        examples: PRIMITIVE_NAMES,
      },
      style: { enum: STYLE_IDS, description: "Render style." },
      palette: { enum: PALETTES, description: "Glyph palette; auto lets each style pick." },
      color: {
        anyOf: [{ enum: THEME_NAMES }, { type: "string", pattern: HEX }],
        description: "A theme or #rrggbb. original keeps a mesh file's own material colors.",
      },
      yaw: { type: "number", description: "Rotation around the vertical axis in degrees." },
      pitch: range(LIMITS.pitch, "Tilt toward the viewer in degrees."),
      zoom: range(LIMITS.zoom, "Zoom factor; 1 fits the model to the screen."),
      spin: range(LIMITS.spin, "Auto-rotation in degrees per second; 0 stops it."),
      paused: { type: "boolean", description: "Pauses spinning and animation." },
      caption: { type: "string", description: "A line of text under the scene; empty hides it." },
      activity: {
        enum: [...ACTIVITY_IDS, ""],
        description:
          "What the avatar shows (glyphterm avatar): a motion for any model, plus a pose for the buddy. " +
          'error and done are short and return by themselves; "" clears it.',
      },
      stats: { type: "boolean", description: "Shows the stats line under the scene (the i key toggles it)." },
      spectrum: {
        type: "boolean",
        description: "Shows the spectrum analyzer: recent tool calls by kind (the e key toggles it).",
      },
      contextLimit: {
        type: "integer",
        minimum: LIMITS.contextLimit[0],
        maximum: LIMITS.contextLimit[1],
        description: "The context window the stats line's meter fills up to (default 1000000).",
      },
      session: {
        type: "object",
        description:
          "The agent session the stats line shows. glyphterm avatar --hook writes it from the Claude Code transcript.",
        properties: {
          model: { type: "string", description: "The model of the latest reply." },
          context: { type: "integer", minimum: 0, description: "Tokens the latest request sent: the context in use." },
          cache: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description: "Percent of all input read from the prompt cache, subagents included.",
          },
          output: { type: "integer", minimum: 0, description: "Output tokens so far, subagents included." },
          tools: { type: "integer", minimum: 0, description: "Tool calls so far, subagents included." },
          failed: { type: "integer", minimum: 0, description: "Tool calls that came back as errors." },
          calls: {
            type: "array",
            maxItems: RECENT_CALLS,
            description:
              'The latest tool calls, oldest first: [time in ms, tool group, failed 0 or 1, subagent id or ""].',
            items: {
              type: "array",
              prefixItems: [
                { type: "integer", minimum: 0 },
                { enum: TOOL_GROUP_IDS },
                { enum: [0, 1] },
                { type: "string" },
              ],
              items: false,
            },
          },
          satellites: {
            type: "array",
            maxItems: MAX_SATELLITES,
            description: "Subagents still running, drawn as satellites: [id, start time in ms].",
            items: {
              type: "array",
              prefixItems: [
                { type: "string", minLength: 1 },
                { type: "integer", minimum: 0 },
              ],
              items: false,
            },
          },
          agents: { type: "integer", minimum: 0, description: "Subagents started." },
          seconds: { type: "integer", minimum: 0, description: "Time from the first reply to the latest." },
        },
      },
      wave: {
        type: "object",
        description: "Settings of the animated models wave and field.",
        additionalProperties: false,
        properties: {
          waveform: { enum: WAVEFORM_NAMES },
          frequency: range(WAVE_LIMITS.frequency, "Periods across the screen."),
          amplitude: range(WAVE_LIMITS.amplitude, "Height of the signal."),
          speed: range(WAVE_LIMITS.speed, "Periods per second the trace scrolls."),
          lines: {
            type: "integer",
            minimum: LINE_LIMITS[0],
            maximum: LINE_LIMITS[1],
            description: "field only: number of lines.",
          },
        },
      },
      gradient: {
        anyOf: [{ enum: GRADIENT_NAMES }, { type: "array", minItems: 2, items: { type: "string", pattern: HEX } }],
        description: "field only: colors from front to back, a preset or a list of #rrggbb.",
      },
      data: { enum: DATA_SOURCES, description: "field only: demo signals or live load per CPU core." },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SCHEMA_FILE, JSON.stringify(sceneSchema(), null, 2) + "\n");
}
