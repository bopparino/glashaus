import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../app/server/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.GLASHAUS_PORT ?? 7783);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Glashaus port.");
const response = await fetch(`http://127.0.0.1:${port}/api/export`, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error("Start Glashaus before creating a verified backup.");
const archive = await response.json();
const temporary = mkdtempSync(path.join(os.tmpdir(), "glashaus-restore-drill-"));
chmodSync(temporary, 0o700);
let store: Store | undefined;
try {
  store = new Store(temporary); const restored = store.importArchive(archive);
  const check = store.db.prepare("PRAGMA integrity_check").get();
  if (check?.integrity_check !== "ok") throw new Error("Restore integrity check failed; no backup marked verified.");
  const destination = path.resolve((process.argv[2] === "backup" ? process.argv[3] : process.argv[2]) ?? path.join(root, ".glashaus-backups"));
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const file = path.join(destination, "glashaus-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json");
  writeFileSync(file, JSON.stringify(archive), { flag: "wx", mode: 0o600 });
  console.log(`Verified backup saved: ${file}`);
  console.log(`Restore drill passed: ${restored.messages} messages, ${restored.memories} memories. Credentials are excluded; schedules pause on restore.`);
} finally { store?.close(); rmSync(temporary, { recursive: true, force: true }); }
