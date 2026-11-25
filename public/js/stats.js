// The owner's stats page (stats.html). Loads /api/stats once and draws a
// few tiles, a 30-day bar chart and the "where people stop" funnel.
// Plain DOM and SVG, no chart library, so it stays small and free.

const formatNumber = (value) => Number(value || 0).toLocaleString("sv-SE");
const percent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// A tile: label, big number, one short line. "help" shows on hover.
const tile = ({ label, value, sub, help }) => {
  const card = element("div", "stats-tile");
  if (help) card.title = help;
  card.append(element("span", "stats-tile-label", label), element("strong", "stats-tile-value", value));
  if (sub) card.append(element("span", "stats-tile-sub", sub));
  return card;
};

// ---- 30-day bar chart ----
const SERIES = [
  { key: "active", label: "Active" },
  { key: "signups", label: "Sign-ups" },
  { key: "ai", label: "AI requests" },
];

const drawChart = (daily, series) => {
  const chart = document.querySelector("#stats-chart");
  const values = daily.map((day) => Number(day[series.key]) || 0);
  const max = Math.max(1, ...values);
  // Draw at the real width so the labels stay readable on phones.
  const width = Math.max(280, Math.round(chart.clientWidth - 32) || 600);
  const height = width < 500 ? 120 : 160;
  const gap = width < 500 ? 2 : 3;
  const barWidth = width / values.length - gap;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height + 20}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${series.label} per day, last 30 days`);

  values.forEach((value, index) => {
    const barHeight = value === 0 ? 1 : Math.max(3, (value / max) * height);
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

  [[0, "30 days ago", "start"], [values.length - 1, "Today", "end"]].forEach(([index, text, anchor]) => {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", anchor === "start" ? 0 : width);
    label.setAttribute("y", height + 15);
    label.setAttribute("text-anchor", anchor);
    label.setAttribute("class", "stats-chart-label");
    label.textContent = text;
    svg.append(label);
  });

  const total = values.reduce((sum, value) => sum + value, 0);
  chart.replaceChildren(element("span", "stats-chart-max", `Best day ${formatNumber(max)} · total ${formatNumber(total)}`), svg);
};

const drawSwitch = (daily) => {
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
  document.querySelector("#stats-switch").replaceChildren(...buttons);
  drawChart(daily, SERIES[0]);
};

// ---- Funnel: how far people get ----
const drawFunnel = (stats) => {
  const steps = [
    ["Signed up", stats.members],
    ["Made a goal", stats.made_goal],
    ["Checked in", stats.checked_in],
    ["Finished a step", stats.finished_step],
  ];
  const first = Math.max(1, stats.members);
  document.querySelector("#stats-funnel").replaceChildren(...steps.map(([label, value]) => {
    const row = element("li", "stats-funnel-row");
    const bar = element("span", "stats-funnel-bar");
    bar.style.width = `${Math.max(1, (value / first) * 100)}%`;
    row.append(element("span", "stats-funnel-label", label), bar, element("span", "stats-funnel-value", `${formatNumber(value)} · ${percent(value, stats.members)}`));
    return row;
  }));
};

const draw = (stats, maxGoals) => {
  document.querySelector("#stats-tiles").replaceChildren(
    tile({ label: "Members", value: formatNumber(stats.members), sub: `+${formatNumber(stats.new_7d)} this week` }),
    tile({ label: "Active today", value: formatNumber(stats.active_today), sub: `${formatNumber(stats.active_30d)} this month`, help: "Checked in or finished a step today. Just opening the site does not count." }),
    tile({ label: "Active this week", value: formatNumber(stats.active_7d), sub: percent(stats.active_7d, stats.members) + " of members" }),
    tile({ label: "Came back", value: percent(stats.came_back, stats.cohort), sub: "in their 2nd week", help: `${stats.came_back} of ${stats.cohort} people who joined 2–6 weeks ago were active in their second week. Above 30% is good.` }),
  );
  document.querySelector("#stats-extra").replaceChildren(
    tile({ label: "Goals finished", value: `${formatNumber(stats.goals_finished)} / ${formatNumber(stats.goals)}` }),
    tile({ label: "Using all goals", value: formatNumber(stats.at_limit), help: `People with ${maxGoals} goals: possible Osiris Plus buyers.` }),
    tile({ label: "AI requests today", value: formatNumber(stats.ai_today), help: "Calls to the free Groq AI. Keep it inside the free daily limit." }),
  );
  drawSwitch(stats.daily || []);
  drawFunnel(stats);
};

const load = async () => {
  const updated = document.querySelector("#stats-updated");
  try {
    const response = await fetch("/api/stats", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load the stats.");
    document.querySelector("#stats-main").hidden = false;
    draw(data.stats, data.max_goals);
    const time = new Date(data.stats.generated_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    updated.textContent = `Updated ${time}`;
  } catch (error) {
    updated.textContent = error.message;
  }
};

load();
