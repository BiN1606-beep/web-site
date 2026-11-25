// The weekly review: a summary of the last 7 days, and once a week a short
// review written by the AI coach (lua/osiris/coach.lua, weekly_review).
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const reviewStats = document.querySelector("#review-stats");
const reviewBody = document.querySelector("#review-body");
const reviewHeadline = document.querySelector("#review-headline");
const reviewWentWell = document.querySelector("#review-went-well");
const reviewWatchOut = document.querySelector("#review-watch-out");
const reviewNextWeek = document.querySelector("#review-next-week");
const reviewButton = document.querySelector("#review-button");
const reviewAdjustButton = document.querySelector("#review-adjust");
const reviewStatus = document.querySelector("#review-status");
const reviewHelp = document.querySelector("#review-help");

// The Monday of the week that contains `day` ("YYYY-MM-DD"). Weeks start on
// Monday, as in most of Europe; the server checks the same rule.
const weekStartOf = (day) => {
  const weekday = new Date(`${day}T12:00:00`).getDay(); // 0 = Sunday
  return shiftDay(day, -((weekday + 6) % 7));
};

// Days checked in and steps finished in the last 7 days (today included).
const lastSevenDays = (tree, today = localDay()) => {
  const first = shiftDay(today, -6);
  const checkins = Array.isArray(tree.checkins) ? tree.checkins : [];
  const days = new Set(checkins.map((checkin) => checkin.day).filter((day) => day >= first && day <= today));
  const since = dayNumber(first) * 86400000;
  const steps = goalsFromTree(tree)
    .flatMap((goal) => goal.completed)
    .filter((step) => (completedTime(step) ?? -Infinity) >= since).length;
  return { days: days.size, steps };
};

const renderWeeklyReview = (tree) => {
  const today = localDay();
  const week = lastSevenDays(tree, today);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  reviewStats.textContent = `Last 7 days: checked in on ${plural(week.days, "day")}, finished ${plural(week.steps, "step")}.`;

  const saved = tree.weekly_review;
  const current = saved && saved.week_start === weekStartOf(today) ? saved.review : null;
  reviewBody.hidden = !current;
  reviewHelp.hidden = Boolean(current);
  // A dot on the Week tab while this week's review is still waiting.
  // Only once there is something to review, so it doesn't nag a new user.
  setPanelTabDot("week", !current && week.days > 0);
  reviewButton.hidden = Boolean(current);
  reviewButton.disabled = false;
  reviewButton.textContent = "Review my week with your coach";
  reviewAdjustButton.hidden = !(current?.suggest_adjust && !tree.finished);
  if (current) {
    reviewHeadline.textContent = current.headline || "";
    reviewWentWell.textContent = current.went_well || "";
    reviewWatchOut.textContent = current.watch_out || "";
    reviewNextWeek.textContent = current.next_week || "";
  }
};

reviewButton.addEventListener("click", async () => {
  const today = localDay();
  reviewButton.disabled = true;
  reviewButton.textContent = "Your coach is reading your week...";
  reviewStatus.textContent = "";
  try {
    await postProgressTree({ action: "weekly_review", weekStart: weekStartOf(today), day: today });
  } catch (error) {
    reviewStatus.textContent = error.message;
    reviewButton.disabled = false;
    reviewButton.textContent = "Review my week with your coach";
  }
});

// The coach thinks the current step is stuck: open the existing "Adjust my
// path" conversation.
reviewAdjustButton.addEventListener("click", () => treeAdjustButton.click());
