// Session stats for the avatar: token counts and tool calls read from a
// Claude Code transcript (the JSONL file every hook event names), and how the
// viewer shows them.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Totals of one transcript file: requests by message id, tool calls and failures, first and last timestamp. */
function readTranscript(path) {
  const usage = new Map();
  const tools = new Set();
  const failed = new Set();
  let model = "";
  let first = null;
  let last = null;
  // A reply is logged once per content block, each line with the same usage.
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"usage"') && !line.includes('"is_error":true')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    // Tool results come back in user entries; a failed one is marked is_error.
    if (entry.type === "user" && Array.isArray(message?.content)) {
      for (const block of message.content)
        if (block.type === "tool_result" && block.is_error) failed.add(block.tool_use_id);
      continue;
    }
    if (entry.type !== "assistant" || !message?.usage || message.model === "<synthetic>") continue;
    usage.set(message.id, message.usage);
    model = message.model ?? model;
    for (const block of message.content ?? []) if (block.type === "tool_use") tools.add(block.id);
    const time = Date.parse(entry.timestamp);
    if (Number.isFinite(time)) {
      first ??= time;
      last = time;
    }
  }
  const replies = [...usage.values()];
  return {
    model,
    replies,
    output: replies.reduce((sum, u) => sum + (u.output_tokens ?? 0), 0),
    tools: tools.size,
    failed: failed.size,
    seconds: first === null ? 0 : Math.round((last - first) / 1000),
  };
}

/** Tokens a request sent: fresh input plus what was written to and read from the cache. */
const sent = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

/**
 * Stats for the session whose transcript is at `path`, or null if it can't
 * be read. `context` is what the latest request sent (the context in use);
 * `cache` is the share of all input that came from the prompt cache, in percent. `output`, `tools`,
 * `failed` and `cache` include the subagents, whose transcripts sit next to it.
 */
export function sessionStats(path) {
  if (typeof path !== "string" || !path) return null;
  let main;
  try {
    main = readTranscript(path);
  } catch {
    return null;
  }
  const dir = join(path.replace(/\.jsonl$/, ""), "subagents");
  let agents = [];
  try {
    agents = readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => readTranscript(join(dir, name)));
  } catch {
    // No subagents.
  }
  const latest = main.replies.at(-1);
  const all = [main, ...agents].flatMap((t) => t.replies);
  const input = all.reduce((sum, u) => sum + sent(u), 0);
  const cached = all.reduce((sum, u) => sum + (u.cache_read_input_tokens ?? 0), 0);
  const total = (key) => agents.reduce((sum, a) => sum + a[key], main[key]);
  return {
    model: main.model,
    context: latest ? sent(latest) : 0,
    cache: input ? Math.round((100 * cached) / input) : 0,
    output: total("output"),
    tools: total("tools"),
    failed: total("failed"),
    agents: agents.length,
    seconds: main.seconds,
  };
}

export const SESSION_NUMBERS = ["context", "cache", "output", "tools", "failed", "agents", "seconds"];

/**
 * The context window the meter fills up to. The transcript doesn't name it,
 * so it's a setting (contextLimit); Claude Code compacts shortly before it.
 */
export const CONTEXT_LIMIT = 200_000;

// Color zones by how full the window is there: green, amber from 60%, red from 85%.
const METER_ZONES = [
  [0.85, "#ff3b30"],
  [0.6, "#ffb000"],
  [0, "#39d353"],
];
const zoneColor = (fraction) => METER_ZONES.find(([from]) => fraction >= from)[1];

/** A color at a quarter of its brightness: an unlit LED. */
const unlit = (hex) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(parseInt(hex.slice(i, i + 2), 16) / 4)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/**
 * The context as a row of LED segments, like an 80s equalizer: at most
 * `room` of them, each worth a round number of tokens (1k, 2k, 5k, 10k, ...),
 * in green, amber and red zones along the row, so the last lit ones turn
 * red near the limit. Unlit segments stay as a dark shade of their color. Returns
 * `[text, color]` segments, or [] when there's no room.
 */
export function contextMeter(context, limit, room) {
  if (!(room >= 4)) return [];
  let scale = 1000;
  for (let step = 0; limit / scale > room; step++) scale *= [2, 2.5, 2][step % 3];
  const cells = Math.ceil(limit / scale);
  if (cells < 4) return [];
  const lit = Math.round(Math.min(context, limit) / scale);
  return Array.from({ length: cells }, (_, i) => {
    const color = zoneColor((i + 0.5) / cells);
    return ["▮", i < lit ? color : unlit(color)];
  });
}

/** Where the context is between none and the limit, as the meter's color there. */
export const meterColor = (context, limit) => zoneColor(Math.min(context / limit, 1));

/** 950 -> "950", 61234 -> "61.2k", 1234567 -> "1.23M". */
export function formatCount(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 2 : n < 1e5 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(2)}M`;
}

const formatDuration = (s) =>
  s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m`
      : `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;

/** claude-opus-5-5 -> "opus 5.5"; anything else as it is. */
const formatModel = (id) => id.replace(/^claude-([a-z]+)-(\d+)-(\d+)(-\d{8})?$/, "$1 $2.$3");

/**
 * The stats as `[label, value, kind]` pairs, in the order the stats line
 * shows them. kind "context" is where the meter goes; "bad" is a count to notice.
 */
export function sessionFields(session) {
  const fields = [];
  if (session.model) fields.push(["", formatModel(session.model)]);
  fields.push(["context", formatCount(session.context ?? 0), "context"]);
  if (session.cache !== undefined) fields.push(["cache", `${session.cache}%`]);
  fields.push(["output", formatCount(session.output ?? 0)], ["tools", String(session.tools ?? 0)]);
  if (session.failed) fields.push(["failed", String(session.failed), "bad"]);
  if (session.agents) fields.push(["agents", String(session.agents)]);
  if (session.seconds) fields.push(["", formatDuration(session.seconds)]);
  return fields;
}
