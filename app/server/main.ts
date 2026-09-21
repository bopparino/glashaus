import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createApp } from "./http.ts";
import http from "node:http";
import { readFileSync } from "node:fs";
import { Startup } from "./startup.ts";

const directory = path.resolve(
  process.env.GLASHAUS_HOME ?? path.join(os.homedir(), ".glashaus-v3"),
);
const port = Number(process.env.GLASHAUS_PORT ?? 7777);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("GLASHAUS_PORT must be a port between 1 and 65535.");
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(
  here,
  here.includes(`${path.sep}app${path.sep}`) ? "../../dist/web" : "../web",
);
// Own the listening port BEFORE opening SQLite or starting Telegram. A second
// process must never mark the first process's running work as interrupted.
const server = http.createServer();
const managed = process.env.GLASHAUS_MANAGED === "1";
const deadline = Date.now() + 60000;
while (true) {
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        server.removeListener("listening", ready);
        reject(error);
      };
      const ready = () => {
        server.removeListener("error", failed);
        resolve();
      };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen(port, "127.0.0.1");
    });
    break;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
      !managed ||
      Date.now() > deadline
    ) {
      console.error(
        `Could not open port ${port}. Another GlasHaus or app may already be running. Open http://127.0.0.1:${port} or stop the other copy first.`,
      );
      process.exit(1);
    }
    // If registration was rolled back while we waited, do not launch later.
    const registration = process.env.GLASHAUS_STARTUP_FILE;
    if (registration && !JSON.parse(readFileSync(registration, "utf8")).enabled)
      process.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
const startup = new Startup({ directory, port });
const app = createApp({
  directory,
  webRoot,
  server,
  startup,
  handoff: () => close(),
});
console.log(
  `\nGlasHaus v3 · http://127.0.0.1:${port}\nCompanion home: ${directory}\n${managed ? "Running in the background." : "Press Ctrl+C to stop."}\n`,
);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void app.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 15000).unref();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
