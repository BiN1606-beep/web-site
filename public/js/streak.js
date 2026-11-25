// Daily streak, streak freezes and rewards. The pure functions here are tested by tests/unit/streak_test.mjs.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

// ---- Daily streak ----
// The server stores one check-in per day as "YYYY-MM-DD" in the
// user's own time zone. Everything here works on those date strings,
// so daylight-saving changes and time zones can't shift a day.

// Today (or another moment) as "YYYY-MM-DD" in the local time zone.
const localDay = (date = new Date()) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");

// Whole days between two "YYYY-MM-DD" dates (later minus earlier).
// Both are read as UTC midnight, where every day is exactly 24 hours.
const dayNumber = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86400000;
const daysBetween = (earlier, later) => Math.round(dayNumber(later) - dayNumber(earlier));
const shiftDay = (day, offset) => new Date((dayNumber(day) + offset) * 86400000).toISOString().slice(0, 10);

// How many missed days make the network fully wilted.
const FULL_WILT_DAYS = 5;

// Streak freezes: every FREEZE_EVERY days in a row earns one, and you
// can hold up to MAX_FREEZES. A missed day uses one up automatically,
// so the streak survives (it doesn't grow that day) and the network
// doesn't wilt. One sick day shouldn't wipe out a 40-day streak.
const FREEZE_EVERY = 7;
const MAX_FREEZES = 2;

// Works out the streak by replaying every day from the first check-in
// to today. Nothing about freezes is stored: the same check-in days
// always give the same result, so there's nothing to get out of sync.
//  current: the streak now. Today counts once you've checked in, and a
//           missing today doesn't break anything until the day is over.
//  best:    the longest streak ever.
//  missed:  missed days in a row that no freeze covered (for wilting).
//  freezes: freezes you hold now.
//  frozenDays: the days a freeze was used on.
const computeStreak = (checkins, today = localDay()) => {
  const days = new Set(checkins.map((checkin) => checkin.day).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)));
  const first = [...days].filter((day) => day <= today).sort()[0];
  const frozenDays = new Set();
  let current = 0;
  let best = 0;
  let freezes = 0;
  let missed = 0;
  if (first) {
    for (let day = first; day <= today; day = shiftDay(day, 1)) {
      if (days.has(day)) {
        current += 1;
        missed = 0;
        if (current % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
      } else if (day === today) {
        // Today is still open.
      } else if (freezes > 0) {
        freezes -= 1;
        frozenDays.add(day);
      } else {
        current = 0;
        missed += 1;
      }
      best = Math.max(best, current);
    }
  }
  return {
    current,
    best,
    missed,
    freezes,
    frozenDays,
    checkedInToday: days.has(today),
    days,
    todayNote: checkins.find((checkin) => checkin.day === today)?.note || "",
  };
};

// ---- Rewards ----
// Milestones for steps done (across all goals) and for the best streak
// ever. They're worked out from data the server already sends, so a
// reward can't be lost: undoing a step only takes back a steps reward
// if the total really drops below it.
const REWARDS = [
  { id: "steps-10", kind: "steps", target: 10, label: "10 steps" },
  { id: "steps-50", kind: "steps", target: 50, label: "50 steps" },
  { id: "steps-100", kind: "steps", target: 100, label: "100 steps" },
  { id: "streak-7", kind: "streak", target: 7, label: "7-day streak" },
  { id: "streak-30", kind: "streak", target: 30, label: "30-day streak" },
  { id: "streak-100", kind: "streak", target: 100, label: "100-day streak" },
];

const computeRewards = (totalSteps, bestStreak) => REWARDS.map((reward) => {
  const value = reward.kind === "steps" ? totalSteps : bestStreak;
  return { ...reward, value: Math.min(value, reward.target), earned: value >= reward.target };
});

const renderStreak = (tree) => {
  const checkins = Array.isArray(tree?.checkins) ? tree.checkins : [];
  const today = localDay();
  const streak = computeStreak(checkins, today);
  const wilt = Math.min(streak.missed, FULL_WILT_DAYS) / FULL_WILT_DAYS;
  netStage.style.setProperty("--wilt", String(wilt));
  streakCard.classList.toggle("is-wilting", streak.missed > 0);
  checkinCard.classList.toggle("is-wilting", streak.missed > 0);
  // A dot on the Today tab until you've checked in today.
  setPanelTabDot("today", !streak.checkedInToday);

  // The number gives a little bump when the streak grows.
  if (Number(streakCount.textContent) < streak.current && streakCount.dataset.shown) {
    streakCount.classList.remove("is-bumping");
    void streakCount.offsetWidth;
    streakCount.classList.add("is-bumping");
  }
  streakCount.dataset.shown = "true";
  streakCount.textContent = String(streak.current);
  streakCountLabel.textContent = "day streak";
  todayStreak.textContent = String(streak.current);
  todayStreakLabel.textContent = streak.freezes
    ? `day streak · ${streak.freezes} ${streak.freezes === 1 ? "freeze" : "freezes"}`
    : "day streak";
  streakBest.textContent = [
    streak.freezes ? `${streak.freezes} ${streak.freezes === 1 ? "freeze" : "freezes"}` : "",
    streak.best > streak.current ? `Best: ${streak.best}` : "",
  ].filter(Boolean).join(" · ");
  streakBest.title = `Every ${FREEZE_EVERY} days in a row earns a freeze (you can hold ${MAX_FREEZES}). A freeze covers one missed day.`;

  streakWeek.replaceChildren();
  for (let offset = -6; offset <= 0; offset += 1) {
    const day = shiftDay(today, offset);
    const item = document.createElement("li");
    item.className = "streak-day";
    item.classList.toggle("is-done", streak.days.has(day));
    item.classList.toggle("is-frozen", streak.frozenDays.has(day));
    item.classList.toggle("is-today", offset === 0);
    const weekday = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" });
    const dayState = streak.days.has(day) ? "checked in" : streak.frozenDays.has(day) ? "covered by a freeze" : "no check-in";
    item.setAttribute("aria-label", `${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}: ${dayState}`);
    const dot = document.createElement("span");
    dot.className = "streak-dot";
    item.append(dot, document.createTextNode(weekday));
    streakWeek.append(item);
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (streak.missed > 0) {
    streakMessage.textContent = `Your network is wilting: ${plural(streak.missed, "day")} missed. Check in today to bring it back to life.`;
  } else if (!streak.checkedInToday && streak.frozenDays.has(shiftDay(today, -1))) {
    streakMessage.textContent = `A freeze saved your ${streak.current}-day streak yesterday. Check in today so you don't need another.`;
  } else if (streak.checkedInToday) {
    streakMessage.textContent = "You showed up today. Come back tomorrow to keep the streak going.";
  } else if (streak.current > 0) {
    streakMessage.textContent = `Check in before midnight to keep your ${streak.current}-day streak.`;
  } else {
    streakMessage.textContent = "Check in every day to build a streak. Miss a day and your network starts to wilt.";
  }

  // Don't overwrite what the user is typing.
  if (document.activeElement !== checkinInput) checkinInput.value = streak.todayNote;
  checkinLabel.textContent = streak.checkedInToday ? "Today's check-in" : "What did you do on your step today?";
  checkinButton.textContent = streak.checkedInToday ? "Update" : "Check in";
  return streak;
};

// The rewards earned when the page last drew them; null before the
// first draw, so rewards you already had don't celebrate on page load.
let earnedRewardIds = null;

const renderRewards = (tree, streak) => {
  const totalSteps = goalsFromTree(tree).reduce((sum, goal) => sum + goal.completed.length, 0);
  const rewards = computeRewards(totalSteps, streak.best);
  const earned = new Set(rewards.filter((reward) => reward.earned).map((reward) => reward.id));
  const fresh = earnedRewardIds ? rewards.filter((reward) => reward.earned && !earnedRewardIds.has(reward.id)) : [];
  earnedRewardIds = earned;
  // Each reward earned draws one gold ring around every goal.
  network.rewardRings = earned.size;

  rewardStrip.replaceChildren();
  for (const reward of rewards) {
    const item = document.createElement("li");
    item.className = "reward";
    item.classList.toggle("is-earned", reward.earned);
    item.classList.toggle("is-new", fresh.includes(reward));
    item.setAttribute("aria-label", reward.earned
      ? `${reward.label}: earned`
      : `${reward.label}: ${reward.value} of ${reward.target}`);
    const badge = document.createElement("span");
    badge.className = "reward-badge";
    badge.textContent = reward.earned ? String(reward.target) : `${reward.value}/${reward.target}`;
    const label = document.createElement("span");
    label.textContent = reward.kind === "steps" ? "steps" : "day streak";
    item.append(badge, label);
    rewardStrip.append(item);
    if (fresh.includes(reward)) celebrateStep(badge);
  }
  // A new reward lights up the Progress tab until you open it.
  if (fresh.length) setPanelTabDot("progress", true);
  rewardMessage.textContent = fresh.length
    ? `Reward unlocked: ${fresh.map((reward) => reward.label).join(" and ")}! A new gold ring now circles your goals.`
    : "";
};
