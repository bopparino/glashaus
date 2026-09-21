import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../shared/version.ts";
import {
  activate,
  alive,
  claimUpdate,
  releaseUpdate,
  rollback,
} from "./update-engine.ts";
import { readUpdate, writeUpdate } from "./update-state.ts";
import { Startup } from "./startup.ts";

export async function installCommand(command: "install" | "recover") {
  const directory = path.resolve(
    process.env.GLASHAUS_HOME ?? path.join(os.homedir(), ".glashaus-v3"),
  );
  const registered = new Startup({ directory, port: 7777 }).registration();
  const port = Number(process.env.GLASHAUS_PORT ?? registered?.port ?? 7777);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a valid GLASHAUS_PORT.");
  if (command === "recover") {
    const record = readUpdate(directory);
    if (!record) throw new Error("No update recovery record was found.");
    if (alive(record.pid) && record.pid !== process.pid)
      throw new Error(
        "The updater is still running. Wait for it to finish before recovery.",
      );
    if (record.phase === "complete" || record.phase === "failed") {
      releaseUpdate(directory, record.id);
      console.log(
        "No recovery is needed. The completed update lock was cleared.",
      );
      return false;
    }
    if (record.stopped) await rollback(directory, record);
    record.phase = "failed";
    record.message = record.stopped
      ? "Recovery finished. The previous app is running again."
      : "The interrupted download was cancelled. Your previous app was not changed.";
    writeUpdate(directory, record);
    releaseUpdate(directory, record.id);
    console.log(record.message);
    return false;
  }
  const candidate = fileURLToPath(new URL("../../", import.meta.url));
  const record = claimUpdate(directory, VERSION);
  console.log(
    "Checking the existing installation. Your companion home will be kept.",
  );
  const foreground = await activate(directory, port, candidate, record);
  console.log(`${record.message}\nOpen http://127.0.0.1:${port}`);
  if (record.backup)
    console.log(`Private recovery backup: ${path.dirname(record.backup)}`);
  return foreground;
}
