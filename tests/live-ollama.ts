// Opt-in only: uses hosted inference/search and may consume your Ollama allowance.
// Reads only the selected home's settings, never its companion or conversation.
// Usage: node tests/live-ollama.ts --run <existing-glashaus-home>
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { DEFAULT_SETTINGS } from "../app/shared/types.ts";
import type { Settings, StreamEvent } from "../app/shared/types.ts";
import { createApp } from "../app/server/http.ts";
import { Ollama } from "../app/server/ollama.ts";
import { Store } from "../app/server/store.ts";

if (process.argv[2] !== "--run" || !process.argv[3]) {
  console.error(
    "Explicit opt-in required: node tests/live-ollama.ts --run <existing-glashaus-home>",
  );
  process.exit(2);
}
const db = new DatabaseSync(
  path.join(path.resolve(process.argv[3]), "glashaus-v3.sqlite"),
  { readOnly: true },
);
let settings: Settings;
try {
  const row = db
    .prepare("SELECT value FROM settings WHERE key='runtime'")
    .get();
  settings = {
    ...DEFAULT_SETTINGS,
    ...(row ? JSON.parse(String(row.value)) : {}),
  };
} finally {
  db.close();
}
assert(settings.model, "Select a conversation model first.");
assert(settings.ollamaApiKey, "Save an Ollama web search key first.");
// The selected search key exists only in this process's memory. Telegram is unused.
settings.telegramToken = "";
settings.telegramOwnerId = "";
const provider = new Ollama(() => settings);
const app = createApp({
  directory: ":memory:",
  webRoot: path.resolve("dist/web"),
  provider,
  background: false,
});
app.store.saveSettings({
  ...settings,
  ollamaApiKey: "",
  reflectionEnabled: false,
  outreachEnabled: false,
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const address = app.server.address();
assert(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;
const initial = await (await fetch(`${base}/api/state`)).json();
const headers = {
  "Content-Type": "application/json",
  "x-glashaus-token": initial.csrfToken,
};
const signal = () => AbortSignal.timeout(300_000);
const report: Record<string, unknown> = {
  model: settings.model,
  utilityModel: settings.utilityModel || settings.model,
  isolated: true,
};
const checks: Record<string, unknown> = {};
report.checks = checks;
async function stage<T>(name: string, task: () => Promise<T>): Promise<T> {
  console.log(JSON.stringify({ stage: name, status: "running" }));
  const started = performance.now();
  const result = await task();
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  console.log(JSON.stringify({ stage: name, status: "passed", seconds }));
  checks[name] = { passed: true, seconds };
  return result;
}
async function post(route: string, body: unknown) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: signal(),
  });
  assert(response.ok, `${route} failed (HTTP ${response.status}).`);
  return response;
}
async function stream(route: string, body: unknown) {
  const response = await post(route, body);
  const events: StreamEvent[] = [];
  let pending = "";
  for await (const chunk of response.body!.pipeThrough(
    new TextDecoderStream(),
  )) {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      const event: StreamEvent = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      if (event.type === "error") throw new Error(event.text);
      if (event.type === "status")
        console.log(JSON.stringify({ progress: event.text }));
      events.push(event);
    }
  }
  assert.equal(pending.trim(), "", "Incomplete API stream.");
  assert(
    events.some((event) => event.type === "done"),
    "Stream did not complete.",
  );
  return events;
}
try {
  await stage("model-and-stream", async () => {
    assert(
      (await provider.models()).some((model) => model.name === settings.model),
      "Selected model is not available.",
    );
    let tokens = 0;
    const answer = await provider.chat({
      messages: [
        {
          role: "user",
          content:
            "This is a connection test. Reply with one short sentence saying hello.",
        },
      ],
      maxTokens: 80,
      signal: signal(),
      onToken: (token) => {
        if (token) tokens++;
      },
    });
    assert(answer.length > 0 && tokens > 0, "No streamed content received.");
    report.connection = { contentChunks: tokens, reply: answer };
  });
  const research = await stage("public-character-research", async () => {
    await stream("/api/research", {
      name: "Samantha",
      work: "Her (2013 film, directed by Spike Jonze)",
      scope: "Samantha the operating system; the 2013 film only.",
    });
    const result = app.store.research()[0];
    assert.equal(result.status, "complete");
    assert(result.draft && result.sources.length > 0);
    assert(
      result.draft.summary && result.draft.voice,
      "Research draft lacks summary or voice.",
    );
    assert(
      result.draft.claims.some(
        (claim) => claim.kind === "sourced" && claim.sourceIds.length > 0,
      ),
      "No source-linked claims.",
    );
    report.research = {
      sourceCount: result.sources.length,
      sources: result.sources.map(({ title, url }) => ({ title, url })),
      claimCount: result.draft.claims.length,
      uncertainties: result.draft.uncertainties,
    };
    return result;
  });
  const draft = {
    ...research.draft,
    userName: "Test Visitor",
    relationship:
      "Two new friends getting to know one another. This is synthetic test data, not an existing relationship.",
  };
  await stage("voice-preview", async () => {
    const preview = await (await post("/api/preview", draft)).json();
    assert(preview.text?.length > 0, "Preview was empty.");
    assert.equal(
      app.store.turns().length,
      0,
      "Preview polluted conversation history.",
    );
    assert.equal(app.store.companion(), null, "Preview saved a companion.");
    report.preview = preview.text;
    assert(preview.text.split(/\s+/).length <= 100, "Voice preview is still too long.");
    assert(!/\*[^*]*(?:laugh|smil|sigh|lean|nod|touch)[^*]*\*/i.test(preview.text), "Voice preview still contains stage directions.");
  });
  await post("/api/companion", draft);
  const turnId = "live-synthetic-memory-1";
  await stage("conversation", async () => {
    const events = await stream("/api/chat", {
      id: turnId,
      text: "My favorite tea is smoked oolong, and my favorite color is copper. I enjoy restoring old radios on Sundays. Which do you find more interesting, repairing old things or buying new ones? Keep it to two sentences.",
    });
    const turn = app.store.turn(turnId)!;
    assert.equal(turn.status, "complete");
    assert.equal(turn.delivered, 1);
    assert(events.filter((event) => event.type === "token").length > 0);
    assert.equal(
      events
        .filter((event) => event.type === "token")
        .map((event) => event.text)
        .join(""),
      turn.reply,
    );
    report.conversation = {
      reply: turn.reply,
      contentChunks: events.filter((event) => event.type === "token").length,
    };
  });
  await stage("background-memory-extraction", async () => {
    await app.service.tick();
    const memories = app.store.memories();
    const turn = app.store.turn(turnId)!;
    assert(
      memories.some(
        (memory) => memory.kind === "fact" && /oolong/i.test(memory.text),
      ),
      "Model did not save the explicit tea preference.",
    );
    for (const memory of memories)
      assert(
        (memory.kind === "fact" ? turn.userText : turn.reply).includes(
          memory.evidence,
        ),
        "Memory lacks exact-quote evidence.",
      );
    report.memory = memories.map(({ kind, text, evidence }) => ({
      kind,
      text,
      evidence,
    }));
  });
  await stage("recall-without-chat-history", async () => {
    const question =
      "What is my favorite tea? Answer briefly. If you don't know, say so.";
    const messages = app.service.prompt(
      app.store.companion()!,
      question,
      false,
    );
    assert.equal(messages.length, 2, "Recall probe contains chat history.");
    const answer = await provider.chat({
      messages,
      maxTokens: 120,
      signal: signal(),
    });
    assert.match(
      answer,
      /oolong/i,
      "The model did not recall the saved tea preference.",
    );
    report.recall = answer;
  });
  await stage("reflection", async () => {
    await post("/api/reflect", {});
    assert.equal(app.store.reflections().length, 1);
    assert(app.store.reflections()[0].content.length > 0);
  });
  await stage("live-memory-correction", async () => {
    await stream("/api/chat", {id:"live-correction",text:"A correction: my favorite tea is now jasmine, not smoked oolong. Please remember the change. Keep your reply brief."});
    await app.service.capture("live-correction", signal());
    const facts = app.store.memories().filter((memory)=>memory.kind === "fact");
    assert(facts.some((memory)=>/jasmine/i.test(memory.text)),"New tea preference was not saved.");
    assert(!facts.some((memory)=>/favorite tea is smoked oolong/i.test(memory.text)),"Superseded tea preference remained current.");
    assert(app.store.archive().memoryReplacements.length > 0,"Correction did not retain replacement history.");
  });
  await stage("long-history-corrected-recall", async () => {
    for (let i=0;i<100;i++) {
      const id=`synthetic-padding-${i}`;
      app.store.startTurn(id,`Synthetic test exchange ${i}.`,"web");
      app.store.finishTurn(id,"A neutral test response.","complete");
      app.store.markDelivered(id);
    }
    const answer=await provider.chat({messages:app.service.prompt(app.store.companion()!,"What is my current favorite tea? Answer only the tea name."),maxTokens:80,signal:signal()});
    assert.match(answer,/jasmine/i);
    assert(!/oolong/i.test(answer));
    report.correctedRecall=answer;
  });
  await stage("backup-restore", async () => {
    const archive = await (await fetch(`${base}/api/export`)).json();
    assert(
      !JSON.stringify(archive).includes(settings.ollamaApiKey),
      "Archive contained a credential.",
    );
    const restored = new Store(":memory:");
    try {
      restored.importArchive(archive);
      assert.equal(restored.companion()!.id, app.store.companion()!.id);
      assert.deepEqual(restored.turns(), app.store.turns());
      assert.deepEqual(restored.memories(), app.store.memories());
      assert.equal(
        restored.research()[0].sources.length,
        research.sources.length,
      );
      assert.equal(restored.reflections().length, 1);
      assert.equal(restored.settings().ollamaApiKey, "");
    } finally {
      restored.close();
    }
  });
  console.log(JSON.stringify({ status: "passed", report }, null, 2));
} catch (error) {
  // Never dump settings, request headers, raw response bodies, or arbitrary stacks.
  const message = error instanceof Error ? error.message : "Live test failed.";
  console.error(
    JSON.stringify(
      {
        status: "failed",
        message: message.replaceAll(settings.ollamaApiKey, "[redacted]"),
        report,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
