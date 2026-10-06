import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../app/server/store.ts";
import { CompanionService, identityPrompt } from "../app/server/companion.ts";
import { companionInput } from "../app/server/validation.ts";

test("capsule vocabulary, dialogue and user context reach the prompt and survive edits and archive restoration", () => {
  const store = new Store(":memory:"),
    restored = new Store(":memory:");
  const capsule = {
    format: "glashaus-soul-capsule",
    version: 1,
    companion: "Elle",
    userName: "Test visitor",
    pronouns: "she/her",
    documents: [
      { name: "SOUL", content: "I am curious and candid." },
      {
        name: "IDENTITY",
        content: "Friends. First-person fictional roleplay.",
      },
      { name: "VOICE", content: "Warm, direct speech." },
      { name: "USER", content: "Test visitor enjoys rainy mornings." },
      { name: "LEXICON", content: "A shared phrase: pocket weather." },
      {
        name: "DIALOGUE",
        content:
          "Demonstration, not history: user: Hello. Elle: Saved you a seat.",
      },
    ],
    identity_facts: [
      {
        category: "user",
        content: "Test visitor enjoys rainy mornings.",
        evidence: "Synthetic interview, 2026-10-05",
      },
    ],
  };
  try {
    store.importArchive(capsule);
    const companion = store.companion()!;
    assert.equal(companion.userName, "Test visitor");
    assert.equal(companion.pronouns, "she/her");
    const prompt = identityPrompt(companion);
    assert.match(prompt, /pocket weather/);
    assert.match(prompt, /Saved you a seat/);
    assert.match(
      prompt,
      /not new conversation turns or proof of shared events/,
    );
    assert.equal(store.turns().length, 0);
    assert.equal(store.memories()[0].subject, "user");
    assert.equal(
      store.memories()[0].evidence,
      "Synthetic interview, 2026-10-05",
    );
    const service = new CompanionService(store, {
      models: async () => [],
      research: async () => [],
      chat: async () => {
        throw new Error("This test must not call a model.");
      },
    });
    const messages = service.prompt(
      companion,
      "What do I like about rainy mornings?",
    );
    assert.match(messages[0].content, /Synthetic interview, 2026-10-05/);
    assert.match(
      messages[0].content,
      /not independently verified conversation events/,
    );
    assert.doesNotMatch(
      messages[0].content,
      /REMEMBERED FROM ACTUAL CONVERSATION/,
    );
    store.saveCompanion(
      companionInput({ ...companion, userName: "Test visitor" }),
      true,
    );
    restored.importArchive(store.archive());
    assert.deepEqual(restored.companion()?.continuity, companion.continuity);
    assert.match(identityPrompt(restored.companion()!), /pocket weather/);
    assert.equal(restored.turns().length, 0);
  } finally {
    store.close();
    restored.close();
  }
});

test("long capsule sections produce a visible warning and preserve their original source", () => {
  const store = new Store(":memory:");
  try {
    const original = "A".repeat(6001);
    const result = store.importArchive({
      format: "glashaus-soul-capsule",
      version: 1,
      companion: "Test",
      documents: [{ name: "DIALOGUE", content: original }],
    });
    assert.match(result.warnings?.[0] ?? "", /DIALOGUE/);
    assert.equal(store.companion()?.continuity?.dialogue.length, 6000);
    assert.equal(store.companion()?.userName, "You");
    assert.equal(store.companion()?.pronouns, "");
    assert.ok(JSON.stringify(store.archive()).includes(original));
  } finally {
    store.close();
  }
});
