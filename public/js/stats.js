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

// "Today", "Yesterday", "Monday", or "Monday, 2 weeks ago": the day, not the date.
const dayName = (isoDay, todayIso) => {
  const day = new Date(`${isoDay}T12:00:00`);
  const daysAgo = Math.round((new Date(`${todayIso}T12:00:00`) - day) / 86400000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  const weekday = day.toLocaleDateString("en-GB", { weekday: "long" });
  if (daysAgo < 7) return weekday;
  const weeks = Math.floor(daysAgo / 7);
  return `${weekday}, ${weeks === 1 ? "last week" : `${weeks} weeks ago`}`;
};

// A bar with round top corners and a flat bottom, as an SVG path.
const pillarPath = (x, y, width, height) => {
  const radius = Math.min(width / 2, height, 8);
  return `M${x},${y + height} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} Z`;
};

const drawChart = (daily, series) => {
  const chart = document.querySelector("#stats-chart");
  const values = daily.map((day) => Number(day[series.key]) || 0);
  const max = Math.max(1, ...values);
  const todayIso = daily.length ? daily[daily.length - 1].day : "";
  // Draw at the real width so everything stays readable on phones.
  const width = Math.max(280, Math.round(chart.clientWidth - 32) || 600);
  const height = width < 500 ? 120 : 160;
  const slot = width / values.length;
  const barWidth = slot * (width < 500 ? 0.68 : 0.62);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height + 20}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${series.label} per day, last 30 days`);

  // The line above the chart: the picked day, or the best day and total.
  const info = element("span", "stats-chart-info");
  const total = values.reduce((sum, value) => sum + value, 0);
  const summary = `Best day ${formatNumber(max)} · total ${formatNumber(total)}`;
  info.textContent = summary;

  const pillars = values.map((value, index) => {
    const x = index * slot + (slot - barWidth) / 2;
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", index === values.length - 1 ? "stats-pillar is-today" : "stats-pillar");
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    const text = `${dayName(daily[index].day, todayIso)}: ${formatNumber(value)} ${series.label.toLowerCase()}`;
    group.setAttribute("aria-label", text);

    // A soft track behind each pillar, so empty days still look tidy.
    const track = document.createElementNS(ns, "path");
    track.setAttribute("d", pillarPath(x, 0, barWidth, height));
    track.setAttribute("class", "stats-pillar-track");
    group.append(track);

    if (value > 0) {
      const barHeight = Math.max(barWidth, (value / max) * height);
      const bar = document.createElementNS(ns, "path");
      bar.setAttribute("d", pillarPath(x, height - barHeight, barWidth, barHeight));
      bar.setAttribute("class", "stats-pillar-bar");
      group.append(bar);
    }

    const pick = () => {
      const wasPicked = group.classList.contains("is-picked");
      pillars.forEach((other) => other.classList.remove("is-picked"));
      if (wasPicked) {
        info.textContent = summary;
        return;
      }
      group.classList.add("is-picked");
      info.textContent = text;
    };
    group.addEventListener("click", pick);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pick();
      }
    });
    svg.append(group);
    return group;
  });

  [["30 days ago", "start", 0], ["Today", "end", width]].forEach(([text, anchor, x]) => {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", height + 15);
    label.setAttribute("text-anchor", anchor);
    label.setAttribute("class", "stats-chart-label");
    label.textContent = text;
    svg.append(label);
  });

  chart.replaceChildren(info, svg);
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
