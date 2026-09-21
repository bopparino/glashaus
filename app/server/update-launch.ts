import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { psQuote, xmlQuote } from "./startup.ts";

// An ordinary detached child is still in its parent's systemd control group.
// A separate, on-demand native job survives stopping the companion service.
export async function launchUpdater(options: {
  directory: string;
  id: string;
  worker: string;
  request: string;
  platform?: string;
  uid?: number;
  execute?: (file: string, args: string[]) => Promise<unknown>;
}) {
  const platform = options.platform ?? process.platform;
  const exec = promisify(execFile);
  const run =
    options.execute ??
    ((file, args) => exec(file, args, { windowsHide: true, timeout: 20000 }));
  const name = `${options.id}-update`;
  if (platform === "linux") {
    await run("systemd-run", [
      "--user",
      `--unit=${name}-${path.basename(options.request, ".json")}`,
      "--collect",
      "--property=UMask=0077",
      process.execPath,
      options.worker,
      options.request,
    ]);
  } else if (platform === "darwin") {
    const folder = path.join(options.directory, "updates");
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, `${name}.plist`);
    if (
      existsSync(file) &&
      !readFileSync(file, "utf8").includes(`<string>${name}</string>`)
    )
      throw new Error("The updater job belongs to another app.");
    const target = `gui/${options.uid ?? process.getuid?.() ?? 0}`;
    try {
      await run("launchctl", ["bootout", `${target}/${name}`]);
    } catch {
      /* Previous one-shot job may not be loaded. */
    }
    writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${name}</string><key>ProgramArguments</key><array>${[process.execPath, options.worker, options.request].map((s) => `<string>${xmlQuote(s)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/></dict></plist>`,
      { mode: 0o600 },
    );
    // Stored outside Library/LaunchAgents: never schedules an update at sign-in.
    await run("launchctl", ["bootstrap", target, file]);
  } else if (platform === "win32") {
    const args = [options.worker, options.request]
      .map((s) => `"${s}"`)
      .join(" ");
    const child = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(args)} -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
    const command = `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(child, "utf16le").toString("base64")}`;
    const script = `$ErrorActionPreference='Stop'; $t=Get-ScheduledTask -TaskName ${psQuote(name)} -ErrorAction SilentlyContinue; if($t -and ($t.Description -ne ${psQuote(name)} -or $t.State -eq 'Running')){throw 'An updater task already owns this name'}; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name; $a=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ${psQuote(command)}; $p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited; $s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew; Register-ScheduledTask -TaskName ${psQuote(name)} -Description ${psQuote(name)} -Action $a -Principal $p -Settings $s -Force | Out-Null; Start-ScheduledTask -TaskName ${psQuote(name)}`;
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ]);
  } else
    throw new Error(
      "Updates from Settings are not supported on this operating system. Use the installer.",
    );
}
