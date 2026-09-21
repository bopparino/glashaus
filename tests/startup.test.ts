import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  Startup,
  psQuote,
  xmlQuote,
  unitQuote,
} from "../app/server/startup.ts";
import { createApp } from "../app/server/http.ts";

function fixture(
  platform: string,
  options: { fail?: string; ready?: boolean; managed?: boolean } = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "glashaus-service-test-"));
  const directory = path.join(root, "Companion's Ω space");
  const entry = path.join(root, "background.js");
  writeFileSync(entry, "// fixture only");
  const calls: { file: string; args: string[]; script: string }[] = [];
  let enabled = false;
  let registered = false;
  const control = new Startup({
    directory,
    port: 7788,
    platform,
    userHome: root,
    configHome: path.join(root, "config"),
    uid: 501,
    entry,
    readyTimeout: 300,
    managed: options.managed ?? false,
    execute: async (file, args) => {
      const script =
        file === "powershell.exe"
          ? Buffer.from(args.at(-1)!, "base64").toString("utf16le")
          : args.join(" ");
      calls.push({ file, args, script });
      if (options.fail && script.includes(options.fail))
        throw new Error("Synthetic system failure");
      if (
        script.includes("Register-ScheduledTask") ||
        (/\benable\b/.test(script) && !script.includes("is-enabled"))
      ) {
        enabled = true;
        registered = true;
      }
      if (
        script.includes("Disable-ScheduledTask") ||
        /\bdisable\b/.test(script)
      )
        enabled = false;
      if (
        options.ready !== false &&
        (script.includes("Start-ScheduledTask") ||
          /\bstart\b|\bkickstart\b/.test(script))
      ) {
        const config = JSON.parse(readFileSync(control.configFile, "utf8"));
        writeFileSync(
          path.join(control.folder, "ready.json"),
          JSON.stringify({ nonce: config.nonce, pid: process.pid }),
        );
      }
      if (script.includes("$t=Get-ScheduledTask"))
        return registered ? (enabled ? "enabled" : "disabled") : "missing";
      if (script.includes("is-enabled"))
        return enabled ? "enabled" : "disabled";
      if (script.includes("print-disabled"))
        return `"${control.id}" => ${!enabled}`;
      if (args[0] === "print") throw new Error("Not bootstrapped yet");
      return "";
    },
  });
  return {
    control,
    calls,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("executable aliases do not look like a different installation", async () => {
  const f = fixture(process.platform);
  try {
    const alias = path.join(f.root, "alias");
    symlinkSync(
      f.root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await f.control.enable();
    const config = JSON.parse(readFileSync(f.control.configFile, "utf8"));
    config.entry = path.join(alias, "background.js");
    writeFileSync(f.control.configFile, JSON.stringify(config));
    assert.equal((await f.control.status()).available, true);
  } finally {
    f.cleanup();
  }
});

for (const platform of ["win32", "darwin", "linux"]) {
  test(`${platform}: opt-in startup registers, confirms a live launcher, and disables without stopping this session`, async () => {
    const f = fixture(platform);
    try {
      assert.equal((await f.control.status()).enabled, false);
      assert.equal(
        existsSync(f.control.configFile),
        false,
        "status must not write a registration",
      );
      await f.control.enable();
      assert.equal((await f.control.status()).enabled, true);
      const config = JSON.parse(readFileSync(f.control.configFile, "utf8"));
      assert.deepEqual(
        Object.keys(config).sort(),
        [
          "directory",
          "enabled",
          "entry",
          "node",
          "nonce",
          "owner",
          "port",
        ].sort(),
      );
      if (platform === "win32") {
        const register = f.calls.find((c) =>
          c.script.includes("Register-ScheduledTask"),
        )!.script;
        assert.match(register, /LogonType Interactive -RunLevel Limited/);
        assert.match(register, /ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
        assert.doesNotMatch(register, /-Password/);
      } else {
        const text = readFileSync(f.control.nativeFile, "utf8");
        assert.ok(
          text.includes(
            platform === "linux"
              ? "WantedBy=default.target"
              : "<key>RunAtLoad</key><true/>",
          ),
        );
        assert.ok(
          text.includes(
            platform === "linux"
              ? unitQuote(f.control.configFile)
              : xmlQuote(f.control.configFile),
          ),
        );
      }
      await f.control.disable();
      assert.equal((await f.control.status()).enabled, false);
      assert.equal(
        JSON.parse(readFileSync(f.control.configFile, "utf8")).enabled,
        false,
      );
      assert.equal(
        f.calls.some((c) =>
          /Stop-ScheduledTask|\bbootout\b|--user stop/.test(c.script),
        ),
        false,
      );
    } finally {
      f.cleanup();
    }
  });
}
test("service registration failure leaves manual mode usable and startup disabled", async () => {
  const f = fixture("linux", { fail: "--user start" });
  try {
    await assert.rejects(f.control.enable(), /current app is still running/);
    assert.equal(
      JSON.parse(readFileSync(f.control.configFile, "utf8")).enabled,
      false,
    );
    assert.ok(f.calls.some((c) => c.args.includes("disable")));
  } finally {
    f.cleanup();
  }
});
test("a successful OS start without a live readiness marker is not called success", async () => {
  const f = fixture("linux", { ready: false });
  try {
    await assert.rejects(f.control.enable(), /did not finish/);
  } finally {
    f.cleanup();
  }
});
test("foreign startup files are untouched, including during rollback", async () => {
  const f = fixture("linux");
  try {
    mkdirSync(path.dirname(f.control.nativeFile), { recursive: true });
    writeFileSync(f.control.nativeFile, "unrelated sentinel");
    await assert.rejects(f.control.enable(), /belongs to another app/);
    assert.equal(
      readFileSync(f.control.nativeFile, "utf8"),
      "unrelated sentinel",
    );
    assert.equal(existsSync(f.control.configFile), false);
    assert.equal(
      f.calls.some((c) => c.args.includes("disable")),
      false,
    );
  } finally {
    f.cleanup();
  }
});
test("Linux without a systemd user session stays in manual mode without writing files", async () => {
  const f = fixture("linux", { fail: "show-environment" });
  try {
    assert.equal((await f.control.status()).available, false);
    await assert.rejects(f.control.enable(), /systemd user session/);
    assert.equal(existsSync(f.control.configFile), false);
  } finally {
    f.cleanup();
  }
});
test("re-enabling a managed session does not launch a duplicate process", async () => {
  const f = fixture("linux", { managed: true, ready: false });
  try {
    await f.control.enable();
    assert.equal(
      f.calls.some((c) => c.args.includes("start")),
      false,
    );
  } finally {
    f.cleanup();
  }
});
test("native quoting preserves literal metacharacters", () => {
  assert.equal(psQuote("O'Brien $x; echo hi"), "'O''Brien $x; echo hi'");
  assert.equal(xmlQuote("<&\"'>"), "&lt;&amp;&quot;&apos;&gt;");
  assert.equal(
    unitQuote('/home/A B/%h/$HOME/"x"'),
    '"/home/A B/%%h/$$HOME/\\"x\\""',
  );
});
test("startup API is protected, validates input, and never claims preview changes", async () => {
  let enabled = false;
  let handoffs = 0;
  const app = createApp({
    directory: ":memory:",
    webRoot: ".",
    background: false,
    startup: {
      async status() {
        return {
          available: true,
          enabled,
          managed: false,
          platform: "Test",
          message: "",
        };
      },
      async enable() {
        enabled = true;
      },
      async disable() {
        enabled = false;
      },
    },
    handoff: () => {
      handoffs++;
    },
  });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const { csrfToken } = (await (await fetch(`${base}/api/state`)).json()) as {
      csrfToken: string;
    };
    const post = (data: unknown, token = csrfToken) =>
      fetch(`${base}/api/startup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-glashaus-token": token,
        },
        body: JSON.stringify(data),
      });
    assert.equal((await post({ enabled: true }, "")).status, 403);
    assert.equal((await post({ enabled: "yes" })).status, 400);
    assert.equal(enabled, false);
    app.service.busy = 1;
    assert.equal((await post({ enabled: true })).status, 409);
    app.service.busy = 0;
    const response = await post({ enabled: true });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      restarting: true,
      stopped: false,
    });
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(enabled, true);
    assert.equal(handoffs, 1);
    assert.equal((await post({ enabled: true })).status, 503);
  } finally {
    await app.close();
  }
});
