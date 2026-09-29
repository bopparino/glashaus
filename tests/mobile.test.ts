import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../app/server/store.ts";
import { MobileDevices, mobileIdentity } from "../app/server/mobile.ts";
import { createApp } from "../app/server/http.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ChatOptions, ModelProvider } from "../app/server/ollama.ts";

class Model implements ModelProvider {
  calls = 0;
  async models() {
    return [];
  }
  async research() {
    return [];
  }
  async chat(options: ChatOptions) {
    this.calls++;
    options.onToken?.("Hello from the shared conversation.");
    return "Hello from the shared conversation.";
  }
}
test("phone enrollment is one-use, expires, resets, and never stores a raw credential", () => {
  const store = new Store(":memory:");
  let now = Date.now();
  const devices = new MobileDevices(store, () => now);
  try {
    const first = devices.createEnrollment();
    const paired = devices.pair({ code: first.code, name: "Test phone" });
    assert.equal(devices.authenticate("Bearer " + paired.token), paired.id);
    assert.throws(
      () => devices.pair({ code: first.code, name: "Replay" }),
      /expired|already used/,
    );
    assert(
      !JSON.stringify(
        store.db.prepare("SELECT * FROM mobile_devices").all(),
      ).includes(paired.token),
    );
    assert(!JSON.stringify(store.archive()).includes(paired.token));
    assert(!JSON.stringify(devices.list()).includes("tokenHash"));
    const controller = new AbortController();
    devices.watch(paired.id, controller);
    devices.revoke(paired.id);
    assert(controller.signal.aborted);
    assert.throws(
      () => devices.authenticate("Bearer " + paired.token),
      /not paired/,
    );
    const expired = devices.createEnrollment();
    now += 300_001;
    assert.throws(
      () => devices.pair({ code: expired.code, name: "Expired" }),
      /expired/,
    );
    const beforeReset = devices.createEnrollment();
    store.resetData(false);
    assert.throws(
      () => devices.pair({ code: beforeReset.code, name: "After reset" }),
      /expired/,
    );
  } finally {
    store.close();
  }
});

test("phone credentials and certificate survive restart; deletion revokes access", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-mobile-"));
  let store = new Store(directory);
  try {
    const fingerprint = mobileIdentity(directory).fingerprint;
    let devices = new MobileDevices(store);
    const enrollment = devices.createEnrollment();
    const paired = devices.pair({ code: enrollment.code, name: "Test phone" });
    store.close();
    store = new Store(directory);
    devices = new MobileDevices(store);
    assert.equal(mobileIdentity(directory).fingerprint, fingerprint);
    assert.equal(devices.authenticate("Bearer " + paired.token), paired.id);
    store.resetData(false);
    assert.throws(
      () => devices.authenticate("Bearer " + paired.token),
      /not paired/,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("HTTPS phone API shares history, replay, reminders and corrections without exposing local admin or secrets", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-mobile-http-"));
  const model = new Model();
  const app = createApp({
    directory,
    webRoot: directory,
    provider: model,
    mobile: true,
    background: false,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  await app.mobile!.listen(0, "127.0.0.1");
  const base = app.mobile!.status().simulatorAddress;
  const request = (
    route: string,
    method = "GET",
    value?: unknown,
    token?: string,
    origin?: string,
  ) =>
    new Promise<{ status: number; data: any; raw: string }>(
      (resolve, reject) => {
        const req = https.request(
          base + route,
          {
            method,
            ca: mobileIdentity(directory).cert,
            checkServerIdentity: () => undefined,
            headers: {
              ...(token ? { Authorization: "Bearer " + token } : {}),
              ...(origin ? { Origin: origin } : {}),
              "Content-Type": "application/json",
            },
          },
          (res) => {
            let raw = "";
            res.setEncoding("utf8");
            res.on("data", (part) => (raw += part));
            res.on("end", () => {
              let data;
              try {
                data = JSON.parse(raw);
              } catch {
                data = raw;
              }
              resolve({ status: res.statusCode!, data, raw });
            });
          },
        );
        req.on("error", reject);
        req.end(value === undefined ? undefined : JSON.stringify(value));
      },
    );
  try {
    app.store.saveCompanion(
      companionInput({
        name: "Maeve",
        userName: "Test visitor",
        mode: "grow",
        relationship: "Synthetic test",
      }),
    );
    app.store.saveSettings({
      ...app.store.settings(),
      ollamaApiKey: "TEST-NEVER-EXPOSE",
      telegramToken: "TEST-PRIVATE",
    });
    assert.equal((await request("/v1/state")).status, 401);
    assert.equal(
      (await request("/v1/pair", "POST", { code: "wrong", name: "x" })).status,
      401,
    );
    const enrollment = app.mobile!.enroll(base);
    const code = new URL(enrollment.link).searchParams.get("code");
    const paired = await request("/v1/pair", "POST", {
      code,
      name: "iPhone test",
    });
    assert.equal(paired.status, 201);
    const token = paired.data.token;
    assert.equal(
      (await request("/v1/pair", "POST", { code, name: "duplicate" })).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/v1/state",
          "GET",
          undefined,
          token,
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/state", "GET", undefined, token)).status,
      404,
    );
    assert.equal(
      (await request("/v1/settings", "GET", undefined, token)).status,
      404,
    );
    const message = { id: "ios:replay", text: "Hello" };
    const chat = await request("/v1/chat", "POST", message, token);
    assert(chat.raw.includes('"type":"done"'));
    await request("/v1/chat", "POST", message, token);
    assert.equal(model.calls, 1);
    assert.equal(app.store.turns().length, 1);
    const state = await request("/v1/state", "GET", undefined, token);
    assert.equal(state.data.turns[0].id, message.id);
    assert(!state.raw.includes("TEST-"));
    assert(!state.raw.includes("csrfToken"));
    assert(!state.raw.includes("settings"));
    assert.equal(state.data.checkInPolicy.delivery, "in_app");
    assert.equal(state.data.companion.relationship, "Synthetic test");
    const preferences = await request(
      "/v1/check-ins/preferences",
      "PATCH",
      { enabled: true, quietEnd: 9, quietStart: 21, maxPerDay: 2 },
      token,
    );
    assert.equal(preferences.status, 200);
    assert.equal(preferences.data.maxPerDay, 2);
    assert.equal(
      (
        await request(
          "/v1/check-ins/preferences",
          "PATCH",
          { model: "leak" },
          token,
        )
      ).status,
      400,
    );
    assert.equal(app.store.settings().ollamaApiKey, "TEST-NEVER-EXPOSE");
    const draft = await request(
      "/v1/reminders",
      "POST",
      {
        title: "Dinner",
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
        timeZone: "America/New_York",
      },
      token,
    );
    assert.equal(draft.data.status, "draft");
    assert.equal(
      (
        await request(
          "/v1/reminders/" + draft.data.id,
          "PATCH",
          { revision: 1, action: "confirm" },
          token,
        )
      ).data.status,
      "scheduled",
    );
    assert.equal(
      (
        await request(
          "/v1/reminders/" + draft.data.id,
          "PATCH",
          { revision: 1, action: "cancel" },
          token,
        )
      ).status,
      409,
    );
    const memory = app.store.writeMemory({
      kind: "fact",
      subject: "user",
      text: "I like tea",
      evidence: "Test only",
      turnId: null,
    })!;
    assert.equal(
      (
        await request(
          "/v1/memories/" + memory.id,
          "PATCH",
          { text: "I prefer coffee" },
          token,
        )
      ).status,
      200,
    );
    assert(app.store.memories().some((m) => m.text === "I prefer coffee"));
    for (let i = 0; i < 205; i++) {
      app.store.startTurn("older-" + i, "history " + i, "web");
      app.store.finishTurn("older-" + i, "response", "complete");
    }
    const page = (await request("/v1/state", "GET", undefined, token)).data;
    const second = (
      await request(
        "/v1/history?before=" + page.olderCursor,
        "GET",
        undefined,
        token,
      )
    ).data;
    const third = (
      await request(
        "/v1/history?before=" + second.olderCursor,
        "GET",
        undefined,
        token,
      )
    ).data;
    const ids = [...page.turns, ...second.turns, ...third.turns].map(
      (t) => t.id,
    );
    assert.equal(ids.length, 206);
    assert.equal(new Set(ids).size, 206);
    assert.equal(third.olderCursor, null);
    app.mobile!.devices.revoke(paired.data.id);
    assert.equal(
      (await request("/v1/state", "GET", undefined, token)).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/v1/chat",
          "POST",
          { id: "new", text: "forbidden" },
          token,
        )
      ).status,
      401,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
