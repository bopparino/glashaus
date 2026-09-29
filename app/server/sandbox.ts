import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { AppError } from "./validation.ts";

export const SANDBOX_IMAGE = "glashaus-workspace:1";
const docker = () =>
  process.env.GLASHAUS_DOCKER_BINARY ||
  (existsSync("/Applications/Docker.app/Contents/Resources/bin/docker")
    ? "/Applications/Docker.app/Contents/Resources/bin/docker"
    : "docker");
function command(
  args: string[],
  signal?: AbortSignal,
  max = 1024 * 1024,
  input?: Buffer,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(docker(), args, {
      stdio: ["pipe", "pipe", "pipe"],
      signal,
      env: { ...process.env },
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    let output = "",
      error = "",
      size = 0,
      exceeded = false;
    child.stdout.on("data", (b) => {
      size += b.length;
      if (size > max) {
        exceeded = true;
        child.kill("SIGKILL");
      } else output += b.toString();
    });
    child.stderr.on("data", (b) => {
      if (error.length < 8000) error += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 && !exceeded
        ? resolve(output)
        : reject(
            new AppError(
              exceeded
                ? "Sandbox output exceeded its limit."
                : `Sandbox command failed: ${error.slice(-1500) || code}`,
              503,
            ),
          ),
    );
  });
}
export interface SandboxOutput {
  name: string;
  mime: string;
  data: string;
}
export interface SandboxRunner {
  status(): Promise<{ ready: boolean; message: string }>;
  run(
    files: Record<string, Buffer>,
    kind: "document" | "python",
    signal: AbortSignal,
    jobId?: string,
  ): Promise<SandboxOutput[]>;
  recover?(ids: string[]): void;
}
export class DockerSandbox implements SandboxRunner {
  private owner: string;
  private stale: string[] = [];
  constructor(home: string = randomUUID()) {
    this.owner = createHash("sha256").update(home).digest("hex").slice(0, 12);
  }
  private name(id: string) {
    return `glashaus-${this.owner}-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
  }
  recover(ids: string[]) {
    this.stale = ids;
  }
  async status() {
    try {
      await command(
        ["image", "inspect", SANDBOX_IMAGE],
        AbortSignal.timeout(4000),
      );
      if (this.stale.length) {
        const names = this.stale.map((id) => this.name(id));
        await command(
          ["rm", "--force", ...names],
          AbortSignal.timeout(10000),
        ).catch(() => {});
        this.stale = [];
      }
      return { ready: true, message: "Local sandbox ready" };
    } catch {
      return {
        ready: false,
        message:
          "Open Docker Desktop, then choose Settings → Prepare local tools in the Mac app.",
      };
    }
  }
  async run(
    files: Record<string, Buffer>,
    kind: "document" | "python",
    signal: AbortSignal,
    jobId: string = randomUUID(),
  ): Promise<SandboxOutput[]> {
    const name = this.name(jobId);
    // No Docker socket, host volumes, network or credentials inside the job.
    // The only writable filesystem is bounded RAM, discarded at completion.
    try {
      await command(
        [
          "run",
          "--detach",
          "--pull=never",
          "--name",
          name,
          "--label",
          "net.glashaus.workspace=true",
          "--network=none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--pids-limit=64",
          "--memory=768m",
          "--memory-swap=768m",
          "--cpus=1",
          "--user=1000:1000",
          "--tmpfs",
          "/work:rw,noexec,nosuid,size=128m,uid=1000,gid=1000,mode=0700",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=192m,uid=1000,gid=1000,mode=1777",
          SANDBOX_IMAGE,
        ],
        signal,
      );
      for (const [filename, bytes] of Object.entries(files)) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(filename))
          throw new AppError("Invalid sandbox input name.");
        await command(
          [
            "exec",
            "-i",
            name,
            "python",
            "-c",
            "import sys,pathlib; pathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())",
            `/work/${filename}`,
          ],
          signal,
          1024,
          bytes,
        );
      }
      await command(
        [
          "exec",
          name,
          "python",
          kind === "document" ? "/opt/glashaus/render.py" : "/work/main.py",
        ],
        signal,
      );
      const raw = await command(
        ["exec", name, "python", "/opt/glashaus/collect.py"],
        signal,
        18 * 1024 * 1024,
      );
      return JSON.parse(raw);
    } finally {
      await command(["rm", "--force", name], AbortSignal.timeout(10000)).catch(
        () => {},
      );
    }
  }
}
