import { existsSync } from "node:fs";
import path from "node:path";
import type { Store } from "./store.ts";
import { integrationSettings } from "./integration-settings.ts";
import { AppError, record, text } from "./validation.ts";
import { Temporal } from "@js-temporal/polyfill";
import { runCalendarApp } from "./calendar-bridge.ts";

export function calendarDraft(value: unknown) {
  const input = record(value);
  const title = text(input.title, "Event title", 300, true);
  const start = text(input.start, "Start time", 60, true), end = text(input.end, "End time", 60, true);
  try { Temporal.Instant.from(start); Temporal.Instant.from(end); } catch { throw new AppError("Choose valid event dates and times with explicit UTC offsets."); }
  if (![start, end].every((v) => /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))) || Date.parse(end) <= Date.parse(start)) throw new AppError("Choose an exact event start and a later end time, with UTC offsets.");
  if (Date.parse(end) - Date.parse(start) > 31 * 86400_000) throw new AppError("An event can last up to 31 days.");
  const operation = input.operation ?? "create";
  if (!["create", "update", "delete"].includes(String(operation))) throw new AppError("Choose create, update, or delete.");
  return { operation: String(operation), calendarId: text(input.calendarId, "Calendar", 300, true), eventId: operation === "create" ? "" : text(input.eventId, "Event", 1000, true), expectedModified: operation === "create" ? "" : text(input.expectedModified, "Event revision", 100, true), title, start: new Date(start).toISOString(), end: new Date(end).toISOString(), location: text(input.location ?? "", "Location", 1000), notes: text(input.notes ?? "", "Notes", 5000) };
}
export class Calendar {
  store: Store;
  constructor(store: Store) { this.store = store; }
  async bridge(command: Record<string, unknown>, signal: AbortSignal) {
    const app = path.join(this.store.directory, "helpers", "Glashaus Calendar.app");
    const executable = path.join(app, "Contents", "MacOS", "GlashausCalendar");
    if (process.platform !== "darwin" || !existsSync(executable)) throw new AppError("Calendar helper is not installed on this Mac. Run pnpm calendar:install, then connect Calendar in Settings.");
    return runCalendarApp(app, command, signal);
  }
  async calendars(signal: AbortSignal, authorize = false) { return this.bridge({ command: authorize ? "authorize" : "calendars" }, signal); }
  async events(signal: AbortSignal) {
    const c = integrationSettings(this.store).calendar;
    if (!c.enabled || !c.ids.length) throw new AppError("Connect Calendar and select calendars in Settings first.");
    return this.bridge({ command: "events", calendarIds: c.ids, start: new Date().toISOString(), end: new Date(Date.now() + 14 * 86400_000).toISOString() }, signal);
  }
  async preview(value: unknown, signal: AbortSignal) {
    const draft = calendarDraft(value), c = integrationSettings(this.store).calendar;
    if (!c.enabled || !c.ids.includes(draft.calendarId)) throw new AppError("Select this calendar in Connections first.");
    return this.bridge({ command: "preview", ...draft, calendarIds: c.ids }, signal);
  }
  async write(value: unknown, actionId: string, signal: AbortSignal) {
    const draft = calendarDraft(value), c = integrationSettings(this.store).calendar;
    if (!c.enabled || !c.ids.includes(draft.calendarId)) throw new AppError("This calendar is no longer connected. Review Calendar settings.");
    return this.bridge({ command: "write", ...draft, actionId }, signal);
  }
}
