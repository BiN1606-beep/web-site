// Pulls the pure orb helpers out of public/js/topaz.js and checks them.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const streakJs = readFileSync(new URL("../../public/js/streak.js", import.meta.url), "utf8");
const topazJs = readFileSync(new URL("../../public/js/topaz.js", import.meta.url), "utf8");
const dayHelpers = streakJs.slice(streakJs.indexOf("const localDay = "), streakJs.indexOf("// How many missed days"));
const start = topazJs.indexOf("// ---- Pure helpers");
const end = topazJs.indexOf("// ---- end of pure helpers ----");
assert.ok(start > 0 && end > start, "orb helpers found");
const { orbShelfDays, orbGemCount } =
  new Function(`${dayHelpers}; ${topazJs.slice(start, end)}; return { orbShelfDays, orbGemCount };`)();

// Seven days, oldest first, ending today.
const today = "2026-11-26";
let days = orbShelfDays([], today);
assert.deepEqual(days.map((day) => day.day), [
  "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26",
]);
assert.ok(days.every((day) => day.topaz === 0 && day.waiting.length === 0));

// Opened orbs add up per day; closed ones never show an amount.
days = orbShelfDays([
  { id: 1, day: "2026-11-26", opened: true, amount: 45 },
  { id: 2, day: "2026-11-26", opened: true, amount: 100 },
  { id: 3, day: "2026-11-26", opened: false, amount: null },
  { id: 4, day: "2026-11-24", opened: false },
  { id: 5, day: "2026-11-10", opened: true, amount: 60 },
], today);
assert.deepEqual(days[6], { day: today, topaz: 145, opened: 2, waiting: [3] });
assert.deepEqual(days[4].waiting, [4]);
assert.equal(days.reduce((sum, day) => sum + day.topaz, 0), 145, "older orbs are left out");

// A server-style empty object is ignored.
assert.equal(orbShelfDays({}, today).length, 7);

// More crystals for bigger orbs, within limits.
assert.equal(orbGemCount(20), 3);
assert.equal(orbGemCount(100), 11);
assert.ok(orbGemCount(60) > orbGemCount(30));
console.log("TOPAZ_TESTS_OK");
