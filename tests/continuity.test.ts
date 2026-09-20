import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../app/server/store.ts";
import { CompanionService, identityPrompt } from "../app/server/companion.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ModelProvider, ChatOptions } from "../app/server/ollama.ts";

const persona = () =>
  companionInput({
    name: "Mira",
    mode: "grow",
    userName: "Visitor",
    relationship: "New friends",
    voice: "Warm, direct, and curious.",
  });
const signal = () => new AbortController().signal;
function fixture(store = new Store(":memory:")) {
  let response = "A brief, specific reply.";
  const calls: ChatOptions[] = [];
  const model: ModelProvider = {
    models: async () => [],
    research: async () => [],
    chat: async (options) => {
      calls.push(options);
      return response;
    },
  };
  const service = new CompanionService(store, model);
  if (!store.companion()) store.saveCompanion(persona());
  return {
    store,
    service,
    calls,
    setResponse(value: unknown) {
      response = typeof value === "string" ? value : JSON.stringify(value);
    },
  };
}
function turn(
  store: Store,
  id: string,
  userText: string,
  reply = "I prefer repairing old radios to buying new ones.",
) {
  store.startTurn(id, userText, "web");
  store.finishTurn(id, reply, "complete");
  store.markDelivered(id);
}
function memory(
  store: Store,
  id: string,
  content: string,
  kind: "fact" | "opinion" = "fact",
) {
  return store.writeMemory({
    kind,
    subject: kind === "fact" ? "user" : "companion",
    text: content,
    evidence: content,
    turnId: id,
  })!;
}
test("explicit fact corrections supersede old memory and exclude contradictory source history", async () => {
  const f = fixture();
  try {
    turn(f.store, "old", "My favorite tea is smoked oolong.");
    const old = memory(f.store, "old", "User's favorite tea is smoked oolong.");
    turn(f.store, "new", "My favorite tea is now jasmine, not smoked oolong.");
    f.setResponse({
      memories: [
        {
          text: "User's favorite tea is jasmine.",
          subject: "user",
          evidence: "My favorite tea is now jasmine, not smoked oolong.",
          supersedes: [old.id],
        },
      ],
      opinions: [],
    });
    await f.service.capture("new", signal());
    assert.equal(f.store.memories().length, 1);
    assert.match(f.store.memories()[0].text, /jasmine/);
    assert(f.store.blockedTurn("old"));
    assert.equal(f.store.archive().memoryReplacements.length, 1);
    const prompt = f.service.prompt(
      f.store.companion()!,
      "What's my favorite tea?",
    );
    assert(
      !prompt.some(
        (m) =>
          m.role === "user" &&
          m.content === "My favorite tea is smoked oolong.",
      ),
    );
  } finally {
    f.service.stop();
    f.store.close();
  }
});
test("changed companion opinions retain provenance and cannot overwrite user facts", async () => {
  const f = fixture();
  try {
    turn(f.store, "first", "Let's talk about radios.");
    const opinion = memory(
      f.store,
      "first",
      "I prefer repairing old radios.",
      "opinion",
    );
    const fact = memory(f.store, "first", "User collects radios.");
    turn(
      f.store,
      "later",
      "Has your view changed?",
      "I now prefer buying new radios because reliable reception matters more to me.",
    );
    f.setResponse({
      memories: [],
      opinions: [
        {
          text: "Prefers new radios for reliable reception.",
          evidence:
            "I now prefer buying new radios because reliable reception matters more to me.",
          supersedes: [opinion.id],
        },
      ],
    });
    await f.service.capture("later", signal());
    assert.equal(
      f.store.memories().filter((m) => m.kind === "opinion").length,
      1,
    );
    assert(f.store.memories().some((m) => m.id === fact.id));
    assert.equal(f.store.memories(true).length, 3);
    f.setResponse({
      memories: [],
      opinions: [
        {
          text: "An unrelated overwrite.",
          evidence:
            "I now prefer buying new radios because reliable reception matters more to me.",
          supersedes: [fact.id],
        },
      ],
    });
    await f.service.capture("later", signal());
    assert(
      !f.store.memories().some((m) => m.text === "An unrelated overwrite."),
    );
  } finally {
    f.service.stop();
    f.store.close();
  }
});
test("manual corrections and their old-wording suppression survive export and restore", () => {
  const source = new Store(":memory:"),
    restored = new Store(":memory:");
  try {
    source.saveCompanion(persona());
    turn(source, "old", "My favorite color is copper.");
    const old = memory(source, "old", "Favorite color is copper.");
    source.editMemory(old.id, "Favorite color is silver.");
    restored.importArchive(source.archive());
    turn(restored, "later", "My favorite color is copper.");
    assert.equal(memory(restored, "later", "Favorite color is copper."), null);
    assert.equal(memory(restored, "later", "Favorite color is silver."), null);
    assert.equal(
      restored.replaceMemory(
        {
          kind: "fact",
          subject: "user",
          text: "Favorite color is blue.",
          evidence: "My favorite color is copper.",
          turnId: "later",
        },
        [old.id],
      ),
      null,
    );
    assert.equal(restored.memories()[0].text, "Favorite color is silver.");
    assert(restored.blockedTurn("old"));
  } finally {
    source.close();
    restored.close();
  }
});
test("forgotten origin stays excluded after hundreds of turns, restart, and archive restore", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-continuity-"));
  let store = new Store(directory);
  const restored = new Store(":memory:");
  try {
    store.saveCompanion(persona());
    turn(store, "private", "My private keepsake is a brass compass.");
    const forgotten = memory(
      store,
      "private",
      "Private keepsake is a brass compass.",
    );
    store.forgetMemory(forgotten.id);
    turn(store, "durable", "My favorite tea is smoked oolong.");
    memory(store, "durable", "Favorite tea is smoked oolong.");
    for (let i = 0; i < 350; i++)
      turn(
        store,
        `filler-${i}`,
        `Ordinary test conversation ${i}.`,
        `Brief response ${i}.`,
      );
    store.close();
    store = new Store(directory);
    restored.importArchive(store.archive());
    const f = fixture(restored);
    const prompt = JSON.stringify(
      f.service.prompt(restored.companion()!, "What is my favorite tea?"),
    );
    assert.match(prompt, /smoked oolong/);
    assert(!prompt.includes("brass compass"));
    assert(!prompt.includes("Ordinary test conversation 0."));
    assert(
      prompt.indexOf("Ordinary test conversation 348.") <
        prompt.indexOf("Ordinary test conversation 349."),
    );
    assert.equal(
      memory(restored, "private", "A paraphrase of that private keepsake."),
      null,
    );
    assert.equal(
      memory(restored, "filler-349", "Private keepsake is a brass compass."),
      null,
    );
    assert.equal(restored.turns(1000).length, 352);
    f.service.stop();
  } finally {
    store.close();
    restored.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("unsupported evidence cannot replace a valid memory", async () => {
  const f = fixture();
  try {
    turn(f.store, "old", "I prefer blue notebooks.");
    const old = memory(f.store, "old", "Prefers blue notebooks.");
    turn(f.store, "new", "Maybe I will try a different notebook.");
    f.setResponse({
      memories: [
        {
          text: "Prefers red notebooks.",
          subject: "user",
          evidence: "I prefer red notebooks.",
          supersedes: [old.id],
        },
      ],
    });
    await f.service.capture("new", signal());
    assert.equal(f.store.memories()[0].id, old.id);
  } finally {
    f.service.stop();
    f.store.close();
  }
});
test("voice preview uses a short greeting and conversation keeps explicit style guidance", async () => {
  const f = fixture();
  try {
    await f.service.preview(f.store.companion()!, signal());
    assert.equal(f.calls[0].maxTokens, 180);
    assert.match(
      f.calls[0].messages.at(-1)!.content,
      /no more than three sentences/,
    );
    assert.match(
      identityPrompt(f.store.companion()!),
      /Questions are optional/,
    );
    assert.match(f.calls[0].messages[0].content, /no asterisk actions/);
    assert.equal(f.store.turns().length, 0);
  } finally {
    f.service.stop();
    f.store.close();
  }
});
test("v2 soul capsule preserves identity and raw unsupported fields without opening a v2 database", () => {
  const store = new Store(":memory:");
  try {
    const capsule = {
      format: "glashaus-soul-capsule",
      version: 1,
      companion: "Legacy companion",
      documents: [
        { name: "SOUL", content: "Curious, candid." },
        { name: "VOICE", content: "Plain-spoken warmth." },
        { name: "IDENTITY", content: "Long-time friends." },
      ],
      identity_facts: [{ category: "companion", content: "Enjoys puzzles." }],
      opinions: [
        {
          claim: "Repairing things matters.",
          context: "After a discussion about waste.",
        },
      ],
      scratchpad: [{ content: "Unmapped private legacy detail." }],
    };
    const result = store.importArchive(capsule);
    assert.equal(result.kind, "capsule");
    assert.equal(store.companion()!.voice, "Plain-spoken warmth.");
    assert.equal(store.memories().length, 2);
    assert.deepEqual(
      JSON.parse(String(store.archive().imports[0].original)).scratchpad,
      capsule.scratchpad,
    );
    assert.throws(() => store.importArchive(capsule), /empty home/);
  } finally {
    store.close();
  }
});
test("schema upgrade is additive and newer archives fail atomically", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "glashaus-upgrade-"));
  let store = new Store(directory);
  try {
    const c = store.saveCompanion(persona());
    store.db.exec("PRAGMA user_version=1");
    store.close();
    store = new Store(directory);
    assert.equal(store.companion()!.id, c.id);
    assert.equal(
      store.db.prepare("PRAGMA user_version").get()!.user_version,
      2,
    );
    const target = new Store(":memory:");
    try {
      assert.throws(
        () => target.importArchive({ ...store.archive(), schemaVersion: 99 }),
        /newer version/,
      );
      assert.equal(target.companion(), null);
    } finally {
      target.close();
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
