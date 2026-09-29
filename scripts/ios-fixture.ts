// Disposable simulator evidence only. Never opens the user's development home.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../app/server/http.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ChatOptions, ModelProvider } from "../app/server/ollama.ts";
class FixtureModel implements ModelProvider {
  async models() {
    return [];
  }
  async research() {
    return [];
  }
  async chat(options: ChatOptions) {
    const text =
      "I’m here. This reply shares the same conversation as your Mac.";
    const delay = options.messages.at(-1)?.content.includes("recovery check")
      ? 500
      : 60;
    for (const word of text.split(" ")) {
      options.signal.throwIfAborted();
      options.onToken?.(word + " ");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return text;
  }
}
const directory = mkdtempSync(path.join(tmpdir(), "glashaus-ios-fixture-"));
const app = createApp({
  directory,
  webRoot: path.resolve("dist/web"),
  provider: new FixtureModel(),
  mobile: true,
  background: false,
});
app.store.saveCompanion(
  companionInput({
    name: "Elle",
    userName: "Test visitor",
    mode: "authored",
    summary: "A corporate-goth AI companion. Synthetic interface fixture.",
    personality: "Dry humor, direct conversation, and a caring streak.",
    voice:
      "Unhurried and candid. Synthetic text fixture, not synthesized audio.",
    relationship: "Synthetic simulator evidence only.",
  }),
);
// Review-only synthetic proposal. No mail account or send transport is connected.
app.service.integrations.save({ id: "design-email", kind: "email", title: "Email to studio@example.test", payload: { from: "visitor@example.test", to: "studio@example.test", subject: "Friday dinner", body: "Would seven work for dinner on Friday? I’ll bring the ingredients." }, status: "draft", revision: 1, configRevision: 0, createdAt: new Date().toISOString(), result: "" });
app.store.startTurn(
  "design-dinner",
  "Remind me to start the French dinner on Friday at 7pm.",
  "web",
);
app.store.finishTurn(
  "design-dinner",
  "I have the time ready. Confirm it and I’ll keep track of it.",
  "complete",
);
app.service.reminders.draft(
  {
    title: "Start the French dinner",
    dueAt: new Date(Date.now() + 4 * 86400_000).toISOString(),
    timeZone: "America/New_York",
  },
  "design-dinner",
);
app.store.writeMemory({
  kind: "fact",
  subject: "user",
  text: "I enjoy French cooking on Fridays.",
  evidence: "Synthetic simulator fixture",
  turnId: "design-dinner",
});
app.service.checkIns.configure({
  enabled: true,
  quietEnd: 9,
  quietStart: 21,
  maxPerDay: 2,
});
app.store.db
  .prepare("INSERT INTO check_ins VALUES (?,?,?,?,?,?,?,?)")
  .run(
    "checkin-fixture",
    "design-dinner",
    "Still deciding what to cook? We could keep Friday simple and find one dish worth taking our time over.",
    "You mentioned cooking French food on Friday.",
    "Remind me to start the French dinner on Friday at 7pm.",
    "available",
    new Date().toISOString(),
    new Date(Date.now() + 86400_000).toISOString(),
  );
await new Promise<void>((resolve) =>
  app.server.listen(17983, "127.0.0.1", resolve),
);
const phoneHost =
  process.env.GLASHAUS_FIXTURE_NETWORK === "1" ? "0.0.0.0" : "127.0.0.1";
await app.mobile!.listen(17984, phoneHost);
console.log(
  `Disposable iOS fixture ready: admin 127.0.0.1:17983, authenticated phone API ${phoneHost}:17984. No provider or personal data is used.`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
