import assert from "node:assert/strict";
import test from "node:test";
import {
  CompanionService,
  cleanReply,
  identityPrompt,
} from "../app/server/companion.ts";
import { Store } from "../app/server/store.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ChatOptions, ModelProvider } from "../app/server/ollama.ts";

function fixture(
  mode: "character" | "authored" | "grow" = "character",
  relationship = "Friends who enjoy fictional workshop roleplay.",
) {
  const store = new Store(":memory:");
  store.saveCompanion(
    companionInput({
      name: "Jinx",
      userName: "Test visitor",
      mode,
      work: "Synthetic fixture, not a canon reference",
      relationship,
      summary:
        "She is an inventive, restless character. She opens the workshop door when visitors arrive.",
      personality: "She is curious and sardonic.",
      voice: "Loose rhythm, playful nicknames, quick changes of pace.",
    }),
  );
  const calls: ChatOptions[] = [];
  const provider: ModelProvider = {
    async models() {
      return [];
    },
    async research() {
      return [];
    },
    async chat(options) {
      calls.push(options);
      const reply =
        'Vi opens the door. "She made it," I say. I wave you inside.';
      options.onToken?.(reply);
      return reply;
    },
  };
  return { store, calls, service: new CompanionService(store, provider) };
}
const signal = () => new AbortController().signal;
function checkPerspective(system: string) {
  assert.match(system, /Default to first person for yourself: I, me, my/);
  assert.match(system, /own actions in first person too/);
  assert.match(system, /biography wording is not your response style/);
  assert.match(
    system,
    /Older replies in third person do not change this default/,
  );
  assert.match(
    system,
    /only when the user or authored relationship explicitly requests it/,
  );
  assert.match(system, /other people in third person and preserve quotations/);
}
for (const mode of ["character", "authored", "grow"] as const) {
  test(`${mode} identity defaults to first person without rewriting the foundation`, () => {
    const f = fixture(mode);
    try {
      const before = f.store.companion()!;
      const prompt = identityPrompt(before);
      checkPerspective(prompt);
      assert.ok(
        prompt.indexOf("PERSPECTIVE:") > prompt.indexOf("RELATIONSHIP ("),
      );
      assert.ok(prompt.includes(before.voice));
      assert.deepEqual(f.store.companion(), before);
    } finally {
      f.store.close();
    }
  });
}
test("web and Telegram receive the same perspective rules despite older third-person replies", async () => {
  const f = fixture();
  try {
    const older = "She opens the door. Jinx waves you inside.";
    f.store.startTurn("older", "Anyone home?", "web");
    f.store.finishTurn("older", older, "complete");
    f.store.markDelivered("older");
    for (const channel of ["web", "telegram"] as const) {
      const result = await f.service.chat(
        `new-${channel}`,
        "The door is stuck. Come in.",
        channel,
        signal(),
        () => {},
      );
      checkPerspective(f.calls.at(-1)!.messages[0].content);
      assert.ok(
        f.calls
          .at(-1)!
          .messages.some((m) => m.role === "assistant" && m.content === older),
      );
      assert.equal(
        result.reply,
        'Vi opens the door. "She made it," I say. I wave you inside.',
      );
    }
    assert.equal(
      f.store.turn("older")!.reply,
      older,
      "old conversation is not rewritten",
    );
  } finally {
    f.service.stop();
    f.store.close();
  }
});
test("previews and journal reflections also receive the first-person default", async () => {
  const f = fixture();
  try {
    await f.service.preview(f.store.companion()!, signal());
    checkPerspective(f.calls[0].messages[0].content);
    assert.equal(f.store.turns().length, 0, "preview stays out of history");
    f.store.startTurn("journal-source", "Let's repair the radio.", "web");
    f.store.finishTurn("journal-source", "She picks up the radio.", "complete");
    f.store.markDelivered("journal-source");
    await f.service.reflect(signal());
    checkPerspective(f.calls.at(-1)!.messages[0].content);
  } finally {
    f.service.stop();
    f.store.close();
  }
});
test("explicit narration requests survive unchanged, without enabling actions in ordinary chat", () => {
  const f = fixture(
    "character",
    "Friends. Plain conversation, no roleplay actions.",
  );
  try {
    const request =
      "For this fictional passage, use an outside narrator in third person.";
    const messages = f.service.prompt(f.store.companion()!, request);
    checkPerspective(messages[0].content);
    assert.equal(messages.at(-1)!.content, request);
    assert.match(
      messages[0].content,
      /Roleplay actions are allowed only when the authored relationship explicitly requests them/,
    );
    assert.match(messages[0].content, /only for that requested narration/);
    const quotation = 'Vi says, "She opens the door." I wait outside.';
    assert.equal(
      cleanReply(quotation),
      quotation,
      "no blind pronoun replacement",
    );
  } finally {
    f.store.close();
  }
});
