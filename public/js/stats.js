// The owner's stats page (stats.html). Loads /api/stats once and draws the
// numbers: tiles, a 30-day bar chart, the sign-up funnel and a few lists.
// Plain DOM and SVG, no chart library, so it stays small and free.

const updatedText = document.querySelector("#stats-updated");
const mainSection = document.querySelector("#stats-main");

const formatNumber = (value) => (value == null ? "–" : Number(value).toLocaleString("sv-SE"));
const percent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// ---- The big numbers ----
const drawTiles = (stats) => {
  const tiles = [
    { label: "Members", value: formatNumber(stats.users.total), sub: `+${formatNumber(stats.users.new_7d)} this week` },
    { label: "Active today", value: formatNumber(stats.active.today), sub: `${formatNumber(stats.active.last_7d)} this week` },
    { label: "Active this month", value: formatNumber(stats.active.last_30d), sub: `Stickiness ${percent(stats.active.today, stats.active.last_30d)}` },
    { label: "Week 2 return rate", value: percent(stats.retention.came_back_week2, stats.retention.cohort), sub: `${formatNumber(stats.retention.came_back_week2)} of ${formatNumber(stats.retention.cohort)} people` },
    { label: "Steps finished", value: formatNumber(stats.steps.total), sub: `${formatNumber(stats.steps.last_7d)} this week` },
    { label: "Check-ins", value: formatNumber(stats.checkins.total), sub: `${formatNumber(stats.checkins.last_7d)} this week` },
  ];
  const container = document.querySelector("#stats-tiles");
  container.replaceChildren(...tiles.map((tile) => {
    const card = element("div", "stats-tile");
    card.append(element("span", "stats-tile-label", tile.label), element("strong", "stats-tile-value", tile.value), element("span", "stats-tile-sub", tile.sub));
    return card;
  }));
};

// ---- 30-day chart ----
const SERIES = [
  { key: "active", label: "Active", note: "People who checked in or finished a step each day." },
  { key: "signups", label: "Sign-ups", note: "New accounts each day." },
  { key: "checkins", label: "Check-ins", note: "Daily check-ins each day." },
  { key: "steps", label: "Steps", note: "Steps finished each day." },
  { key: "ai", label: "AI requests", note: "Calls to the Groq AI each day (the free limit is per day)." },
];

const drawChart = (daily, series) => {
  const chart = document.querySelector("#stats-chart");
  const values = daily.map((day) => Number(day[series.key]) || 0);
  const max = Math.max(1, ...values);
  // Draw at the real width so the date labels stay readable on phones.
  const width = Math.max(280, Math.round(chart.clientWidth - 32) || 600);
  const height = width < 500 ? 140 : 180;
  const gap = width < 500 ? 2 : 3;
  const barWidth = width / values.length - gap;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height + 22}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${series.label} per day for the last 30 days, highest ${max}`);

  // A faint line at the top with the highest value, so bars have a scale.
  const top = document.createElementNS(ns, "line");
  top.setAttribute("x1", 0); top.setAttribute("x2", width);
  top.setAttribute("y1", 0.5); top.setAttribute("y2", 0.5);
  top.setAttribute("class", "stats-chart-grid");
  svg.append(top);

  values.forEach((value, index) => {
    const barHeight = value === 0 ? 1 : Math.max(3, (value / max) * (height - 8));
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", index * (barWidth + gap));
    rect.setAttribute("y", height - barHeight);
    rect.setAttribute("width", barWidth);
    rect.setAttribute("height", barHeight);
    rect.setAttribute("rx", 2);
    rect.setAttribute("class", index === values.length - 1 ? "stats-bar is-today" : "stats-bar");
    const title = document.createElementNS(ns, "title");
    title.textContent = `${daily[index].day}: ${value}`;
    rect.append(title);
    svg.append(rect);
  });

  // Dates under the first, middle and last bar.
  [0, Math.floor(values.length / 2), values.length - 1].forEach((index) => {
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", index * (barWidth + gap) + barWidth / 2);
    text.setAttribute("y", height + 16);
    text.setAttribute("text-anchor", index === 0 ? "start" : index === values.length - 1 ? "end" : "middle");
    text.setAttribute("class", "stats-chart-label");
    text.textContent = index === values.length - 1 ? "Today" : daily[index].day.slice(5);
    svg.append(text);
  });

  const peak = element("span", "stats-chart-max", `Highest: ${formatNumber(max)}`);
  chart.replaceChildren(peak, svg);
  const total = values.reduce((sum, value) => sum + value, 0);
  document.querySelector("#stats-chart-note").textContent = `${series.note} Total: ${formatNumber(total)}.`;
};

const drawSwitch = (daily) => {
  const group = document.querySelector("#stats-switch");
  const buttons = SERIES.map((series, index) => {
    const button = element("button", "stats-switch-button", series.label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => {
      buttons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      drawChart(daily, series);
    });
    return button;
  });
  group.replaceChildren(...buttons);
  drawChart(daily, SERIES[0]);
};

// ---- Funnel ----
const drawFunnel = (funnel) => {
  const steps = [
    ["Signed up", funnel.signed_up],
    ["Made a goal", funnel.made_goal],
    ["Did a check-in", funnel.checked_in],
    ["Finished a step", funnel.finished_step],
    ["Active this week", funnel.active_7d],
  ];
  const first = Math.max(1, steps[0][1]);
  document.querySelector("#stats-funnel").replaceChildren(...steps.map(([label, value]) => {
    const row = element("li", "stats-funnel-row");
    const bar = element("span", "stats-funnel-bar");
    bar.style.width = `${Math.max(2, (value / first) * 100)}%`;
    row.append(element("span", "stats-funnel-label", label), bar, element("span", "stats-funnel-value", `${formatNumber(value)} · ${percent(value, steps[0][1])}`));
    return row;
  }));
};

// ---- Lists ----
const drawList = (selector, rows) => {
  document.querySelector(selector).replaceChildren(...rows.flatMap(([label, value]) => [element("dt", null, label), element("dd", null, value)]));
};

const drawAreas = (byArea) => {
  const entries = Object.entries(byArea || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const list = document.querySelector("#stats-areas");
  if (!entries.length) {
    list.replaceChildren(element("li", "stats-note", "No goals yet."));
    return;
  }
  list.replaceChildren(...entries.map(([area, count]) => {
    const row = element("li", "stats-area");
    const bar = element("span", "stats-area-bar");
    bar.style.width = `${(count / Math.max(1, entries[0][1])) * 100}%`;
    bar.style.background = `var(--area-${area.toLowerCase()}, var(--area-other))`;
    row.append(element("span", "stats-area-name", area), bar, element("span", "stats-area-count", `${count} · ${percent(count, total)}`));
    return row;
  }));
};

const draw = (stats, maxGoals) => {
  drawTiles(stats);
  drawSwitch(stats.daily || []);
  drawFunnel(stats.funnel);
  drawList("#stats-goals", [
    ["Goals made", formatNumber(stats.goals.total)],
    ["Goals finished", `${formatNumber(stats.goals.finished)} (${percent(stats.goals.finished, stats.goals.total)})`],
    ["New goals this week", formatNumber(stats.goals.new_7d)],
    ["Goals per member", stats.goals.avg_per_user ?? "–"],
    [`At the goal limit (${maxGoals})`, formatNumber(stats.goals.at_limit)],
  ]);
  drawAreas(stats.goals.by_area);
  drawList("#stats-more", [
    ["AI requests today", formatNumber(stats.ai.today)],
    ["AI requests, 30 days", formatNumber(stats.ai.last_30d)],
    ["Reminders turned on", formatNumber(stats.features.reminders_on)],
    ["Weekly reviews made", `${formatNumber(stats.features.weekly_reviews)} by ${formatNumber(stats.features.weekly_review_users)} people`],
    ["Signed up with Google", formatNumber(stats.users.google)],
    ["Friendships", formatNumber(stats.community.friendships)],
    ["Follows", formatNumber(stats.community.follows)],
    ["Reactions", formatNumber(stats.community.reactions)],
    ["Open reports", formatNumber(stats.community.open_reports)],
  ]);
};

const load = async () => {
  try {
    const response = await fetch("/api/stats", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load the stats.");
    draw(data.stats, data.max_goals);
    const time = new Date(data.stats.generated_at).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
    updatedText.textContent = `Updated ${time}. Reload the page for fresh numbers.`;
    mainSection.hidden = false;
  } catch (error) {
    updatedText.textContent = error.message;
  }
};

load();
