// Synthetic browser coverage. No live provider or existing home is used.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createApp } from "../app/server/http.ts";
import { companionInput } from "../app/server/validation.ts";
import type { ModelProvider } from "../app/server/ollama.ts";
const dueAt = new Date(Date.now() + 3600000).toISOString();
const provider: ModelProvider = {
  supportsTools: true,
  async models() {
    return [{ name: "test-model", size: 0 }];
  },
  async research() {
    return [];
  },
  async search() {
    return [
      {
        id: "source-1",
        title: "A French dinner recipe",
        url: "https://example.com/dinner",
        excerpt: "Cook a vegetable tian.",
        fetchedAt: new Date().toISOString(),
      },
    ];
  },
  async chat(options) {
    if (options.messages.at(-1)?.role === "user" && options.tools) {
      const search = options.messages.at(-1)!.content.includes("Search");
      options.onToolCalls!([
        {
          function: {
            name: search ? "web_search" : "prepare_reminder",
            arguments: search
              ? { query: "French dinner" }
              : {
                  title: "Start the French dinner",
                  dueAt,
                  timeZone: "America/New_York",
                },
          },
        },
      ]);
      return "";
    }
    return "I’ve prepared that for you to review.";
  },
};
const directory = mkdtempSync(path.join(tmpdir(), "glashaus-actions-browser-"));
const app = createApp({
  directory,
  webRoot: path.resolve("dist/web"),
  provider,
  background: false,
});
app.store.saveCompanion(
  companionInput({
    name: "Maeve",
    userName: "Test visitor",
    mode: "grow",
    relationship: "Synthetic preview.",
  }),
);
app.store.saveSettings({
  ...app.store.settings(),
  model: "test-model",
  assistantToolsEnabled: true,
});
await new Promise<void>((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const address = app.server.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const shots = path.resolve(".impeccable/review/assistant-actions");
mkdirSync(shots, { recursive: true });
async function capture(name: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(shots, `${name}.png`),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `overflow in ${name}`,
  );
}
const nav = () =>
  page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: /^Reminders/ });
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await nav().click();
  await page.getByRole("heading", { name: "Nothing waiting." }).waitFor();
  await page.getByRole("button", { name: "New reminder", exact: true }).click();
  await page.getByLabel("Reminder", { exact: true }).fill("Check the oven");
  const localDate = new Date(Date.now() + 3600000);
  const local = new Date(
    localDate.getTime() - localDate.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Date and time").fill(local);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Confirm reminder" }).waitFor();
  assert.equal(app.service.reminders.list()[0].status, "draft");
  await capture("draft-desktop", 1440);
  await capture("draft-mobile", 390);
  await capture("draft-small", 320);
  await page.reload();
  await nav().click();
  await page.getByRole("button", { name: "Confirm reminder" }).click();
  await page.getByText("Scheduled", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Reminder", { exact: true })
    .fill("Check the oven again");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Confirm reminder" }).waitFor();
  assert.equal(app.service.reminders.list()[0].status, "draft");
  await page.getByRole("button", { name: "Cancel reminder" }).click();
  await page.getByRole("heading", { name: "Nothing waiting." }).waitFor();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("Please remind me about dinner.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Review & confirm reminder" }).click();
  await page.getByRole("button", { name: "Confirm reminder" }).click();
  await page.getByText("Scheduled", { exact: true }).waitFor();
  const scheduled = app.service.reminders
    .list()
    .find((r) => r.status === "scheduled")!;
  app.store.db
    .prepare("UPDATE reminders SET dueAt=? WHERE id=?")
    .run(new Date(Date.now() - 120000).toISOString(), scheduled.id);
  await app.service.tick();
  await page.reload();
  await nav().click();
  await page.getByText("Due", { exact: true }).waitFor();
  await capture("due-desktop", 1440);
  await capture("due-mobile", 390);
  await page.getByRole("button", { name: "Mark done" }).click();
  await page.getByRole("heading", { name: "Nothing waiting." }).waitFor();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message your companion" })
    .fill("Search for a French dish.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Sources (1)", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("link", { name: "A French dinner recipe" })
      .getAttribute("href"),
    "https://example.com/dinner",
  );
  await capture("sources-desktop", 1440);
  await capture("sources-mobile", 390);
  app.store.saveSettings({
    ...app.store.settings(),
    outreachEnabled: true,
    quietEnd: 9,
    quietStart: 21,
    maxOutreachPerDay: 2,
  });
  app.store.startTurn(
    "check-in-source",
    "I want to try a French vegetable dish this Friday.",
    "web",
  );
  app.store.finishTurn(
    "check-in-source",
    "We can find something simple.",
    "complete",
  );
  app.store.markDelivered("check-in-source");
  app.store.db
    .prepare("INSERT INTO check_ins VALUES (?,?,?,?,?,?,?,?)")
    .run(
      "checkin-browser",
      "check-in-source",
      "Still in the mood to pick a dish for Friday?",
      "You mentioned French cooking on Friday.",
      "I want to try a French vegetable dish this Friday.",
      "available",
      new Date().toISOString(),
      new Date(Date.now() + 86400_000).toISOString(),
    );
  await page.reload();
  const checkIn = page.getByRole("article", { name: "Check-in from Maeve" });
  await checkIn.getByText("Why this appeared", { exact: true }).click();
  await checkIn.getByText("You mentioned French cooking on Friday.").waitFor();
  await capture("check-in-desktop", 1440);
  await capture("check-in-mobile", 390);
  await checkIn
    .getByRole("button", { name: "Continue conversation", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Conversation", exact: true })
    .waitFor();
  assert.equal(app.service.checkIns.list()[0].status, "seen");
  await page
    .getByRole("button", { name: "Back to your space", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Allow personal check-ins").uncheck();
  await page
    .getByRole("button", { name: "Save check-in preferences", exact: true })
    .click();
  await page.getByText("Preferences saved.", { exact: true }).waitFor();
  assert.equal(app.store.settings().outreachEnabled, false);
  assert.equal(app.store.settings().maxOutreachPerDay, 2);
  await capture("check-in-settings-desktop", 1440);
  await capture("check-in-settings-mobile", 390);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: manual and conversational reminders, source links, check-in provenance/continuation, and pause preferences. No overflow at 320/390/1440px or browser errors. Synthetic provider.",
  );
} finally {
  await browser.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
