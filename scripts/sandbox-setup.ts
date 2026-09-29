import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const executable =
  process.env.GLASHAUS_DOCKER_BINARY ||
  (existsSync("/Applications/Docker.app/Contents/Resources/bin/docker")
    ? "/Applications/Docker.app/Contents/Resources/bin/docker"
    : "docker");
const result = spawnSync(
  executable,
  [
    "build",
    "--tag",
    "glashaus-workspace:1",
    fileURLToPath(new URL("../tool-runtime", import.meta.url)),
  ],
  { stdio: "inherit" },
);
if (result.error)
  console.error(
    "Install and open Docker Desktop before preparing the workspace.",
  );
process.exitCode = result.status ?? 1;
