// Session stats: reading a Claude Code transcript, the hook writing them to
// the avatar file, and the stats line the viewer toggles with i.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionStats, sessionFields, formatCount, contextMeter } from "../src/session.js";
import { hookChanges } from "../src/hooks.js";
import { parseSettings, viewDefaultsFor } from "../src/settings.js";
import { createState } from "../src/state.js";
import { handleKey } from "../src/input.js";
import { applyScene, sceneSnapshot } from "../src/scene.js";
import { statsLine, sceneRows, composeFrame } from "../src/hud.js";
import { visibleLength } from "../src/ansi.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "glyphterm-session-"));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** A reply as Claude Code logs it: one line per content block, each with the reply's usage. */
function reply(id, usage, blocks, timestamp, model = "claude-opus-5-5") {
  return blocks.map((block) =>
    JSON.stringify({ type: "assistant", timestamp, message: { id, model, usage, content: [block] } }),
  );
}

function transcript(name, lines) {
  const path = join(tmp, `${name}.jsonl`);
  writeFileSync(path, lines.flat().join("\n") + "\n");
  return path;
}

/** A viewer state as the CLI starts it, for the torus. */
function torusState() {
  const { values } = parseSettings({
    style: "halfblock",
    palette: "auto",
    color: "phosphor",
    gradient: "synthwave",
    data: "demo",
    ...viewDefaultsFor("torus"),
  });
  return createState({ ...values, model: "torus" });
}

const usage = (input, read, created, output) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: created,
  output_tokens: output,
});

const MAIN = [
  JSON.stringify({ type: "user", message: { content: "secret plans" } }),
  reply(
    "m1",
    usage(10, 0, 5000, 300),
    [
      { type: "text", text: "hi" },
      { type: "tool_use", id: "t1" },
    ],
    "2026-10-21T10:00:00Z",
  ),
  reply("m2", usage(2, 5000, 800, 120), [{ type: "tool_use", id: "t2" }], "2026-10-21T10:05:30Z"),
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "Exit code 1" }] },
  }),
  // Error notices Claude Code writes itself.
  reply("m3", usage(0, 0, 0, 0), [{ type: "text", text: "API error" }], "2026-10-21T10:06:00Z", "<synthetic>"),
  '{ not json, but mentions "usage"',
];

test("stats come from the transcript: replies counted once, subagents included", () => {
  const path = transcript("main", MAIN);
  assert.deepEqual(sessionStats(path), {
    model: "claude-opus-5-5",
    context: 5802,
    cache: 46,
    output: 420,
    tools: 2,
    failed: 1,
    agents: 0,
    seconds: 330,
  });

  mkdirSync(join(tmp, "main", "subagents"), { recursive: true });
  writeFileSync(
    join(tmp, "main", "subagents", "agent-a.jsonl"),
    reply("s1", usage(5, 0, 900, 80), [{ type: "tool_use", id: "t9" }], "2026-10-21T10:01:00Z").join("\n"),
  );
  const stats = sessionStats(path);
  assert.deepEqual([stats.output, stats.tools, stats.agents, stats.context, stats.cache], [500, 3, 1, 5802, 43]);

  assert.equal(sessionStats(join(tmp, "missing.jsonl")), null);
  assert.equal(sessionStats(undefined), null);
});

test("stats read as short numbers, the context as an LED meter", () => {
  assert.deepEqual([950, 1234, 61234, 409291, 1234567].map(formatCount), ["950", "1.23k", "61.2k", "409k", "1.23M"]);
  const session = {
    model: "claude-opus-5-5",
    context: 61234,
    cache: 97,
    output: 900,
    tools: 4,
    failed: 2,
    agents: 0,
    seconds: 4380,
  };
  assert.deepEqual(sessionFields(session), [
    ["", "opus 5.5"],
    ["context", "61.2k", "context"],
    ["cache", "97%"],
    ["output", "900"],
    ["tools", "4"],
    ["failed", "2", "bad"],
    ["", "1h 13m"],
  ]);

  // Each segment is a round number of tokens: 200k in 40 cells is 5k each, in 20 cells 10k.
  assert.equal(contextMeter(100_000, 200_000, 40).length, 40);
  assert.equal(contextMeter(100_000, 200_000, 39).length, 20);
  assert.equal(contextMeter(5_000, 10_000, 40).length, 10, "1k each at most");
  const meter = contextMeter(180_000, 200_000, 20);
  const colors = meter.map(([, color]) => color);
  assert.equal(meter.map(([text]) => text).join(""), "▮".repeat(20));
  assert.deepEqual([colors[0], colors[12], colors[17]], ["#39d353", "#ffb000", "#ff3b30"], "green, amber, red zones");
  assert.equal(colors[19], "#400f0c", "unlit: a dark shade of red");
  assert.deepEqual([contextMeter(1, 200_000, 3), contextMeter(1, 200_000, -50)], [[], []]);
});

test("a hook event writes the stats next to the activity", () => {
  const transcript_path = transcript("hook", MAIN);
  const changes = hookChanges({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, transcript_path });
  assert.equal(changes.activity, "running");
  assert.equal(changes.session.output, 420);
  // PostToolUse changes no activity, but the tokens still move on.
  assert.deepEqual(Object.keys(hookChanges({ hook_event_name: "PostToolUse", transcript_path })), ["session"]);
  assert.equal(hookChanges({ hook_event_name: "PostToolUse" }), null);

  const file = join(tmp, "avatar.json");
  writeFileSync(file, JSON.stringify({ stats: true }));
  const { status } = spawnSync(process.execPath, ["bin/glyphterm.js", "avatar", "--hook", "--watch", file], {
    cwd: root,
    input: JSON.stringify({ hook_event_name: "Stop", transcript_path }),
  });
  assert.equal(status, 0);
  const scene = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual([scene.stats, scene.activity, scene.session.tools], [true, "waiting", 2]);
});

test("i toggles the stats line, which the scene file keeps along with the session", () => {
  const { values } = parseSettings({
    stats: true,
    contextLimit: 1e9,
    session: { model: "m", output: 12, tools: -1, context: "lots", cache: 90 },
  });
  assert.deepEqual(values, { stats: true, contextLimit: 1e7, session: { model: "m", cache: 90, output: 12 } });
  assert.match(parseSettings({ stats: "yes" }).problems[0], /stats must be a boolean/);

  const state = torusState();
  assert.equal(state.stats, false, "off by default");
  assert.equal(handleKey(state, "i", {}), "changed");
  assert.equal(state.stats, true);
  assert.deepEqual(applyScene(state, { session: { output: 7 } }), []);
  const snapshot = sceneSnapshot(state, "/a/scene.json");
  assert.deepEqual([snapshot.stats, snapshot.session], [true, { output: 7 }]);
  handleKey(state, "I", {});
  assert.equal(state.stats, false);
});

test("the stats line fills the width and takes a row from the scene", () => {
  const state = torusState();
  assert.equal(sceneRows(state, 24), 22);
  state.stats = true;
  assert.equal(sceneRows(state, 24), 21);
  assert.match(strip(statsLine(state, 80)), /no session stats yet/);

  state.session = { model: "claude-opus-5-5", context: 87078, output: 14112, tools: 19, agents: 2, seconds: 323 };
  const line = strip(statsLine(state, 100));
  assert.equal(
    line.trimEnd(),
    ` opus 5.5 · context 87.1k ${"▮".repeat(20)} 44% · output 14.1k · tools 19 · agents 2 · 5m`,
  );
  for (const cols of [20, 100]) assert.equal(visibleLength(statsLine(state, cols)), cols);

  // The meter takes what room is left, at most 40 segments, and goes when there's too little.
  state.session = { ...state.session, context: 100_000, cache: 96, failed: 1 };
  const fields = " opus 5.5 · context 100k · cache 96% · output 14.1k · tools 19 · failed 1 · agents 2 · 5m";
  const meter = (cols) => strip(statsLine(state, cols)).match(/100k (▮+) 50% ·/)?.[1] ?? "";
  assert.equal(meter(200).length, 40);
  assert.equal(meter(fields.length + 30).length, 20);
  assert.equal(strip(statsLine(state, 80)).trimEnd(), fields.slice(0, 80), "no room for it at 80 columns");
  state.contextLimit = 1_000_000;
  assert.match(strip(statsLine(state, 200)), / 10% ·/);
  for (const cols of [20, 80, 200]) assert.equal(visibleLength(statsLine(state, cols)), cols);

  state.caption = "hello";
  assert.equal(sceneRows(state, 10), 6);
  const frame = composeFrame(state, ["row"], 60, 10, null);
  assert.ok(frame.includes("\x1b[8;1H") && frame.includes("\x1b[9;1H"), "stats above the caption, above the footer");
});
