import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Store } from "./store.ts";
import { AppError } from "./validation.ts";
import { isUpdating, readUpdate, writeUpdate } from "./update-state.ts";
import { alive } from "./update-engine.ts";

export type ResetMode = "companion" | "purge";
export interface ResetResult {
  cleared: true;
  complete: boolean;
  warnings: string[];
  removedFiles: number;
}
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const recoveryFolder = new RegExp(`^update-${UUID}$`, "i");
const failedFolder = new RegExp(`^failed-candidate-${UUID}$`, "i");
const databaseFile = /^glashaus-v3\.sqlite(?:-wal|-shm)?$/;

function checkedPath(home: string, target: string) {
  const relative = path.relative(home, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new AppError(
      "The cleanup target is outside this companion home. Nothing was cleared.",
      409,
    );
  // lstat each component: neither directory junctions nor file links are followed.
  let current = home;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new AppError(
        "Cleanup does not follow linked data files or folders. Nothing was cleared. Use a regular companion home.",
        409,
      );
  }
  const resolved = path.relative(realpathSync(home), realpathSync(target));
  if (resolved.startsWith("..") || path.isAbsolute(resolved))
    throw new AppError(
      "The cleanup target resolves outside this companion home. Nothing was cleared.",
      409,
    );
}

// Share the updater's exclusive lock. Neither action can race a backup/rollback.
export function claimDataReset(directory: string): () => void {
  if (directory === ":memory:") return () => {};
  const home = path.resolve(directory);
  checkedPath(home, home);
  const folder = path.join(home, "updates");
  if (existsSync(folder)) checkedPath(home, folder);
  else mkdirSync(folder, { mode: 0o700 });
  if (isUpdating(readUpdate(home)))
    throw new AppError(
      "Finish or recover the current update before deleting data.",
      409,
    );
  const lock = path.join(folder, "lock.json");
  const id = randomUUID();
  try {
    writeFileSync(
      lock,
      JSON.stringify({ id, kind: "data-reset", pid: process.pid }),
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    throw new AppError(
      "An update or data cleanup owns this home. Wait for it to finish. After an interrupted cleanup, use the recover command.",
      409,
    );
  }
  return () => {
    if (!existsSync(lock)) return;
    checkedPath(home, lock);
    if (JSON.parse(readFileSync(lock, "utf8")).id === id) unlinkSync(lock);
  };
}

export function recoverDataResetLock(directory: string): boolean {
  const file = path.join(directory, "updates", "lock.json");
  if (!existsSync(file)) return false;
  checkedPath(path.resolve(directory), file);
  const lock = JSON.parse(readFileSync(file, "utf8"));
  if (lock.kind !== "data-reset") return false;
  if (!Number.isInteger(lock.pid) || lock.pid <= 0 || alive(lock.pid))
    throw new AppError(
      "The data cleanup process may still be running. Stop it before clearing its lock.",
      409,
    );
  unlinkSync(file);
  console.log(
    "The interrupted cleanup lock was cleared. No deleted data was restored. Open Settings to check the result or retry Purge local data.",
  );
  return true;
}

export function prepareDataReset(store: Store, mode: ResetMode) {
  const files: string[] = [],
    folders: string[] = [];
  const home = path.resolve(store.directory);
  if (store.directory !== ":memory:") {
    const database = path.join(home, "glashaus-v3.sqlite");
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${database}${suffix}`;
      if (!existsSync(file)) continue;
      checkedPath(home, file);
      if (!lstatSync(file).isFile() || lstatSync(file).nlink !== 1)
        throw new AppError(
          "Cleanup requires ordinary, unlinked database files. Nothing was cleared.",
          409,
        );
    }
    if (mode === "purge") {
      const backups = path.join(home, "backups");
      if (existsSync(backups)) {
        checkedPath(home, backups);
        for (const entry of readdirSync(backups)) {
          if (!recoveryFolder.test(entry)) continue; // User-owned files stay.
          const folder = path.join(backups, entry);
          checkedPath(home, folder);
          if (!lstatSync(folder).isDirectory())
            throw new AppError(
              "A recovery folder is not a directory. Nothing was cleared.",
              409,
            );
          const collect = (dir: string, nested = false) => {
            for (const name of readdirSync(dir)) {
              const file = path.join(dir, name);
              checkedPath(home, file);
              if (
                !nested &&
                failedFolder.test(name) &&
                lstatSync(file).isDirectory()
              ) {
                collect(file, true);
              } else if (databaseFile.test(name) && lstatSync(file).isFile()) {
                files.push(file);
              } else {
                throw new AppError(
                  "A managed recovery folder contains an unfamiliar file. Move your own files out of that folder before purging. Nothing was cleared.",
                  409,
                );
              }
            }
            folders.push(dir);
          };
          collect(folder);
        }
      }
      for (const name of ["background.log", "background.log.previous"]) {
        const file = path.join(home, "startup", name);
        if (existsSync(file)) {
          checkedPath(home, file);
          if (!lstatSync(file).isFile())
            throw new AppError(
              "A background log is not a file. Nothing was cleared.",
              409,
            );
          files.push(file);
        }
      }
    }
  }
  return (removeFile = unlinkSync): ResetResult => {
    const warnings = store.resetData(mode === "purge");
    let removedFiles = 0;
    for (const file of files) {
      try {
        checkedPath(home, file);
        removeFile(file);
        removedFiles++;
      } catch {
        warnings.push(
          "Some recovery copies or background logs could not be removed. Your current companion and settings were cleared, but the purge is incomplete. Close other apps using those files and retry Purge local data.",
        );
      }
    }
    for (const folder of folders) {
      try {
        checkedPath(home, folder);
        rmdirSync(folder);
      } catch {
        /* Never recursively remove unknown contents. */
      }
    }
    if (
      mode === "purge" &&
      store.directory !== ":memory:" &&
      !warnings.length
    ) {
      try {
        const update = readUpdate(home);
        if (update) {
          delete update.backup;
          update.message =
            "The previous update finished. Its recovery copies were purged by you.";
          writeUpdate(home, update);
        }
      } catch {
        warnings.push(
          "Data was cleared, but the old update status could not be refreshed. A recovery path shown in Updates may no longer exist.",
        );
      }
    }
    return {
      cleared: true,
      complete: warnings.length === 0,
      warnings: [...new Set(warnings)],
      removedFiles,
    };
  };
}
