import os from "node:os";
import path from "node:path";
import { Startup } from "./startup.ts";
import type { StartupStatus } from "../shared/types.ts";

export async function serviceCommand(command: string) {
  const directory = path.resolve(
    process.env.GLASHAUS_HOME ?? path.join(os.homedir(), ".glashaus-v3"),
  );
  const port = Number(process.env.GLASHAUS_PORT ?? 7777);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a valid GLASHAUS_PORT.");
  const startup = new Startup({ directory, port });
  const base = `http://127.0.0.1:${port}`;
  if (command === "status") {
    const status = await startup.status();
    console.log(
      `${status.platform}: sign-in startup ${status.enabled ? "on" : "off"}.\n${status.message || `App: ${base}`}\nService name: ${startup.id}\nLog: ${path.join(startup.folder, "background.log")}`,
    );
    return;
  }
  if (command === "disable") {
    await startup.disable();
    console.log(
      "Sign-in startup is off. Any current session stays open. Use 'service stop' to stop a background session.",
    );
    return;
  }
  if (command !== "enable" && command !== "stop")
    throw new Error("Use service enable, disable, status, or stop.");
  let live: StartupStatus | undefined;
  try {
    const response = await fetch(`${base}/api/startup`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error();
    live = (await response.json()) as StartupStatus;
  } catch {
    /* No local service, or an older app without startup support. */
  }
  if (live) {
    if (live.id !== startup.id)
      throw new Error(
        "Another app or companion home owns this port. Stop it before changing this service.",
      );
    const state = (await (
      await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(2000) })
    ).json()) as { csrfToken: string };
    const response = await fetch(
      `${base}/api/startup${command === "stop" ? "/stop" : ""}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-glashaus-token": state.csrfToken,
        },
        body: JSON.stringify({ enabled: true }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!response.ok)
      throw new Error(((await response.json()) as { error: string }).error);
  } else if (command === "enable") await startup.enable();
  else
    throw new Error("No reachable background app. It may already be stopped.");
  console.log(
    command === "enable"
      ? `Background startup enabled. Open ${base} in a few seconds. Keep the installed app folder and Node in place.`
      : "The background session is stopping. Sign-in startup is unchanged; use 'service disable' to turn it off.",
  );
}
