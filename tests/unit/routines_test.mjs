// Pulls the pure routine helpers out of public/js/routines.js (plus the day
// helpers they use from streak.js) and checks them.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (name) => readFileSync(new URL(`../../public/js/${name}`, import.meta.url), "utf8");
const slice = (code, from, to) => {
  const start = code.indexOf(from);
  const end = code.indexOf(to);
  assert.ok(start >= 0 && end > start, `${from} found`);
  return code.slice(start, end);
};
const streak = slice(read("streak.js"), "const localDay = ", "// How many missed days");
const routines = slice(read("routines.js"), "const ROUTINE_WEEKDAYS", "// ---- The page ----");
const { routineWeekday, routineIsDue, routineCheckSet, routineDayProgress, routineMonthDays, routineFullDayStreak, routineRepeatText } =
  new Function(`${streak}${routines}; return { routineWeekday, routineIsDue, routineCheckSet, routineDayProgress, routineMonthDays, routineFullDayStreak, routineRepeatText };`)();

// 2026-11-23 is a Monday, 2026-11-29 a Sunday.
assert.equal(routineWeekday("2026-11-23"), 0);
assert.equal(routineWeekday("2026-11-29"), 6);
assert.equal(routineWeekday("1970-01-01"), 3);

const daily = { id: 1, start_day: "2026-11-10", repeat: { kind: "daily" } };
const mwf = { id: 2, start_day: "2026-11-01", repeat: { kind: "weekdays", days: [0, 2, 4] } };
const every3 = { id: 3, start_day: "2026-11-20", repeat: { kind: "every", every: 3 } };
const removed = { id: 4, start_day: "2026-11-01", removed_on: "2026-11-15", repeat: { kind: "daily" } };

assert.equal(routineIsDue(daily, "2026-11-09"), false, "not before it was made");
assert.equal(routineIsDue(daily, "2026-11-10"), true);
assert.equal(routineIsDue(mwf, "2026-11-23"), true, "Monday");
assert.equal(routineIsDue(mwf, "2026-11-24"), false, "Tuesday");
assert.equal(routineIsDue(mwf, "2026-11-27"), true, "Friday");
assert.deepEqual(["2026-11-20", "2026-11-21", "2026-11-23", "2026-11-26"].map((d) => routineIsDue(every3, d)), [true, false, true, true]);
assert.equal(routineIsDue(removed, "2026-11-14"), true, "before removal");
assert.equal(routineIsDue(removed, "2026-11-15"), false, "from the day it was removed");

const all = [daily, mwf, every3, removed];
const checks = routineCheckSet([
  { routine_id: 1, day: "2026-11-23" }, { routine_id: 2, day: "2026-11-23" }, { routine_id: 3, day: "2026-11-23" },
  { routine_id: 1, day: "2026-11-24" },
  { routine_id: 1, day: "2026-11-25" },
]);
assert.deepEqual(routineDayProgress(all, checks, "2026-11-23"), { due: 3, done: 3 });
assert.deepEqual(routineDayProgress(all, checks, "2026-11-24"), { due: 1, done: 1 });
assert.deepEqual(routineDayProgress(all, checks, "2026-11-25"), { due: 2, done: 1 }, "Wednesday: daily + MWF");

// Nov 2026 starts on a Sunday: 6 blanks, then 30 days.
const nov = routineMonthDays(2026, 10);
assert.equal(nov.filter((d) => d === null).length, 6);
assert.equal(nov.length, 36);
assert.equal(nov[6], "2026-11-01");
assert.equal(nov.at(-1), "2026-11-30");
assert.equal(routineMonthDays(2028, 1).filter(Boolean).length, 29, "leap year February");

// Full days: 23 and 24 are full, 25 isn't (yesterday), so on the 26th the run is broken.
assert.equal(routineFullDayStreak([daily, mwf], checks, "2026-11-24"), 2);
assert.equal(routineFullDayStreak([daily, mwf], checks, "2026-11-25"), 2, "today still open");
assert.equal(routineFullDayStreak([daily, mwf], checks, "2026-11-26"), 0);
// A rest day doesn't break the run.
const restChecks = routineCheckSet([{ routine_id: 2, day: "2026-11-23" }, { routine_id: 2, day: "2026-11-25" }]);
assert.equal(routineFullDayStreak([mwf], restChecks, "2026-11-26"), 2);
assert.equal(routineFullDayStreak([], restChecks, "2026-11-26"), 0);

assert.equal(routineRepeatText({ kind: "daily" }), "Every day");
assert.equal(routineRepeatText({ kind: "weekdays", days: [0, 1, 2, 3, 4] }), "Weekdays");
assert.equal(routineRepeatText({ kind: "weekdays", days: [4, 0, 2] }), "Mon, Wed, Fri");
assert.equal(routineRepeatText({ kind: "every", every: 2 }), "Every other day");
assert.equal(routineRepeatText({ kind: "every", every: 7 }), "Once a week");
assert.equal(routineRepeatText({ kind: "every", every: 3 }), "Every 3 days");

console.log("routine tests passed");
