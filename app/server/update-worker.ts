import { readFileSync } from "node:fs";
import path from "node:path";
import { activate, releaseUpdate } from "./update-engine.ts";
import { stageRelease } from "./update-release.ts";
import { isUpdating, readUpdate, writeUpdate } from "./update-state.ts";

const file = process.argv[2];
if (!file || !path.isAbsolute(file))
  throw new Error("An updater request file is required.");
const request = JSON.parse(readFileSync(file, "utf8"));
const directory = path.resolve(request.directory);
const record = readUpdate(directory);
if (
  !record ||
  record.id !== request.id ||
  record.phase !== "preparing" ||
  file !== path.join(directory, "updates", `${record.id}.json`)
)
  throw new Error("This update request no longer owns the companion home.");
record.pid = process.pid;
writeUpdate(directory, record);
try {
  const candidate = await stageRelease(request.release);
  await activate(directory, request.port, candidate, record);
} catch (error) {
  // activate() records rollback results itself; download failures stop here.
  if (record.phase === "preparing") {
    record.phase = "failed";
    record.message =
      error instanceof Error
        ? error.message
        : "The release could not be downloaded. Your app has not changed.";
    writeUpdate(directory, record);
  }
  process.exitCode = 1;
} finally {
  if (!isUpdating(record)) releaseUpdate(directory, record.id);
}
