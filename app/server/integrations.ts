import { createHash, randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import { AppError, record, text } from "./validation.ts";
import { integrationSettings, publicIntegrations, saveIntegrations } from "./integration-settings.ts";
import { Mail, mailDraft } from "./mail.ts";
import { Calendar, calendarDraft } from "./calendar.ts";
import { Connectors } from "./connectors.ts";
import { Voice } from "./voice.ts";

export interface ReviewedAction {
  id: string; kind: "email" | "calendar" | "connector"; title: string; payload: Record<string, unknown>;
  status: "draft" | "executing" | "complete" | "cancelled" | "unknown";
  revision: number; configRevision: number; createdAt: string; result: string;
}
export class Integrations {
  store: Store; mail: Mail; calendar: Calendar; connectors: Connectors; voice: Voice;
  constructor(store: Store) {
    this.store = store; this.mail = new Mail(store); this.calendar = new Calendar(store); this.connectors = new Connectors(store); this.voice = new Voice(store);
  }
  settings() { return publicIntegrations(this.store); }
  configure(value: unknown) { return saveIntegrations(this.store, value); }
  actions(): ReviewedAction[] {
    return this.store.db.prepare("SELECT data FROM integration_actions ORDER BY createdAt DESC LIMIT 100").all().map((r) => JSON.parse(String(r.data)));
  }
  get(id: string): ReviewedAction {
    const r = this.store.db.prepare("SELECT data FROM integration_actions WHERE id=?").get(id);
    if (!r) throw new AppError("This proposal no longer exists.", 404);
    return JSON.parse(String(r.data));
  }
  save(action: ReviewedAction) {
    this.store.db.prepare("INSERT INTO integration_actions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(action.id, JSON.stringify(action), action.createdAt);
  }
  async prepare(value: unknown, signal: AbortSignal, turnId?: string) {
    const input = record(value), revision = integrationSettings(this.store).revision;
    const details = input.kind === "calendar" ? await this.calendar.preview(input.payload, signal) : undefined;
    signal.throwIfAborted();
    if (integrationSettings(this.store).revision !== revision) throw new AppError("Connection settings changed. Prepare the proposal again.", 409);
    const action = this.draft(input, turnId);
    if (action.status === "draft" && details && !action.payload.checkedAt) {
      // Calendar names, the before-state, and conflicts come from EventKit,
      // never from model-written labels in a confirmation screen.
      action.payload = { ...action.payload, ...details };
      if (action.payload.operation === "delete") {
        const current = record(details.currentEvent);
        for (const key of ["title", "start", "end", "location", "notes"]) action.payload[key] = current[key];
      }
      this.save(action);
    }
    return action;
  }
  draft(value: unknown, turnId?: string) {
    const input = record(value), config = integrationSettings(this.store);
    let payload: Record<string, unknown>, title: string;
    const kind = input.kind;
    if (kind === "email") {
      if (!config.mail.enabled) throw new AppError("Connect iCloud Mail first.");
      payload = { ...mailDraft(input.payload), from: config.mail.address }; title = `Email to ${payload.to}`;
    } else if (kind === "calendar") {
      payload = calendarDraft(input.payload);
      if (!config.calendar.enabled || !config.calendar.ids.includes(String(payload.calendarId))) throw new AppError("Select this calendar in Connections first.");
      title = `${payload.operation === "delete" ? "Delete" : payload.operation === "update" ? "Update" : "Create"} calendar event`;
    } else if (kind === "connector") {
      const p = record(input.payload), connectorId = text(p.connectorId, "Connector", 80, true), name = text(p.name, "Tool", 150, true), args = record(p.arguments);
      const connector = this.connectors.config(connectorId);
      if (!connector.tools.includes(name)) throw new AppError("Select this tool in Connections first.");
      payload = { connectorId, name, arguments: args }; title = `${connector.name}: ${name}`;
    } else throw new AppError("Choose email, calendar, or connector.");
    if (JSON.stringify(payload).length > 24_000) throw new AppError("This proposal is too large.");
    // Conversation retries return the original immutable proposal/receipt.
    const id = turnId ? createHash("sha256").update(turnId + ":" + kind + ":" + JSON.stringify(payload)).digest("hex") : randomUUID();
    const prior = this.store.db.prepare("SELECT id FROM integration_actions WHERE id=?").get(id);
    if (prior) return this.get(id);
    const action: ReviewedAction = { id, kind, title, payload, status: "draft", revision: 1, configRevision: config.revision, createdAt: new Date().toISOString(), result: "" };
    this.save(action); return action;
  }
  async update(id: string, value: unknown, signal: AbortSignal) {
    const input = record(value);
    const action = this.store.transaction(() => {
      const action = this.get(id);
      if (action.revision !== input.revision || action.status !== "draft") throw new AppError("This proposal changed or was already handled. Refresh before reviewing.", 409);
      if (input.action === "cancel") { action.status = "cancelled"; action.revision++; this.save(action); return action; }
      if (input.action !== "confirm") throw new AppError("Choose confirm or cancel.");
      if (action.configRevision !== integrationSettings(this.store).revision) throw new AppError("Connection settings changed. Cancel this draft and prepare a fresh one before approving it.", 409);
      if (Date.now() - Date.parse(action.createdAt) > 86400_000) throw new AppError("This proposal is over a day old. Prepare a fresh draft so you can review current details.", 409);
      signal.throwIfAborted();
      action.status = "executing"; action.revision++; this.save(action); return action;
    });
    if (action.status === "cancelled") return action;
    try {
      let result: unknown;
      if (action.kind === "email") result = await this.mail.send(action.payload, action.id);
      else if (action.kind === "calendar") result = await this.calendar.write(action.payload, action.id, signal);
      else result = await this.connectors.call(String(action.payload.connectorId), String(action.payload.name), record(action.payload.arguments), signal);
      action.status = "complete"; action.result = JSON.stringify(result).slice(0, 30_000);
    } catch {
      // The remote side may have committed even if its response was lost.
      // Never offer a blind retry of a mail send or other external write.
      action.status = "unknown"; action.result = "Could not verify the outcome. Check the destination before creating another proposal; this action will not be retried automatically.";
    }
    action.revision++;
    // Data reset may revoke the phone while the destination is responding.
    // Do not resurrect a deleted proposal after a purge.
    if (this.store.db.prepare("SELECT id FROM integration_actions WHERE id=?").get(id)) this.save(action);
    return action;
  }
  async route(method: string, path: string, body: unknown, signal: AbortSignal): Promise<{ value: unknown; audio?: boolean } | undefined> {
    if (method === "GET" && path === "/integrations") return { value: this.settings() };
    if (method === "POST" && path === "/calendar/settings") return { value: await this.calendar.bridge({ command: "settings" }, signal) };
    if (method === "PATCH" && path === "/integrations") return { value: this.configure(body) };
    if (method === "GET" && path === "/voice/status") return { value: this.voice.status() };
    if (method === "GET" && path === "/voice/voices") return { value: await this.voice.voices(signal) };
    if (method === "POST" && path === "/voice/speak") return { value: await this.voice.speak(body, signal), audio: true };
    if (method === "GET" && path === "/mail/inbox") return { value: await this.mail.inbox(signal) };
    if (method === "GET" && /^\/mail\/messages\/[\d:]+$/.test(path)) return { value: await this.mail.inbox(signal, path.split("/").at(-1)) };
    if (method === "POST" && path === "/calendar/authorize") return { value: await this.calendar.calendars(signal, true) };
    if (method === "GET" && path === "/calendar/calendars") return { value: await this.calendar.calendars(signal) };
    if (method === "GET" && path === "/calendar/events") return { value: await this.calendar.events(signal) };
    if (method === "POST" && /^\/connectors\/[\w-]+\/discover$/.test(path)) return { value: await this.connectors.discover(path.split("/")[2], signal) };
    if (method === "GET" && path === "/proposals") return { value: { actions: this.actions() } };
    if (method === "POST" && path === "/proposals") return { value: await this.prepare(body, signal) };
    if (method === "PATCH" && /^\/proposals\/[\w-]+$/.test(path)) return { value: await this.update(path.split("/").at(-1)!, body, signal) };
  }
}
