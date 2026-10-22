// The avatar: activities and their timing, the buddy's poses, the hook
// mapping, the avatar file and the `glyphterm avatar` command.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVITIES,
  ACTIVITY_IDS,
  SLEEP_AFTER,
  setActivity,
  currentActivity,
  activityMotion,
  smoothMotion,
  avatarGeometry,
  AVATAR_NAMES,
  DEFAULT_AVATAR,
} from "../src/avatar.js";
import { modelGeometry } from "../src/geometry.js";
import { hookActivity, writeActivity, readActivity, avatarFile, hooksConfig, HOOK_EVENTS } from "../src/hooks.js";
import { loadModel } from "../src/models.js";
import { createState } from "../src/state.js";
import { handleKey } from "../src/input.js";
import { parseSettings, viewDefaultsFor } from "../src/settings.js";
import { applyScene, sceneSnapshot } from "../src/scene.js";
import { captionLine, sceneRows } from "../src/hud.js";
import { renderFrame, findStyle } from "../src/render.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "glyphterm-avatar-"));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Run the CLI without a multiplexer in the environment, so `open` never opens a pane. */
function cli(args, input) {
  const { TMUX, WEZTERM_PANE, KITTY_WINDOW_ID, WT_SESSION, ...env } = process.env;
  const result = spawnSync(process.execPath, ["bin/glyphterm.js", ...args], {
    cwd: root,
    encoding: "utf8",
    input,
    env,
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function avatarState(activity = "") {
  const { values } = parseSettings({ style: "halfblock", color: "original", activity, ...viewDefaultsFor("buddy") });
  return createState({ ...values, model: "buddy", fps: 30 });
}

test("every activity moves smoothly and every avatar stays within its bounds", () => {
  for (const id of ACTIVITY_IDS) {
    const state = avatarState();
    setActivity(state, id, 0);
    for (const t of [0, 0.1, 0.3, 1.7, 2.9]) {
      const motion = activityMotion(state, t);
      for (const value of Object.values(motion)) assert.ok(Number.isFinite(value), `${id} at ${t}`);
      for (const name of AVATAR_NAMES) {
        const { polygons, points } = avatarGeometry(name, { activity: id, previous: "thinking", age: t }, t);
        const spots = points ? points.map((p) => p.at) : polygons.flatMap((p) => p.vertices);
        const radius = Math.max(...spots.map((v) => Math.hypot(...v)));
        const smallest = id === "sleeping" && name === "core" ? 0.3 : 0.6;
        assert.ok(radius > smallest && radius < 1.15, `${name} ${id} at ${t}: radius ${radius}`);
      }
    }
  }
});

test("the core moves itself, flashes on a change, and has a floor in half-block styles", async () => {
  const state = avatarState();
  state.source = "core";
  setActivity(state, "coding", 0);
  assert.deepEqual(activityMotion(state, 1), { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, scale: 1 });

  const color = (age) => avatarGeometry("core", { activity: "coding", age }, 1).polygons.at(0).color;
  assert.equal(color(5), ACTIVITIES.coding.color);
  assert.notEqual(color(0.05), ACTIVITIES.coding.color, "white flash right after the change");

  const model = await loadModel("core");
  const { polygons, underlay } = modelGeometry(model, { look: { activity: "waiting", age: 5 } });
  const drawn = (frame) =>
    frame
      .join("")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/ /g, "").length;
  const base = { polygons, style: findStyle("halfblock"), cols: 60, rows: 24, pitch: 28 };
  assert.ok(drawn(renderFrame({ ...base, underlay })) > drawn(renderFrame(base)) + 20, "the floor adds cells");
  const plain = { ...base, style: findStyle("shade"), color: false };
  assert.deepEqual(renderFrame({ ...plain, underlay }), renderFrame(plain), "other styles leave it out");
});

test("short activities return to what came before; a long wait turns into sleep", () => {
  const state = avatarState();
  setActivity(state, "coding", 0);
  setActivity(state, "error", 10);
  assert.equal(currentActivity(state, 11), "error");
  assert.equal(currentActivity(state, 13), "coding");

  // A short one interrupting another returns to the long one before both.
  setActivity(state, "error", 20);
  setActivity(state, "done", 21);
  assert.equal(currentActivity(state, 25), "waiting", "done goes on to waiting");

  setActivity(state, "reading", 30);
  setActivity(state, "error", 31);
  setActivity(state, "error", 31.5);
  assert.equal(currentActivity(state, 40), "reading");

  // An error after a permission prompt: the prompt is over.
  setActivity(state, "needs-you", 50);
  state.caption = "allow Bash?";
  setActivity(state, "error", 51);
  state.caption = "Bash failed";
  assert.equal(currentActivity(state, 60), "thinking");
  assert.equal(state.caption, "", "the error's detail ends with it");

  setActivity(state, "waiting", 100);
  assert.equal(currentActivity(state, 100 + SLEEP_AFTER - 1), "waiting");
  assert.equal(currentActivity(state, 100 + SLEEP_AFTER + 1), "sleeping");
  assert.equal(state.activity, "waiting", "sleep is only shown; the file still says waiting");
});

test("motion eases toward the target and turns the short way round", () => {
  const target = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0.2, scale: 1 };
  assert.deepEqual(smoothMotion(null, target, 0.03), target);
  const eased = smoothMotion({ ...target, yaw: 350, y: 0 }, target, 0.03);
  assert.ok(eased.yaw > 350 && eased.yaw < 360, `yaw ${eased.yaw} goes up to 360, not down to 0`);
  assert.ok(eased.y > 0 && eased.y < 0.2);
});

test("the cloud regroups from one formation to the next and draws its characters by depth", () => {
  const look = (age) => ({ activity: "coding", previous: "thinking", age });
  const { points } = avatarGeometry("cloud", look(9), 9);
  assert.ok(points.length > 100);
  assert.ok(points.every((p) => p.color === ACTIVITIES.coding.color && p.char.length === 1));

  // Right after the change some particles haven't set off yet; on the way, their color blends into the new one.
  const early = avatarGeometry("cloud", look(0.2), 9).points;
  assert.ok(early.some((p) => p.color === ACTIVITIES.thinking.color));
  const halfway = avatarGeometry("cloud", look(1.2), 9).points;
  const between = (p) => p.color !== ACTIVITIES.thinking.color && p.color !== ACTIVITIES.coding.color;
  assert.ok(halfway.some(between), "colors in between");
  const settled = avatarGeometry("cloud", { activity: "coding" }, 9).points;
  assert.deepEqual(
    avatarGeometry("cloud", look(5), 9).points.map((p) => p.at),
    settled.map((p) => p.at),
    "once there, the old formation no longer matters",
  );

  const frame = renderFrame({ points, style: findStyle("halfblock"), cols: 60, rows: 24, color: false });
  assert.equal(frame.length, 24);
  assert.ok(frame.every((line) => [...line].length === 60 && !line.includes("\x1b")));
  assert.ok(frame.join("").replace(/ /g, "").length > 80, "plenty of characters drawn");
});

test("a switches between the avatars with their own views; m still cycles every model", () => {
  const { values } = parseSettings({ style: "halfblock", color: "phosphor", ...viewDefaultsFor("torus") });
  const options = { ...values, model: "torus", fps: 30 };
  const state = createState(options);
  const pick = (key) => {
    assert.equal(handleKey(state, key, options), "model");
    state.source = state.sources[state.sourceIdx]; // what the viewer does once it has loaded
    return state.source;
  };
  assert.equal(pick("a"), DEFAULT_AVATAR, "from any other model to the default avatar");
  assert.equal(state.pitch, viewDefaultsFor(DEFAULT_AVATAR).pitch);
  const other = pick("a");
  assert.ok(AVATAR_NAMES.includes(other) && other !== DEFAULT_AVATAR);
  assert.equal(state.pitch, viewDefaultsFor(other).pitch);
  assert.equal(pick("A"), DEFAULT_AVATAR);
  const before = state.sourceIdx;
  pick("m");
  assert.equal(state.sourceIdx, (before + 1) % state.sources.length, "m goes on to the next model, whatever it is");
});

test("the scene file restarts an activity only when it names a new one", () => {
  const state = avatarState("coding");
  state.time = 5;
  applyScene(state, { activity: "error" });
  assert.equal(state.activitySince, 5);
  state.time = 9; // the error is over and coding shows again
  assert.equal(currentActivity(state), "coding");
  applyScene(state, { activity: "error", zoom: 1.2 });
  assert.equal(currentActivity(state), "coding", "another edit to the file doesn't replay the error");
  assert.deepEqual(applyScene(state, { activity: "dancing" }).length, 1);
  assert.equal(sceneSnapshot(state, "/a/avatar.json").activity, "coding");
});

test("the caption line shows the activity badge and the detail", () => {
  const state = avatarState();
  assert.equal(captionLine(state, 40), null);
  assert.equal(sceneRows(state, 24), 22);
  setActivity(state, "needs-you", 0);
  state.caption = "allow Bash?";
  const line = strip(captionLine(state, 40));
  assert.match(line, /● NEEDS YOU {2}» allow Bash\?/);
  assert.equal([...line].length, 40);
  assert.equal(sceneRows(state, 24), 21);
});

test("the buddy renders, and motion moves it on screen", async () => {
  const model = await loadModel("buddy");
  const frame = (motion) =>
    renderFrame({ polygons: model.polygons, style: findStyle("shade"), cols: 40, rows: 20, color: false, motion });
  const rest = frame();
  const up = frame({ y: 0.3 });
  const firstRow = (lines) => lines.findIndex((l) => l.trim());
  assert.ok(firstRow(up) < firstRow(rest), "moving up starts higher on screen");
});

test("hook events become activities, without the user's prompt", () => {
  const cwd = "/work";
  const pre = (tool_name, tool_input) => hookActivity({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd });
  assert.deepEqual(hookActivity({ hook_event_name: "UserPromptSubmit", prompt: "secret plans" }), {
    activity: "thinking",
    detail: "",
  });
  assert.deepEqual(pre("Read", { file_path: "/work/src/a.js" }), { activity: "reading", detail: "src/a.js" });
  assert.deepEqual(pre("Grep", { pattern: "TODO" }), { activity: "reading", detail: "TODO" });
  assert.deepEqual(pre("Edit", { file_path: "/work/src/a.js" }), { activity: "coding", detail: "src/a.js" });
  assert.deepEqual(pre("Write", { file_path: "/elsewhere/README.md" }), {
    activity: "writing",
    detail: "/elsewhere/README.md",
  });
  assert.deepEqual(pre("Bash", { command: "npm test", description: "Run the tests" }), {
    activity: "running",
    detail: "Run the tests",
  });
  assert.equal(pre("Bash", { command: "x".repeat(200) }).detail.length, 60);
  assert.equal(pre("TodoWrite", {}).activity, "thinking");

  const event = (hook_event_name, extra) => hookActivity({ hook_event_name, ...extra })?.activity ?? null;
  assert.equal(event("PermissionRequest", { tool_name: "Bash" }), "needs-you");
  assert.equal(event("Notification", { notification_type: "permission_prompt", message: "?" }), "needs-you");
  assert.equal(event("Notification", { notification_type: "idle_prompt" }), "waiting");
  assert.equal(event("Notification", { notification_type: "auth_success" }), null);
  assert.equal(event("PostToolUseFailure", { tool_name: "Bash" }), "error");
  assert.equal(event("PostToolUseFailure", { tool_name: "Bash", is_interrupt: true }), null);
  assert.equal(event("Stop"), "waiting");
  assert.equal(event("StopFailure"), "waiting");
  assert.equal(event("SessionEnd"), "sleeping");
  assert.equal(event("SomethingNew"), null);
  // After a permission prompt the tool has run; otherwise PostToolUse changes nothing.
  assert.equal(hookActivity({ hook_event_name: "PostToolUse" }, "needs-you").activity, "thinking");
  assert.equal(hookActivity({ hook_event_name: "PostToolUse" }, "running"), null);
});

test("the avatar file keeps its other keys and is written whole", () => {
  const file = join(tmp, "nested", "avatar.json");
  assert.equal(readActivity(file), "");
  writeActivity(file, "coding", "a.js");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), zoom: 1.4 }));
  assert.equal(writeActivity(file, "running", "npm test"), "coding");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { activity: "running", caption: "npm test", zoom: 1.4 });
  writeActivity(file, "none");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { activity: "", caption: "", zoom: 1.4 });

  assert.equal(avatarFile({ GLYPHTERM_AVATAR: "/x.json" }), "/x.json");
  assert.equal(avatarFile({ XDG_STATE_HOME: "/s" }, "linux"), join("/s", "glyphterm", "avatar.json"));
  assert.deepEqual(Object.keys(hooksConfig("cmd").hooks), HOOK_EVENTS);
  assert.equal(hooksConfig("cmd").hooks.PreToolUse[0].hooks[0].async, true);
});

test("glyphterm avatar sets activities, runs as a hook and prints the hook settings", () => {
  const file = join(tmp, "cli.json");
  assert.equal(cli(["avatar", "coding", "--detail", "a.js", "--watch", file]).code, 0);
  assert.equal(readActivity(file), "coding");

  const bad = cli(["avatar", "codeing", "--watch", file]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /unknown activity "codeing" \(thinking, /);

  const hook = cli(["avatar", "--hook", "--watch", file], JSON.stringify({ hook_event_name: "Stop" }));
  assert.deepEqual([hook.code, hook.out, hook.err], [0, "", ""]);
  assert.equal(readActivity(file), "waiting");
  const broken = cli(["avatar", "--hook", "--watch", join(tmp, "never.json")], "not json");
  assert.deepEqual([broken.code, broken.out, broken.err], [0, "", ""], "a hook never gets in the way");
  assert.equal(existsSync(join(tmp, "never.json")), false);

  const settings = JSON.parse(cli(["avatar", "--print-hooks", "--watch", file]).out);
  assert.match(settings.hooks.Stop[0].hooks[0].command, /glyphterm\.js avatar --hook --watch /);

  const opened = cli(["open", "avatar"]);
  assert.equal(opened.code, 3);
  assert.match(opened.err, /glyphterm\.js avatar$/m, "open passes avatar on to the new pane");

  assert.equal(cli(["torus", "--detail", "x"]).code, 2, "--detail belongs to avatar");
  assert.equal(cli(["avatar", "--detail", "x"]).code, 2, "--detail needs an activity");
});

test("--scene previews an avatar file's pose", () => {
  const file = join(tmp, "preview.json");
  writeFileSync(file, JSON.stringify({ model: "buddy", activity: "sleeping", caption: "zzz" }));
  const { code, out, err } = cli(["--scene", file, "--cols", "40", "--rows", "16"]);
  assert.equal(code, 0, err);
  assert.ok(out.trim().length > 0);
});
