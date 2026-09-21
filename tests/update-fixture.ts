import type { UpdateStatus } from "../app/shared/types.ts";
import { VERSION } from "../app/shared/version.ts";
import type { UpdateControl } from "../app/server/updates.ts";
import { AppError } from "../app/server/validation.ts";

export function updateFixture(): UpdateControl & {
  checks: number;
  starts: number;
} {
  const status: UpdateStatus = {
    current: VERSION,
    latest: null,
    checkedAt: null,
    available: true,
    message:
      "Synthetic preview only. No real update is downloaded or installed.",
    operation: null,
  };
  return {
    checks: 0,
    starts: 0,
    async status() {
      return { ...status };
    },
    async check() {
      this.checks++;
      if (this.checks === 1)
        throw new AppError(
          "Preview: GitHub could not be reached. Your app has not changed. Try again.",
        );
      status.checkedAt = Date.now();
      status.latest = {
        version: "3.0.1-alpha.0",
        tag: "v3.0.1-alpha.0",
        url: "https://github.com/bopparino/glashaus/releases",
      };
      return { ...status };
    },
    async start() {
      this.starts++;
      status.operation = {
        id: "synthetic-update",
        version: "3.0.1-alpha.0",
        phase: "preparing",
        message: "Preparing the update. Your companion is still available.",
        backup: null,
      };
      setTimeout(() => {
        status.operation = {
          ...status.operation!,
          phase: "failed",
          message:
            "Preview: the new app did not start. The previous version is running again.",
          backup:
            "C:/Synthetic companion home/backups/update-demo/glashaus-v3.sqlite",
        };
      }, 1800).unref();
      return { ...status };
    },
  };
}
