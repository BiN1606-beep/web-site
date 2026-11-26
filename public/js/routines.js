// Routines: small things you want to do again and again, each with its own
// rhythm (every day, some weekdays, or every few days).
//
// Two places show them:
//  - the Today tab: a card with today's routines. Tap the circle when one is
//    done; "+" adds a routine and tapping a routine's name changes it.
//  - "Your stats" (my-stats.js calls renderRoutineGrid): a month of boxes,
//    one per day. A box fills up as that day's routines get done, so a full
//    box is a day where you did all of them.
//
// The server keeps the routines and the ticks (lua/osiris/routines.lua,
// /api/routines). Every answer holds the whole state, so the page simply
// redraws from it.
//
// When a tick finishes the whole day, the page sends an
// "osiris:routine-day-complete" event on window. Nothing listens yet; it's
// the hook for a reward later (for example gems).
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters. It
// uses localDay, dayNumber and shiftDay from streak.js.

// ---- Pure helpers (no page access; tests/unit/routines_test.mjs checks them) ----

const ROUTINE_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// 0 = Monday ... 6 = Sunday, for a "YYYY-MM-DD" day. 1970-01-01 was a Thursday.
const routineWeekday = (day) => (((dayNumber(day) + 3) % 7) + 7) % 7;

// Is the routine on for this day? Not before it was made, not from the day
// it was removed, and otherwise as its rhythm says.
const routineIsDue = (routine, day) => {
  if (day < routine.start_day) return false;
  if (routine.removed_on && day >= routine.removed_on) return false;
  const rule = routine.repeat || { kind: "daily" };
  if (rule.kind === "weekdays") return (rule.days || []).includes(routineWeekday(day));
  if (rule.kind === "every") return daysBetween(routine.start_day, day) % Math.max(1, rule.every || 1) === 0;
  return true;
};

// "routineId|day" for every tick, so looking one up is quick.
const routineCheckSet = (checks) => new Set((checks || []).map((check) => `${check.routine_id}|${check.day}`));

// How many routines were on for a day, and how many of those were done.
const routineDayProgress = (routines, checkSet, day) => {
  let due = 0;
  let done = 0;
  for (const routine of routines) {
    if (!routineIsDue(routine, day)) continue;
    due += 1;
    if (checkSet.has(`${routine.id}|${day}`)) done += 1;
  }
  return { due, done };
};

// The boxes for one month, Monday first: null for the empty boxes before
// the 1st, then "YYYY-MM-DD" for each day. month is 0-11.
const routineMonthDays = (year, month) => {
  const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const blanks = routineWeekday(first);
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: count }, (_, index) => shiftDay(first, index)),
  ];
};

// Full days in a row (every routine done), ending today or yesterday. Days
// with nothing on don't break it and don't add to it; today doesn't break
// it while it's still going.
const routineFullDayStreak = (routines, checkSet, today) => {
  const first = routines.map((routine) => routine.start_day).sort()[0];
  if (!first) return 0;
  let streak = 0;
  for (let day = today; day >= first; day = shiftDay(day, -1)) {
    const { due, done } = routineDayProgress(routines, checkSet, day);
    if (!due) continue;
    if (done === due) streak += 1;
    else if (day !== today) break;
  }
  return streak;
};

// "Every day", "Mon, Wed, Fri", "Weekdays", "Every 3 days".
const routineRepeatText = (rule) => {
  if (rule?.kind === "weekdays") {
    const days = [...(rule.days || [])].sort();
    if (days.length === 7) return "Every day";
    if (days.join() === "0,1,2,3,4") return "Weekdays";
    if (days.join() === "5,6") return "Weekends";
    return days.map((day) => ROUTINE_WEEKDAYS[day]).join(", ");
  }
  if (rule?.kind === "every") return rule.every === 7 ? "Once a week" : rule.every === 2 ? "Every other day" : `Every ${rule.every} days`;
  return "Every day";
};

// ---- The page ----

let routinesState = { routines: [], checks: [] };
let routineEditing = null; // the routine being changed, or null when adding
let routineRepeatKind = "daily";
let routineChosenDays = new Set([0, 2, 4]);
let routineEvery = 2;
let routineGridMonth = null; // { year, month } shown in "Your stats"

const routineCard = document.querySelector("#routine-card");
const routineList = document.querySelector("#routine-list");
const routineLater = document.querySelector("#routine-later");
const routineLaterList = document.querySelector("#routine-later-list");
const routineEmpty = document.querySelector("#routine-empty");
const routineForm = document.querySelector("#routine-form");
const routineName = document.querySelector("#routine-name");
const routineStatus = document.querySelector("#routine-status");
const routineAddButton = document.querySelector("#routine-add");
const routineWeekdayBox = document.querySelector("#routine-weekdays");
const routineEveryBox = document.querySelector("#routine-every");

const routineActive = () => routinesState.routines.filter((routine) => !routine.removed_on);

const routineRequest = async (body) => {
  const response = await fetch("/api/routines", body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const result = await readApiResponse(response, "Routines");
  if (!response.ok) throw new Error(result.error || "Could not save your routines.");
  routinesState = {
    routines: Array.isArray(result.routines) ? result.routines : [],
    checks: Array.isArray(result.checks) ? result.checks : [],
  };
  return result;
};

// A round tick button with a check mark that draws itself.
const routineTickIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M6 12.5l4 4 8-9");
  path.setAttribute("pathLength", "1");
  svg.append(path);
  return svg;
};

const routineItem = (routine, today, checkSet, isDue) => {
  const item = document.createElement("li");
  item.className = "routine-item";
  item.dataset.id = routine.id;
  const done = checkSet.has(`${routine.id}|${today}`);
  item.classList.toggle("is-done", done);

  if (isDue) {
    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "routine-tick";
    tick.setAttribute("aria-pressed", String(done));
    tick.setAttribute("aria-label", `${routine.title}: ${done ? "done" : "not done yet"}`);
    tick.append(routineTickIcon());
    tick.addEventListener("click", () => toggleRoutine(routine, !done, item));
    item.append(tick);
  }

  const name = document.createElement("button");
  name.type = "button";
  name.className = "routine-name";
  name.title = "Change";
  const title = document.createElement("span");
  title.textContent = routine.title;
  const rhythm = document.createElement("small");
  rhythm.textContent = routineRepeatText(routine.repeat);
  name.append(title, rhythm);
  name.addEventListener("click", () => openRoutineForm(routine));
  item.append(name);
  return item;
};

const renderRoutines = () => {
  const today = localDay();
  const checkSet = routineCheckSet(routinesState.checks);
  const active = routineActive();
  const due = active.filter((routine) => routineIsDue(routine, today));
  const later = active.filter((routine) => !routineIsDue(routine, today));

  routineList.replaceChildren(...due.map((routine) => routineItem(routine, today, checkSet, true)));
  routineLaterList.replaceChildren(...later.map((routine) => routineItem(routine, today, checkSet, false)));
  routineLater.hidden = later.length === 0;
  document.querySelector("#routine-later-summary").textContent = `Not today (${later.length})`;
  routineEmpty.hidden = active.length > 0 || !routineForm.hidden;

  // The ring: how much of today is done.
  const { due: dueCount, done } = routineDayProgress(active, checkSet, today);
  const ring = document.querySelector("#routine-ring");
  ring.hidden = dueCount === 0;
  document.querySelector("#routine-ring-text").textContent = `${done}/${dueCount}`;
  document.querySelector("#routine-ring-fill").style.strokeDashoffset = String(dueCount ? 1 - done / dueCount : 1);
  routineCard.classList.toggle("is-all-done", dueCount > 0 && done === dueCount);
};

const toggleRoutine = async (routine, done, item) => {
  const day = localDay();
  // Show it straight away; the server's answer confirms or undoes it.
  item.classList.toggle("is-done", done);
  if (done) {
    item.classList.remove("is-ticking");
    void item.offsetWidth;
    item.classList.add("is-ticking");
  }
  routineStatus.textContent = "";
  try {
    const result = await routineRequest({ action: "check", id: routine.id, day, done });
    renderRoutines();
    if (result.day_complete) {
      routineCard.classList.remove("is-celebrating");
      void routineCard.offsetWidth;
      routineCard.classList.add("is-celebrating");
      window.setTimeout(() => routineCard.classList.remove("is-celebrating"), 1400);
      routineStatus.textContent = "All done today!";
      window.dispatchEvent(new CustomEvent("osiris:routine-day-complete", { detail: { day } }));
    }
  } catch (error) {
    item.classList.toggle("is-done", !done);
    routineStatus.textContent = error.message;
  }
};

// ---- Adding and changing a routine ----

const showRoutineRepeat = () => {
  for (const button of routineForm.querySelectorAll("[data-repeat]")) {
    button.setAttribute("aria-checked", String(button.dataset.repeat === routineRepeatKind));
  }
  routineWeekdayBox.hidden = routineRepeatKind !== "weekdays";
  routineEveryBox.hidden = routineRepeatKind !== "every";
  for (const button of routineWeekdayBox.children) {
    button.setAttribute("aria-pressed", String(routineChosenDays.has(Number(button.dataset.day))));
  }
  document.querySelector("#routine-every-count").textContent = String(routineEvery);
  document.querySelector("#routine-every-less").disabled = routineEvery <= 2;
  document.querySelector("#routine-every-more").disabled = routineEvery >= 30;
};

// One toggle per weekday: M T W T F S S.
routineWeekdayBox.replaceChildren(...ROUTINE_WEEKDAYS.map((name, day) => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.day = String(day);
  button.textContent = name.slice(0, 1);
  button.setAttribute("aria-label", name);
  button.addEventListener("click", () => {
    if (routineChosenDays.has(day)) {
      if (routineChosenDays.size > 1) routineChosenDays.delete(day);
    } else {
      routineChosenDays.add(day);
    }
    showRoutineRepeat();
  });
  return button;
}));

for (const button of routineForm.querySelectorAll("[data-repeat]")) {
  button.addEventListener("click", () => {
    routineRepeatKind = button.dataset.repeat;
    showRoutineRepeat();
  });
}

document.querySelector("#routine-every-less").addEventListener("click", () => {
  routineEvery = Math.max(2, routineEvery - 1);
  showRoutineRepeat();
});
document.querySelector("#routine-every-more").addEventListener("click", () => {
  routineEvery = Math.min(30, routineEvery + 1);
  showRoutineRepeat();
});

const openRoutineForm = (routine = null) => {
  routineEditing = routine;
  const rule = routine?.repeat || { kind: "daily" };
  routineName.value = routine?.title || "";
  routineRepeatKind = rule.kind;
  routineChosenDays = new Set(rule.kind === "weekdays" ? rule.days : [0, 2, 4]);
  routineEvery = rule.kind === "every" ? Math.max(2, rule.every) : 2;
  document.querySelector("#routine-save").textContent = routine ? "Save" : "Add";
  document.querySelector("#routine-remove").hidden = !routine;
  routineForm.hidden = false;
  routineAddButton.setAttribute("aria-expanded", "true");
  routineStatus.textContent = "";
  showRoutineRepeat();
  renderRoutines();
  routineName.focus();
};

const closeRoutineForm = () => {
  routineForm.hidden = true;
  routineEditing = null;
  routineAddButton.setAttribute("aria-expanded", "false");
  renderRoutines();
};

const routineRepeatChoice = () => {
  if (routineRepeatKind === "weekdays") {
    return routineChosenDays.size === 7
      ? { kind: "daily" }
      : { kind: "weekdays", days: [...routineChosenDays].sort() };
  }
  if (routineRepeatKind === "every") return { kind: "every", every: routineEvery };
  return { kind: "daily" };
};

routineAddButton.addEventListener("click", () => {
  if (!routineForm.hidden && !routineEditing) closeRoutineForm();
  else openRoutineForm();
});
routineEmpty.addEventListener("click", () => openRoutineForm());
document.querySelector("#routine-cancel").addEventListener("click", closeRoutineForm);

routineForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = routineName.value.trim();
  if (!title) return;
  const save = document.querySelector("#routine-save");
  save.disabled = true;
  try {
    const body = { title, repeat: routineRepeatChoice() };
    if (routineEditing) await routineRequest({ action: "edit", id: routineEditing.id, ...body });
    else await routineRequest({ action: "add", day: localDay(), ...body });
    closeRoutineForm();
  } catch (error) {
    routineStatus.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});

document.querySelector("#routine-remove").addEventListener("click", async () => {
  if (!routineEditing) return;
  try {
    await routineRequest({ action: "remove", id: routineEditing.id, day: localDay() });
    closeRoutineForm();
  } catch (error) {
    routineStatus.textContent = error.message;
  }
});

// ---- The month grid in "Your stats" ----

const routineDateText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

const renderRoutineGrid = () => {
  const today = localDay();
  if (!routineGridMonth) {
    routineGridMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
  }
  const { year, month } = routineGridMonth;
  const routines = routinesState.routines;
  const checkSet = routineCheckSet(routinesState.checks);
  const days = routineMonthDays(year, month);
  const info = document.querySelector("#routine-grid-info");

  document.querySelector("#routine-month-name").textContent =
    new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  // Up to a year back (that's what the server keeps), and not into the future.
  const thisMonth = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  document.querySelector("#routine-month-next").disabled = year * 12 + month >= thisMonth;
  document.querySelector("#routine-month-prev").disabled = year * 12 + month <= thisMonth - 12;

  let fullDays = 0;
  let dueTotal = 0;
  let doneTotal = 0;
  const describe = (day, due, done) => {
    if (day > today) return `${routineDateText(day)}: still to come`;
    if (!due) return `${routineDateText(day)}: nothing on`;
    return `${routineDateText(day)}: ${done} of ${due} done`;
  };

  const boxes = days.map((day, index) => {
    const box = document.createElement("li");
    box.className = "routine-box";
    box.style.setProperty("--i", String(index));
    if (!day) {
      box.classList.add("is-blank");
      box.setAttribute("aria-hidden", "true");
      return box;
    }
    const { due, done } = day <= today ? routineDayProgress(routines, checkSet, day) : { due: 0, done: 0 };
    if (day <= today) {
      dueTotal += due;
      doneTotal += done;
      if (due && done === due) fullDays += 1;
    }
    const fill = due ? done / due : 0;
    box.style.setProperty("--fill", String(fill));
    if (day > today) box.classList.add("is-future");
    else if (!due) box.classList.add("is-rest");
    if (due && fill === 1) box.classList.add("is-full");
    if (day === today) box.classList.add("is-today");
    box.tabIndex = 0;
    const text = describe(day, due, done);
    box.setAttribute("aria-label", text);
    box.title = text;
    const number = document.createElement("span");
    number.className = "routine-box-day";
    number.textContent = String(Number(day.slice(8)));
    box.append(number);
    const show = () => {
      info.textContent = text;
    };
    box.addEventListener("click", show);
    box.addEventListener("focus", show);
    return box;
  });

  const grid = document.querySelector("#routine-grid");
  grid.replaceChildren(...boxes);
  grid.classList.remove("is-entering");
  void grid.offsetWidth;
  grid.classList.add("is-entering");

  info.textContent = routines.length ? "" : "Add a routine in the Today tab to start filling the boxes.";
  const monthWords = year * 12 + month === thisMonth
    ? "this month"
    : `in ${new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long" })}`;
  document.querySelector("#routine-grid-tiles").replaceChildren(
    chartTile({ label: "Full days", value: chartNumber(fullDays), sub: monthWords, help: "Days where every routine was done." }),
    chartTile({ label: "In a row", value: chartNumber(routineFullDayStreak(routines, checkSet, today)), sub: "full days now", help: "Full days in a row, up to today. Days with nothing on don't count." }),
    chartTile({ label: "Done", value: chartPercent(doneTotal, dueTotal), sub: monthWords }),
  );
};

const moveRoutineMonth = (step) => {
  const index = routineGridMonth.year * 12 + routineGridMonth.month + step;
  routineGridMonth = { year: Math.floor(index / 12), month: index % 12 };
  renderRoutineGrid();
};
document.querySelector("#routine-month-prev").addEventListener("click", () => moveRoutineMonth(-1));
document.querySelector("#routine-month-next").addEventListener("click", () => moveRoutineMonth(1));

// Load once when the page starts; again when you come back to the tab on a
// new day, so "today" is right.
let routineLoadedDay = null;
const loadRoutines = async () => {
  try {
    await routineRequest();
    routineLoadedDay = localDay();
    renderRoutines();
  } catch (error) {
    routineStatus.textContent = error.message;
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && routineLoadedDay && routineLoadedDay !== localDay()) loadRoutines();
});
loadRoutines();
