import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../app/server/store.ts";
import { CheckIns, checkInWindow } from "../app/server/check-ins.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ChatOptions } from "../app/server/ollama.ts";

function fixture() {
  const store = new Store(":memory:");
  let now = new Date("2026-09-29T15:00:00.000Z"),
    calls = 0;
  store.saveCompanion(
    companionInput({
      name: "Test companion",
      userName: "Test visitor",
      mode: "grow",
      relationship: "Synthetic review",
    }),
  );
  store.saveSettings({
    ...store.settings(),
    model: "fixture",
    outreachEnabled: true,
    quietEnd: 9,
    quietStart: 21,
    maxOutreachPerDay: 2,
    timeZone: "America/New_York",
  });
  const message = "I have been getting into old science fiction movies lately.";
  let answer = async (_options: ChatOptions) =>
    JSON.stringify({
      send: true,
      content: "Still in the mood to talk about old science fiction?",
      reason: "You mentioned an interest in old science fiction movies.",
      evidence: message,
    });
  const service = new CheckIns(
    store,
    {
      models: async () => [],
      research: async () => [],
      chat: async (options) => {
        calls++;
        return answer(options);
      },
    },
    () => now,
  );
  const source = (id = "source", hoursAgo = 3) => {
    store.startTurn(id, message, "web");
    store.finishTurn(id, "There is plenty to explore.", "complete");
    store.markDelivered(id);
    store.db
      .prepare("UPDATE turns SET createdAt=? WHERE id=?")
      .run(new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(), id);
  };
  source();
  return {
    store,
    service,
    source,
    message,
    calls: () => calls,
    now: (value: string) => {
      now = new Date(value);
    },
    answer: (value: typeof answer) => {
      answer = value;
    },
    run: () =>
      service.evaluate("Synthetic identity", new AbortController().signal),
  };
}
test("check-ins respect the selected time zone, DST, and quiet-hour boundaries", () => {
  const f = fixture();
  try {
    const s = f.store.settings();
    for (const at of [
      "2026-09-29T12:59:00Z",
      "2026-09-30T01:00:00Z",
      "2026-11-01T13:59:00Z",
    ])
      assert.equal(checkInWindow(s, new Date(at)), false, at);
    for (const at of [
      "2026-09-29T13:00:00Z",
      "2026-09-30T00:59:00Z",
      "2026-11-01T14:00:00Z",
    ])
      assert.equal(checkInWindow(s, new Date(at)), true, at);
    assert.equal(
      checkInWindow(
        { ...s, quietStart: 9, quietEnd: 17 },
        new Date("2026-09-29T22:00:00Z"),
      ),
      true,
    );
    assert.equal(
      checkInWindow({ ...s, quietStart: 9, quietEnd: 9 }, new Date()),
      false,
    );
  } finally {
    f.store.close();
  }
});
test("one grounded message per source; read continuation has no fake user turn", async () => {
  const f = fixture();
  try {
    await f.run();
    await f.run();
    const [message] = f.service.list();
    assert.equal(f.calls(), 1);
    assert.equal(message.status, "available");
    assert.equal(message.evidence, f.message);
    assert.equal(f.store.turns().length, 1);
    f.service.update(message.id, { action: "seen" });
    assert.equal(f.service.list()[0].status, "seen");
    f.service.update(message.id, { action: "dismiss" });
    assert.equal(f.service.list().length, 0);
    await f.run();
    assert.equal(f.calls(), 1);
  } finally {
    f.store.close();
  }
});
test("recent conversation, quiet hours, paused settings, and stale context cause no inference", async () => {
  const f = fixture();
  try {
    f.source("recent", 0.5);
    await f.run();
    assert.equal(f.calls(), 0);
    f.now("2026-09-30T02:00:00.000Z");
    await f.run();
    assert.equal(f.calls(), 0);
    f.now("2026-10-01T15:00:00.000Z");
    await f.run();
    assert.equal(f.calls(), 0);
    f.source("fresh");
    f.service.configure({ enabled: false });
    await f.run();
    assert.equal(f.calls(), 0);
    assert.throws(
      () => f.service.configure({ model: "not-allowed" }),
      /preferences/,
    );
  } finally {
    f.store.close();
  }
});
test("cadence and daily quota are separate from requested reminders", async () => {
  const f = fixture();
  try {
    await f.run();
    f.service.update(f.service.list()[0].id, { action: "seen" });
    f.now("2026-09-29T18:00:00.000Z");
    f.source("second", 2);
    await f.run();
    assert.equal(f.calls(), 1);
    f.now("2026-09-29T19:00:00.000Z");
    await f.run();
    assert.equal(f.calls(), 2);
    const second = f.service.list().find((r) => r.status === "available")!;
    f.service.update(second.id, { action: "seen" });
    f.now("2026-09-29T23:00:00.000Z");
    f.source("third", 2);
    await f.run();
    assert.equal(f.calls(), 2);
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM reminders").get()!.n,
      0,
    );
  } finally {
    f.store.close();
  }
});
test("new conversation, profile changes, pause, and forgotten evidence invalidate generation", async () => {
  for (const change of ["conversation", "profile", "pause", "forget"]) {
    const f = fixture();
    try {
      const memory = f.store.writeMemory({
        kind: "fact",
        subject: "user",
        text: f.message,
        evidence: f.message,
        turnId: "source",
      });
      f.answer(async () => {
        if (change === "conversation") f.source("new", 0);
        if (change === "profile")
          f.store.saveCompanion(
            { ...f.store.companion()!, voice: "Changed" },
            true,
          );
        if (change === "pause") f.service.configure({ enabled: false });
        if (change === "forget") f.store.forgetMemory(memory.id);
        return JSON.stringify({
          send: true,
          content: "A grounded follow-up.",
          reason: "An interest you mentioned.",
          evidence: f.message,
        });
      });
      await f.run();
      assert.equal(f.service.list().length, 0, change);
    } finally {
      f.store.close();
    }
  }
});
test("silence, invented evidence, and provider failures are bounded; stale messages expire", async () => {
  for (const result of [
    JSON.stringify({ send: false }),
    JSON.stringify({
      send: true,
      content: "Hi",
      reason: "Invented",
      evidence: "You never said this.",
    }),
    "malformed",
  ]) {
    const f = fixture();
    try {
      f.answer(async () => result);
      await f.run();
      await f.run();
      assert.equal(f.calls(), 1);
      assert.equal(f.service.list().length, 0);
    } finally {
      f.store.close();
    }
  }
  const f = fixture();
  try {
    await f.run();
    f.now("2026-09-30T15:00:00.000Z");
    assert.equal(f.service.list().length, 0);
  } finally {
    f.store.close();
  }
});
test("archive preserves check-in history, expires unseen outreach, pauses on restore, and clears on deletion", async () => {
  const f = fixture(),
    target = new Store(":memory:");
  try {
    await f.run();
    target.saveSettings({ ...target.settings(), outreachEnabled: true });
    target.importArchive(f.store.archive());
    assert.equal(target.settings().outreachEnabled, false);
    assert.equal(
      target.db.prepare("SELECT status FROM check_ins").get()!.status,
      "expired",
    );
    assert.equal(target.turns().length, 1);
    target.resetData(false);
    assert.equal(
      target.db.prepare("SELECT count(*) AS n FROM check_ins").get()!.n,
      0,
    );
    assert.deepEqual(target.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.store.close();
    target.close();
  }
});
