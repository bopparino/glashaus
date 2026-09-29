import type { Store } from "./store.ts";
import { AppError, record, text } from "./validation.ts";

export interface ConnectorConfig { id: string; name: string; url: string; token: string; tools: string[]; readTools: string[]; revision: number }
export interface IntegrationSettings {
  voice: { apiKey: string; voiceId: string; model: string; monthlyCharacters: number };
  mail: { address: string; password: string; enabled: boolean };
  calendar: { ids: string[]; enabled: boolean };
  connectors: ConnectorConfig[];
  revision: number;
}
export function integrationSettings(store: Store): IntegrationSettings {
  const row = store.db.prepare("SELECT value FROM settings WHERE key='integrations'").get();
  return row ? JSON.parse(String(row.value)) : {
    voice: { apiKey: "", voiceId: "", model: "eleven_flash_v2_5", monthlyCharacters: 100_000 },
    mail: { address: "", password: "", enabled: false },
    calendar: { ids: [], enabled: false }, connectors: [], revision: 1,
  };
}
export function publicIntegrations(store: Store) {
  const s = integrationSettings(store);
  return { ...s, voice: { ...s.voice, apiKey: undefined, hasKey: !!s.voice.apiKey }, mail: { ...s.mail, password: undefined, hasPassword: !!s.mail.password }, connectors: s.connectors.map(({ token, ...c }) => ({ ...c, hasToken: !!token })) };
}
export function saveIntegrations(store: Store, value: unknown) {
  const input = record(value), old = integrationSettings(store);
  if (input.revision !== old.revision) throw new AppError("Connection settings changed. Refresh before saving.", 409);
  const next = structuredClone(old);
  if (input.voice) {
    const v = record(input.voice);
    if (v.apiKey !== undefined) next.voice.apiKey = text(v.apiKey, "Voice key", 500);
    if (v.voiceId !== undefined) next.voice.voiceId = text(v.voiceId, "Voice", 100);
    if (next.voice.voiceId && !/^[A-Za-z0-9_-]+$/.test(next.voice.voiceId)) throw new AppError("Choose a valid voice ID.");
    if (v.model !== undefined) {
      if (!["eleven_flash_v2_5", "eleven_multilingual_v2"].includes(String(v.model))) throw new AppError("Choose Flash or Multilingual voice.");
      next.voice.model = String(v.model);
    }
    if (v.monthlyCharacters !== undefined) {
      if (!Number.isInteger(v.monthlyCharacters) || Number(v.monthlyCharacters) < 100 || Number(v.monthlyCharacters) > 100_000) throw new AppError("The voice limit must be 100–100,000 characters per month.");
      next.voice.monthlyCharacters = Number(v.monthlyCharacters);
    }
  }
  if (input.mail) {
    const m = record(input.mail);
    if (m.address !== undefined) next.mail.address = email(m.address);
    if (m.password !== undefined) next.mail.password = text(m.password, "App-specific password", 200);
    if (typeof m.enabled === "boolean") next.mail.enabled = m.enabled;
    if (next.mail.enabled && (!next.mail.address || !next.mail.password)) throw new AppError("Enter your iCloud address and an app-specific password first.");
  }
  if (input.calendar) {
    const c = record(input.calendar);
    if (!Array.isArray(c.ids) || c.ids.length > 50) throw new AppError("Select up to 50 calendars.");
    next.calendar = { ids: c.ids.map((id) => text(id, "Calendar", 300, true)), enabled: c.enabled === true };
    if (next.calendar.enabled && !next.calendar.ids.length) throw new AppError("Select a calendar first.");
  }
  if (input.connectors !== undefined) {
    if (!Array.isArray(input.connectors) || input.connectors.length > 10) throw new AppError("Connect up to ten tool servers.");
    next.connectors = input.connectors.map((raw) => {
      const c = record(raw), id = text(c.id, "Connector ID", 80, true);
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new AppError("Use letters, digits, hyphens or underscores for a connector ID.");
      const url = new URL(text(c.url, "Server URL", 1000, true));
      if (url.username || url.password || url.hash || url.search || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new AppError("Use HTTPS, or HTTP for a server on this Mac. Enter access tokens separately.");
      const prior = old.connectors.find((v) => v.id === id);
      if (!Array.isArray(c.tools) || !Array.isArray(c.readTools) || c.tools.length > 100) throw new AppError("Select the tools this connector may use.");
      const toolNames = c.tools.map((v) => text(v, "Tool name", 150, true));
      const readTools = c.readTools.map((v) => text(v, "Read tool", 150, true));
      if (readTools.some((v) => !toolNames.includes(v))) throw new AppError("Read access must belong to a selected tool.");
      return { id, name: text(c.name, "Connector name", 100, true), url: url.href, token: c.token === undefined ? prior?.token ?? "" : text(c.token, "Access token", 2000), tools: toolNames, readTools, revision: (prior?.revision ?? 0) + 1 };
    });
    if (new Set(next.connectors.map((c) => c.id)).size !== next.connectors.length) throw new AppError("Connector IDs must be unique.");
  }
  next.revision++;
  store.db.prepare("INSERT INTO settings VALUES ('integrations',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
  return publicIntegrations(store);
}
export function email(value: unknown) {
  const address = text(value, "Email address", 254, true);
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) throw new AppError("Enter one complete email address.");
  return address;
}
