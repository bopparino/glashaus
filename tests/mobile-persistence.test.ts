import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../app/server/http.ts";
import { Store } from "../app/server/store.ts";
import { companionInput } from "../app/server/validation.ts";

test("recent history follows append order through clock rollback, retry, compaction and backup restore", () => {
  const store = new Store(":memory:");
  const restored = new Store(":memory:");
  try {
    store.saveCompanion(
      companionInput({
        name: "Test companion",
        userName: "Test visitor",
        mode: "authored",
        relationship: "Synthetic persistence test.",
      }),
    );
    for (let index = 0; index < 205; index++) {
      const id = `turn-${index}`;
      store.startTurn(
        id,
        `Test message ${index}`,
        index % 2 ? "web" : "telegram",
      );
      store.finishTurn(
        id,
        "Test reply",
        index === 100 ? "interrupted" : "complete",
      );
      store.db
        .prepare("UPDATE turns SET createdAt=? WHERE id=?")
        .run(new Date(Date.UTC(2099, 0, 1) - index * 60_000).toISOString(), id);
    }
    const expected = Array.from(
      { length: 200 },
      (_, index) => `turn-${index + 5}`,
    );
    assert.deepEqual(
      store.turns().map((turn) => turn.id),
      expected,
    );
    assert.deepEqual(
      store.turns(2).map((turn) => turn.id),
      ["turn-203", "turn-204"],
    );
    store.startTurn("turn-100", "Test message 100", "telegram");
    store.finishTurn("turn-100", "Retried reply", "complete");
    store.db.exec("VACUUM");
    assert.deepEqual(
      store.turns().map((turn) => turn.id),
      expected,
    );
    const archive = store.archive();
    restored.importArchive(archive);
    assert.deepEqual(restored.turns(), store.turns());
    assert.equal(
      restored.turns(1)[0].createdAt,
      archive.turns.at(-1)!.createdAt,
    );
  } finally {
    restored.close();
    store.close();
  }
});

test("phone exchanges keep their order across reload, retry and restart after a clock-skewed import", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "glashaus-mobile-persistence-"),
  );
  const original = new Store(":memory:");
  original.saveCompanion(
    companionInput({
      name: "Test companion",
      userName: "Test visitor",
      mode: "authored",
      relationship: "Synthetic persistence test.",
    }),
  );
  for (let index = 0; index < 4; index++) {
    original.startTurn(`imported-${index}`, `Imported message ${index}`, "web");
    original.finishTurn(
      `imported-${index}`,
      "I remember this test message.",
      "complete",
    );
    original.db
      .prepare("UPDATE turns SET createdAt=? WHERE id=?")
      .run(`2099-01-01T00:0${index}:00.000Z`, `imported-${index}`);
  }
  const archive = original.archive();
  original.close();
  let modelCalls = 0;
  const options = {
    directory,
    webRoot: directory,
    background: false,
    provider: {
      models: async () => [],
      research: async () => [],
      chat: async () => {
        modelCalls++;
        return "I saved this new test reply.";
      },
    },
  };
  let app = createApp(options);
  const listen = async () => {
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    await new Promise<void>((resolve) =>
      app.mobile.server.listen(0, "127.0.0.1", resolve),
    );
    return {
      desktop: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
      phone: `http://127.0.0.1:${(app.mobile.server.address() as AddressInfo).port}`,
    };
  };
  try {
    app.store.importArchive(archive);
    let endpoints = await listen();
    const pair = app.mobile.devices.pair({
      name: "Test phone",
      code: app.mobile.devices.createCode().code,
    });
    const headers = {
      Authorization: `Bearer ${pair.token}`,
      "Content-Type": "application/json",
    };
    const chat = async (index: number) => {
      const response = await fetch(`${endpoints.phone}/mobile/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: `new-${index}`,
          text: `New phone message ${index}`,
        }),
      });
      assert.equal(response.status, 200);
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(events.at(-1).type, "done");
    };
    const verify = async (newCount: number) => {
      for (const url of [
        `${endpoints.phone}/mobile/state`,
        `${endpoints.desktop}/api/state`,
      ]) {
        const response = await fetch(url, { headers });
        assert.equal(response.status, 200);
        const state = await response.json();
        assert.equal(state.turns.length, 4 + newCount);
        assert.deepEqual(
          state.turns.map((turn: { id: string }) => turn.id),
          [
            ...Array.from({ length: 4 }, (_, index) => `imported-${index}`),
            ...Array.from(
              { length: newCount },
              (_, index) => `mobile:${pair.id}:new-${index}`,
            ),
          ],
        );
        for (let index = 0; index < newCount; index++) {
          const turn = state.turns.find(
            (turn: { id: string }) =>
              turn.id === `mobile:${pair.id}:new-${index}`,
          );
          assert.equal(turn?.userText, `New phone message ${index}`);
          assert.equal(turn?.reply, "I saved this new test reply.");
          assert.equal(turn?.status, "complete");
        }
      }
    };
    for (let index = 0; index < 3; index++) {
      await chat(index);
      await verify(index + 1);
    }
    await app.close();
    app = createApp(options);
    endpoints = await listen();
    await verify(3);
    await chat(2); // A restored pending message must replay, not duplicate.
    await verify(3);
    assert.equal(modelCalls, 3);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
