import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../shared/version.ts";
import type { UpdateStatus } from "../shared/types.ts";
import { alive, claimUpdate, releaseUpdate } from "./update-engine.ts";
import { launchUpdater } from "./update-launch.ts";
import { latestRelease } from "./update-release.ts";
import type { Release } from "./update-release.ts";
import { isUpdating, readUpdate, writeUpdate } from "./update-state.ts";
import type { Startup } from "./startup.ts";
import { AppError } from "./validation.ts";

export interface UpdateControl {
  status(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  start(version: string): Promise<UpdateStatus>;
}
export class Updates implements UpdateControl {
  private release: Release | null = null;
  private checkedAt: number | null = null;
  private starting = false;
  private readonly startup: Startup;
  constructor(startup: Startup) {
    this.startup = startup;
  }
  async status(): Promise<UpdateStatus> {
    const startup = await this.startup.status();
    const current = readUpdate(this.startup.directory);
    const worker = fileURLToPath(
      new URL("./update-worker.js", import.meta.url),
    );
    return {
      current: VERSION,
      latest: this.release,
      checkedAt: this.checkedAt,
      available: startup.managed && startup.available && existsSync(worker),
      message: startup.managed
        ? startup.message
        : "To update from here, enable background startup above. For a manual session, stop it with Ctrl+C and rerun the installer.",
      operation: current
        ? {
            id: current.id,
            version: current.version,
            phase:
              isUpdating(current) && !alive(current.pid)
                ? "recovery-needed"
                : current.phase,
            message:
              isUpdating(current) && !alive(current.pid)
                ? "The updater stopped before finishing. Run 'node bin/glashaus-v3.js recover' from the downloaded app. Your previous app and backup have been kept."
                : current.message,
            backup: current.backup ?? null,
          }
        : null,
    };
  }
  async check() {
    this.release = await latestRelease(VERSION);
    this.checkedAt = Date.now();
    return this.status();
  }
  async start(version: string) {
    if (this.starting)
      throw new AppError("An update is already being prepared.", 409);
    this.starting = true;
    try {
      const status = await this.status();
      if (!status.available)
        throw new AppError(
          status.message || "Update from the one-line installer.",
        );
      if (
        !this.release ||
        this.release.version !== version ||
        !this.checkedAt ||
        Date.now() - this.checkedAt > 15 * 60_000
      )
        throw new AppError(
          "Check for updates again before confirming this release.",
        );
      const record = claimUpdate(this.startup.directory, version);
      const file = path.join(
        this.startup.directory,
        "updates",
        `${record.id}.json`,
      );
      try {
        writeFileSync(
          file,
          JSON.stringify({
            directory: this.startup.directory,
            port: this.startup.port,
            id: record.id,
            release: this.release,
          }),
          { mode: 0o600, flag: "wx" },
        );
        await launchUpdater({
          directory: this.startup.directory,
          id: this.startup.id,
          worker: fileURLToPath(new URL("./update-worker.js", import.meta.url)),
          request: file,
        });
      } catch {
        writeUpdate(this.startup.directory, {
          ...record,
          phase: "failed",
          message:
            "The updater could not start. Your running app has not changed. Try the one-line installer instead.",
        });
        releaseUpdate(this.startup.directory, record.id);
        throw new AppError(
          "The updater could not start. Your running app has not changed. Try the one-line installer instead.",
        );
      }
      return this.status();
    } finally {
      this.starting = false;
    }
  }
}
