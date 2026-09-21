import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { Startup } from "./startup.ts";
import type { Registration } from "./startup.ts";
import { compareVersions } from "./update-release.ts";
import { isUpdating, readUpdate, writeUpdate } from "./update-state.ts";
import type { UpdateRecord } from "./update-state.ts";
import { AppError } from "./validation.ts";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lockFile = (home: string) => path.join(home, "updates", "lock.json");
export function claimUpdate(directory: string, version: string): UpdateRecord {
  mkdirSync(path.dirname(lockFile(directory)), {
    recursive: true,
    mode: 0o700,
  });
  if (isUpdating(readUpdate(directory)))
    throw new AppError(
      "An update is in progress or needs recovery. Check Settings or run 'node bin/glashaus-v3.js recover' from the installed app.",
      409,
    );
  const registration = new Startup({ directory, port: 7777 }).registration();
  if (registration?.updateId)
    throw new AppError(
      "The last update is still finishing its restart. Open the app and wait a moment before updating again.",
      409,
    );
  const record: UpdateRecord = {
    id: randomUUID(),
    pid: process.pid,
    phase: "preparing",
    version,
    message: "Preparing the update. Your companion is still available.",
    startedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(lockFile(directory), JSON.stringify({ id: record.id }), {
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new AppError(
      "Another update owns this companion home. Wait for it to finish, or use the recover command after it has stopped.",
      409,
    );
  }
  writeUpdate(directory, record);
  return record;
}
export function releaseUpdate(directory: string, id: string) {
  const file = lockFile(directory);
  if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).id === id)
    unlinkSync(file);
}
export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export async function occupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const end = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => end(true));
    socket.once("error", () => end(false));
    socket.setTimeout(1500, () => end(true)); // Unknown is not permission to write.
  });
}
async function waitFor(
  check: () => Promise<boolean>,
  message: string,
  timeout = 45000,
) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await pause(300);
  }
  throw new Error(message);
}
async function get<T>(port: number, endpoint: string): Promise<T> {
  const r = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) throw new Error(`The local app could not answer ${endpoint}.`);
  return (await r.json()) as T;
}
export async function requestStop(port: number, owner: string) {
  const state = await get<{ id: string; managed: boolean }>(port, "startup");
  if (state.id !== owner)
    throw new Error(
      "Another companion home owns this port. Nothing was stopped.",
    );
  if (!state.managed)
    throw new Error(
      "This is a manual session. Stop it with Ctrl+C, then rerun the installer. Or enable background startup in Settings first.",
    );
  const { csrfToken } = await get<{ csrfToken: string }>(port, "state");
  const response = await fetch(`http://127.0.0.1:${port}/api/startup/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-glashaus-token": csrfToken,
    },
    body: JSON.stringify({ enabled: true }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(((await response.json()) as { error: string }).error);
}
export function checkDatabase(file: string) {
  if (lstatSync(file).isSymbolicLink())
    throw new Error("Updates do not follow a linked database file.");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
      throw new Error(
        "The companion database did not pass its integrity check.",
      );
    if (
      Object.values(db.prepare("PRAGMA application_id").get()!)[0] !==
      1196179763
    )
      throw new Error("This is not a GlasHaus v3 companion database.");
  } finally {
    db.close();
  }
}
export async function backupDatabase(directory: string, id: string) {
  const file = path.join(directory, "glashaus-v3.sqlite");
  if (!existsSync(file)) return undefined;
  checkDatabase(file);
  const folder = path.join(directory, "backups", `update-${id}`);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  const destination = path.join(folder, "glashaus-v3.sqlite");
  // Precreate with owner-only permissions; SQLite backup includes WAL contents.
  writeFileSync(destination, "", { mode: 0o600, flag: "wx" });
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    await backup(db, destination);
  } finally {
    db.close();
  }
  checkDatabase(destination);
  return destination;
}
export function restoreDatabase(directory: string, record: UpdateRecord) {
  if (!record.backup) return;
  const expected = path.join(
    directory,
    "backups",
    `update-${record.id}`,
    "glashaus-v3.sqlite",
  );
  if (record.backup !== expected)
    throw new Error(
      "The backup path is outside this update's recovery folder.",
    );
  checkDatabase(expected);
  const preserved = path.join(
    path.dirname(expected),
    `failed-candidate-${randomUUID()}`,
  );
  mkdirSync(preserved, { mode: 0o700 });
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = path.join(directory, `glashaus-v3.sqlite${suffix}`);
    if (existsSync(file)) {
      if (lstatSync(file).isSymbolicLink())
        throw new Error("Recovery does not follow linked database files.");
      renameSync(file, path.join(preserved, path.basename(file)));
    }
  }
  copyFileSync(expected, path.join(directory, "glashaus-v3.sqlite"));
}
export interface UpdateRuntime {
  control(config: Registration, updateId?: string): Startup;
  occupied(port: number): Promise<boolean>;
  stop(port: number, owner: string): Promise<void>;
  waitClosed(port: number): Promise<void>;
  quiescent(config: Registration): Promise<void>;
  healthy(
    config: Registration,
    version: string,
    updateId?: string,
  ): Promise<void>;
  backup(directory: string, id: string): Promise<string | undefined>;
  restore(directory: string, record: UpdateRecord): void;
}
export const runtime: UpdateRuntime = {
  control: (config, updateId) =>
    new Startup({ ...config, managed: false, updateId }),
  occupied,
  stop: requestStop,
  waitClosed: (port) =>
    waitFor(
      async () => !(await occupied(port)),
      "The old app did not release its port. No database files were replaced.",
    ),
  quiescent: (config) =>
    waitFor(async () => {
      if (await occupied(config.port)) return false;
      const marker = path.join(config.directory, "startup", "ready.json");
      if (!existsSync(marker)) return true;
      const ready = JSON.parse(readFileSync(marker, "utf8"));
      return Number.isInteger(ready.pid) && !alive(ready.pid);
    }, "The background process has not fully exited. Recovery will not replace a database while a process may still own it."),
  healthy: (config, version, updateId) =>
    waitFor(async () => {
      try {
        const identity = await get<{ id: string; managed: boolean }>(
          config.port,
          "startup",
        );
        if (identity.id !== config.owner || !identity.managed) return false;
        if (updateId) {
          const health = await get<{
            version: string;
            updateId: string;
            id: string;
          }>(config.port, "health");
          return (
            health.version === version &&
            health.updateId === updateId &&
            health.id === config.owner
          );
        }
        return (
          (await get<{ version: string }>(config.port, "state")).version ===
          version
        );
      } catch {
        return false;
      }
    }, "The new app did not pass its startup check."),
  backup: backupDatabase,
  restore: restoreDatabase,
};
function versionAt(entry: string) {
  const root = path.resolve(path.dirname(entry), "../..");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.name !== "glashaus")
    throw new Error("The installation is not a GlasHaus app.");
  compareVersions(pkg.version, pkg.version);
  return pkg.version as string;
}
export async function rollback(
  directory: string,
  record: UpdateRecord,
  rt: UpdateRuntime = runtime,
) {
  const previous = record.previous;
  if (!previous || previous.directory !== directory)
    throw new Error("The previous installation record is missing.");
  const current = new Startup({
    directory,
    port: previous.port,
  }).registration();
  // The native service may be partially registered. Stop only this home's app.
  if (current) {
    const control = rt.control(current);
    if (await rt.occupied(current.port))
      await rt.stop(current.port, current.owner);
    await control.disable();
    await control.stopNative();
    await rt.waitClosed(current.port);
    await rt.quiescent(current);
  }
  if (await rt.occupied(previous.port))
    throw new Error(
      "The companion port is still occupied. Recovery has not replaced the database.",
    );
  rt.restore(directory, record);
  const old = rt.control(previous);
  await old.enable();
  if (!previous.enabled) await old.disable();
  await rt.healthy(previous, versionAt(previous.entry));
}
// Called with a fully downloaded installation. No network is needed after stop.
export async function activate(
  directory: string,
  port: number,
  candidate: string,
  record: UpdateRecord,
  rt: UpdateRuntime = runtime,
) {
  const entry = path.join(candidate, "dist", "server", "background.js");
  const own = new Startup({ directory, port, entry });
  const previous = own.registration();
  const change = (phase: UpdateRecord["phase"], message: string) => {
    Object.assign(record, { phase, message });
    writeUpdate(directory, record);
  };
  try {
    const version = versionAt(entry);
    if (version !== record.version || !existsSync(entry))
      throw new Error("The staged application does not match this update.");
    if (previous && previous.port !== port)
      throw new Error(
        `This companion uses port ${previous.port}. Set GLASHAUS_PORT to that port before updating.`,
      );
    if (previous && compareVersions(version, versionAt(previous.entry)) < 0)
      throw new Error(
        "This installer is older than your installed app. Download the current installer; automatic downgrades are not allowed.",
      );
    if (previous && compareVersions(version, versionAt(previous.entry)) === 0) {
      if (!(await rt.occupied(port))) {
        const old = rt.control(previous);
        await old.enable();
        if (!previous.enabled) await old.disable();
        await rt.healthy(previous, version);
      }
      change(
        "complete",
        `GlasHaus ${version} is already installed. Open the existing app.`,
      );
      return false;
    }
    record.previous = previous ?? undefined;
    record.candidate = candidate;
    writeUpdate(directory, record);
    if (await rt.occupied(port)) {
      if (!previous)
        throw new Error(
          "An app is already using this port. Stop a manual GlasHaus session with Ctrl+C before rerunning the installer.",
        );
      change("stopping", "Waiting for GlasHaus to stop…");
      await rt.stop(port, own.id); // Busy/foreign/manual refusal leaves registration untouched.
      record.stopped = true;
      writeUpdate(directory, record);
    }
    if (previous) {
      record.stopped = true;
      writeUpdate(directory, record);
      const old = rt.control(previous);
      await old.disable();
      await rt.waitClosed(port);
      await old.stopNative();
      await rt.quiescent(previous);
    }
    change("backing-up", "Saving a local recovery copy of your companion…");
    record.backup = await rt.backup(directory, record.id);
    writeUpdate(directory, record);
    if (!previous) {
      change("complete", "Installed. Starting GlasHaus in this terminal.");
      return true; // First installation/manual offline home keeps foreground mode.
    }
    change("starting", "Starting the new version. This page will reconnect…");
    const next: Registration = {
      ...previous,
      node: process.execPath,
      entry,
      enabled: true,
      updateId: record.id,
    };
    const control = rt.control(next, record.id);
    await control.enable();
    if (!previous.enabled) await control.disable();
    await rt.healthy(next, version, record.id);
    if (existsSync(path.join(directory, "glashaus-v3.sqlite")))
      checkDatabase(path.join(directory, "glashaus-v3.sqlite"));
    // Commit is a single atomic file replacement. Only then does the candidate
    // allow mutations, jobs and Telegram, so failed startup cannot lose messages.
    change("complete", `Updated to ${version}. Your companion is ready.`);
    return false;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The update failed.";
    if (record.stopped && record.previous) {
      try {
        await rollback(directory, record, rt);
        change(
          "failed",
          `${message} The previous version is running again. Your recovery backup and both app folders were kept.`,
        );
      } catch {
        change(
          "recovery-needed",
          `${message} Automatic recovery could not finish. Do not delete your app or companion folders. Run 'node bin/glashaus-v3.js recover' from this downloaded app after the updater has stopped.`,
        );
      }
    } else change("failed", `${message} The running app was not changed.`);
    throw new AppError(record.message);
  } finally {
    if (!isUpdating(record)) releaseUpdate(directory, record.id);
  }
}
