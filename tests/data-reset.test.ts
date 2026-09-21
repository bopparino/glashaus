import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../app/server/store.ts";
import { companionInput } from "../app/server/validation.ts";
import {
  claimDataReset,
  prepareDataReset,
  recoverDataResetLock,
} from "../app/server/data-reset.ts";
import {
  backupDatabase,
  claimUpdate,
  releaseUpdate,
} from "../app/server/update-engine.ts";
import { readUpdate, writeUpdate } from "../app/server/update-state.ts";
import { createApp } from "../app/server/http.ts";
import type { State } from "../app/shared/types.ts";

const privateText = "synthetic-private-content-6fd328e8-not-real";
const privateKey = "synthetic-secret-key-2891-not-real";
const persona = () =>
  companionInput({
    name: "Mira",
    mode: "grow",
    userName: "Test visitor",
    relationship: privateText,
  });
function seed(store: Store) {
  store.saveSettings({
    ...store.settings(),
    model: "test-model",
    ollamaApiKey: privateKey,
    telegramToken: "synthetic-bot-token",
    telegramOwnerId: "42",
  });
  store.saveCompanion(persona());
  store.saveCompanion(persona(), true);
  store.startTurn("turn-1", privateText, "web");
  store.finishTurn("turn-1", privateText, "complete");
  const memory = store.writeMemory({
    kind: "fact",
    subject: "user",
    text: privateText,
    evidence: privateText,
    turnId: "turn-1",
  });
  store.forgetMemory(memory.id);
  store.db
    .prepare("INSERT INTO reflections VALUES (?,?,?,?)")
    .run("r1", privateText, '["turn-1"]', new Date().toISOString());
  store.db
    .prepare("INSERT INTO imports VALUES (?,?,?,?)")
    .run("i1", "synthetic", privateText, new Date().toISOString());
  store.db
    .prepare("INSERT INTO outreach VALUES (?,?,?,?)")
    .run("o1", privateText, "pending", new Date().toISOString());
  store.enqueue("j1", "capture", { turnId: "turn-1", test: privateText });
  store.setMeta("telegramOffset", "123");
  store.setMeta("delivery:old", privateText);
}
const contentTables = [
  "companion",
  "revisions",
  "turns",
  "memories",
  "blocked_turns",
  "memory_suppressions",
  "memory_replacements",
  "reflections",
  "research",
  "jobs",
  "imports",
  "outreach",
];
function assertEmpty(store: Store) {
  for (const table of contentTables)
    assert.equal(
      store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count,
      0,
      table,
    );
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(store.companion(), null);
}
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "glashaus-delete-test-"));
  const home = path.join(root, "Companion home");
  const store = new Store(home);
  seed(store);
  return {
    root,
    home,
    store,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("deletion clears every content table and SQLite remnants, keeps connections and old backup", async () => {
  const f = fixture();
  try {
    const backup = await backupDatabase(f.home, randomUUID());
    const release = claimDataReset(f.home);
    const result = prepareDataReset(f.store, "companion")();
    release();
    assert(result.complete);
    assertEmpty(f.store);
    assert.equal(f.store.settings().ollamaApiKey, privateKey);
    assert.equal(f.store.settings().telegramOwnerId, "42");
    assert.equal(f.store.meta("telegramOffset"), "123");
    assert.equal(f.store.meta("delivery:old"), null);
    assert(existsSync(backup!));
    assert(
      !readFileSync(path.join(f.home, "glashaus-v3.sqlite")).includes(
        privateText,
      ),
    );
    f.store.saveCompanion(persona());
    assert.notEqual(f.store.companion(), null);
    assert.equal(f.store.turns().length, 0);
  } finally {
    f.close();
  }
});

test("purge clears settings and managed recovery files, preserves service and unrelated files", async () => {
  const f = fixture();
  try {
    const id = randomUUID();
    const backup = await backupDatabase(f.home, id);
    const failed = path.join(
      path.dirname(backup!),
      `failed-candidate-${randomUUID()}`,
    );
    mkdirSync(failed);
    writeFileSync(path.join(failed, "glashaus-v3.sqlite-wal"), privateText);
    const startup = path.join(f.home, "startup");
    mkdirSync(startup);
    writeFileSync(path.join(startup, "background.log"), privateText);
    writeFileSync(path.join(startup, "background.log.previous"), privateText);
    writeFileSync(
      path.join(startup, "registration.json"),
      "synthetic registration remains",
    );
    writeFileSync(path.join(f.home, "backups", "my-export.json"), privateText);
    writeFileSync(path.join(f.root, "external-export.json"), privateText);
    writeUpdate(f.home, {
      id,
      pid: process.pid,
      phase: "complete",
      version: "3.0.0-alpha.6",
      message: "Done",
      startedAt: new Date().toISOString(),
      backup,
    });
    const release = claimDataReset(f.home);
    const result = prepareDataReset(f.store, "purge")();
    release();
    assert(result.complete);
    assert(result.removedFiles >= 4); // SQLite may also create backup WAL/SHM files.
    assertEmpty(f.store);
    assert.equal(f.store.settings().model, "");
    assert.equal(f.store.settings().ollamaApiKey, "");
    assert.equal(f.store.settings().telegramOwnerId, "");
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS count FROM meta").get()!.count,
      0,
    );
    assert(!existsSync(backup!));
    assert(!existsSync(failed));
    assert(existsSync(path.join(startup, "registration.json")));
    assert(existsSync(path.join(f.home, "backups", "my-export.json")));
    assert(existsSync(path.join(f.root, "external-export.json")));
    assert.equal(readUpdate(f.home)?.backup, undefined);
    const bytes = readFileSync(path.join(f.home, "glashaus-v3.sqlite"));
    assert(!bytes.includes(privateText));
    assert(!bytes.includes(privateKey));
    assert(
      prepareDataReset(f.store, "purge")().complete,
      "Empty home purge is retryable",
    );
  } finally {
    f.close();
  }
});

test("purge refuses unknown recovery contents before changing anything", async () => {
  const f = fixture();
  try {
    const backup = await backupDatabase(f.home, randomUUID());
    writeFileSync(
      path.join(path.dirname(backup!), "personal-notes.txt"),
      "keep",
    );
    assert.throws(() => prepareDataReset(f.store, "purge"), /unfamiliar file/);
    assert(f.store.companion());
    assert(existsSync(backup!));
  } finally {
    f.close();
  }
});

test("purge refuses a recovery junction pointing outside this home", () => {
  const f = fixture();
  try {
    const outside = path.join(f.root, "untouched");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "glashaus-v3.sqlite"), privateText);
    mkdirSync(path.join(f.home, "backups"));
    symlinkSync(
      outside,
      path.join(f.home, "backups", `update-${randomUUID()}`),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => prepareDataReset(f.store, "purge"), /linked data/);
    assert(f.store.companion());
    assert.equal(
      readFileSync(path.join(outside, "glashaus-v3.sqlite"), "utf8"),
      privateText,
    );
  } finally {
    f.close();
  }
});

test("deletion refuses a hard-linked active database", () => {
  const f = fixture();
  try {
    linkSync(
      path.join(f.home, "glashaus-v3.sqlite"),
      path.join(f.root, "other.sqlite"),
    );
    assert.throws(
      () => prepareDataReset(f.store, "companion"),
      /unlinked database/,
    );
    assert(f.store.companion());
  } finally {
    f.close();
  }
});

test("file cleanup failure is reported as partial and purge can be retried", async () => {
  const f = fixture();
  try {
    const backup = await backupDatabase(f.home, randomUUID());
    const result = prepareDataReset(
      f.store,
      "purge",
    )(() => {
      throw new Error("Synthetic permission error");
    });
    assert.equal(result.complete, false);
    assert.match(result.warnings.join(" "), /purge is incomplete/);
    assertEmpty(f.store);
    assert(existsSync(backup!));
    assert(prepareDataReset(f.store, "purge")().complete);
    assert(!existsSync(backup!));
  } finally {
    f.close();
  }
});

test("database deletion is transactional if a write fails", () => {
  const f = fixture();
  try {
    f.store.db.exec(
      "CREATE TRIGGER deny_cleanup BEFORE DELETE ON turns BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    assert.throws(
      () => prepareDataReset(f.store, "companion")(),
      /synthetic failure/,
    );
    assert(f.store.companion());
    assert.equal(f.store.turns().length, 1);
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS count FROM imports").get()!.count,
      1,
    );
  } finally {
    f.close();
  }
});

test("updater and cleanup share an exclusive lock; recovery never resurrects deleted data", () => {
  const f = fixture();
  try {
    const release = claimDataReset(f.home);
    assert.throws(() => claimDataReset(f.home), /owns this home/);
    assert.throws(
      () => claimUpdate(f.home, "3.0.0-alpha.7"),
      /Another update owns/,
    );
    assert.throws(() => recoverDataResetLock(f.home), /may still be running/);
    release();
    const update = claimUpdate(f.home, "3.0.0-alpha.7");
    assert.throws(() => claimDataReset(f.home), /Finish or recover/);
    writeUpdate(f.home, { ...update, phase: "failed" });
    releaseUpdate(f.home, update.id);
    writeFileSync(
      path.join(f.home, "updates", "lock.json"),
      JSON.stringify({
        kind: "data-reset",
        id: "synthetic-dead",
        pid: 2147483647,
      }),
    );
    assert(recoverDataResetLock(f.home));
    assert(!existsSync(path.join(f.home, "updates", "lock.json")));
    assert(
      f.store.companion(),
      "Recovery clears a lock only; it does not run a deletion",
    );
  } finally {
    f.close();
  }
});

async function httpFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "glashaus-reset-http-"));
  const app = createApp({
    directory,
    webRoot: directory,
    background: false,
    provider: {
      models: async () => [],
      research: async () => [],
      chat: async () => "synthetic reply",
    },
  });
  seed(app.store);
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api`;
  const state = (await (await fetch(`${base}/state`)).json()) as State;
  const input = {
    mode: "companion",
    companionId: state.companion!.id,
    confirmation: "DELETE Mira",
    confirmed: true,
  };
  return {
    app,
    base,
    state,
    input,
    post: (body: unknown, token = state.csrfToken, endpoint = "/data/reset") =>
      fetch(base + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-glashaus-token": token,
        },
        body: JSON.stringify(body),
      }),
    async close() {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("HTTP deletion requires CSRF, exact phrase, acknowledgement and current companion ID", async () => {
  const f = await httpFixture();
  try {
    assert.equal((await f.post(f.input, "wrong-token")).status, 403);
    for (const change of [
      { confirmation: "DELETE" },
      { confirmed: false },
      { companionId: "old-id" },
      { mode: "anything" },
    ]) {
      assert(
        [400, 409].includes((await f.post({ ...f.input, ...change })).status),
      );
      assert(f.app.store.companion());
    }
    const r = await f.post(f.input);
    assert.equal(r.status, 200);
    assert((await r.json()).complete);
    assertEmpty(f.app.store);
    assert.equal(
      (await f.post({}, f.state.csrfToken, "/settings")).status,
      403,
      "Old tabs cannot mutate with the previous token",
    );
    const next = (await (await fetch(f.base + "/state")).json()) as State;
    assert.notEqual(next.csrfToken, f.state.csrfToken);
    assert.equal(
      (
        await f.post(
          {
            mode: "purge",
            companionId: null,
            confirmation: "PURGE ALL",
            confirmed: true,
          },
          next.csrfToken,
        )
      ).status,
      200,
    );
    assert.equal(f.app.store.settings().ollamaApiKey, "");
  } finally {
    await f.close();
  }
});

test("HTTP deletion refuses reply and background work, then resumes after a safe refusal", async () => {
  const f = await httpFixture();
  try {
    f.app.service.busy = 1;
    assert.equal((await f.post(f.input)).status, 409);
    f.app.service.busy = 0;
    f.app.service.background = "Remembering the conversation";
    assert.equal((await f.post(f.input)).status, 409);
    f.app.service.background = "Idle";
    const release = claimDataReset(f.app.store.directory);
    assert.equal((await f.post(f.input)).status, 409);
    release();
    assert(f.app.store.companion());
    assert.equal((await f.post(f.input)).status, 200);
  } finally {
    await f.close();
  }
});

test("HTTP maintenance blocks new writes while Telegram is draining", async () => {
  const f = await httpFixture();
  const original = f.app.telegram.shutdown.bind(f.app.telegram);
  let resume!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.app.telegram.shutdown = async () => {
    entered();
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
    await original();
  };
  try {
    const deleting = f.post(f.input);
    await started;
    assert.equal(
      (await f.post(persona(), f.state.csrfToken, "/companion")).status,
      409,
    );
    assert.equal((await f.post(f.input)).status, 409);
    assert.equal((await fetch(f.base + "/export")).status, 409);
    resume();
    assert.equal((await deleting).status, 200);
    assertEmpty(f.app.store);
  } finally {
    f.app.telegram.shutdown = original;
    await f.close();
  }
});
