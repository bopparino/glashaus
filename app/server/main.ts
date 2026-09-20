import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createApp } from "./http.ts";

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
const app = createApp({ directory, webRoot });
app.server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Stop the other GlasHaus process or set GLASHAUS_PORT to another port.`
      : error.message,
  );
  process.exitCode = 1;
  app.service.stop();
  app.telegram.stop();
  app.store.close();
});
app.server.listen(port, "127.0.0.1", () => {
  console.log(
    `\nGlasHaus v3 · http://127.0.0.1:${port}\nCompanion home: ${directory}\nPress Ctrl+C to stop.\n`,
  );
});
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void app.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
