// Pulls the pure streak and reward functions out of index.html and checks them.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const start = html.indexOf("      const localDay = ");
const end = html.indexOf("      const renderStreak = ");
assert.ok(start > 0 && end > start, "streak functions found");
const { localDay, daysBetween, shiftDay, computeStreak, computeRewards } =
  new Function(`${html.slice(start, end)}; return { localDay, daysBetween, shiftDay, computeStreak, computeRewards };`)();

const c = (...days) => days.map((day) => ({ day, note: "x" }));
// n days in a row ending at `last`
const run = (last, n) => Array.from({ length: n }, (_, i) => shiftDay(last, -i));
const today = "2026-11-24";

assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // across EU DST change
assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");

let s = computeStreak([], today);
assert.deepEqual([s.current, s.best, s.missed, s.checkedInToday, s.freezes], [0, 0, 0, false, 0]);

s = computeStreak(c("2026-11-24", "2026-11-23", "2026-11-22"), today);
assert.deepEqual([s.current, s.best, s.missed, s.checkedInToday], [3, 3, 0, true]);

// Today still open: yesterday's streak is alive, nothing missed.
s = computeStreak(c("2026-11-23", "2026-11-22"), today);
assert.deepEqual([s.current, s.missed, s.checkedInToday], [2, 0, false]);

// Last check-in 3 days ago, no freezes: 2 days missed, streak broken, best kept.
s = computeStreak(c("2026-11-21", "2026-11-20", "2026-11-19", "2026-11-18"), today);
assert.deepEqual([s.current, s.best, s.missed], [0, 4, 2]);

// Back after a gap: new streak of 1, nothing missed any more.
s = computeStreak(c("2026-11-24", "2026-11-10", "2026-11-09"), today);
assert.deepEqual([s.current, s.best, s.missed], [1, 2, 0]);

// A check-in dated tomorrow (other time zone) doesn't break anything.
s = computeStreak(c("2026-11-25", "2026-11-24"), today);
assert.deepEqual([s.current, s.missed], [1, 0]);

// Freezes: 7 in a row earns one.
s = computeStreak(c(...run("2026-11-23", 7)), today);
assert.deepEqual([s.current, s.freezes], [7, 1]);

// 7 in a row, miss 1 day, check in today: the freeze covers it.
s = computeStreak(c(...run("2026-11-22", 7), "2026-11-24"), today);
assert.deepEqual([s.current, s.freezes, s.missed, [...s.frozenDays]], [8, 0, 0, ["2026-11-23"]]);

// 7 in a row then 2 missed days: 1 freeze covers the first, the second breaks it.
s = computeStreak(c(...run("2026-11-21", 7)), today);
assert.deepEqual([s.current, s.best, s.freezes, s.missed], [0, 7, 0, 1]);

// 14 in a row: 2 freezes (the cap), covers 2 missed days.
s = computeStreak(c(...run("2026-11-21", 14)), today);
assert.deepEqual([s.current, s.freezes, s.missed, s.frozenDays.size], [14, 0, 0, 2]);

// 21 in a row still holds only 2.
s = computeStreak(c(...run("2026-11-24", 21)), today);
assert.deepEqual([s.current, s.freezes], [21, 2]);

// Notes for today come through.
assert.equal(computeStreak([{ day: today, note: "ran" }], today).todayNote, "ran");

// Rewards
const r = computeRewards(12, 7);
assert.deepEqual(r.filter((x) => x.earned).map((x) => x.id), ["steps-10", "streak-7"]);
assert.equal(r.find((x) => x.id === "steps-50").value, 12);
assert.equal(computeRewards(0, 0).some((x) => x.earned), false);
assert.equal(computeRewards(500, 500).every((x) => x.earned), true);
console.log("STREAK_AND_REWARD_TESTS_OK");
