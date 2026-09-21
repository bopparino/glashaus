// Disposable CI machines only. Never register a service on a developer's PC.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { promisify } from "node:util";
import { Startup } from "../app/server/startup.ts";

if (
  process.env.CI !== "true" ||
  process.env.GLASHAUS_TEST_NATIVE_SERVICE !== "1"
)
  throw new Error(
    "Native service tests require an explicitly opted-in disposable CI runner.",
  );
const root = mkdtempSync(path.join(os.tmpdir(), "glashaus service 'Ω-"));
const socket = net.createServer();
await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
const address = socket.address();
assert.ok(address && typeof address === "object");
const port = address.port;
await new Promise<void>((r) => socket.close(() => r()));
const startup = new Startup({
  directory: root,
  port,
  entry: path.resolve("dist/server/background.js"),
});
const base = `http://127.0.0.1:${port}`;
const exec = promisify(execFile);
const foreground = spawn(process.execPath, ["bin/glashaus-v3.js"], {
  env: { ...process.env, GLASHAUS_HOME: root, GLASHAUS_PORT: String(port) },
  stdio: "ignore",
  windowsHide: true,
});
const exited = new Promise((r) => foreground.once("exit", r));
async function poll<T>(task: () => Promise<T>, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    try {
      return await task();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
async function state() {
  return (await (
    await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(1500) })
  ).json()) as { csrfToken: string; companion: { name: string } | null };
}
async function post(route: string, data: unknown) {
  const current = await state();
  const r = await fetch(`${base}/api${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-glashaus-token": current.csrfToken,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(60000),
  });
  const value = await r.json();
  assert.equal(r.status, 200, JSON.stringify(value));
  return value;
}
try {
  const initial = await poll(state);
  await post("/companion", {
    name: "Service fixture",
    mode: "grow",
    userName: "CI visitor",
    relationship: "Synthetic test",
  });
  const switchResult = await post("/startup", { enabled: true });
  assert.equal(switchResult.restarting, true);
  await poll(async () => {
    const status = (await (
      await fetch(`${base}/api/startup`, { signal: AbortSignal.timeout(1500) })
    ).json()) as { managed: boolean; enabled: boolean };
    assert.equal(status.managed, true);
    assert.equal(status.enabled, true);
    const next = await state();
    assert.notEqual(next.csrfToken, initial.csrfToken);
    assert.equal(next.companion?.name, "Service fixture");
  });
  await exited;
  // A second launch must fail before it opens the database.
  await assert.rejects(
    exec(process.execPath, ["bin/glashaus-v3.js"], {
      env: { ...process.env, GLASHAUS_HOME: root, GLASHAUS_PORT: String(port) },
      windowsHide: true,
      timeout: 10000,
    }),
  );
  await post("/startup", { enabled: false });
  assert.equal((await startup.status()).enabled, false);
  assert.equal(
    (await state()).companion?.name,
    "Service fixture",
    "disable must preserve the running app",
  );
  await post("/startup/stop", {});
  await poll(async () => {
    let online = false;
    try {
      online = (
        await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(500) })
      ).ok;
    } catch {
      /* closed */
    }
    assert.equal(online, false);
  });
  // Start again from the native registration, then verify persistence and stop.
  await startup.enable();
  await poll(async () =>
    assert.equal((await state()).companion?.name, "Service fixture"),
  );
  await startup.disable();
  await post("/startup/stop", {});
  console.log(
    `${process.platform}: real service enable, foreground handoff, duplicate prevention, disable, stop, and restart passed.`,
  );
} catch (error) {
  const log = path.join(startup.folder, "background.log");
  if (existsSync(log)) console.error(readFileSync(log, "utf8")); // Synthetic test home only.
  throw error;
} finally {
  foreground.kill();
  await exited;
  await startup.disable().catch(() => {});
  if (process.platform === "win32") {
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$t=Get-ScheduledTask -TaskName '${startup.id}' -ErrorAction SilentlyContinue; if($t -and $t.Description -eq '${startup.id}'){Stop-ScheduledTask -TaskName '${startup.id}'; Unregister-ScheduledTask -TaskName '${startup.id}' -Confirm:$false}`,
      ],
      { windowsHide: true },
    );
  } else if (process.platform === "linux") {
    await exec("systemctl", ["--user", "stop", `${startup.id}.service`]).catch(
      () => {},
    );
    if (
      existsSync(startup.nativeFile) &&
      readFileSync(startup.nativeFile, "utf8").includes(startup.id)
    )
      rmSync(startup.nativeFile);
    await exec("systemctl", ["--user", "daemon-reload"]);
  } else {
    await exec("launchctl", [
      "bootout",
      `gui/${process.getuid!()}/${startup.id}`,
    ]).catch(() => {});
    if (
      existsSync(startup.nativeFile) &&
      readFileSync(startup.nativeFile, "utf8").includes(startup.id)
    )
      rmSync(startup.nativeFile);
  }
  // Only this test's mkdtemp directory; no real companion home is opened.
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  rmSync(root, { recursive: true, force: true });
}
