// `glyphterm avatar`: the avatar's file, setting its activity, and turning
// Claude Code hook events into activities, so the avatar follows an agent
// without the agent spending a word on it.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { ACTIVITY_IDS } from "./avatar.js";
import { sessionStats } from "./session.js";

/** Where the avatar viewer and the hooks meet, unless --watch names another file. */
export function avatarFile(env = process.env, platform = process.platform) {
  if (env.GLYPHTERM_AVATAR) return env.GLYPHTERM_AVATAR;
  const state =
    platform === "win32"
      ? (env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : (env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"));
  return join(state, "glyphterm", "avatar.json");
}

const DETAIL_LENGTH = 60;
const short = (text) => {
  const line = String(text ?? "")
    .split("\n")[0]
    .trim();
  return line.length > DETAIL_LENGTH ? line.slice(0, DETAIL_LENGTH - 1) + "…" : line;
};

/** A path as the user knows it: relative to the session's folder when inside it. */
function shownPath(path, cwd) {
  if (!path) return "";
  const rel = cwd ? relative(cwd, path) : path;
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

const READING = ["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch", "NotebookRead"];
const EDITING = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
// Notifications that mean the agent is blocked on the user.
const BLOCKED = ["permission_prompt", "elicitation_dialog", "agent_needs_input"];

function toolActivity(tool, input = {}, cwd) {
  if (READING.includes(tool)) {
    const what = input.file_path ?? input.notebook_path ?? input.path;
    const detail = what ? shownPath(what, cwd) : (input.pattern ?? input.query ?? input.url);
    return { activity: "reading", detail };
  }
  if (EDITING.includes(tool)) {
    const path = input.file_path ?? input.notebook_path ?? "";
    return { activity: PROSE.test(path) ? "writing" : "coding", detail: shownPath(path, cwd) };
  }
  if (tool === "Bash") return { activity: "running", detail: input.description ?? input.command };
  if (tool === "Agent" || tool === "Task") return { activity: "thinking", detail: input.description };
  return { activity: "thinking" };
}

/**
 * The activity for one Claude Code hook event (the JSON a hook gets on
 * stdin), or null to leave the avatar as it is. `current` is the activity the
 * avatar shows now. Details are file names and short descriptions, never the
 * user's prompt.
 */
export function hookActivity(event, current = "") {
  const { hook_event_name: name, tool_name: tool, tool_input: input, cwd } = event ?? {};
  let result;
  switch (name) {
    case "SessionStart":
    case "Stop":
      result = { activity: "waiting" };
      break;
    case "UserPromptSubmit":
      result = { activity: "thinking" };
      break;
    case "PreToolUse":
      result = toolActivity(tool, input, cwd);
      break;
    // After a permission prompt nothing else says the tool now runs.
    case "PostToolUse":
      result = current === "needs-you" ? { activity: "thinking" } : null;
      break;
    case "PostToolUseFailure":
      result = event.is_interrupt ? null : { activity: "error", detail: `${tool} failed` };
      break;
    // The turn is over either way, so it's the user's move.
    case "StopFailure":
      result = { activity: "waiting", detail: "stopped by an error" };
      break;
    case "PermissionRequest":
      result = { activity: "needs-you", detail: tool && `allow ${tool}?` };
      break;
    case "Notification":
      if (BLOCKED.includes(event.notification_type)) result = { activity: "needs-you", detail: event.message };
      else if (event.notification_type === "idle_prompt") result = { activity: "waiting" };
      else result = null;
      break;
    case "SessionEnd":
      result = { activity: "sleeping" };
      break;
    default:
      result = null;
  }
  return result && { activity: result.activity, detail: short(result.detail) };
}

/**
 * Merge `changes` into the avatar's scene file, keeping its other keys. The
 * write is atomic, so the viewer never reads half a file. Returns the
 * activity the file held before.
 */
export function updateAvatar(file, changes) {
  let scene = {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) scene = parsed;
  } catch {
    // Missing or broken: start a new one.
  }
  const before = scene.activity ?? "";
  Object.assign(scene, changes);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(scene, null, 2) + "\n");
  renameSync(temp, file);
  return before;
}

/** The scene keys for an activity and its caption; "none" clears both. */
export const activityKeys = (activity, detail = "") =>
  activity === "none" ? { activity: "", caption: "" } : { activity, caption: short(detail) };

/** Set the avatar's activity and caption. Returns the activity the file held before. */
export const writeActivity = (file, activity, detail = "") => updateAvatar(file, activityKeys(activity, detail));

/**
 * Everything one hook event changes in the avatar's file: the activity, if
 * it changes, and the session's stats, if the event names a readable
 * transcript. Null when there is nothing to write.
 */
export function hookChanges(event, current = "") {
  const change = hookActivity(event, current);
  const session = sessionStats(event?.transcript_path);
  if (!change && !session) return null;
  return { ...(change && activityKeys(change.activity, change.detail)), ...(session && { session }) };
}

/** The activity the avatar file names now, or "". */
export function readActivity(file) {
  try {
    const { activity } = JSON.parse(readFileSync(file, "utf8"));
    return ACTIVITY_IDS.includes(activity) ? activity : "";
  } catch {
    return "";
  }
}

/** Hook events glyphterm listens to; all run in the background so they never slow the agent. */
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  // Changes no activity, but brings a satellite home (see session.js).
  "SubagentStop",
  "Stop",
  "StopFailure",
  "SessionEnd",
];

/** The `hooks` block for a Claude Code settings file that runs `command` on every event. */
export function hooksConfig(command) {
  return {
    hooks: Object.fromEntries(
      HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command, async: true }] }]]),
    ),
  };
}
