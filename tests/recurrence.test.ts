import test from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence } from "../app/server/recurrence.ts";
import { Store } from "../app/server/store.ts";
import { Reminders } from "../app/server/reminders.ts";
import { companionInput } from "../app/server/validation.ts";

test("daily schedules preserve wall time across DST, including gaps and folds", () => {
  const zone = "America/New_York";
  assert.equal(nextOccurrence("2026-03-07T14:00:00Z", zone, "daily", new Date("2026-03-07T20:00:00Z")), "2026-03-08T13:00:00.000Z");
  assert.equal(nextOccurrence("2026-03-07T07:30:00Z", zone, "daily", new Date("2026-03-08T00:00:00Z")), "2026-03-08T07:30:00.000Z");
  assert.equal(nextOccurrence("2026-03-07T07:30:00Z", zone, "daily", new Date("2026-03-08T20:00:00Z")), "2026-03-09T06:30:00.000Z");
  assert.equal(nextOccurrence("2026-10-31T05:30:00Z", zone, "daily", new Date("2026-11-01T00:00:00Z")), "2026-11-01T05:30:00.000Z");
});
test("monthly anchor returns to the 31st after a shorter month; weekdays skip weekends", () => {
  assert.equal(nextOccurrence("2026-01-31T15:00:00Z", "UTC", "monthly", new Date("2026-02-01T00:00:00Z")), "2026-02-28T15:00:00.000Z");
  assert.equal(nextOccurrence("2026-01-31T15:00:00Z", "UTC", "monthly", new Date("2026-03-01T00:00:00Z")), "2026-03-31T15:00:00.000Z");
  assert.equal(nextOccurrence("2026-10-02T09:00:00Z", "UTC", "weekdays", new Date("2026-10-02T10:00:00Z")), "2026-10-05T09:00:00.000Z");
});
test("overdue recurrence is acknowledged once, skips missed days, and restore pauses its schedule", () => {
  const store = new Store(":memory:"); const restored = new Store(":memory:");
  let now = new Date("2026-10-01T00:00:00Z");
  try {
    store.saveCompanion(companionInput({ name: "Test", userName: "Tester", mode: "grow", relationship: "Synthetic test" }));
    const reminders = new Reminders(store, () => now);
    let item = reminders.draft({ title: "Daily", dueAt: "2026-10-02T09:00:00Z", timeZone: "UTC", recurrence: "daily" });
    item = reminders.update(item.id, { action: "confirm", revision: item.revision });
    now = new Date("2026-10-10T12:00:00Z");
    assert.equal(reminders.dispatchDue(), 1); assert.equal(reminders.dispatchDue(), 0);
    item = reminders.get(item.id);
    item = reminders.update(item.id, { action: "complete", revision: item.revision });
    assert.equal(item.dueAt, "2026-10-11T09:00:00.000Z");
    assert.equal(item.status, "scheduled");
    assert.throws(() => reminders.update(item.id, { action: "complete", revision: item.revision }), /when it is due/);
    restored.importArchive(store.archive());
    const copy = new Reminders(restored).get(item.id);
    assert.equal(copy.status, "paused"); assert.equal(copy.anchorAt, "2026-10-02T09:00:00.000Z"); assert.equal(copy.recurrence, "daily");
  } finally { store.close(); restored.close(); }
});
