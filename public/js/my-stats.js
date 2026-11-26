// "Your stats": your own progress in the same layout as the site stats page.
// Opened from "See your stats" in the Progress tab. Everything is worked out
// in the browser from data the page already has (progressTreeState: your
// goals, finished steps with their dates, and your check-ins), so it needs
// no extra request. Drawing uses the shared helpers in charts.js.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const myStatsDialog = document.querySelector("#my-stats");

const MY_STATS_SERIES = [
  { key: "steps", label: "Steps" },
  { key: "checkins", label: "Check-ins" },
];

const myStatsPlural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const renderMyStats = () => {
  const tree = progressTreeState || {};
  const goals = Array.isArray(tree.goals) ? tree.goals : [];
  const checkins = Array.isArray(tree.checkins) ? tree.checkins : [];
  const days = chartLastDays(30);
  const today = days[days.length - 1];
  const lastWeek = new Set(days.slice(-7));

  // Finished steps per local day (steps finished before dates were saved
  // have no date; they still count in the totals).
  const steps = goals.flatMap((goal) => goal.completed || []);
  const stepsPerDay = new Map();
  for (const step of steps) {
    if (!step.completed_at) continue;
    const day = localDay(new Date(step.completed_at));
    stepsPerDay.set(day, (stepsPerDay.get(day) || 0) + 1);
  }
  const checkinDays = new Set(checkins.map((checkin) => checkin.day));
  const streak = computeStreak(checkins, today, tree?.topaz?.purchases);

  const stepsThisWeek = [...lastWeek].reduce((sum, day) => sum + (stepsPerDay.get(day) || 0), 0);
  const checkinsThisMonth = days.filter((day) => checkinDays.has(day)).length;
  const finishedGoals = goals.filter((goal) => goal.finished).length;

  document.querySelector("#my-stats-tiles").replaceChildren(
    chartTile({ label: "Steps done", value: chartNumber(steps.length), sub: `+${stepsThisWeek} this week` }),
    chartTile({ label: "Day streak", value: chartNumber(streak.current), sub: `Best ${streak.best}` }),
    chartTile({ label: "Check-ins", value: chartNumber(checkinsThisMonth), sub: "last 30 days" }),
    chartTile({ label: "Goals reached", value: chartNumber(finishedGoals), sub: `of ${myStatsPlural(goals.length, "goal")}` }),
  );

  // 30-day chart: steps per day, or which days you checked in.
  const chart = document.querySelector("#my-stats-chart");
  drawChartSwitch(document.querySelector("#my-stats-switch"), MY_STATS_SERIES, (series) => {
    if (series.key === "steps") {
      const values = days.map((day) => stepsPerDay.get(day) || 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      drawPillarChart(chart, {
        days,
        values,
        describe: (value) => (value ? myStatsPlural(value, "step") : "no steps"),
        summary: `${myStatsPlural(total, "step")} in 30 days`,
        label: "Steps finished per day, last 30 days",
      });
    } else {
      const values = days.map((day) => (checkinDays.has(day) ? 1 : 0));
      drawPillarChart(chart, {
        days,
        values,
        describe: (value) => (value ? "checked in" : "no check-in"),
        summary: `Checked in ${checkinsThisMonth} of 30 days`,
        label: "Check-ins, last 30 days",
      });
    }
  });

  // Each goal's progress, colored by its life area.
  const goalList = document.querySelector("#my-stats-goals");
  if (goals.length) {
    drawChartBars(goalList, goals.map((goal) => ({
      label: goal.goal,
      value: (goal.completed || []).length,
      max: goal.total_steps,
      text: goal.finished ? "Done" : `${(goal.completed || []).length}/${goal.total_steps}`,
      color: `var(--area-${String(goal.area || "other").toLowerCase()}, var(--area-other))`,
    })));
  } else {
    goalList.replaceChildren(chartElement("li", "chart-tile-sub", "No goals yet. Make one in the Today tab."));
  }

  // Small tiles: skills, your most active weekday, active days.
  const skills = new Set(steps.flatMap((step) => (Array.isArray(step.skills) ? step.skills : [])));
  const activeDays = new Set([...checkinDays, ...stepsPerDay.keys()]);
  const perWeekday = new Map();
  for (const day of activeDays) {
    const weekday = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" });
    perWeekday.set(weekday, (perWeekday.get(weekday) || 0) + 1);
  }
  const bestWeekday = [...perWeekday].sort((a, b) => b[1] - a[1])[0];
  document.querySelector("#my-stats-extra").replaceChildren(
    chartTile({ label: "Skills learned", value: chartNumber(skills.size) }),
    chartTile({ label: "Your best day", value: bestWeekday ? `${bestWeekday[0]}s` : "–", help: "The weekday you check in or finish steps most often." }),
    chartTile({ label: "Active days", value: `${days.filter((day) => activeDays.has(day)).length} / 30`, help: "Days in the last 30 with a check-in or a finished step." }),
  );
};

document.querySelector("#my-stats-open").addEventListener("click", () => {
  if (!myStatsDialog.open) myStatsDialog.showModal();
  // Draw after opening, so the chart knows how wide it is.
  renderMyStats();
  // The routines month grid (routines.js) starts at this month.
  routineGridMonth = null;
  renderRoutineGrid();
});

// Closing plays a short animation first (css/motion.css), then closes.
const closeMyStats = () => {
  if (!myStatsDialog.open || myStatsDialog.classList.contains("is-closing")) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    myStatsDialog.close();
    return;
  }
  myStatsDialog.classList.add("is-closing");
  window.setTimeout(() => {
    myStatsDialog.classList.remove("is-closing");
    myStatsDialog.close();
  }, 190);
};

document.querySelector("#my-stats-close").addEventListener("click", closeMyStats);

// A click on the dark area around the card closes it too.
myStatsDialog.addEventListener("click", (event) => {
  if (event.target === myStatsDialog) closeMyStats();
});

// Escape closes with the same animation.
myStatsDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeMyStats();
});
