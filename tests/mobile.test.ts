import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { Store } from "../app/server/store.ts";
import { MobileDevices } from "../app/server/mobile.ts";
import { createApp } from "../app/server/http.ts";
import { companionInput } from "../app/server/validation.ts";

const identity = () =>
  companionInput({
    name: "Elle",
    userName: "Test visitor",
    mode: "authored",
    relationship: "Friends. Synthetic testing context.",
  });
function fixture() {
  const store = new Store(":memory:");
  store.saveCompanion(identity());
  let now = Date.now();
  const devices = new MobileDevices(store, () => now);
  return {
    store,
    devices,
    advance: () => {
      now += 300_001;
    },
  };
}
test("pairing codes expire, are single use, and a new code invalidates the old one", () => {
  const f = fixture();
  try {
    const old = f.devices.createCode();
    const current = f.devices.createCode();
    assert.throws(
      () => f.devices.pair({ name: "Phone", code: old.code }),
      /incorrect/,
    );
    const paired = f.devices.pair({
      name: "Phone",
      code: current.code.toLowerCase().replace("-", " "),
    });
    assert.equal(f.devices.authenticate(`Bearer ${paired.token}`), paired.id);
    assert.throws(
      () => f.devices.pair({ name: "Phone", code: current.code }),
      /new pairing/,
    );
    const expired = f.devices.createCode();
    f.advance();
    assert.throws(
      () => f.devices.pair({ name: "Phone", code: expired.code }),
      /new pairing/,
    );
    const stored = f.store.db.prepare("SELECT * FROM mobile_devices").all();
    assert.ok(!JSON.stringify(stored).includes(paired.token));
    assert.ok(!JSON.stringify(f.store.archive()).includes(paired.token));
    assert.ok(
      !JSON.stringify(f.store.archive()).includes(
        stored[0].tokenHash as string,
      ),
    );
  } finally {
    f.store.close();
  }
});
test("five wrong attempts invalidate a code; restart and companion replacement invalidate pending enrollment", () => {
  const f = fixture();
  try {
    const code = f.devices.createCode();
    for (let i = 0; i < 5; i++)
      assert.throws(
        () => f.devices.pair({ name: "Phone", code: "WRONG" }),
        /incorrect/,
      );
    assert.throws(
      () => f.devices.pair({ name: "Phone", code: code.code }),
      /new pairing/,
    );
    const beforeRestart = f.devices.createCode();
    assert.throws(
      () =>
        new MobileDevices(f.store).pair({
          name: "Phone",
          code: beforeRestart.code,
        }),
      /new pairing/,
    );
    f.store.resetData(false);
    f.store.saveCompanion(identity());
    assert.throws(
      () => f.devices.pair({ name: "Phone", code: beforeRestart.code }),
      /new pairing/,
    );
  } finally {
    f.store.close();
  }
});
test("device revocation cancels active work; purge invalidates saved device credentials", () => {
  const f = fixture();
  try {
    const paired = f.devices.pair({
      name: "Phone",
      code: f.devices.createCode().code,
    });
    const controller = new AbortController();
    const unwatch = f.devices.watch(paired.id, controller);
    f.devices.revoke(paired.id);
    assert.ok(controller.signal.aborted);
    assert.throws(
      () => f.devices.authenticate(`Bearer ${paired.token}`),
      /Pair this phone/,
    );
    unwatch();
    const other = f.devices.pair({
      name: "Other phone",
      code: f.devices.createCode().code,
    });
    f.store.resetData(true);
    assert.throws(
      () => f.devices.authenticate(`Bearer ${other.token}`),
      /Pair this phone/,
    );
  } finally {
    f.store.close();
  }
});
test("mobile API isolates administration, hides keys, and shares identity/settings/history with the host", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-mobile-"));
  let calls = 0;
  const app = createApp({
    directory,
    webRoot: directory,
    background: false,
    provider: {
      models: async () => [{ name: "synthetic-model", size: 1 }],
      research: async () => [],
      chat: async (options) => {
        calls++;
        const reply = "I saved you a seat. Tell me about your day.";
        options.onToken?.(reply);
        return reply;
      },
    },
  });
  app.store.saveCompanion(identity());
  app.store.saveSettings({
    ...app.store.settings(),
    model: "synthetic-model",
    ollamaApiKey: "private-search-key",
    telegramToken: "private-telegram-key",
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  await new Promise<void>((resolve) =>
    app.mobile.server.listen(0, "127.0.0.1", resolve),
  );
  const host = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const base = `http://127.0.0.1:${(app.mobile.server.address() as AddressInfo).port}`;
  const post = (url: string, body: unknown, headers = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    const state = await (await fetch(`${host}/api/state`)).json();
    assert.equal((await post(`${host}/api/mobile/code`, {})).status, 403);
    const code = await (
      await post(
        `${host}/api/mobile/code`,
        {},
        { "x-glashaus-token": state.csrfToken },
      )
    ).json();
    const pair = await (
      await post(`${base}/mobile/pair`, {
        name: "Test iPhone",
        code: code.code,
      })
    ).json();
    assert.ok(pair.token);
    const headers = { Authorization: `Bearer ${pair.token}` };
    assert.equal((await fetch(`${base}/mobile/state`)).status, 401);
    assert.equal((await fetch(`${base}/api/state`, { headers })).status, 404);
    assert.equal(
      (await post(`${base}/api/data/reset`, {}, headers)).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${base}/mobile/state`, {
          headers: { ...headers, Origin: "https://unrelated.example" },
        })
      ).status,
      403,
    );
    const snapshot = await (
      await fetch(`${base}/mobile/state`, { headers })
    ).text();
    assert.ok(snapshot.includes('"name":"Elle"'));
    assert.ok(
      !snapshot.includes("private-search-key") &&
        !snapshot.includes("private-telegram-key") &&
        !snapshot.includes("csrfToken"),
    );
    assert.equal(
      (
        await post(
          `${base}/mobile/settings`,
          { ollamaApiKey: "replacement" },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (await post(`${base}/mobile/settings`, { contextSize: 16384 }, headers))
        .status,
      200,
    );
    assert.equal(app.store.settings().contextSize, 16384);
    const first = await (
      await post(
        `${base}/mobile/chat`,
        { id: "message-1", text: "Hello" },
        headers,
      )
    ).text();
    assert.ok(first.includes('"type":"done"'));
    assert.equal(app.store.turns().length, 1);
    await (
      await post(
        `${base}/mobile/chat`,
        { id: "message-1", text: "Hello" },
        headers,
      )
    ).text();
    assert.equal(calls, 1);
    assert.equal(app.store.turns().length, 1);
    assert.equal(
      (
        await post(
          `${base}/mobile/identity`,
          { ...app.store.companion(), revision: 0 },
          headers,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await post(
          `${base}/mobile/identity`,
          { ...app.store.companion(), voice: "Warm and direct." },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(app.store.companion()?.voice, "Warm and direct.");
    const memory = await (
      await post(
        `${base}/mobile/memories`,
        { text: "I enjoy rainy mornings.", subject: "user" },
        headers,
      )
    ).json();
    assert.ok(memory.id);
    assert.equal(
      (
        await post(
          `${base}/mobile/memories`,
          { text: "I enjoy rainy mornings.", subject: "user" },
          headers,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await fetch(`${base}/mobile/memories/${memory.id}`, {
          method: "DELETE",
          headers,
        })
      ).status,
      200,
    );
    assert.equal(app.store.memories().length, 0);
    const revoked = app.mobile.devices.pair({
      name: "Revocation race",
      code: app.mobile.devices.createCode().code,
    });
    let delayed!: http.ClientRequest;
    const delayedStatus = new Promise<number>((resolve, reject) => {
      delayed = http.request(
        `${base}/mobile/settings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${revoked.token}`,
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode!));
        },
      );
      delayed.on("error", reject);
      delayed.write('{"model":');
    });
    const deadline = Date.now() + 2000;
    while (!app.mobile.active && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 5));
    assert.ok(app.mobile.active);
    app.mobile.devices.revoke(revoked.id);
    delayed.end('"revoked-device-change"}');
    assert.equal(await delayedStatus, 409);
    assert.equal(app.store.settings().model, "synthetic-model");
    await post(`${base}/mobile/disconnect`, {}, headers);
    assert.equal(
      (await fetch(`${base}/mobile/state`, { headers })).status,
      401,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
