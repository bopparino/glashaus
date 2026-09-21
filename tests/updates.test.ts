import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../app/server/store.ts";
import { Startup } from "../app/server/startup.ts";
import type { Registration } from "../app/server/startup.ts";
import {
  activate,
  backupDatabase,
  claimUpdate,
  restoreDatabase,
} from "../app/server/update-engine.ts";
import type { UpdateRuntime } from "../app/server/update-engine.ts";
import { readUpdate, updateCommitted } from "../app/server/update-state.ts";
import {
  compareVersions,
  latestRelease,
  stageRelease,
} from "../app/server/update-release.ts";
import { launchUpdater } from "../app/server/update-launch.ts";
import { createApp } from "../app/server/http.ts";
import { VERSION } from "../app/shared/version.ts";

function fixture(
  options: {
    enabled?: boolean;
    fail?: string;
    running?: boolean;
    oldVersion?: string;
  } = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "glashaus-update-test-"));
  const directory = path.join(root, "Companion's Ω space");
  const app = (name: string, version: string) => {
    const folder = path.join(root, name);
    mkdirSync(path.join(folder, "dist", "server"), { recursive: true });
    writeFileSync(
      path.join(folder, "dist", "server", "background.js"),
      "// synthetic app",
    );
    writeFileSync(
      path.join(folder, "package.json"),
      JSON.stringify({ name: "glashaus", version }),
    );
    return folder;
  };
  const old = app("old app", options.oldVersion ?? "3.0.0-alpha.5");
  const candidate = app("new app", VERSION);
  const store = new Store(directory);
  store.saveSettings({
    ...store.settings(),
    model: "synthetic-model",
    telegramToken: "synthetic-private-token",
    telegramOwnerId: "synthetic-owner",
  });
  store.setMeta("test-marker", "keep-me");
  store.close();
  const control = new Startup({
    directory,
    port: 7791,
    entry: path.join(old, "dist", "server", "background.js"),
    managed: false,
  });
  mkdirSync(control.folder, { recursive: true });
  const previous: Registration = {
    owner: control.id,
    directory,
    port: 7791,
    enabled: options.enabled ?? true,
    entry: control.entry,
    node: process.execPath,
    nonce: "old-fixture",
  };
  writeFileSync(control.configFile, JSON.stringify(previous));
  let running = options.running ?? true;
  const calls: string[] = [];
  const rt: UpdateRuntime = {
    control(config, updateId) {
      const isCandidate = config.entry.includes("new app");
      return {
        async enable() {
          calls.push(isCandidate ? "start-new" : "start-old");
          writeFileSync(
            control.configFile,
            JSON.stringify({ ...config, enabled: true, updateId }),
          );
          if (options.fail === "start" && isCandidate)
            throw new Error("Synthetic launch failure");
          running = true;
        },
        async disable() {
          calls.push("disable");
          const current = JSON.parse(readFileSync(control.configFile, "utf8"));
          writeFileSync(
            control.configFile,
            JSON.stringify({ ...current, enabled: false }),
          );
        },
        async stopNative() {
          calls.push("native-stop");
          running = false;
        },
      } as Startup;
    },
    async occupied() {
      return running;
    },
    async stop() {
      calls.push("stop");
      if (options.fail === "busy") throw new Error("Conversation is busy");
      running = false;
    },
    async waitClosed() {
      assert.equal(running, false);
    },
    async quiescent() {
      if (options.fail === "quiescent")
        throw new Error("Process still owns database");
    },
    async healthy(config, version, id) {
      calls.push(id ? "check-new" : "check-old");
      if (id && options.fail === "health") {
        const db = new DatabaseSync(path.join(directory, "glashaus-v3.sqlite"));
        db.prepare(
          "UPDATE meta SET value='candidate-change' WHERE key='test-marker'",
        ).run();
        db.close();
        throw new Error("Synthetic health failure");
      }
      assert.equal(
        version,
        id ? VERSION : (options.oldVersion ?? "3.0.0-alpha.5"),
      );
    },
    async backup(home, id) {
      calls.push("backup");
      if (options.fail === "backup")
        throw new Error("Synthetic backup failure");
      return backupDatabase(home, id);
    },
    restore(home, record) {
      calls.push("restore");
      restoreDatabase(home, record);
    },
  };
  return {
    root,
    directory,
    candidate,
    control,
    previous,
    rt,
    calls,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}
test("release selection sorts numeric prereleases and ignores v2, drafts, missing assets and older releases", async () => {
  assert.ok(compareVersions("3.0.0-alpha.10", "3.0.0-alpha.9") > 0);
  assert.ok(compareVersions("3.0.0", "3.0.0-rc.9") > 0);
  const assets = [
    { name: "glashaus-v3.zip" },
    { name: "glashaus-v3.zip.sha256" },
  ];
  const request = async () =>
    Response.json([
      { tag_name: "v3.0.0-alpha.8", assets },
      { tag_name: "v3.0.0-alpha.10", assets },
      { tag_name: "v2.9.9", assets },
      { tag_name: "v3.0.0-alpha.20", assets, draft: true },
      { tag_name: "v3.0.0-alpha.30", assets: [] },
    ]);
  assert.equal(
    (await latestRelease(VERSION, request as typeof fetch))?.version,
    "3.0.0-alpha.10",
  );
  assert.equal(await latestRelease("3.0.0", request as typeof fetch), null);
  await assert.rejects(
    latestRelease(
      VERSION,
      (async () => new Response("", { status: 403 })) as typeof fetch,
    ),
    /not changed/,
  );
});
test("bad downloads and mismatched checksums cannot stage or execute a release", async () => {
  const release = {
    version: VERSION,
    tag: `v${VERSION}`,
    url: "https://example.invalid/not-used",
  };
  await assert.rejects(
    stageRelease(
      release,
      (async () => new Response("", { status: 502 })) as typeof fetch,
    ),
    /running app has not changed/i,
  );
  await assert.rejects(
    stageRelease(
      release,
      (async (url) =>
        new Response(
          String(url).endsWith("sha256") ? "0".repeat(64) : "not a release",
        )) as typeof fetch,
    ),
    /checksum did not match/,
  );
});

for (const enabled of [true, false])
  test(`update preserves data and sign-in preference (${enabled}) and commits only after health`, async () => {
    const f = fixture({ enabled });
    try {
      const record = claimUpdate(f.directory, VERSION);
      assert.equal(
        await activate(f.directory, 7791, f.candidate, record, f.rt),
        false,
      );
      assert.equal(readUpdate(f.directory)?.phase, "complete");
      assert.equal(updateCommitted(f.directory, record.id), true);
      assert.ok(f.calls.indexOf("stop") < f.calls.indexOf("backup"));
      assert.ok(f.calls.indexOf("backup") < f.calls.indexOf("start-new"));
      assert.ok(existsSync(record.backup!));
      const cfg = JSON.parse(readFileSync(f.control.configFile, "utf8"));
      assert.equal(cfg.enabled, enabled);
      const db = new DatabaseSync(record.backup!, { readOnly: true });
      assert.equal(
        db.prepare("SELECT value FROM meta WHERE key='test-marker'").get()
          ?.value,
        "keep-me",
      );
      db.close();
      assert.ok(existsSync(f.previous.entry));
    } finally {
      f.clean();
    }
  });
for (const fail of ["start", "health", "backup"])
  test(`${fail} failure brings back the old app and leaves a usable recovery record`, async () => {
    const f = fixture({ fail });
    try {
      const record = claimUpdate(f.directory, VERSION);
      await assert.rejects(
        activate(f.directory, 7791, f.candidate, record, f.rt),
        /previous version is running again/,
      );
      assert.equal(readUpdate(f.directory)?.phase, "failed");
      assert.equal(updateCommitted(f.directory, record.id), false);
      assert.ok(f.calls.includes("start-old"));
      const db = new DatabaseSync(
        path.join(f.directory, "glashaus-v3.sqlite"),
        { readOnly: true },
      );
      assert.equal(
        db.prepare("SELECT value FROM meta WHERE key='test-marker'").get()
          ?.value,
        "keep-me",
      );
      db.close();
      assert.equal(
        JSON.parse(readFileSync(f.control.configFile, "utf8")).entry,
        f.previous.entry,
      );
    } finally {
      f.clean();
    }
  });
test("busy refusal never disables startup or opens a backup", async () => {
  const f = fixture({ fail: "busy" });
  try {
    await assert.rejects(
      activate(
        f.directory,
        7791,
        f.candidate,
        claimUpdate(f.directory, VERSION),
        f.rt,
      ),
      /busy/,
    );
    assert.deepEqual(f.calls, ["stop"]);
    assert.equal(
      JSON.parse(readFileSync(f.control.configFile, "utf8")).enabled,
      true,
    );
  } finally {
    f.clean();
  }
});
test("cannot replace database until the old process is fully gone", async () => {
  const f = fixture({ fail: "quiescent" });
  try {
    await assert.rejects(
      activate(
        f.directory,
        7791,
        f.candidate,
        claimUpdate(f.directory, VERSION),
        f.rt,
      ),
      /recovery could not finish/,
    );
    assert.equal(readUpdate(f.directory)?.phase, "recovery-needed");
    assert.equal(f.calls.includes("backup"), false);
    assert.equal(f.calls.includes("restore"), false);
    assert.throws(() => claimUpdate(f.directory, VERSION), /recovery/);
  } finally {
    f.clean();
  }
});
test("one companion home allows only one update; mismatched ports and downgrades are refused", async () => {
  const f = fixture();
  try {
    const record = claimUpdate(f.directory, VERSION);
    assert.throws(() => claimUpdate(f.directory, VERSION), /in progress/);
    await assert.rejects(
      activate(f.directory, 7777, f.candidate, record, f.rt),
      /port 7791/,
    );
    assert.deepEqual(f.calls, []);
  } finally {
    f.clean();
  }
  const newer = fixture({ oldVersion: "3.0.0-alpha.99" });
  try {
    await assert.rejects(
      activate(
        newer.directory,
        7791,
        newer.candidate,
        claimUpdate(newer.directory, VERSION),
        newer.rt,
      ),
      /downgrades/,
    );
    assert.deepEqual(newer.calls, []);
  } finally {
    newer.clean();
  }
});
test("same-version rerun is a no-op for a running app and starts a stopped app", async () => {
  for (const running of [true, false]) {
    const f = fixture({ oldVersion: VERSION, running });
    try {
      await activate(
        f.directory,
        7791,
        f.candidate,
        claimUpdate(f.directory, VERSION),
        f.rt,
      );
      assert.equal(f.calls.includes("start-old"), !running);
      assert.equal(f.calls.includes("backup"), false);
      assert.equal(f.calls.includes("stop"), false);
    } finally {
      f.clean();
    }
  }
});
for (const platform of ["linux", "darwin", "win32"])
  test(`${platform}: update worker is a separate on-demand native job, not a detached service child`, async () => {
    const f = fixture();
    try {
      const calls: { file: string; text: string }[] = [];
      await launchUpdater({
        directory: f.directory,
        id: f.control.id,
        worker: "C:/app's space/worker.js",
        request: "C:/app's space/request.json",
        platform,
        uid: 501,
        execute: async (file, args) => {
          calls.push({
            file,
            text:
              file === "powershell.exe"
                ? Buffer.from(args.at(-1)!, "base64").toString("utf16le")
                : args.join(" "),
          });
        },
      });
      if (platform === "linux") {
        assert.equal(calls[0].file, "systemd-run");
        assert.match(calls[0].text, /--user.*--collect/);
      }
      if (platform === "darwin") {
        const plist = readFileSync(
          path.join(f.directory, "updates", `${f.control.id}-update.plist`),
          "utf8",
        );
        assert.match(plist, /KeepAlive<\/key><false\/>/);
        assert.match(plist, /app&apos;s/);
      }
      if (platform === "win32") {
        assert.match(calls[0].text, /Register-ScheduledTask/);
        assert.doesNotMatch(calls[0].text, /New-ScheduledTaskTrigger/);
        assert.match(calls[0].text, /LogonType Interactive -RunLevel Limited/);
      }
    } finally {
      f.clean();
    }
  });
test("HTTP update confirmation requires CSRF; activation blocks mutations until commit", async () => {
  const f = fixture();
  let ready = false,
    starts = 0;
  const status = {
    current: VERSION,
    latest: null,
    checkedAt: null,
    available: true,
    message: "",
    operation: null,
  };
  const app = createApp({
    directory: f.directory,
    webRoot: f.root,
    background: false,
    activation: { id: "test-activation", ready: () => ready },
    updates: {
      async status() {
        return status;
      },
      async check() {
        return status;
      },
      async start() {
        starts++;
        return status;
      },
    },
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    const state = await (await fetch(`${base}/state`)).json();
    const post = (body: unknown, token = state.csrfToken) =>
      fetch(`${base}/updates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-glashaus-token": token,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post({ confirmed: true, version: VERSION }, "foreign")).status,
      403,
    );
    assert.equal(
      (await post({ confirmed: true, version: VERSION })).status,
      503,
    );
    ready = true;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal((await post({ version: VERSION })).status, 400);
    assert.equal(
      (await post({ confirmed: true, version: VERSION })).status,
      202,
    );
    assert.equal(starts, 1);
  } finally {
    await app.close();
    f.clean();
  }
});
