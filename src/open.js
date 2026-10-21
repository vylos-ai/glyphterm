// `glyphterm open`: start the viewer in a new pane next to the caller, using
// the terminal's own command-line interface. Terminals without one (or with
// it switched off) get a command to hand to the user instead.

import { execFileSync } from "node:child_process";

/**
 * How to split the current terminal and run `argv` in the new pane, judged
 * from the environment. The innermost multiplexer wins (tmux inside
 * Windows Terminal splits the tmux window). Returns null when there is no
 * supported way.
 */
export function paneLauncher(env, argv, cwd) {
  if (env.TMUX) {
    return { terminal: "tmux", command: ["tmux", "split-window", "-h", "-c", cwd, ...argv] };
  }
  if (env.WEZTERM_PANE) {
    return { terminal: "WezTerm", command: ["wezterm", "cli", "split-pane", "--right", "--cwd", cwd, "--", ...argv] };
  }
  if (env.KITTY_WINDOW_ID) {
    // Needs `allow_remote_control` in kitty.conf; without it kitty refuses and we say so.
    return { terminal: "kitty", command: ["kitty", "@", "launch", "--location=vsplit", "--cwd", cwd, ...argv] };
  }
  if (env.WT_SESSION) {
    return { terminal: "Windows Terminal", command: ["wt.exe", "-w", "0", "split-pane", "-V", "-d", cwd, ...argv] };
  }
  return null;
}

/** Quote `argv` for a POSIX shell, for a command the user copies. */
export function shellCommand(argv) {
  return argv.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/**
 * Open the pane. Returns `{ ok, message }`; on failure the message contains
 * the command for the user to run in a second terminal themselves.
 */
export function openPane(argv, { env = process.env, cwd = process.cwd() } = {}) {
  const manual = `Ask the user to run this in a second terminal:\n  cd ${shellCommand([cwd])} && ${shellCommand(argv)}`;
  const launcher = paneLauncher(env, argv, cwd);
  if (!launcher) {
    return {
      ok: false,
      message: `no supported way to open a pane here (tmux, WezTerm, kitty, Windows Terminal). ${manual}`,
    };
  }
  try {
    const [bin, ...args] = launcher.command;
    execFileSync(bin, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 });
    return { ok: true, message: `opened a ${launcher.terminal} pane running: ${shellCommand(argv)}` };
  } catch (err) {
    const reason = err.stderr?.toString().trim() || err.message;
    return { ok: false, message: `${launcher.terminal} could not open a pane (${reason}). ${manual}` };
  }
}
