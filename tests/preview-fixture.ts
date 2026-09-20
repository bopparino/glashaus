// Explicitly synthetic UI fixture. No real settings, credentials, or messages.
import path from "node:path";
import { createApp } from "../app/server/http.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ModelProvider } from "../app/server/ollama.ts";
const provider: ModelProvider = {
  async models() {
    return [{ name: "demo-model", size: 0 }];
  },
  async research() {
    return [];
  },
  async chat(options) {
    const system = options.messages[0]?.content || "";
    const reply = system.includes("Extract at most")
      ? '{"memories":[],"opinions":[]}'
      : "There’s room for that here. Tell me the part you keep coming back to.";
    for (const chunk of reply.match(/.{1,10}/gs) || []) {
      options.signal?.throwIfAborted();
      options.onToken?.(chunk);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return reply;
  },
};
for (const [port, seed] of [
  [7781, true],
  [7782, false],
] as const) {
  const app = createApp({
    directory: ":memory:",
    webRoot: path.resolve("dist/web"),
    provider,
    background: false,
  });
  app.store.saveSettings({ ...app.store.settings(), model: "demo-model" });
  if (seed) {
    app.store.saveCompanion(
      companionInput({
        name: "Mira",
        userName: "Demo visitor",
        mode: "grow",
        relationship: "Friends. Synthetic design preview.",
        voice: "Warm, direct and curious.",
      }),
    );
    app.store.startTurn("demo-1", "I’ve got a lot on my mind tonight.", "web");
    app.store.finishTurn(
      "demo-1",
      "I’m here.\n\nWant to talk it through, make a plan, or just vibe for a bit?",
      "complete",
    );
    app.store.startTurn("demo-2", "Let’s just vibe for now.", "web");
    app.store.finishTurn(
      "demo-2",
      "Perfect.\n\nNo agenda tonight.",
      "complete",
    );
  }
  app.server.listen(port, "127.0.0.1", () =>
    console.log(`Synthetic preview http://127.0.0.1:${port}`),
  );
  process.on("SIGINT", () => void app.close());
}
