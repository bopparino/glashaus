// Disposable CI machines only. Never register a service on a developer's PC.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  rmSync,
  readFileSync,
  readdirSync,
  cpSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { promisify } from "node:util";
import { Startup } from "../app/server/startup.ts";
import { pathToFileURL } from "node:url";
import { VERSION } from "../app/shared/version.ts";
import { alive } from "../app/server/update-engine.ts";
import { readUpdate } from "../app/server/update-state.ts";
import { stageRelease } from "../app/server/update-release.ts";

if (
  process.env.CI !== "true" ||
  process.env.GLASHAUS_TEST_NATIVE_SERVICE !== "1"
)
  throw new Error(
    "Native service tests require an explicitly opted-in disposable CI runner.",
  );
const root = mkdtempSync(path.join(os.tmpdir(), "glashaus service 'Ω-"));
const appRoot = mkdtempSync(path.join(os.tmpdir(), "glashaus update apps 'Ω-"));
function copyApp(name: string, version: string) {
  const folder = path.join(appRoot, name);
  mkdirSync(folder);
  cpSync(path.resolve("dist"), path.join(folder, "dist"), { recursive: true });
  cpSync(path.resolve("bin"), path.join(folder, "bin"), { recursive: true });
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  writeFileSync(
    path.join(folder, "package.json"),
    JSON.stringify({ ...pkg, version }),
  );
  writeFileSync(
    path.join(folder, "dist/shared/version.js"),
    `export const VERSION = ${JSON.stringify(version)};`,
  );
  return folder;
}
const oldApp = copyApp("old", VERSION);
const newApp = copyApp("new", "3.0.1-alpha.0");
const badApp = copyApp("bad", "3.0.2-alpha.0");
const legacyApp = await stageRelease(
  {
    version: "3.0.0-alpha.5",
    tag: "v3.0.0-alpha.5",
    url: "https://github.com/bopparino/glashaus/releases/tag/v3.0.0-alpha.5",
  },
  fetch,
  appRoot,
);
writeFileSync(
  path.join(badApp, "dist/server/main.js"),
  "throw new Error('Synthetic candidate startup failure');",
);
// Only disposable app copies use this offline release source. The production
// HTTP control, independent OS job, worker, database backup and handoff are real.
for (const [app, candidate, version] of [
  [oldApp, newApp, "3.0.1-alpha.0"],
  [newApp, badApp, "3.0.2-alpha.0"],
]) {
  writeFileSync(
    path.join(app, "dist/server/update-release.js"),
    `export {compareVersions} from ${JSON.stringify(pathToFileURL(path.resolve("dist/server/update-release.js")).href)}; export async function latestRelease(){return ${JSON.stringify({ version, tag: `v${version}`, url: `https://github.com/bopparino/glashaus/releases/tag/v${version}` })}} export async function stageRelease(){return ${JSON.stringify(candidate)}}`,
  );
}
const socket = net.createServer();
await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
const address = socket.address();
assert.ok(address && typeof address === "object");
const port = address.port;
await new Promise<void>((r) => socket.close(() => r()));
const startup = new Startup({
  directory: root,
  port,
  entry: path.join(legacyApp, "dist/server/background.js"),
});
const base = `http://127.0.0.1:${port}`;
const exec = promisify(execFile);
const foreground = spawn(
  process.execPath,
  [path.join(legacyApp, "bin/glashaus-v3.js")],
  {
    env: { ...process.env, GLASHAUS_HOME: root, GLASHAUS_PORT: String(port) },
    stdio: "ignore",
    windowsHide: true,
  },
);
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
async function post(route: string, data: unknown, expected = 200) {
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
  assert.equal(r.status, expected, JSON.stringify(value));
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
  await post("/settings", {
    model: "synthetic-model",
    ollamaApiKey: "synthetic-private-key",
    telegramOwnerId: "synthetic-pairing",
  });
  // The exact published alpha.5 app has no updater. The new installer must
  // still find it, stop it, back it up, and transfer its registration.
  await exec(
    process.execPath,
    [path.join(oldApp, "bin/glashaus-v3.js"), "install"],
    {
      env: { ...process.env, GLASHAUS_HOME: root, GLASHAUS_PORT: String(port) },
      windowsHide: true,
      timeout: 120000,
    },
  );
  await poll(async () => {
    const result = await (await fetch(`${base}/api/updates`)).json();
    assert.equal(result.current, VERSION);
    assert.equal(result.operation.phase, "complete");
    assert.equal(startup.registration()?.updateId, undefined);
    assert.equal((await state()).companion?.name, "Service fixture");
  });
  await post("/updates/check", {});
  await post("/updates", { confirmed: true, version: "3.0.1-alpha.0" }, 202);
  await poll(async () => {
    const update = await (await fetch(`${base}/api/updates`)).json();
    assert.equal(update.operation?.phase, "complete", JSON.stringify(update));
    assert.equal(update.current, "3.0.1-alpha.0");
    assert.equal((await state()).companion?.name, "Service fixture");
    assert.ok(existsSync(update.operation.backup));
    assert.equal(startup.registration()?.updateId, undefined);
    assert.equal(
      alive(readUpdate(root)!.pid),
      false,
      "The independent updater must exit after committing",
    );
  }, 120000);
  if (process.platform === "win32")
    await poll(async () => {
      const task = await exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-ScheduledTask -TaskName '${startup.id}-update').State`,
        ],
        { windowsHide: true },
      );
      assert.doesNotMatch(task.stdout, /Running/);
    });
  // A bad subsequent release must restore this new app and its exact data.
  await post("/startup", { enabled: false });
  await post("/updates/check", {});
  await post("/updates", { confirmed: true, version: "3.0.2-alpha.0" }, 202);
  await poll(async () => {
    const update = await (await fetch(`${base}/api/updates`)).json();
    assert.equal(update.operation?.phase, "failed", JSON.stringify(update));
    assert.equal(update.current, "3.0.1-alpha.0");
    assert.match(update.operation.message, /previous version is running again/);
    assert.equal((await state()).companion?.name, "Service fixture");
    assert.equal((await startup.status()).enabled, false);
  }, 180000);
  await poll(async () => {
    assert.equal(alive(readUpdate(root)!.pid), false);
    assert.equal(existsSync(path.join(root, "updates", "lock.json")), false);
  });
  const beforeDelete = await state();
  await post("/data/reset", {
    mode: "companion",
    companionId: beforeDelete.companion.id,
    confirmation: "DELETE Service fixture",
    confirmed: true,
  });
  assert.equal((await state()).companion, null);
  assert.equal((await state()).settings.model, "synthetic-model");
  assert.ok(existsSync(readUpdate(root)!.backup!));
  await post("/companion", {
    name: "Replacement fixture",
    mode: "grow",
    userName: "Test visitor",
    relationship: "Synthetic service lifecycle test.",
  });
  const replacement = await state();
  await post("/data/reset", {
    mode: "purge",
    companionId: replacement.companion.id,
    confirmation: "PURGE ALL",
    confirmed: true,
  });
  const purged = await state();
  assert.equal(purged.companion, null);
  assert.equal(purged.settings.model, "");
  assert.equal(purged.settings.hasSearchKey, false);
  assert.equal(purged.settings.telegramOwnerId, "");
  assert.equal((await startup.status()).enabled, false);
  assert.deepEqual(readdirSync(path.join(root, "backups")), []);
  await post("/startup", { enabled: false });
  await post("/startup/stop", {});
  console.log(
    `${process.platform}: real service handoff, restart, Settings update, worker survival, rollback, companion deletion, replacement and purge passed.`,
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
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$t=Get-ScheduledTask -TaskName '${startup.id}-update' -ErrorAction SilentlyContinue; if($t -and $t.Description -eq '${startup.id}-update'){Stop-ScheduledTask -TaskName '${startup.id}-update'; Unregister-ScheduledTask -TaskName '${startup.id}-update' -Confirm:$false}`,
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
      `gui/${process.getuid!()}/${startup.id}-update`,
    ]).catch(() => {});
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
  assert.ok(
    path.resolve(appRoot).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  rmSync(appRoot, { recursive: true, force: true });
}
