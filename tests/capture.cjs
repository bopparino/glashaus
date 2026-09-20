const path = require("node:path");
const { mkdirSync } = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1536, height: 1024 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.CAPTURE_FIXTURE === "1")
    await page.route("**/api/state", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.companion = {
        name: "Mira",
        userName: "babe",
        relationship: "Close companions",
        mode: "authored",
      };
      data.memories = [{ text: "You’re making space for this project." }];
      await route.fulfill({ json: data });
    });
  await page.goto(process.env.CAPTURE_URL || "http://127.0.0.1:7777");
  await page.evaluate(() => document.fonts.ready);
  await page.locator("img.scene").evaluate((el) => el.decode());
  mkdirSync(".impeccable/review", { recursive: true });
  await page.screenshot({
    path: process.env.CAPTURE_PATH || ".impeccable/review/hero-repro.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      errors,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    }),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
