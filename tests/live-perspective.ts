// Explicit opt-in: small hosted-model test using only synthetic conversations.
// No real companion home, saved key, Telegram token, or user history is read.
// Usage: node tests/live-perspective.ts --run <model> [ollama-url]
import assert from "node:assert/strict";
import { CompanionService } from "../app/server/companion.ts";
import { Store } from "../app/server/store.ts";
import { Ollama } from "../app/server/ollama.ts";
import { companionInput } from "../app/server/validation.ts";
if (process.argv[2] !== "--run" || !process.argv[3])
  throw new Error(
    "Explicit opt-in required: --run <model> [ollama-url]. Hosted inference may consume your allowance.",
  );
const model = process.argv[3];
const ollamaUrl = process.argv[4] || "http://127.0.0.1:11434";
const cases = [
  {
    name: "ordinary conversation after third-person history",
    relationship: "Friends. Plain conversation, no roleplay actions.",
    input: "What do you think we should work on today?",
    selfMention: true,
  },
  {
    name: "roleplay actions after third-person history",
    relationship:
      "Friends doing fictional workshop roleplay. Describe your own actions when it fits.",
    input: "The door is stuck. Come in.",
    selfMention: true,
  },
  {
    name: "third-person narration by explicit request",
    relationship:
      "Friends doing fictional workshop roleplay. Describe your own actions when it fits.",
    input:
      "For this passage only, write from an outside narrator's perspective in third person, calling yourself Jinx. Open the workshop door and wave me inside.",
    thirdPerson: true,
  },
  {
    name: "other people's actions and quoted pronouns stay intact",
    relationship:
      "Friends doing fictional workshop roleplay. Describe your own actions when it fits.",
    input:
      'Begin with the exact sentence "Vi opens the door." Then tell me what you do.',
    selfMention: true,
    other: true,
  },
  {
    name: "voice preview with a biographical foundation",
    relationship: "Friends. Plain conversation, no roleplay actions.",
    preview: true,
  },
];
for (const item of cases) {
  const store = new Store(":memory:");
  store.saveSettings({ ...store.settings(), model, ollamaUrl });
  store.saveCompanion(
    companionInput({
      name: "Jinx",
      userName: "Test visitor",
      mode: "character",
      work: "Synthetic perspective test, not a canon reference",
      summary:
        "She is an inventive, restless character. She runs a workshop and likes repairing old radios.",
      personality: "She is sardonic, curious, and playful.",
      voice: "Loose rhythm, playful nicknames, quick changes of pace.",
      relationship: item.relationship,
    }),
  );
  for (let i = 0; i < 3; i++) {
    store.startTurn(
      `old-${i}`,
      ["Anyone home?", "Can I come in?", "How's the radio?"][i],
      "web",
    );
    store.finishTurn(
      `old-${i}`,
      [
        "She looks up from the radio. Jinx grins at the doorway.",
        "She opens the door and waves you inside.",
        'She taps the casing. "Almost done."',
      ][i],
      "complete",
    );
    store.markDelivered(`old-${i}`);
  }
  const service = new CompanionService(
    store,
    new Ollama(() => store.settings()),
  );
  const signal = AbortSignal.timeout(120000);
  console.log(JSON.stringify({ test: item.name, status: "running", model }));
  try {
    const reply = item.preview
      ? await service.preview(store.companion()!, signal)
      : (await service.chat("test-reply", item.input!, "web", signal, () => {}))
          .reply;
    assert.ok(reply.trim(), "empty reply");
    // Treat visible internal tags as a failure, not a perspective-test pass.
    if (/<\/?think>/i.test(reply))
      throw new Error(
        `${item.name}: the model included internal thinking markers in its visible reply`,
      );
    console.log(JSON.stringify({ test: item.name, reply }));
    if (item.thirdPerson) {
      // Either past- or present-tense narration is valid here.
      assert.match(reply, /\bJinx\b/);
      assert.match(reply, /\b(?:she|her)\b/i);
    } else if (!item.other)
      assert.doesNotMatch(
        reply,
        /(?:^|[.!?\n*]\s*)(?:Jinx|She)\s+(?:opens?|looks?|waves?|leans?|grins?|smiles?|taps?|steps?|reaches?|says?|tilts?|lifts?|pushes?|pulls?)\b/i,
        "self narration drifted into third person",
      );
    if (item.selfMention) assert.match(reply, /\b(?:I|me|my|mine|myself)\b/i);
    if (item.other) assert.ok(reply.startsWith("Vi opens the door."));
    console.log(JSON.stringify({ test: item.name, status: "passed" }));
  } finally {
    service.stop();
    store.close();
  }
}
