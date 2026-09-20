import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createApp } from "../app/server/http.ts";
import type { ChatOptions, ModelProvider } from "../app/server/ollama.ts";

class BrowserModel implements ModelProvider {
  async models() {
    return [{ name: "test-model", size: 1000 }];
  }
  async research() {
    return [
      {
        id: "source-1",
        title: "Example public character source",
        url: "https://example.com/character",
        excerpt: "Mira is curious and speaks with a dry wit.",
        fetchedAt: new Date().toISOString(),
      },
    ];
  }
  async chat(options: ChatOptions) {
    const system = options.messages[0]?.content || "";
    const value = system.includes("Draft a character")
      ? JSON.stringify({
          summary: "A curious, candid companion.",
          personality: "Warm and curious.",
          voice: "Relaxed, with a dry wit.",
          backstory: "",
          values: "Honesty and curiosity",
          pronouns: "she/her",
          claims: [
            {
              text: "Has a dry wit.",
              sourceIds: ["source-1"],
              kind: "sourced",
            },
          ],
          uncertainties: [],
        })
      : system.includes("Extract at most")
        ? JSON.stringify({ memories: [], opinions: [] })
        : system.includes("journal entry")
          ? "There was something good about returning to an unfinished idea. I am curious what we will make of it."
          : "You came back to it. That counts for something.\n\nTell me which part you want to make real first.";
    for (const piece of value.match(/.{1,22}/gs) || []) {
      options.signal?.throwIfAborted();
      options.onToken?.(piece);
      await new Promise((r) => setTimeout(r, 8));
    }
    return value;
  }
}
const directory = mkdtempSync(path.join(tmpdir(), "glashaus-browser-"));
const app = createApp({
  directory,
  webRoot: path.resolve("dist/web"),
  provider: new BrowserModel(),
  background: false,
});
await new Promise<void>((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const address = app.server.address();
assert.ok(address && typeof address === "object");
const executable = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(executable) ? { executablePath: executable } : {}),
});
const page = await browser.newPage({
  viewport: { width: 1536, height: 1024 },
  reducedMotion: "reduce",
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const shots = ".impeccable/review/browser-regression";
mkdirSync(shots, { recursive: true });
async function capture(name: string, width = 1536, height = 1024) {
  await page.setViewportSize({ width, height });
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("img.scene")
    .evaluate((el) => (el as HTMLImageElement).decode());
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `horizontal overflow: ${name}`,
  );
}
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page
    .getByRole("heading", { name: "A beginning, not a template." })
    .waitFor();
  await capture("setup-desktop");
  await capture("setup-mobile", 390, 844);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByLabel("Conversation model").fill("test-model");
  await page.getByLabel("Ollama API key").fill("test-key-not-real");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByText("Settings saved.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Back to setup", exact: true })
    .click();
  await page.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await page.getByLabel("Their name", { exact: true }).fill("Mira");
  await page.getByLabel("Where are they from?").fill("Example novel");
  await page.getByLabel("Story scope").fill("Original novel only");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to setup", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Their name", { exact: true }).inputValue(),
    "Mira",
  );
  assert.equal(
    await page.getByLabel("Story scope").inputValue(),
    "Original novel only",
  );
  await capture("character-desktop", 1440, 1024);
  await capture("character-mobile", 390, 844);
  await page
    .getByRole("button", { name: "Absorb character", exact: true })
    .click();
  await page
    .getByText("Ready for your review. Make it feel right before you continue.")
    .waitFor();
  assert.equal(
    await page.getByLabel("Personality", { exact: true }).inputValue(),
    "Warm and curious.",
  );
  await page
    .getByRole("button", { name: "Set the relationship", exact: true })
    .click();
  await page.getByLabel("What should they call you?").fill("babe");
  await page
    .getByLabel("Your relationship", { exact: true })
    .fill("Close companions. Warm, curious, and honest with each other.");
  await page.getByRole("button", { name: "Meet Mira", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview their voice", exact: true })
    .click();
  await page
    .getByText("A preview only. This is not added to your conversation.")
    .waitFor();
  assert.equal(app.store.turns().length, 0);
  await page
    .getByRole("button", { name: "Make a home together", exact: true })
    .click();
  await page
    .getByRole("heading", { name: /Good (morning|afternoon|evening)\./ })
    .waitFor();
  app.store.writeMemory({
    kind: "fact",
    subject: "user",
    text: "You’re making space for this project.",
    evidence: "Example fixture for visual testing",
    turnId: null,
  });
  await page.reload();
  await page
    .getByRole("heading", { name: /Good (morning|afternoon|evening)\./ })
    .waitFor();
  await capture("user-1536");
  await capture("desktop", 1440, 960);
  await capture("mobile", 390, 844);
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("I want to revive my old companion project.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByText("Tell me which part you want to make real first.", {
      exact: false,
    })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Send message" }).waitFor();
  assert.equal(app.store.turns().length, 1);
  assert.equal(app.store.turns()[0].status, "complete");
  await capture("conversation-mobile", 390, 844);
  await capture("conversation-desktop", 1440, 1024);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Memory", exact: true })
    .click();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page
    .getByLabel("Something worth remembering")
    .fill("I enjoy quiet rainy mornings.");
  await page.getByRole("button", { name: "Keep this", exact: true }).click();
  await page
    .getByText("I enjoy quiet rainy mornings.", { exact: true })
    .waitFor();
  const memory = page
    .locator(".memory-item")
    .filter({ hasText: "I enjoy quiet rainy mornings." });
  await memory.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit memory").fill("I prefer quiet rainy evenings.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await page
    .getByText("I prefer quiet rainy evenings.", { exact: true })
    .waitFor();
  await capture("memory-desktop", 1440, 1024);
  await capture("memory-mobile", 390, 844);
  const edited = page
    .locator(".memory-item")
    .filter({ hasText: "I prefer quiet rainy evenings." });
  await edited.getByRole("button", { name: "Forget", exact: true }).click();
  await page
    .getByRole("button", { name: "Yes, forget it", exact: true })
    .click();
  await page
    .getByText("I prefer quiet rainy evenings.", { exact: true })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Journal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reflect on our conversations" })
    .click();
  await page
    .getByText(
      "There was something good about returning to an unfinished idea.",
      { exact: false },
    )
    .waitFor();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await capture("settings-mobile", 390, 844);
  await capture("settings-desktop", 1440, 1024);
  await page
    .getByRole("button", { name: "Edit identity", exact: true })
    .click();
  await page
    .getByLabel("Personality", { exact: true })
    .fill("An unsaved, thoughtful edit.");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to conversation", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Personality", { exact: true }).inputValue(),
    "An unsaved, thoughtful edit.",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: /Good (morning|afternoon|evening)\./ })
    .waitFor();
  assert.equal(app.store.turns().length, 1);
  assert.equal(app.store.memories().length, 1);
  assert.equal(app.store.reflections().length, 1);
  assert.equal(app.store.companion()?.name, "Mira");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: first-run settings → research → review → relationship → preview → save → streaming chat → memory add/edit/forget → journal → reload. Desktop and mobile captures have no horizontal overflow or browser errors. Provider is a deterministic test double, not live Ollama.",
  );
} finally {
  await browser.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
