// Explicit live-provider smoke test. Only synthetic conversation is submitted.
// OLLAMA_API_KEY is optional; without it the search case is reported as skipped.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { Store } from "../app/server/store.ts";
import { CompanionService } from "../app/server/companion.ts";
import { Ollama } from "../app/server/ollama.ts";
import { companionInput } from "../app/server/validation.ts";
const store = new Store(":memory:");
let searchKey = process.env.OLLAMA_API_KEY || "";
if (!searchKey && process.env.GLASHAUS_TEST_SETTINGS_HOME) {
  // Read only the explicitly selected home's settings; opening it as a Store
  // would run recovery logic and could disrupt a concurrently running app.
  const saved = new DatabaseSync(
    path.join(process.env.GLASHAUS_TEST_SETTINGS_HOME, "glashaus-v3.sqlite"),
    { readOnly: true },
  );
  try {
    const row = saved
      .prepare("SELECT value FROM settings WHERE key='runtime'")
      .get();
    searchKey = row ? JSON.parse(String(row.value)).ollamaApiKey || "" : "";
  } finally {
    saved.close();
  }
}
store.saveSettings({
  ...store.settings(),
  model: process.env.GLASHAUS_TEST_MODEL || "kimi-k2.6:cloud",
  assistantToolsEnabled: true,
  timeZone: "America/New_York",
  ollamaApiKey: searchKey,
});
store.saveCompanion(
  companionInput({
    name: "Maeve",
    mode: "grow",
    userName: "Test visitor",
    relationship: "Synthetic development test. Be warm, direct, and candid.",
  }),
);
const service = new CompanionService(store, new Ollama(() => store.settings()));
try {
  if (!process.argv.includes("--search-only")) {
    const dueAt = new Date(Date.now() + 2 * 3600000)
      .toISOString()
      .replace(/:\d\d\.\d{3}Z$/, ":00.000Z");
    const turn = await service.chat(
      "live-reminder",
      `Please remind me to start the French dinner at exactly ${dueAt}. My time zone is America/New_York. This is a one-time reminder.`,
      "web",
      AbortSignal.timeout(120000),
      () => {},
    );
    const draft = service.reminders.list()[0];
    assert(draft, "The model must prepare an actual draft");
    assert.equal(draft.status, "draft");
    assert.equal(draft.dueAt, dueAt);
    assert.equal(service.reminders.dispatchDue(), 0);
    assert.match(turn.reply, /confirm|review|approval|approve/i);
    console.log(
      "PASS: live Kimi created one accurate draft and requested confirmation.",
    );
    service.reminders.update(draft.id, {
      action: "confirm",
      revision: draft.revision,
    });
    store.db
      .prepare("UPDATE reminders SET dueAt=? WHERE id=?")
      .run(new Date(Date.now() - 1000).toISOString(), draft.id);
    await service.tick();
    assert.equal(service.reminders.get(draft.id).status, "due");
    console.log("PASS: explicit confirmation enabled in-app due processing.");
    const before = service.reminders.list().length;
    const ambiguous = await service.chat(
      "live-ambiguous",
      "Remind me to buy ingredients sometime next week.",
      "web",
      AbortSignal.timeout(120000),
      () => {},
    );
    assert.equal(
      service.reminders.list().length,
      before,
      "Ambiguous request must not choose a time",
    );
    assert.match(ambiguous.reply, /when|time|day|date/i);
    console.log("PASS: live Kimi asked for a clearer reminder time.");
  }
  if (store.settings().ollamaApiKey) {
    const search = await service.chat(
      "live-search",
      "Search the web for a French dish I can cook on Friday. Give one idea with its source.",
      "web",
      AbortSignal.timeout(120000),
      () => {},
    );
    assert(
      search.sources?.length,
      "Live web search must produce saved source receipts",
    );
    assert(
      search.sources.some(
        (source) =>
          search.reply.includes(source.url.replace(/\/$/, "")) ||
          (source.title.length > 5 && search.reply.includes(source.title)),
      ),
      "The final reply should cite an actual retrieved source",
    );
    console.log(
      `PASS: live search returned ${search.sources.length} saved sources.`,
    );
    console.log("Live synthetic dinner reply:", search.reply);
  } else
    console.log(
      "SKIP: live search needs an Ollama API key. HTTP adapter behavior is covered by fixtures.",
    );
} finally {
  service.stop();
  store.close();
}
