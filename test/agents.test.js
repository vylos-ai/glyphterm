// The agent-facing interface: machine-readable listings, scene file
// validation and previews, the status file name, the schema, and `open`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_KEYS, unknownSceneKeys } from "../src/settings.js";
import { sceneModelName, resolveSceneModel, statusPath } from "../src/scene.js";
import { paneLauncher, shellCommand, openPane } from "../src/open.js";
import { sceneSchema, SCHEMA_FILE } from "../scripts/scene-schema.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "glyphterm-"));

/** Run the CLI without a terminal or a multiplexer in the environment. */
function cli(args, env = {}) {
  const { TMUX, WEZTERM_PANE, KITTY_WINDOW_ID, WT_SESSION, ...clean } = process.env;
  const result = spawnSync(process.execPath, ["bin/glyphterm.js", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...clean, ...env },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function sceneFile(name, scene) {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify(scene));
  return path;
}

test("--list --json describes every choice and limit", () => {
  const { code, out } = cli(["--list", "--json"]);
  assert.equal(code, 0);
  const listing = JSON.parse(out);
  assert.ok(listing.models.primitives.includes("torus"));
  assert.deepEqual(listing.models.animated, ["wave", "field"]);
  assert.ok(listing.styles.some((s) => s.id === "braille"));
  assert.deepEqual(listing.limits.pitch, [-89, 89]);
  assert.deepEqual(listing.sceneKeys, SCENE_KEYS);
  assert.equal(listing.sceneSchema, SCHEMA_FILE);
});

test("the scene schema is up to date and covers exactly the scene keys", () => {
  assert.deepEqual(JSON.parse(readFileSync(SCHEMA_FILE, "utf8")), sceneSchema(), "run npm run schema");
  assert.deepEqual(Object.keys(sceneSchema().properties), SCENE_KEYS);
});

test("unknown scene keys are reported, typos included", () => {
  assert.deepEqual(unknownSceneKeys({ zoom: 1, wave: { lines: 3 } }), []);
  const problems = unknownSceneKeys({ colour: "amber", wave: { speeed: 1 } });
  assert.match(problems[0], /^unknown key "colour"/);
  assert.match(problems[1], /^unknown key "wave.speeed"/);
});

test("scene files name models relative to themselves when they sit below them", () => {
  assert.equal(sceneModelName("torus", "/a/scene.json"), "torus");
  assert.equal(sceneModelName("/a/models/x.obj", "/a/scene.json"), "models/x.obj");
  assert.equal(sceneModelName("/b/x.obj", "/a/scene.json"), "/b/x.obj");
  assert.equal(resolveSceneModel("models/x.obj", "/a/scene.json"), "/a/models/x.obj");
  assert.equal(statusPath("/a/scene.json"), "/a/scene.status.json");
  assert.equal(statusPath("/a/scene"), "/a/scene.status.json");
});

test("--scene previews the scene; explicit flags win over it", () => {
  const path = sceneFile("ok.json", { model: "cube", style: "wire", zoom: 1.5, caption: "x" });
  const preview = cli(["--scene", path, "--cols", "30", "--rows", "10"]);
  assert.equal(preview.code, 0, preview.err);
  assert.match(preview.out, /[│─┼]/, "wire style from the scene");

  const shaded = cli(["--scene", path, "--style", "shade", "--cols", "30", "--rows", "10"]);
  assert.doesNotMatch(shaded.out, /[│─┼]/, "--style overrides the scene");
});

test("--scene relative model paths resolve against the scene file", () => {
  const path = sceneFile("rocket.json", { model: join(root, "examples", "rocket.obj") });
  assert.equal(cli(["--scene", path, "--cols", "30", "--rows", "10"]).code, 0);
  const relative = sceneFile("missing.json", { model: "examples/rocket.obj" });
  const { code, err } = cli(["--scene", relative]);
  assert.equal(code, 2);
  assert.ok(err.includes(join(tmp, "examples", "rocket.obj")), err);
});

test("--scene reports every problem at once and exits 2", () => {
  const path = sceneFile("bad.json", { style: "halfblok", zoom: "2", colour: "amber" });
  const { code, out, err } = cli(["--scene", path]);
  assert.equal(code, 2);
  assert.equal(out, "");
  assert.match(err, /unknown style "halfblok"/);
  assert.match(err, /zoom must be a number, got "2"/);
  assert.match(err, /unknown key "colour"/);
  assert.equal(cli(["--scene", join(tmp, "nope.json")]).code, 2);
});

test("open picks the terminal's own split command, innermost multiplexer first", () => {
  const argv = ["node", "glyphterm.js", "torus"];
  assert.equal(paneLauncher({}, argv, "/w"), null);
  assert.deepEqual(paneLauncher({ TMUX: "/tmp/tmux", WT_SESSION: "1" }, argv, "/w").command, [
    "tmux",
    "split-window",
    "-h",
    "-c",
    "/w",
    ...argv,
  ]);
  assert.equal(paneLauncher({ WT_SESSION: "1" }, argv, "/w").terminal, "Windows Terminal");
  assert.equal(paneLauncher({ WEZTERM_PANE: "0" }, argv, "/w").terminal, "WezTerm");
  assert.equal(paneLauncher({ KITTY_WINDOW_ID: "1" }, argv, "/w").terminal, "kitty");
});

test("open without a supported terminal hands back a command for the user (exit 3)", () => {
  const { ok, message } = openPane(["node", "a b.js"], { env: {}, cwd: "/w" });
  assert.equal(ok, false);
  assert.match(message, /cd \/w && node 'a b\.js'/);
  assert.equal(shellCommand(["it's"]), `'it'\\''s'`);

  const { code, err } = cli(["open", "torus", "--watch", "scene.json"]);
  assert.equal(code, 3);
  assert.match(err, /bin\/glyphterm\.js torus --watch scene\.json/);
  assert.equal(cli(["open", "torus", "--once"]).code, 2);
  assert.equal(cli(["open", "torus", "--style", "nope"]).code, 2, "arguments are checked before opening");
});
