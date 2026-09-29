import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { Reminder } from "../shared/types.ts";
import { AppError, record, text } from "./validation.ts";
import { nextOccurrence, repeatRule } from "./recurrence.ts";

export function timeZone(value: unknown): string {
  const zone = text(value, "Time zone", 100, true);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
  } catch {
    throw new AppError(
      "Choose a valid IANA time zone, such as America/New_York.",
    );
  }
  return zone;
}

export function reminderInput(value: unknown, now = new Date()) {
  const input = record(value);
  const title = text(input.title, "Reminder", 500, true);
  const raw = text(input.dueAt, "Reminder time", 60, true);
  // An explicit offset prevents host-local parsing and daylight-saving guesses.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      raw,
    )
  )
    throw new AppError("Use an exact date and time with a time-zone offset.");
  const instant = new Date(raw);
  const clock = raw.slice(11, 19).split(":");
  if (
    Number(clock[0]) > 23 ||
    Number(clock[1]) > 59 ||
    (clock[2] && Number.parseInt(clock[2], 10) > 59)
  )
    throw new AppError("Choose a valid time of day.");
  const calendar = raw.slice(0, 10);
  const [year, month, day] = calendar.split("-").map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    throw new AppError("Choose a valid calendar date.");
  if (!Number.isFinite(instant.getTime()) || instant <= now)
    throw new AppError("Choose a reminder time in the future.");
  if (instant.getTime() - now.getTime() > 366 * 24 * 60 * 60 * 1000)
    throw new AppError("Choose a reminder time within the next year.");
  const zone = timeZone(input.timeZone);
  if (!raw.endsWith("Z")) {
    const actual =
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "longOffset",
      })
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")!
        .value.replace("GMT", "") || "+00:00";
    if (
      raw.slice(-6) !== actual &&
      !(raw.endsWith("-00:00") && actual === "+00:00")
    )
      throw new AppError(
        "That UTC offset does not match the time zone on this date. Check daylight-saving time and choose an exact time.",
      );
  }
  return {
    title,
    dueAt: instant.toISOString(),
    timeZone: zone,
    recurrence: repeatRule(input.recurrence),
  };
}

export class Reminders {
  private store: Store;
  private now: () => Date;
  constructor(store: Store, now: () => Date = () => new Date()) {
    this.store = store;
    this.now = now;
  }
  list(): Reminder[] {
    return this.store.db
      .prepare(
        "SELECT * FROM reminders ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'due' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END, dueAt, id",
      )
      .all() as unknown as Reminder[];
  }
  get(id: string): Reminder {
    const result = this.store.db
      .prepare("SELECT * FROM reminders WHERE id=?")
      .get(id) as unknown as Reminder | undefined;
    if (!result) throw new AppError("This reminder no longer exists.", 404);
    return result;
  }
  draft(value: unknown, turnId: string | null = null): Reminder {
    if (!this.store.companion())
      throw new AppError("Create a companion first.");
    // A conversation retry can never create a second draft, even if the model
    // chooses a slightly different interpretation on its next attempt.
    if (turnId) {
      const old = this.store.db
        .prepare("SELECT * FROM reminders WHERE turnId=?")
        .get(turnId) as unknown as Reminder | undefined;
      if (old) return old;
    }
    const input = reminderInput(value, this.now());
    const id = randomUUID();
    const at = this.now().toISOString();
    this.store.db
      .prepare(
        "INSERT INTO reminders(id,turnId,title,dueAt,timeZone,status,revision,createdAt,updatedAt,firedAt,recurrence,anchorAt) VALUES (?,?,?,?,?,'draft',1,?,?,NULL,?,?)",
      )
      .run(id, turnId, input.title, input.dueAt, input.timeZone, at, at, input.recurrence, input.dueAt);
    return this.get(id);
  }
  update(id: string, value: unknown): Reminder {
    const input = record(value);
    return this.store.transaction(() => {
      const old = this.get(id);
      if (input.revision !== old.revision)
        throw new AppError(
          "This reminder changed. Refresh it before trying again.",
          409,
        );
      const at = this.now().toISOString();
      const action = input.action;
      if (action === "confirm") {
        if (!["draft", "paused"].includes(old.status))
          throw new AppError(
            "This reminder is no longer awaiting confirmation.",
            409,
          );
        reminderInput(old, this.now());
        this.store.db
          .prepare(
            "UPDATE reminders SET status='scheduled',revision=revision+1,updatedAt=? WHERE id=?",
          )
          .run(at, id);
      } else if (action === "edit") {
        if (["completed", "cancelled"].includes(old.status))
          throw new AppError(
            "Create a new reminder for a completed or cancelled item.",
            409,
          );
        const next = reminderInput(input, this.now());
        // Editing a scheduled task cancels its old occurrence immediately; the
        // replacement is a draft until its exact content/time is confirmed.
        this.store.db
          .prepare(
            "UPDATE reminders SET title=?,dueAt=?,timeZone=?,recurrence=?,anchorAt=?,status='draft',revision=revision+1,updatedAt=?,firedAt=NULL WHERE id=?",
          )
          .run(next.title, next.dueAt, next.timeZone, next.recurrence, next.dueAt, at, id);
      } else if (action === "pause") {
        if (old.status !== "scheduled") throw new AppError("Only a scheduled reminder can be paused.", 409);
        this.store.db.prepare("UPDATE reminders SET status='paused',revision=revision+1,updatedAt=? WHERE id=?").run(at, id);
      } else if (action === "cancel" || action === "complete") {
        if (["completed", "cancelled"].includes(old.status))
          throw new AppError("This reminder is already closed.", 409);
        if (action === "complete" && old.recurrence !== "none") {
          if (old.status !== "due") throw new AppError("A repeating reminder can be completed when it is due.", 409);
          const next = nextOccurrence(old.anchorAt, old.timeZone, old.recurrence, this.now());
          this.store.db.prepare("UPDATE reminders SET dueAt=?,status='scheduled',firedAt=NULL,revision=revision+1,updatedAt=? WHERE id=?").run(next, at, id);
        } else this.store.db
          .prepare(
            "UPDATE reminders SET status=?,revision=revision+1,updatedAt=? WHERE id=?",
          )
          .run(action === "cancel" ? "cancelled" : "completed", at, id);
      } else throw new AppError("Choose confirm, edit, cancel, or complete.");
      return this.get(id);
    });
  }
  dispatchDue(): number {
    const now = this.now().toISOString();
    return this.store.transaction(() => {
      const due = this.store.db
        .prepare(
          "SELECT * FROM reminders WHERE status='scheduled' AND dueAt<=?",
        )
        .all(now) as unknown as Reminder[];
      for (const reminder of due) {
        this.store.db
          .prepare(
            "INSERT OR IGNORE INTO reminder_events(id,reminderId,dueAt,createdAt) VALUES (?,?,?,?)",
          )
          .run(
            `${reminder.id}:${reminder.revision}`,
            reminder.id,
            reminder.dueAt,
            now,
          );
        this.store.db
          .prepare(
            "UPDATE reminders SET status='due',firedAt=?,updatedAt=?,revision=revision+1 WHERE id=?",
          )
          .run(now, now, reminder.id);
      }
      return due.length;
    });
  }
}
