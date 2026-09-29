import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AppError, record } from "./validation.ts";

const run = promisify(execFile);
type Launcher = (args: string[], signal: AbortSignal) => Promise<void>;
const launch: Launcher = async (args, signal) => { await run("/usr/bin/open", args, { signal, maxBuffer: 4096 }); };

// LaunchServices gives the helper its own macOS permission identity. Spawning
// its executable directly instead attributes access to Node or the terminal.
export async function runCalendarApp(app: string, command: Record<string, unknown>, signal: AbortSignal, launcher: Launcher = launch) {
  signal.throwIfAborted();
  const timeout = command.command === "authorize" ? 120_000 : 20_000;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  const directory = await mkdtemp(path.join(tmpdir(), "glashaus-calendar-"));
  const request = path.join(directory, "request.json"), response = path.join(directory, "response.json");
  try {
    await writeFile(request, JSON.stringify({ ...command, deadline: Date.now() + timeout }), { mode: 0o600 });
    await writeFile(response, "", { mode: 0o600 });
    try {
      await launcher(["-n", "-W", "-g", "--stdin", request, "--stdout", response, "--stderr", "/dev/null", app, "--args", "--request-file", request], bounded);
    } catch {
      throw new AppError("Calendar helper did not respond. Unlock your Mac and check its Calendar permission dialog, then try again.", 502);
    }
    bounded.throwIfAborted();
    let result: Record<string, unknown>;
    try {
      const output = await readFile(response, "utf8");
      if (output.length > 500_000) throw new Error("Response too large");
      result = record(JSON.parse(output));
    } catch { throw new AppError("Calendar helper could not complete the request. Reconnect Calendar in Settings.", 502); }
    if (result.error) throw new AppError(String(result.error));
    return result;
  } finally {
    // Removing the request also prevents a delayed helper from starting a write.
    await rm(directory, { recursive: true, force: true });
  }
}
