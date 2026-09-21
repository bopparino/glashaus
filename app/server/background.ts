// Native service entry. No credentials are placed in the registration file.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { format } from "node:util";
import type { Registration } from "./startup.ts";

const file = process.argv[2];
if (!file || !path.isAbsolute(file))
  throw new Error("A startup registration file is required.");
const config = JSON.parse(readFileSync(file, "utf8")) as Registration;
if (!config.enabled) process.exit(0);
if (
  !path.isAbsolute(config.directory) ||
  !Number.isInteger(config.port) ||
  config.port < 1 ||
  config.port > 65535 ||
  typeof config.nonce !== "string"
)
  throw new Error("Invalid startup registration.");
const folder = path.dirname(file);
const log = path.join(folder, "background.log");
if (existsSync(log) && statSync(log).size > 5_000_000)
  renameSync(log, `${log}.previous`);
for (const level of ["log", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) =>
    appendFileSync(log, `${new Date().toISOString()} ${format(...args)}\n`, {
      mode: 0o600,
    });
}
process.env.GLASHAUS_HOME = config.directory;
process.env.GLASHAUS_PORT = String(config.port);
process.env.GLASHAUS_MANAGED = "1";
process.env.GLASHAUS_STARTUP_FILE = file;
// Tell the foreground process we are alive before waiting for its listening port.
writeFileSync(
  path.join(folder, "ready.json"),
  JSON.stringify({ nonce: config.nonce, pid: process.pid }),
  { mode: 0o600 },
);
try {
  await import("./main.ts");
} catch (error) {
  console.error(
    "Background app could not start:",
    error instanceof Error ? error.message : "Unknown startup failure",
  );
  process.exit(1);
}
