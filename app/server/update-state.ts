import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Registration } from "./startup.ts";

export type UpdatePhase =
  | "preparing"
  | "stopping"
  | "backing-up"
  | "starting"
  | "complete"
  | "failed"
  | "recovery-needed";
export interface UpdateRecord {
  id: string;
  pid: number;
  phase: UpdatePhase;
  version: string;
  message: string;
  startedAt: string;
  previous?: Registration;
  candidate?: string;
  backup?: string;
  stopped?: boolean;
}
export const updateFile = (directory: string) =>
  path.join(directory, "updates", "current.json");
export function readUpdate(directory: string): UpdateRecord | null {
  const file = updateFile(directory);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as UpdateRecord;
}
export function writeUpdate(directory: string, record: UpdateRecord) {
  const file = updateFile(directory);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
  renameSync(temp, file);
}
export function isUpdating(record: UpdateRecord | null) {
  return !!record && !["complete", "failed"].includes(record.phase);
}
export function updateCommitted(directory: string, id: string) {
  try {
    const record = readUpdate(directory);
    return record?.id === id && record.phase === "complete";
  } catch {
    return false;
  }
}
