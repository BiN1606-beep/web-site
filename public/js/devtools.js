// Dev tools: a panel for the site owner to see everything about their own
// account and push it back and forth while testing (set the streak, skip a
// day, jump to any step, clear follows, grow a shared tree, ...).
//
// Only the accounts in lua/debug_menu_email.txt can use it. The server
// checks that on every call (lua/osiris/devtools.lua answers 403 to anyone
// else); the Settings button is only shown when the progress tree says
// "dev: true", and the "ä" key just asks the server.
//
// How it works: GET /api/dev gives a "snapshot" of the account, and the
// panel draws it as cards. Each button POSTs { action, ... } and the answer
// carries a fresh snapshot, so the panel always shows what is really saved.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const devBody = document.querySelector("#dev-body");
const devWho = document.querySelector("#dev-who");
const devToast = document.querySelector("#dev-toast");
const devTabs = [...document.querySelectorAll(".dev-tab")];
const devToolsButton = document.querySelector("#open-dev-tools");
const DEV_TAB_STORAGE = "osiris-dev-tab";

let devSnapshot = null;
let devTab = "goals";
let devBusy = false;
let devToastTimer = null;

// ---- Small helpers ----

// Builds an element: devEl("div", { class: "x", text: "hi" }, child, ...).
const devEl = (tag, options = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "onclick") node.addEventListener("click", value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.filter(Boolean));
  return node;
};

const showDevToast = (message, isError = false) => {
  devToast.textContent = message;
  devToast.classList.toggle("is-error", isError);
  devToast.classList.remove("is-shown");
  void devToast.offsetWidth;
  devToast.classList.add("is-shown");
  window.clearTimeout(devToastTimer);
  devToastTimer = window.setTimeout(() => devToast.classList.remove("is-shown"), 2600);
};

// Called by goals.js after loading the tree: only dev accounts see the
// Settings button.
const showDevToolsButton = (isDev) => {
  if (devToolsButton) devToolsButton.hidden = !isDev;
};

// ---- Talking to the server ----

const fetchDevSnapshot = async () => {
  const response = await fetch(`/api/dev?today=${localDay()}`, { cache: "no-store" });
  const result = await readApiResponse(response, "Dev tools");
  if (!response.ok) {
    const error = new Error(result.error || "Could not load dev tools.");
    error.status = response.status;
    throw error;
  }
  return result.snapshot;
};

// After an action the rest of the page should show the new state too.
const refreshPageAfterDev = (result) => {
  if (result.reload) {
    window.setTimeout(() => window.location.reload(), 700);
    return;
  }
  loadProgressTree();
  if (typeof refreshCommunityCounts === "function") refreshCommunityCounts();
};

// Runs one server action. Actions on the progress tree itself (restart the
// interview) go through /api/progress-tree so the page redraws the same
// way it does normally.
const runDevAction = async (body, button) => {
  if (devBusy) return;
  devBusy = true;
  button?.classList.add("is-working");
  devBody.classList.add("is-busy");
  try {
    let result;
    if (body.via === "progress") {
      await postProgressTree({ action: body.action });
      devSnapshot = await fetchDevSnapshot();
      result = { message: body.done };
    } else {
      const response = await fetch("/api/dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, today: localDay() }),
      });
      result = await readApiResponse(response, "Dev tools");
      if (!response.ok) throw new Error(result.error || "That did not work.");
      devSnapshot = result.snapshot;
    }
    renderDevTools();
    showDevToast(result.message || "Done");
    refreshPageAfterDev(result);
  } catch (error) {
    showDevToast(error.message, true);
  } finally {
    devBusy = false;
    button?.classList.remove("is-working");
    devBody.classList.remove("is-busy");
  }
};

// ---- Building blocks for the cards ----

// A big number with a small label under it.
const devStat = (value, label, tone = "") => devEl("div", { class: `dev-stat ${tone}` },
  devEl("strong", { text: String(value) }),
  devEl("span", { text: label }));

const devStats = (...stats) => devEl("div", { class: "dev-stats" }, ...stats);

// A button that runs an action. Dangerous ones need a second tap within
// three seconds ("Tap again"), so nothing is wiped by accident and there's
// no pop-up to click through.
const devButton = (label, body, { danger = false, big = false } = {}) => {
  const button = devEl("button", {
    class: `dev-button${danger ? " is-danger" : ""}${big ? " is-big" : ""}`,
    type: "button",
    text: label,
  });
  let armTimer = null;
  button.addEventListener("click", () => {
    if (danger && !button.classList.contains("is-armed")) {
      button.classList.add("is-armed");
      button.textContent = "Tap again";
      armTimer = window.setTimeout(() => {
        button.classList.remove("is-armed");
        button.textContent = label;
      }, 3000);
      return;
    }
    window.clearTimeout(armTimer);
    button.classList.remove("is-armed");
    button.textContent = label;
    if (typeof body === "function") body(button);
    else runDevAction(body, button);
  });
  return button;
};

const devButtons = (...buttons) => devEl("div", { class: "dev-buttons" }, ...buttons);

const devCard = (title, ...children) => devEl("section", { class: "dev-card" },
  devEl("h2", { text: title }), ...children);

// A yes/no shown as a filled or empty dot.
const devFlag = (on, label) => devEl("span", { class: `dev-flag${on ? " is-on" : ""}`, text: label });

const devShortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "-");

// ---- The tabs ----

const renderGoalsTab = (snapshot) => {
  const goals = snapshot.goals.filter((goal) => !goal.interview);
  const active = snapshot.goals.find((goal) => goal.active);
  const finished = goals.filter((goal) => goal.total > 0 && goal.done >= goal.total).length;
  const cards = [];

  cards.push(devStats(
    devStat(`${goals.length}/8`, "goals"),
    devStat(snapshot.steps_finished, "steps done"),
    devStat(finished, "finished", finished ? "is-gold" : ""),
  ));

  if (active && !active.interview) {
    // One dot per step: tap a dot to jump there. Done steps are filled.
    const dots = devEl("div", { class: "dev-steps", role: "group", "aria-label": "Jump to a step" });
    for (let step = 0; step <= active.total; step += 1) {
      const isEnd = step === active.total;
      dots.append(devEl("button", {
        class: `dev-step${step < active.done ? " is-done" : ""}${step === active.done ? " is-current" : ""}${isEnd ? " is-end" : ""}`,
        type: "button",
        text: isEnd ? "End" : String(step + 1),
        title: isEnd ? "Finish the goal" : `Go to step ${step + 1}`,
        onclick: (event) => runDevAction({ action: "set_step", step }, event.currentTarget),
      }));
    }
    cards.push(devCard(active.title || "Active goal",
      devEl("p", { class: "dev-hint", text: `Step ${Math.min(active.done + 1, active.total)} of ${active.total}${active.done >= active.total ? " · finished" : ""}. Tap a dot to jump.` }),
      dots,
      devButtons(
        devButton("Back to start", { action: "set_step", step: 0 }),
        devButton("Next step", { action: "set_step", step: active.done + 1 }),
        devButton("Finish goal", { action: "set_step", step: active.total }),
      )));
  } else {
    cards.push(devCard("Active goal", devEl("p", { class: "dev-hint", text: active ? "In the interview, no steps yet." : "No goal yet." })));
  }

  if (goals.length) {
    const list = devEl("ul", { class: "dev-list" });
    for (const goal of goals) {
      const percent = goal.total ? Math.round((goal.done / goal.total) * 100) : 0;
      list.append(devEl("li", { class: goal.active ? "is-active" : "" },
        devEl("span", { class: "dev-list-title", text: goal.title || "Untitled" }),
        devEl("span", { class: "dev-bar" }, devEl("span", { style: `width: ${percent}%` })),
        devEl("span", { class: "dev-list-meta", text: `${goal.done}/${goal.total}${goal.grows_from ? " · sprout" : ""}` })));
    }
    cards.push(devCard("All goals", list));
  }

  cards.push(devCard("Start over",
    devEl("p", { class: "dev-hint", text: "Deletes every goal and opens the goal interview." }),
    devButtons(devButton("Restart interview", {
      via: "progress", action: "debug_reset", done: "All goals removed",
    }, { danger: true }))));
  return cards;
};

const renderStreakTab = (snapshot) => {
  const today = localDay();
  const streak = computeStreak(snapshot.checkins, today);
  const cards = [];

  cards.push(devStats(
    devStat(streak.current, "streak", streak.current ? "is-gold" : ""),
    devStat(streak.best, "best"),
    devStat(streak.freezes, "freezes", streak.freezes ? "is-blue" : ""),
    devStat(streak.missed, "missed", streak.missed ? "is-red" : ""),
  ));

  // The last 4 weeks, oldest first. Tap a day to add or remove a check-in.
  const calendar = devEl("div", { class: "dev-calendar", role: "group", "aria-label": "Check-ins, last 28 days" });
  for (let offset = 27; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset);
    const state = streak.days.has(day) ? "is-done" : streak.frozenDays.has(day) ? "is-frozen" : "";
    calendar.append(devEl("button", {
      class: `dev-day ${state}${day === today ? " is-today" : ""}`,
      type: "button",
      text: String(Number(day.slice(8))),
      title: `${day}: ${state === "is-done" ? "checked in" : state === "is-frozen" ? "freeze used" : "no check-in"}`,
      onclick: (event) => runDevAction({ action: "toggle_day", day }, event.currentTarget),
    }));
  }
  cards.push(devCard("Last 4 weeks",
    calendar,
    devEl("p", { class: "dev-legend" },
      devFlag(true, "checked in"), devEl("span", { class: "dev-flag is-frozen", text: "freeze" }),
      devEl("span", { class: "dev-flag is-today", text: "today" }))));

  cards.push(devCard("Set the streak",
    devEl("p", { class: "dev-hint", text: "Ends yesterday, so today's check-in stays open to test." }),
    devButtons(
      devButton("0", { action: "set_streak", days: 0 }),
      devButton("3", { action: "set_streak", days: 3 }),
      devButton("6", { action: "set_streak", days: 6 }),
      devButton("7", { action: "set_streak", days: 7 }),
      devButton("14", { action: "set_streak", days: 14 }),
      devButton("30", { action: "set_streak", days: 30 }),
      devButton("100", { action: "set_streak", days: 100 }),
    )));

  cards.push(devCard("Time",
    devEl("p", { class: "dev-hint", text: "Skip a day moves all your dates one day back, like a day went by without you." }),
    devButtons(
      devButton("Skip a day", { action: "skip_day" }, { big: true }),
      devButton(streak.checkedInToday ? "Undo today's check-in" : "Check in today", { action: "toggle_day", day: today }),
      devButton("Remove all check-ins", { action: "clear_checkins" }, { danger: true }),
    ),
    devEl("p", { class: "dev-hint", text: `${snapshot.checkin_total} check-ins saved in total.` })));
  return cards;
};

const renderFriendsTab = (snapshot) => {
  const social = snapshot.social;
  const cards = [];
  cards.push(devStats(
    devStat(social.following, "following"),
    devStat(social.followers, "followers"),
    devStat(social.friends, "friends", social.friends ? "is-gold" : ""),
    devStat(social.requests_in + social.requests_out, "requests"),
  ));

  const trees = snapshot.shared_trees;
  const treeList = devEl("ul", { class: "dev-list" });
  for (const tree of trees) {
    treeList.append(devEl("li", {},
      devEl("span", { class: "dev-list-title", text: `${tree.title} · ${tree.partner}` }),
      devEl("span", { class: "dev-list-meta", text: `${tree.status} · grown ${tree.grown}` }),
      devEl("span", { class: "dev-today" },
        devFlag(tree.me_today, "you"), devFlag(tree.partner_today, "them"))));
  }
  cards.push(devCard("Shared trees",
    trees.length ? treeList : devEl("p", { class: "dev-hint", text: "No shared trees. Plant one with a friend in Community." }),
    devButtons(
      devButton("Grow +1 day", { action: "grow_shared", days: 1 }),
      devButton("Grow +7 days", { action: "grow_shared", days: 7 }),
      devButton("Unwater today", { action: "unwater_today" }),
      devButton("Remove all", { action: "clear_shared_trees" }, { danger: true }),
    )));

  cards.push(devCard("Follows and bell",
    devEl("p", { class: "dev-hint", text: `${social.requests_in} requests to you, ${social.requests_out} from you. ${social.unread} of ${social.notifications} notifications unread. Profile is ${social.visibility || "private"}.` }),
    devButtons(
      devButton("Mark all unread", { action: "unread_notifications" }),
      devButton("Clear notifications", { action: "clear_notifications" }),
      devButton("Clear community posts", { action: "clear_activities" }, { danger: true }),
      devButton("Clear all follows", { action: "clear_follows" }, { danger: true }),
    )));
  return cards;
};

const renderAccountTab = (snapshot) => {
  const account = snapshot.account;
  const reminders = snapshot.reminders;
  const cards = [];
  cards.push(devStats(
    devStat(`#${account.id}`, "account"),
    devStat(account.sessions, "sign-ins"),
    devStat(snapshot.reviews.total, "reviews"),
    devStat(reminders.length, "reminders"),
  ));

  cards.push(devCard("You",
    devEl("p", { class: "dev-flags" },
      devFlag(account.onboarding_seen, "welcome done"),
      devFlag(account.google, "Google"),
      devFlag(account.password, "password"),
      devFlag(account.picture, "picture"),
      devFlag(account.custom_look, "own theme"),
      devFlag(account.custom_network, "own network look")),
    devEl("p", { class: "dev-hint", text: `Joined ${devShortDate(account.joined)}.` }),
    devButtons(
      devButton("Show welcome again", { action: "reset_onboarding" }),
      devButton("Reset look", { action: "reset_look" }),
      devButton("Forget this browser", () => {
        // Saved tab, reminder hour and a copy of the look live in this
        // browser only (localStorage). Clearing it shows first-visit behavior.
        try { localStorage.clear(); } catch { /* storage may be blocked */ }
        showDevToast("Browser memory cleared");
        window.setTimeout(() => window.location.reload(), 700);
      }, { danger: true }),
    )));

  cards.push(devCard("Weekly review",
    devEl("p", { class: "dev-flags" }, devFlag(snapshot.reviews.this_week, "done this week")),
    devButtons(devButton("Remove this week's", { action: "clear_week_review" }))));

  const reminderLine = reminders.length
    ? reminders.map((reminder) => `${String(reminder.hour).padStart(2, "0")}:00 ${reminder.timezone}, last sent ${reminder.last_sent || "never"}`).join(" · ")
    : "Not turned on in any browser.";
  cards.push(devCard("Reminder",
    devEl("p", { class: "dev-hint", text: reminderLine }),
    devButtons(devButton("Let it send again today", { action: "reset_reminder" }))));

  // Everything the server sent, for the details the cards leave out.
  const raw = devEl("details", { class: "dev-raw" },
    devEl("summary", { text: "Raw data" }),
    devEl("pre", { text: JSON.stringify(snapshot, null, 2) }));
  cards.push(devCard("More", devButtons(devEl("a", { class: "dev-button", href: "/stats.html", text: "Site stats" })), raw));
  return cards;
};

// Cards that other features add on the server (lua/osiris/devtools.lua,
// EXTRA_SECTIONS), for example gems: numbers plus buttons, nothing else
// needed here.
const renderExtrasTab = (snapshot) => snapshot.extras.map((extra) => devCard(extra.title || "Extra",
  devStats(...(extra.stats || []).map((stat) => devStat(stat.value, stat.label))),
  devButtons(...(extra.actions || []).map((action) => devButton(action.label, {
    ...action, label: undefined, danger: undefined,
  }, { danger: action.danger === true }))),
));

const DEV_TABS = {
  goals: renderGoalsTab,
  streak: renderStreakTab,
  friends: renderFriendsTab,
  account: renderAccountTab,
  extras: renderExtrasTab,
};

const renderDevTools = () => {
  const snapshot = devSnapshot;
  if (!snapshot) return;
  const account = snapshot.account;
  devWho.textContent = `${account.name || "No name"} · ${account.email}`;

  const hasExtras = snapshot.extras?.length > 0;
  devTabs.find((tab) => tab.dataset.devTab === "extras").hidden = !hasExtras;
  if (devTab === "extras" && !hasExtras) devTab = "goals";
  for (const tab of devTabs) tab.setAttribute("aria-selected", String(tab.dataset.devTab === devTab));

  devBody.replaceChildren(...DEV_TABS[devTab](snapshot));
};

for (const tab of devTabs) {
  tab.addEventListener("click", () => {
    devTab = tab.dataset.devTab;
    try { localStorage.setItem(DEV_TAB_STORAGE, devTab); } catch { /* fine */ }
    renderDevTools();
    devBody.classList.remove("is-entering");
    void devBody.offsetWidth;
    devBody.classList.add("is-entering");
  });
}

// ---- Opening ----

let devOpenRequest = null;

// Called by the "ä" key (panels.js) and the Settings button. For anyone
// who isn't a dev account the server says 403 and nothing opens.
const openDebugMenu = async () => {
  if (devOpenRequest) return devOpenRequest;
  devOpenRequest = (async () => {
    try {
      devSnapshot = await fetchDevSnapshot();
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) console.error("Could not open dev tools:", error);
      return;
    }
    try { devTab = localStorage.getItem(DEV_TAB_STORAGE) || "goals"; } catch { devTab = "goals"; }
    if (!DEV_TABS[devTab]) devTab = "goals";
    renderDevTools();
    openPanel(debugMenuDialog, null);
  })();
  try {
    await devOpenRequest;
  } finally {
    devOpenRequest = null;
  }
};

devToolsButton?.addEventListener("click", openDebugMenu);
