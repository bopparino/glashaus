import { existsSync, readFileSync, statfsSync } from "node:fs";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import type { CompanionService } from "./companion.ts";
import { integrationSettings } from "./integration-settings.ts";

export function diagnostics(service: CompanionService) {
  const store = service.store, settings = integrationSettings(store);
  const checks: { id: string; title: string; ok: boolean; detail: string }[] = [];
  const check = store.db.prepare("PRAGMA quick_check").get();
  checks.push({ id: "database", title: "Companion data", ok: check?.quick_check === "ok", detail: check?.quick_check === "ok" ? "Database integrity check passed." : "Database needs attention. Preserve your backups before recovery." });
  checks.push({ id: "model", title: "Conversation model", ok: !!store.settings().model, detail: store.settings().model ? "A conversation model is configured. A live reply checks its availability." : "Choose a model in Mac Settings." });
  if (store.directory !== ":memory:") {
    const free = statfsSync(store.directory); const bytes = free.bavail * free.bsize;
    checks.push({ id: "storage", title: "Mac storage", ok: bytes > 1_000_000_000, detail: `${(bytes / 1_000_000_000).toFixed(1)} GB available.` });
    const cert = path.join(store.directory, "mobile", "server-cert.pem");
    if (existsSync(cert)) { const identity = new X509Certificate(readFileSync(cert)); checks.push({ id: "certificate", title: "Phone certificate", ok: Date.parse(identity.validTo) > Date.now() + 7 * 86400_000, detail: `Valid until ${new Date(identity.validTo).toISOString().slice(0, 10)}. Phone connections check the exact paired certificate.` }); }
    const registration = path.join(store.directory, "startup", "registration.json");
    let startup: { enabled?: boolean; mobilePort?: number } = {};
    try { startup = JSON.parse(readFileSync(registration, "utf8")); } catch { /* Not configured. */ }
    checks.push({ id: "startup", title: "Start at sign-in", ok: startup.enabled === true && !!startup.mobilePort, detail: startup.enabled && startup.mobilePort ? "Background registration includes the phone connection." : "Enable background startup in Mac Settings. Phone access must be included." });
    checks.push({ id: "calendar", title: "Calendar", ok: settings.calendar.enabled, detail: settings.calendar.enabled ? `${settings.calendar.ids.length} selected calendars. Open Calendar to check access.` : "Connect Calendar in Settings." });
  }
  checks.push({ id: "voice", title: "Voice", ok: service.integrations.voice.status().ready, detail: service.integrations.voice.status().ready ? "Voice configured. Hear a sample in Voice settings to test it." : "Add a voice key and select a voice." });
  checks.push({ id: "mail", title: "iCloud Mail", ok: settings.mail.enabled, detail: settings.mail.enabled ? "Inbox access enabled. Test inbox in Mail settings." : "Connect iCloud Mail in Settings." });
  return { checkedAt: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()), checks };
}
