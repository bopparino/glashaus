import assert from "node:assert/strict";
import test from "node:test";
import { CompanionService } from "../app/server/companion.ts";
import { Store } from "../app/server/store.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ChatOptions, ModelProvider } from "../app/server/ollama.ts";

function fixture(
  draft: string,
  review: string | ((options: ChatOptions) => string) = "",
) {
  const store = new Store(":memory:");
  store.saveCompanion(
    companionInput({
      name: "Elle",
      userName: "Test visitor",
      mode: "authored",
      relationship: "Friends enjoying first-person fictional roleplay.",
    }),
  );
  const calls: ChatOptions[] = [];
  const visible: string[] = [];
  const provider: ModelProvider = {
    models: async () => [],
    research: async () => [],
    async chat(options) {
      calls.push(options);
      if (options.utility)
        return typeof review === "function" ? review(options) : review;
      for (const token of draft) options.onToken?.(token);
      return draft;
    },
  };
  const service = new CompanionService(store, provider);
  const controller = new AbortController();
  const send = (
    request = "Is there room for me?",
    channel: "web" | "telegram" = "web",
  ) =>
    service.chat("test", request, channel, controller.signal, (e) => {
      if (e.type === "token") visible.push(e.text!);
    });
  return {
    store,
    calls,
    visible,
    service,
    controller,
    send,
    close() {
      service.stop();
      store.close();
    },
  };
}

test("ordinary direct speech streams without an extra model call", async () => {
  const reply =
    "I saved you a seat. Tell me what you have been thinking about today.";
  const f = fixture(reply);
  try {
    const turn = await f.send();
    assert.equal(f.calls.length, 1);
    assert.ok(
      f.visible.length > 1,
      "ordinary replies still stream incrementally",
    );
    assert.equal(f.visible.join(""), reply);
    assert.equal(turn.reply, reply);
  } finally {
    f.close();
  }
});

test("identity preview uses the same review without adding a conversation or memory job", async () => {
  const f = fixture(
    'Elle waves. "Hello."',
    JSON.stringify({
      decision: "edit",
      reason: "drift",
      text: "I wave. Hello.",
    }),
  );
  try {
    assert.equal(
      await f.service.preview(f.store.companion()!, f.controller.signal),
      "I wave. Hello.",
    );
    assert.equal(f.store.turns().length, 0);
    assert.equal(f.store.nextJob(), null);
  } finally {
    f.close();
  }
});

for (const channel of ["web", "telegram"] as const) {
  test(`${channel}: narration split into single-character tokens is repaired before display and persistence`, async () => {
    const draft =
      'Elle moves the book aside. "Come sit with me. I want to hear about your day."';
    const corrected =
      "I move the book aside. Come sit with me. I want to hear about your day.";
    const f = fixture(draft, (options) => {
      assert.equal(
        f.visible.join(""),
        "",
        "the draft must not leak during generation",
      );
      assert.ok(options.json && options.utility);
      return JSON.stringify({
        decision: "edit",
        reason: "drift",
        text: corrected,
      });
    });
    try {
      const result = await f.send(undefined, channel);
      assert.equal(f.calls.length, 2);
      assert.equal(f.visible.join(""), corrected);
      assert.equal(f.store.turn("test")?.reply, corrected);
      assert.equal(result.status, "complete");
      assert.equal(result.delivered, channel === "web" ? 1 : 0);
      await f.send(undefined, channel);
      assert.equal(
        f.calls.length,
        2,
        "request retries reuse the approved reply",
      );
    } finally {
      f.close();
    }
  });
}

test("late drift preserves the already streamed prefix exactly", async () => {
  const draft =
    'I saved you a seat. She moves the book aside. "Come sit with me. Tell me about today."';
  const f = fixture(draft, (options) => {
    const data = JSON.parse(options.messages[1].content);
    assert.equal(data.prefix, "I saved you a seat.");
    assert.equal(f.visible.join(""), data.prefix);
    return JSON.stringify({
      decision: "edit",
      reason: "drift",
      text: "I move the book aside. Come sit with me. Tell me about today.",
    });
  });
  try {
    const result = await f.send();
    assert.equal(
      result.reply,
      "I saved you a seat. I move the book aside. Come sit with me. Tell me about today.",
    );
    assert.equal(f.visible.join(""), result.reply);
  } finally {
    f.close();
  }
});

for (const [reply, reason, request] of [
  [
    'Vi opens the door. She says, "You made it." I wave you inside.',
    "third-party",
    "Tell me what Vi does.",
  ],
  [
    '"To be, or not to be" is the line you are thinking of.',
    "quotation",
    "Quote the opening of Hamlet's soliloquy.",
  ],
  [
    'No, the guide says otherwise. "No appointment required" is the wording it uses.',
    "quotation",
    "Does the guide say I need an appointment?",
  ],
  [
    'Elle opens the door. "Hello," she says.',
    "requested-narration",
    "Write this scene from an outside narrator's perspective.",
  ],
] as const) {
  test(`context review preserves ${reason}`, async () => {
    const f = fixture(
      reply,
      JSON.stringify({
        decision: "keep",
        reason,
        text: "this field must not replace the draft",
      }),
    );
    try {
      const result = await f.send(request);
      assert.equal(result.reply, reply);
      assert.equal(f.visible.join(""), reply);
    } finally {
      f.close();
    }
  });
}

for (const response of [
  "{}",
  '{"decision":"keep","reason":"drift"}',
  '{"decision":"edit","reason":"quotation","text":"A cited phrase must not be rewritten."}',
  '{"decision":"edit","reason":"drift","text":""}',
  '{"decision":"edit","reason":"drift","text":"<think>hidden</think>hello"}',
]) {
  test(`invalid review never saves or displays an unreviewed draft: ${response}`, async () => {
    const f = fixture('Elle smiles. "Hello there."', response);
    try {
      await assert.rejects(f.send(), /voice check/);
      assert.equal(f.visible.join(""), "");
      assert.equal(f.store.turn("test")?.reply, "");
      assert.equal(f.store.turn("test")?.status, "failed");
      assert.equal(f.store.turn("test")?.delivered, 0);
      assert.equal(f.store.nextJob(), null);
    } finally {
      f.close();
    }
  });
}

test("stop during review prevents the corrected reply being delivered or remembered", async () => {
  const f = fixture('Elle smiles. "Hello there."', () => {
    f.controller.abort(new Error("stopped"));
    return JSON.stringify({
      decision: "edit",
      reason: "drift",
      text: "I smile. Hello there.",
    });
  });
  try {
    await assert.rejects(f.send(), /stopped/);
    assert.equal(f.visible.join(""), "");
    assert.equal(f.store.turn("test")?.status, "interrupted");
    assert.equal(f.store.turn("test")?.delivered, 0);
  } finally {
    f.close();
  }
});
