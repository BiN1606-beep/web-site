// The owner's stats page (stats.html). Loads /api/stats once and draws a
// few tiles, a 30-day pillar chart and the "where people stop" bars, using
// the shared helpers in charts.js.

const STATS_SERIES = [
  { key: "active", label: "Active", unit: "active" },
  { key: "signups", label: "Sign-ups", unit: "sign-ups" },
  { key: "ai", label: "AI requests", unit: "AI requests" },
];

// Tapping the Members tile shows or hides the member list.
const toggleMembers = (event) => {
  const section = document.querySelector("#stats-members-section");
  section.hidden = !section.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!section.hidden));
  if (!section.hidden) section.scrollIntoView({ behavior: "smooth", block: "start" });
};

const drawStats = (stats, maxGoals) => {
  document.querySelector("#stats-tiles").replaceChildren(
    chartTile({ label: "Members", value: chartNumber(stats.members), sub: `+${chartNumber(stats.new_7d)} this week · see who`, onClick: toggleMembers }),
    chartTile({ label: "Active today", value: chartNumber(stats.active_today), sub: `${chartNumber(stats.active_30d)} this month`, help: "Checked in or finished a step today. Just opening the site does not count." }),
    chartTile({ label: "Active this week", value: chartNumber(stats.active_7d), sub: `${chartPercent(stats.active_7d, stats.members)} of members` }),
    chartTile({ label: "Came back", value: chartPercent(stats.came_back, stats.cohort), sub: "in their 2nd week", help: `${stats.came_back} of ${stats.cohort} people who joined 2–6 weeks ago were active in their second week. Above 30% is good.` }),
  );
  document.querySelector("#stats-extra").replaceChildren(
    chartTile({ label: "Goals finished", value: `${chartNumber(stats.goals_finished)} / ${chartNumber(stats.goals)}` }),
    chartTile({ label: "Using all goals", value: chartNumber(stats.at_limit), help: `People with ${maxGoals} goals: possible Osiris Plus buyers.` }),
    chartTile({ label: "AI requests today", value: chartNumber(stats.ai_today), help: "Calls to the free Groq AI. Keep it inside the free daily limit." }),
  );

  const daily = stats.daily || [];
  const chart = document.querySelector("#stats-chart");
  drawChartSwitch(document.querySelector("#stats-switch"), STATS_SERIES, (series) => {
    const values = daily.map((day) => Number(day[series.key]) || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    drawPillarChart(chart, {
      days: daily.map((day) => day.day),
      values,
      describe: (value) => `${chartNumber(value)} ${series.unit}`,
      summary: `Best day ${chartNumber(Math.max(0, ...values))} · total ${chartNumber(total)}`,
      label: `${series.label} per day, last 30 days`,
    });
  });

  drawMembers(stats.member_list || [], daily.length ? daily[daily.length - 1].day : "");

  // Where people stop: each step as a share of everyone who signed up.
  drawChartBars(document.querySelector("#stats-funnel"), [
    ["Signed up", stats.members],
    ["Made a goal", stats.made_goal],
    ["Checked in", stats.checked_in],
    ["Finished a step", stats.finished_step],
  ].map(([label, value]) => ({
    label,
    value,
    max: stats.members,
    text: `${chartNumber(value)} · ${chartPercent(value, stats.members)}`,
  })));
};

// ---- Members: newest activity first, with a search box ----
const ago = (isoDay, todayIso) => {
  const daysAgo = Math.round((new Date(`${todayIso}T12:00:00`) - new Date(`${isoDay}T12:00:00`)) / 86400000);
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 14) return `${daysAgo} days ago`;
  if (daysAgo < 60) return `${Math.floor(daysAgo / 7)} weeks ago`;
  return `${Math.floor(daysAgo / 30)} months ago`;
};

const drawMembers = (members, todayIso) => {
  const list = document.querySelector("#stats-members");
  const search = document.querySelector("#stats-search");
  const draw = () => {
    const query = search.value.trim().toLowerCase();
    const shown = members.filter((member) => !query
      || (member.name || "").toLowerCase().includes(query)
      || (member.email || "").toLowerCase().includes(query));
    if (!shown.length) {
      list.replaceChildren(chartElement("li", "stats-member-empty", query ? "No one matches that." : "No members yet."));
      return;
    }
    list.replaceChildren(...shown.map((member) => {
      const row = chartElement("li", "stats-member");
      const who = chartElement("div", "stats-member-who");
      who.append(
        chartElement("strong", null, member.name || member.email.split("@")[0]),
        chartElement("span", "stats-member-email", member.email),
      );
      const when = member.last_active
        ? `Active ${member.last_active === todayIso ? "today" : ago(member.last_active, todayIso)}`
        : "Not active yet";
      const facts = chartElement("div", "stats-member-facts");
      facts.append(
        chartElement("span", member.last_active === todayIso ? "is-today" : null, when),
        chartElement("span", null, `Joined ${ago(member.joined, todayIso)}${member.last_login ? ` · last login ${ago(member.last_login, todayIso)}` : ""}`),
        chartElement("span", null, `${member.steps} steps · ${member.checkins} check-ins`),
      );
      row.append(who, facts);
      return row;
    }));
  };
  search.addEventListener("input", draw);
  draw();
};

const loadStats = async () => {
  const updated = document.querySelector("#stats-updated");
  try {
    const response = await fetch("/api/stats", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load the stats.");
    document.querySelector("#stats-main").hidden = false;
    drawStats(data.stats, data.max_goals);
    const time = new Date(data.stats.generated_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    updated.textContent = `Updated ${time}`;
  } catch (error) {
    updated.textContent = error.message;
  }
};

loadStats();
