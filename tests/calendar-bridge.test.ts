import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCalendarApp } from "../app/server/calendar-bridge.ts";

const app = "/Applications/Synthetic Calendar.app";
test("Calendar launches as an app with private IPC, a deadline and cleanup", async () => {
  let directory = "";
  const result = await runCalendarApp(app, { command: "calendars" }, new AbortController().signal, async (args) => {
    assert.deepEqual(args.slice(0, 3), ["-n", "-W", "-g"]);
    assert.equal(args[9], app);
    const request = args[args.indexOf("--stdin") + 1], response = args[args.indexOf("--stdout") + 1];
    directory = path.dirname(request);
    if (process.platform !== "win32") {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(request)).mode & 0o777, 0o600);
      assert.equal((await stat(response)).mode & 0o777, 0o600);
    }
    const input = JSON.parse(await readFile(request, "utf8"));
    assert.equal(input.command, "calendars");
    assert.ok(input.deadline > Date.now() && input.deadline <= Date.now() + 20_000);
    await writeFile(response, JSON.stringify({ calendars: [{ id: "fixture" }] }));
  });
  assert.deepEqual(result, { calendars: [{ id: "fixture" }] });
  assert.equal(existsSync(directory), false);
});
test("Calendar preserves permission instructions and cleans up after cancellation", async () => {
  await assert.rejects(runCalendarApp(app, { command: "authorize" }, new AbortController().signal, async (args) => {
    await writeFile(args[args.indexOf("--stdout") + 1], JSON.stringify({ error: "Enable Glashaus Calendar on your Mac." }));
  }), /Enable Glashaus Calendar/);
  let request = "";
  const controller = new AbortController();
  await assert.rejects(runCalendarApp(app, { command: "write" }, controller.signal, async (args) => {
    request = args[args.indexOf("--stdin") + 1];
    controller.abort();
    throw new Error("Synthetic cancellation");
  }), /did not respond/);
  assert.equal(existsSync(request), false);
  let launched = false;
  await assert.rejects(runCalendarApp(app, { command: "write" }, controller.signal, async () => { launched = true; }));
  assert.equal(launched, false);
});
