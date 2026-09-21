import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { StartupStatus } from "../shared/types.ts";
import { AppError } from "./validation.ts";

export interface StartupControl {
  status(): Promise<StartupStatus>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}
export interface Registration {
  owner: string;
  enabled: boolean;
  directory: string;
  port: number;
  node: string;
  entry: string;
  nonce: string;
  updateId?: string;
}
type Runner = (file: string, args: string[]) => Promise<string>;
const exec = promisify(execFile);
const run: Runner = async (file, args) =>
  (
    await exec(file, args, {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 65536,
    })
  ).stdout.trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`;
export const xmlQuote = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export const unitQuote = (s: string) =>
  JSON.stringify(s.replaceAll("%", "%%").replaceAll("$", () => "$$"));
const encoded = (s: string) => [
  "-NoProfile",
  "-NonInteractive",
  "-WindowStyle",
  "Hidden",
  "-EncodedCommand",
  Buffer.from(`$ErrorActionPreference='Stop'; ${s}`, "utf16le").toString(
    "base64",
  ),
];

export class Startup implements StartupControl {
  readonly directory: string;
  readonly folder: string;
  readonly configFile: string;
  readonly id: string;
  readonly platform: string;
  readonly nativeFile: string;
  readonly entry: string;
  readonly node: string;
  readonly port: number;
  readonly uid: number;
  readonly execute: Runner;
  readonly managed: boolean;
  private busy = false;
  private readyTimeout: number;
  private updateId?: string;

  constructor(options: {
    directory: string;
    port: number;
    platform?: string;
    userHome?: string;
    configHome?: string;
    node?: string;
    entry?: string;
    uid?: number;
    execute?: Runner;
    managed?: boolean;
    readyTimeout?: number;
    updateId?: string;
  }) {
    this.directory = path.resolve(options.directory);
    this.folder = path.join(this.directory, "startup");
    this.configFile = path.join(this.folder, "registration.json");
    this.platform = options.platform ?? process.platform;
    this.id = `glashaus-${createHash("sha256")
      .update(
        this.platform === "win32"
          ? this.directory.toLowerCase()
          : this.directory,
      )
      .digest("hex")
      .slice(0, 16)}`;
    const userHome = options.userHome ?? os.homedir();
    const configHome = options.configHome ?? process.env.XDG_CONFIG_HOME;
    this.nativeFile =
      this.platform === "darwin"
        ? path.join(userHome, "Library", "LaunchAgents", `${this.id}.plist`)
        : path.join(
            configHome && path.isAbsolute(configHome)
              ? configHome
              : path.join(userHome, ".config"),
            "systemd",
            "user",
            `${this.id}.service`,
          );
    this.entry =
      options.entry ??
      fileURLToPath(new URL("./background.js", import.meta.url));
    this.node = options.node ?? process.execPath;
    this.port = options.port;
    this.uid = options.uid ?? process.getuid?.() ?? 0;
    this.execute = options.execute ?? run;
    this.managed = options.managed ?? process.env.GLASHAUS_MANAGED === "1";
    this.readyTimeout = options.readyTimeout ?? 15000;
    this.updateId = options.updateId;
  }
  private config(): Registration | null {
    if (!existsSync(this.configFile)) return null;
    try {
      const saved = JSON.parse(
        readFileSync(this.configFile, "utf8"),
      ) as Registration;
      if (saved.owner !== this.id || saved.directory !== this.directory)
        throw new Error();
      return saved;
    } catch {
      throw new AppError(
        "The background-startup record is unreadable. Keep using manual start; check the startup folder in your companion home.",
      );
    }
  }
  registration() {
    return this.config();
  }
  // Only an updater outside the service may use this, after graceful shutdown
  // or when rolling back a candidate that never reached its health endpoint.
  async stopNative() {
    const config = this.config();
    if (!config || config.entry !== this.entry || config.node !== this.node)
      throw new AppError(
        "This installation does not own the background service.",
      );
    if (this.platform === "win32") {
      await this.windowsState();
      await this.ps(`Stop-ScheduledTask -TaskName ${psQuote(this.id)}`);
    } else {
      if (
        !existsSync(this.nativeFile) ||
        !readFileSync(this.nativeFile, "utf8").includes(this.id)
      )
        throw new AppError("The service ownership record does not match.");
      if (this.platform === "linux")
        await this.execute("systemctl", [
          "--user",
          "stop",
          `${this.id}.service`,
        ]);
      else {
        let loaded = true;
        try {
          await this.execute("launchctl", [
            "print",
            `gui/${this.uid}/${this.id}`,
          ]);
        } catch {
          loaded = false;
        }
        if (loaded)
          await this.execute("launchctl", [
            "bootout",
            `gui/${this.uid}/${this.id}`,
          ]);
      }
    }
  }
  private write(config: Registration) {
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    writeFileSync(this.configFile, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
  }
  private ps(script: string) {
    return this.execute("powershell.exe", encoded(script));
  }
  private async windowsState() {
    const result = await this.ps(
      `$t=Get-ScheduledTask -TaskName ${psQuote(this.id)} -ErrorAction SilentlyContinue; if($t){ if($t.Description -ne ${psQuote(this.id)}){throw 'Task belongs to another app'}; if($t.Settings.Enabled){'enabled'}else{'disabled'} }else{'missing'}`,
    );
    return result;
  }
  async status(): Promise<StartupStatus> {
    const platform =
      this.platform === "linux"
        ? "Linux · systemd"
        : this.platform === "darwin"
          ? "macOS · launchd"
          : this.platform === "win32"
            ? "Windows · Task Scheduler"
            : "Unsupported system";
    const result: StartupStatus = {
      id: this.id,
      available: true,
      enabled: false,
      managed: this.managed,
      platform,
      message: "",
    };
    if (
      !["linux", "darwin", "win32"].includes(this.platform) ||
      !existsSync(this.entry)
    ) {
      return {
        ...result,
        available: false,
        message:
          "Background startup is available in the installed Windows, macOS, and systemd Linux release.",
      };
    }
    try {
      const config = this.config();
      if (this.platform === "linux")
        await this.execute("systemctl", ["--user", "show-environment"]);
      if (!config) return result;
      if (this.platform === "win32")
        result.enabled = (await this.windowsState()) === "enabled";
      else if (this.platform === "linux") {
        try {
          result.enabled =
            (await this.execute("systemctl", [
              "--user",
              "is-enabled",
              `${this.id}.service`,
            ])) === "enabled";
        } catch {
          result.enabled = false;
        }
      } else {
        const disabled = await this.execute("launchctl", [
          "print-disabled",
          `gui/${this.uid}`,
        ]);
        result.enabled =
          config.enabled &&
          existsSync(this.nativeFile) &&
          !disabled.includes(`"${this.id}" => true`);
      }
      if (
        result.enabled &&
        (config.entry !== this.entry ||
          config.node !== this.node ||
          config.port !== this.port)
      ) {
        result.available = false;
        result.message =
          "Another GlasHaus installation owns background startup. Disable it there and stop that copy before enabling this one.";
      }
      return result;
    } catch {
      return {
        ...result,
        available: false,
        message:
          this.platform === "linux"
            ? "A working systemd user session is required. You can still use manual start. On a server, sign in as your own user; do not run this app with sudo."
            : "Could not check your sign-in startup service. You can still use manual start. Check your system’s startup permissions.",
      };
    }
  }
  private nativeText() {
    if (this.platform === "linux")
      return `# ${this.id}\n[Unit]\nDescription=GlasHaus companion (${this.id})\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${unitQuote(this.node)} ${unitQuote(this.entry)} ${unitQuote(this.configFile)}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=15\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${this.id}</string>\n<key>ProgramArguments</key><array>${[this.node, this.entry, this.configFile].map((s) => `<string>${xmlQuote(s)}</string>`).join("")}</array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>5</integer>\n</dict></plist>\n`;
  }
  private async register() {
    if (this.platform === "win32") {
      // The waiting PowerShell parent gives Task Scheduler the full process lifetime.
      // EncodedCommand and literal arguments protect spaces, apostrophes, and Unicode.
      const args = [this.entry, this.configFile].map((s) => `"${s}"`).join(" ");
      const start = `$p=Start-Process -FilePath ${psQuote(this.node)} -ArgumentList ${psQuote(args)} -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
      const launch = encoded(start).join(" ");
      await this.windowsState(); // Refuse an unrelated task with the same name.
      await this.ps(
        `$u=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name; $a=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ${psQuote(launch)}; $t=New-ScheduledTaskTrigger -AtLogOn -User $u; $p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited; $s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1); Register-ScheduledTask -TaskName ${psQuote(this.id)} -Description ${psQuote(this.id)} -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null`,
      );
    } else {
      if (
        existsSync(this.nativeFile) &&
        !readFileSync(this.nativeFile, "utf8").includes(this.id)
      )
        throw new AppError(
          "A startup file with this name belongs to another app. It was not changed.",
        );
      mkdirSync(path.dirname(this.nativeFile), {
        recursive: true,
        mode: 0o700,
      });
      if (this.platform === "darwin" && !this.managed) {
        // launchd keeps ProgramArguments in memory. A stopped registration from
        // an older installation must be unloaded before it can use the new file.
        let loaded = false;
        try {
          await this.execute("launchctl", [
            "print",
            `gui/${this.uid}/${this.id}`,
          ]);
          loaded = true;
        } catch {
          /* not loaded */
        }
        if (loaded)
          await this.execute("launchctl", [
            "bootout",
            `gui/${this.uid}/${this.id}`,
          ]);
      }
      writeFileSync(this.nativeFile, this.nativeText(), { mode: 0o600 });
      if (this.platform === "linux") {
        await this.execute("systemctl", ["--user", "daemon-reload"]);
        await this.execute("systemctl", [
          "--user",
          "enable",
          `${this.id}.service`,
        ]);
      } else {
        await this.execute("launchctl", [
          "enable",
          `gui/${this.uid}/${this.id}`,
        ]);
      }
    }
  }
  private async start() {
    if (this.platform === "win32")
      await this.ps(`Start-ScheduledTask -TaskName ${psQuote(this.id)}`);
    else if (this.platform === "linux")
      await this.execute("systemctl", [
        "--user",
        "start",
        `${this.id}.service`,
      ]);
    else {
      try {
        await this.execute("launchctl", [
          "print",
          `gui/${this.uid}/${this.id}`,
        ]);
      } catch {
        await this.execute("launchctl", [
          "bootstrap",
          `gui/${this.uid}`,
          this.nativeFile,
        ]);
      }
      await this.execute("launchctl", [
        "kickstart",
        `gui/${this.uid}/${this.id}`,
      ]);
    }
  }
  private async disableNative() {
    if (this.platform === "win32")
      await this.ps(
        `if(Get-ScheduledTask -TaskName ${psQuote(this.id)} -ErrorAction SilentlyContinue){Disable-ScheduledTask -TaskName ${psQuote(this.id)} | Out-Null}`,
      );
    else if (this.platform === "linux")
      await this.execute("systemctl", [
        "--user",
        "disable",
        `${this.id}.service`,
      ]);
    else
      await this.execute("launchctl", [
        "disable",
        `gui/${this.uid}/${this.id}`,
      ]);
  }
  async enable() {
    if (this.busy)
      throw new AppError(
        "Startup is already being changed. Wait a moment and try again.",
        409,
      );
    this.busy = true;
    try {
      const status = await this.status();
      if (!status.available) throw new AppError(status.message);
      if (
        ![this.node, this.entry, this.directory, this.configFile].every(
          (s) => !/[\r\n\0]/.test(s),
        )
      )
        throw new AppError(
          "Background startup does not support line breaks in file paths.",
        );
      const previous = this.config();
      // Check ownership before writing anything or entering rollback code.
      if (this.platform === "win32") await this.windowsState();
      else if (
        existsSync(this.nativeFile) &&
        !readFileSync(this.nativeFile, "utf8").includes(this.id)
      )
        throw new AppError(
          "A startup file with this name belongs to another app. It was not changed.",
        );
      const config: Registration = {
        owner: this.id,
        enabled: true,
        directory: this.directory,
        port: this.port,
        node: this.node,
        entry: this.entry,
        nonce: previous?.enabled ? previous.nonce : randomUUID(),
        ...(this.updateId ? { updateId: this.updateId } : {}),
      };
      // Re-enabling a currently managed process needs no restart or readiness handshake.
      this.write(config);
      try {
        await this.register();
        if (!this.managed) {
          await this.start();
          const deadline = Date.now() + this.readyTimeout;
          let ready = false;
          while (Date.now() < deadline) {
            try {
              const marker = JSON.parse(
                readFileSync(path.join(this.folder, "ready.json"), "utf8"),
              );
              if (
                marker.nonce === config.nonce &&
                Number.isInteger(marker.pid)
              ) {
                process.kill(marker.pid, 0);
                ready = true;
                break;
              }
            } catch {
              /* Service launch can take a few seconds. */
            }
            await sleep(200);
          }
          if (!ready) throw new Error("Service did not become ready");
        }
      } catch {
        this.write(previous ?? { ...config, enabled: false });
        // A failed first enable must not silently leave sign-in startup enabled.
        if (!previous?.enabled) {
          try {
            await this.disableNative();
          } catch {
            throw new AppError(
              "The startup change failed, and its sign-in registration could not be disabled. Your current app is still running. Check Task Scheduler, launchd, or systemd before signing in again.",
            );
          }
        }
        throw new AppError(
          "Background startup did not finish. Your current app is still running. Check system startup permissions and the startup/background.log file in your companion home, or continue with manual start.",
        );
      }
    } finally {
      this.busy = false;
    }
  }
  async disable() {
    if (this.busy)
      throw new AppError(
        "Startup is already being changed. Wait a moment and try again.",
        409,
      );
    this.busy = true;
    try {
      const config = this.config();
      if (!config) return;
      if (this.platform === "win32") await this.windowsState();
      await this.disableNative();
      this.write({ ...config, enabled: false });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "Could not turn off sign-in startup. Check your system’s startup permissions and try again.",
      );
    } finally {
      this.busy = false;
    }
  }
}
