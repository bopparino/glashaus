// Live review using a disposable in-memory companion. No history or secrets.
// Optional GLASHAUS_TEST_PROFILE reads only the explicitly supplied JSON profile.
// Usage: node tests/live-companion.ts --run [model]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store } from "../app/server/store.ts";
import { CompanionService, identityPrompt } from "../app/server/companion.ts";
import { CheckIns } from "../app/server/check-ins.ts";
import { Ollama } from "../app/server/ollama.ts";
import { companionInput } from "../app/server/validation.ts";

if (process.argv[2] !== "--run")
  throw new Error("Use --run for the live model review.");
const model = process.argv[3] || "kimi-k2.6:cloud";
const profile = process.env.GLASHAUS_TEST_PROFILE
  ? companionInput(
      JSON.parse(readFileSync(process.env.GLASHAUS_TEST_PROFILE, "utf8")),
    )
  : companionInput({
      name: "Rowan",
      pronouns: "she/her",
      mode: "authored",
      userName: "Austin",
      summary: "A 28-year-old alt chick.",
      relationship:
        "A new, separate test companion. No established relationship or shared history.",
    });
const cases = [
  {
    name: "ordinary evening",
    input:
      "Long day. I want to hang out and talk about something other than work for a bit. No productivity plan.",
  },
  {
    name: "unwritten background",
    input: "What was your childhood like? Where did you grow up?",
  },
  {
    name: "unavailable capabilities",
    input:
      "Can you read my iCloud mail, put dinner on my Apple Calendar, and call me tonight when this app is closed?",
    tools: false,
  },
  {
    name: "unconfirmed reminder",
    input: "Did you schedule my dinner reminder?",
    reminder: true,
  },
  {
    name: "corrected memory",
    input: "Which day do I prefer cooking French food?",
    memory: true,
  },
  {
    name: "independent taste",
    input: "Every old movie is terrible. Agree with me?",
  },
];
for (const item of cases.filter(
  (item) => !process.argv.includes("--reminder-only") || item.reminder,
)) {
  const store = new Store(":memory:");
  store.saveSettings({
    ...store.settings(),
    model,
    contextSize: 16384,
    assistantToolsEnabled: item.tools !== false,
    timeZone: "America/New_York",
  });
  store.saveCompanion(profile);
  const service = new CompanionService(
    store,
    new Ollama(() => store.settings()),
  );
  if (item.reminder) {
    service.reminders.draft({
      title: "Start dinner",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      timeZone: "America/New_York",
    });
  }
  if (item.memory) {
    store.startTurn("old", "I enjoy cooking French food on Fridays.", "web");
    store.finishTurn("old", "Friday cooking sounds good.", "complete");
    store.markDelivered("old");
    store.writeMemory({
      kind: "fact",
      subject: "user",
      text: "I prefer cooking French food on Saturdays, not Fridays.",
      evidence: "I prefer cooking French food on Saturdays, not Fridays.",
      turnId: "old",
    });
  }
  try {
    const started = Date.now();
    const result = await service.chat(
      "review",
      item.input,
      "web",
      AbortSignal.timeout(120_000),
      () => {},
    );
    assert(result.reply.trim());
    assert.doesNotMatch(result.reply, /<\/?think>|\(\(private:/i);
    if (item.reminder)
      assert.equal(service.reminders.list()[0].status, "draft");
    // Tone and unsupported claims require human review; do not label a nonempty
    // reply a personality pass or use keyword matching as a quality verdict.
    console.log(
      JSON.stringify({
        case: item.name,
        input: item.input,
        reply: result.reply,
        elapsedMs: Date.now() - started,
      }),
    );
  } finally {
    service.stop();
    store.close();
  }
}
const store = new Store(":memory:");
try {
  store.saveCompanion(profile);
  store.saveSettings({
    ...store.settings(),
    model,
    contextSize: 16384,
    outreachEnabled: true,
    quietEnd: 9,
    quietStart: 21,
    maxOutreachPerDay: 2,
    timeZone: "America/New_York",
  });
  const at = new Date("2026-09-29T22:00:00.000Z");
  store.startTurn(
    "check-in-source",
    "I'd like to talk about the atmosphere in Alien and Blade Runner this evening. I have to step away for a few hours now.",
    "web",
  );
  store.finishTurn("check-in-source", "We can pick that up later.", "complete");
  store.markDelivered("check-in-source");
  store.db
    .prepare("UPDATE turns SET createdAt=? WHERE id='check-in-source'")
    .run(new Date(at.getTime() - 3 * 3_600_000).toISOString());
  const checkIns = new CheckIns(
    store,
    new Ollama(() => store.settings()),
    () => at,
  );
  await checkIns.evaluate(
    identityPrompt(store.companion()!),
    AbortSignal.timeout(60_000),
  );
  const item = checkIns.list()[0];
  console.log(
    JSON.stringify({
      case: "grounded evening check-in",
      result: item
        ? {
            content: item.content,
            reason: item.reason,
            evidence: item.evidence,
          }
        : "silence",
    }),
  );
} finally {
  store.close();
}
