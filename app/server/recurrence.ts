import { Temporal } from "@js-temporal/polyfill";
import { AppError } from "./validation.ts";

export const repeatRules = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type RepeatRule = (typeof repeatRules)[number];
export function repeatRule(value: unknown): RepeatRule {
  if (value === undefined) return "none";
  if (!repeatRules.includes(value as RepeatRule))
    throw new AppError("Choose no repeat, daily, weekdays, weekly, or monthly.");
  return value as RepeatRule;
}

// Always derive wall-clock time and day-of-month from the original anchor.
// A spring-forward gap moves forward; a repeated fall-back time uses its first
// occurrence. Missed occurrences collapse into one due item until acknowledged.
export function nextOccurrence(anchorAt: string, zone: string, rule: RepeatRule, after: Date): string {
  if (rule === "none") throw new AppError("This reminder does not repeat.");
  const anchor = Temporal.Instant.from(anchorAt).toZonedDateTimeISO(zone);
  const current = Temporal.Instant.from(after.toISOString()).toZonedDateTimeISO(zone);
  const start = anchor.toPlainDateTime();
  let step = rule === "monthly"
    ? Math.max(0, (current.year - anchor.year) * 12 + current.month - anchor.month)
    : Math.max(0, start.toPlainDate().until(current.toPlainDate(), { largestUnit: "days" }).days - 1);
  if (rule === "weekly") step = Math.floor(step / 7);
  for (let attempt = 0; attempt < 40; attempt++, step++) {
    const local = start.add(rule === "monthly" ? { months: step } : { days: step * (rule === "weekly" ? 7 : 1) });
    if (rule === "weekdays" && local.dayOfWeek > 5) continue;
    const next = local.toZonedDateTime(zone, { disambiguation: "compatible" });
    if (next.epochMilliseconds > after.getTime()) return new Date(next.epochMilliseconds).toISOString();
  }
  throw new AppError("Could not calculate the next reminder. Edit its schedule.");
}
