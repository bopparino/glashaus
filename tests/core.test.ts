import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../app/server/store.ts";
import { CompanionService, ReplyStream } from "../app/server/companion.ts";
import { Ollama } from "../app/server/ollama.ts";
import type { ModelProvider, ChatOptions } from "../app/server/ollama.ts";
import { companionInput, character } from "../app/server/validation.ts";
import { createApp } from "../app/server/http.ts";
import { splitTelegram } from "../app/server/telegram.ts";
import { modelLocation } from "../app/web/model-location.ts";

const persona = () =>
  companionInput({
    name: "Mira",
    pronouns: "she/her",
    mode: "authored",
    work: "",
    summary: "A curious companion.",
    personality: "Thoughtful and candid.",
    voice: "Short, natural replies.",
    backstory: "",
    values: "Honesty",
    relationship: "Friends getting to know one another.",
    userName: "You",
    claims: [],
    sources: [],
    uncertainties: [],
  });

test("routing labels distinguish hosted models, local servers, and remote servers", () => {
  assert.equal(
    modelLocation("kimi-k2.6:cloud", "http://127.0.0.1:11434"),
    "Cloud model · via Ollama",
  );
  assert.equal(
    modelLocation("local-model", "http://127.0.0.1:11434"),
    "Ollama · local server",
  );
  assert.equal(
    modelLocation("model", "https://ollama.example"),
    "Remote Ollama server",
  );
  assert.equal(
    modelLocation("", "http://localhost:11434"),
    "Choose a model in Settings",
  );
});
class FakeModel implements ModelProvider {
  calls: ChatOptions[] = [];
  response = "That project matters to you. What made you return to it?";
  async models() {
    return [{ name: "test-model", size: 1000 }];
  }
  async chat(options: ChatOptions) {
    this.calls.push(options);
    options.signal?.throwIfAborted();
    options.onToken?.(this.response.slice(0, 15));
    options.onToken?.(this.response.slice(15));
    return this.response;
  }
  async research() {
    return [
      {
        id: "source-1",
        title: "Example source",
        url: "https://example.com/character",
        excerpt:
          "The character cares about a shared project and has a dry sense of humor.",
        fetchedAt: new Date().toISOString(),
      },
    ];
  }
}

test("identity, delivered conversations and memories survive reopening; credentials stay out of archives", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-test-"));
  let db: Store | undefined;
  try {
    db = new Store(directory);
    const c = db.saveCompanion(persona());
    db.saveSettings({
      ...db.settings(),
      model: "test-model",
      ollamaApiKey: "secret-search",
      telegramToken: "secret-bot",
    });
    db.startTurn("turn-1", "I love rainy mornings.", "web");
    db.finishTurn("turn-1", "So do I.", "complete");
    db.markDelivered("turn-1");
    db.writeMemory({
      kind: "fact",
      subject: "user",
      text: "You love rainy mornings.",
      evidence: "I love rainy mornings.",
      turnId: "turn-1",
    });
    db.close();
    db = new Store(directory);
    assert.equal(db.companion()?.id, c.id);
    assert.equal(db.turns()[0].reply, "So do I.");
    assert.equal(db.recall("mornings")[0].text, "You love rainy mornings.");
    const archive = db.archive();
    assert.ok(!JSON.stringify(archive).includes("secret-search"));
    assert.ok(!JSON.stringify(archive).includes("secret-bot"));
    const target = new Store(":memory:");
    try {
      target.importArchive(archive);
      assert.equal(target.companion()?.id, c.id);
      assert.deepEqual(target.turns(), db.turns());
      assert.equal(target.memories().length, 1);
    } finally {
      target.close();
    }
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interrupted turns are recoverable; forget blocks queued capture from the source turn", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-test-"));
  let db = new Store(directory);
  try {
    db.startTurn("unfinished", "hello", "web");
    db.close();
    db = new Store(directory);
    assert.equal(db.turn("unfinished")?.status, "interrupted");
    db.startTurn("unfinished", "hello", "web");
    db.finishTurn("unfinished", "hello back", "complete");
    const memory = db.writeMemory({
      kind: "fact",
      subject: "user",
      text: "A memory to forget.",
      evidence: "hello",
      turnId: "unfinished",
    })!;
    db.forgetMemory(memory.id);
    assert.equal(db.memories().length, 0);
    assert.equal(
      db.writeMemory({
        kind: "fact",
        subject: "user",
        text: "Paraphrased memory.",
        evidence: "hello",
        turnId: "unfinished",
      }),
      null,
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid import is atomic and cannot replace an existing companion", () => {
  const source = new Store(":memory:");
  const target = new Store(":memory:");
  try {
    source.saveCompanion(persona());
    const archive = source.archive();
    const invalid = {
      ...archive,
      memories: [
        {
          id: "bad",
          kind: "fact",
          subject: "user",
          text: "Bad",
          turnId: "missing",
        },
      ],
    };
    assert.throws(() => target.importArchive(invalid), /missing conversation/);
    assert.equal(target.companion(), null);
    target.importArchive(archive);
    assert.throws(() => target.importArchive(archive), /empty home/);
  } finally {
    source.close();
    target.close();
  }
});

test("source validation demotes unsupported sourced claims", () => {
  const c = character({
    ...persona(),
    claims: [
      {
        text: "An unsupported claim.",
        sourceIds: ["made-up"],
        kind: "sourced",
      },
    ],
  });
  assert.equal(c.claims[0].kind, "interpretation");
  assert.deepEqual(c.claims[0].sourceIds, []);
});

test("replaying a request ID does not generate twice; quoted evidence gates automatic memory", async () => {
  const store = new Store(":memory:");
  const model = new FakeModel();
  const service = new CompanionService(store, model);
  try {
    store.saveCompanion(persona());
    store.saveSettings({ ...store.settings(), model: "test-model" });
    const signal = new AbortController().signal;
    await service.chat(
      "same",
      "I love rainy mornings.",
      "web",
      signal,
      () => {},
    );
    await service.chat(
      "same",
      "I love rainy mornings.",
      "web",
      signal,
      () => {},
    );
    assert.equal(model.calls.length, 1);
    assert.equal(store.turns().length, 1);
    await assert.rejects(
      () => service.chat("same", "Different message.", "web", signal, () => {}),
      /another message/,
    );
    model.response = JSON.stringify({
      memories: [
        {
          text: "Loves rainy mornings.",
          subject: "user",
          evidence: "I love rainy mornings.",
        },
        { text: "Has a cat.", subject: "user", evidence: "my cat" },
      ],
      opinions: [],
    });
    await service.capture("same", signal);
    assert.equal(store.memories().length, 1);
    assert.equal(store.memories()[0].text, "Loves rainy mornings.");
  } finally {
    service.stop();
    store.close();
  }
});

test("internal note markers are suppressed even when split across tiny tokens", () => {
  const stream = new ReplyStream();
  let emitted = "";
  for (const char of "Hello. ((private: a hidden note)) How are you?")
    emitted += stream.push(char);
  emitted += stream.push("", true);
  assert.equal(emitted, "Hello.  How are you?");
  assert.ok(!emitted.includes("hidden"));
});

test("Ollama handles split NDJSON and refuses truncated output", async () => {
  const store = new Store(":memory:");
  store.saveSettings({ ...store.settings(), model: "test-model" });
  const makeFetch = (data: string) =>
    (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const c of new TextEncoder().encode(data))
              controller.enqueue(new Uint8Array([c]));
            controller.close();
          },
        }),
      )) as typeof fetch;
  try {
    const good = new Ollama(
      () => store.settings(),
      makeFetch(
        '{"message":{"content":"héllo"},"done":false}\n{"done":true}\n',
      ),
    );
    assert.equal(
      await good.chat({ messages: [{ role: "user", content: "hi" }] }),
      "héllo",
    );
    const bad = new Ollama(
      () => store.settings(),
      makeFetch('{"message":{"content":"partial"}}\n'),
    );
    await assert.rejects(
      () => bad.chat({ messages: [] }),
      /before the reply finished/,
    );
  } finally {
    store.close();
  }
});

test("HTTP setup, streaming chat and export work with origin/CSRF checks", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-http-"));
  mkdirSync(path.join(directory, "art"));
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "index.html"), "GlasHaus test");
  writeFileSync(path.join(directory, "art", "prism.png"), "test asset");
  writeFileSync(path.join(directory, "assets", "index-abc123.js"), "// fixture");
  const app = createApp({
    directory,
    webRoot: directory,
    provider: new FakeModel(),
    background: false,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const resource of ["/", "/art/prism.png"]) {
      const response = await fetch(`${base}${resource}`);
      assert.equal(response.headers.get("cache-control"), "no-cache");
    }
    const bundled = await fetch(`${base}/assets/index-abc123.js`);
    assert.match(bundled.headers.get("cache-control") || "", /immutable/);
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      csrfToken: string;
    };
    const post = (
      route: string,
      body: unknown,
      extra: Record<string, string> = {},
    ) =>
      fetch(`${base}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-glashaus-token": state.csrfToken,
          ...extra,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post("/api/settings", {}, { Origin: "https://unrelated.example" }))
        .status,
      403,
    );
    assert.equal(
      (await post("/api/settings", {}, { "x-glashaus-token": "wrong" })).status,
      403,
    );
    assert.equal(
      (
        await post("/api/settings", {
          model: "test-model",
          ollamaApiKey: "never-return-me",
        })
      ).status,
      200,
    );
    assert.equal((await post("/api/companion", persona())).status, 200);
    const chat = await post("/api/chat", { id: "http-1", text: "hello" });
    const events = (await chat.text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).turn.status, "complete");
    const archive = await (await fetch(`${base}/api/export`)).text();
    assert.ok(!archive.includes("never-return-me"));
    assert.ok(archive.includes("http-1"));
    const hostileStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        http
          .get(
            `${base}/api/state`,
            { headers: { Host: "hostile.example" } },
            (res) => {
              res.resume();
              resolve(res.statusCode);
            },
          )
          .on("error", reject);
      },
    );
    assert.equal(hostileStatus, 403);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("research retains sources, can resume, and full archives restore research and identity revisions", async () => {
  const store = new Store(":memory:");
  const model = new FakeModel();
  const service = new CompanionService(store, model);
  model.response = JSON.stringify({
    summary: "Candid and curious.",
    voice: "Dry wit",
    claims: [
      { text: "Has a dry wit.", kind: "sourced", sourceIds: ["source-1"] },
    ],
    uncertainties: ["Adaptation details may vary."],
  });
  let lookups = 0;
  const original = model.research.bind(model);
  model.research = async () => {
    lookups++;
    return original();
  };
  try {
    const first = await service.research(
      { name: "Mira", work: "Example" },
      new AbortController().signal,
      () => {},
    );
    const second = await service.research(
      { id: first.id, name: "Mira", work: "Example" },
      new AbortController().signal,
      () => {},
    );
    assert.equal(lookups, 1);
    assert.equal(second.draft?.claims[0].kind, "sourced");
    assert.equal(second.sources.length, 1);
    store.saveCompanion(persona());
    store.saveCompanion({ ...persona(), voice: "A revised voice." }, true);
    const restored = new Store(":memory:");
    try {
      restored.importArchive(store.archive());
      assert.deepEqual(restored.research(), store.research());
      assert.equal(restored.archive().revisions.length, 1);
      assert.equal(restored.companion()?.revision, 2);
    } finally {
      restored.close();
    }
  } finally {
    store.close();
  }
});

test("foreground interruptions do not exhaust background job retries", () => {
  const store = new Store(":memory:");
  try {
    store.enqueue("capture:test", "capture", { turnId: "test" });
    for (let i = 0; i < 6; i++) {
      const job = store.nextJob();
      assert.ok(job);
      store.jobStatus(job.id, "running");
      store.deferJob(job.id);
    }
    assert.equal(store.nextJob()?.attempts, 0);
  } finally {
    store.close();
  }
});

test("Telegram message splitting preserves Unicode and stays within the limit", () => {
  const text = "A".repeat(3899) + "🌒" + "B".repeat(6000);
  const parts = splitTelegram(text);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every((p) => p.length <= 3900));
  assert.ok(
    parts.every(
      (p) => !/[\uD800-\uDBFF]$/.test(p) && !/^[\uDC00-\uDFFF]/.test(p),
    ),
  );
});
