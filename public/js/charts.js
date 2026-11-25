// Small chart helpers shared by the site stats page (stats.js) and "Your
// stats" in the Progress tab (my-stats.js): number tiles, a 30-day chart of
// rounded pillars you can tap, and the buttons that switch what it shows.
// Plain DOM and SVG, no chart library, so it stays small and free.
//
// On the main page this is a plain script like the others (see the list at
// the end of index.html), so every name starts with "chart" to avoid clashes.

const chartNumber = (value) => Number(value || 0).toLocaleString("sv-SE");
const chartPercent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

const chartElement = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// A tile: label, big number, one short line. "help" shows on hover. With
// "onClick" the tile is a button.
const chartTile = ({ label, value, sub, help, onClick }) => {
  const card = chartElement(onClick ? "button" : "div", onClick ? "chart-tile is-button" : "chart-tile");
  if (onClick) {
    card.type = "button";
    card.addEventListener("click", onClick);
  }
  if (help) card.title = help;
  const number = chartElement("strong", "chart-tile-value", value);
  card.append(chartElement("span", "chart-tile-label", label), number);
  if (sub) card.append(chartElement("span", "chart-tile-sub", sub));
  chartCountUp(number);
  return card;
};

// Counts the first number in a tile up from 0 ("15%", "8 / 30", "1 234"),
// unless the device asks for reduced motion.
const chartCountUp = (node) => {
  const text = node.textContent;
  const match = text.match(/^(\d+(?:[\s\u00a0]\d{3})*)(.*)$/);
  if (!match || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = Number(match[1].replace(/[\s\u00a0]/g, ""));
  if (!Number.isFinite(target) || target < 2) return;
  const rest = match[2];
  const start = performance.now();
  const duration = 800;
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = `${chartNumber(Math.round(target * eased))}${rest}`;
    if (progress < 1) requestAnimationFrame(step);
    else node.textContent = text;
  };
  node.textContent = `0${rest}`;
  requestAnimationFrame(step);
};

// The last `count` days as "YYYY-MM-DD", oldest first, in local time.
const chartLastDays = (count, today = new Date()) => Array.from({ length: count }, (_, index) => {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - index));
  return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0")].join("-");
});

// "Today", "Yesterday", "Monday", or "Monday, 2 weeks ago": the day, not the date.
const chartDayName = (isoDay, todayIso) => {
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
const chartPillarPath = (x, y, width, height) => {
  const radius = Math.min(width / 2, height, 8);
  return `M${x},${y + height} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} Z`;
};

// Draws one pillar per day into `container`.
//   days:     ["YYYY-MM-DD", ...] oldest first (the last one is today)
//   values:   one number per day
//   describe: (value) => text after the day name, e.g. "4 active"
//   summary:  the line shown when no pillar is picked
const drawPillarChart = (container, { days, values, describe, summary, label }) => {
  const max = Math.max(1, ...values);
  const todayIso = days[days.length - 1];
  // Draw at the real width so everything stays readable on phones.
  const width = Math.max(260, Math.round(container.clientWidth - 32) || 600);
  const height = width < 500 ? 120 : 160;
  const slot = width / values.length;
  const barWidth = slot * (width < 500 ? 0.68 : 0.62);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height + 20}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", label);

  const info = chartElement("span", "chart-info", summary);

  const pillars = values.map((value, index) => {
    const x = index * slot + (slot - barWidth) / 2;
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", index === values.length - 1 ? "chart-pillar is-today" : "chart-pillar");
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    const text = `${chartDayName(days[index], todayIso)}: ${describe(value)}`;
    group.setAttribute("aria-label", text);
    // Its place in the row, so the pillars pop up one after another.
    group.style.setProperty("--i", String(index));

    // A soft track behind each pillar, so empty days still look tidy.
    const track = document.createElementNS(ns, "path");
    track.setAttribute("d", chartPillarPath(x, 0, barWidth, height));
    track.setAttribute("class", "chart-pillar-track");
    group.append(track);

    if (value > 0) {
      const barHeight = Math.max(barWidth, (value / max) * height);
      const bar = document.createElementNS(ns, "path");
      bar.setAttribute("d", chartPillarPath(x, height - barHeight, barWidth, barHeight));
      bar.setAttribute("class", "chart-pillar-bar");
      group.append(bar);
    }

    // Tap a pillar to see its day; tap it again to go back to the summary.
    const pick = () => {
      const wasPicked = group.classList.contains("is-picked");
      pillars.forEach((other) => other.classList.remove("is-picked"));
      if (!wasPicked) group.classList.add("is-picked");
      info.textContent = wasPicked ? summary : text;
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
    const dayLabel = document.createElementNS(ns, "text");
    dayLabel.setAttribute("x", x);
    dayLabel.setAttribute("y", height + 15);
    dayLabel.setAttribute("text-anchor", anchor);
    dayLabel.setAttribute("class", "chart-label");
    dayLabel.textContent = text;
    svg.append(dayLabel);
  });

  container.replaceChildren(info, svg);
};

// Buttons that switch the chart between series. `draw(series)` redraws it.
const drawChartSwitch = (group, seriesList, draw) => {
  const buttons = seriesList.map((series, index) => {
    const button = chartElement("button", "chart-switch-button", series.label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => {
      buttons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      draw(series);
    });
    return button;
  });
  group.replaceChildren(...buttons);
  draw(seriesList[0]);
};

// Horizontal bars: [{ label, value, max, text, color }].
const drawChartBars = (list, rows) => {
  list.replaceChildren(...rows.map((row, index) => {
    const item = chartElement("li", "chart-bar-row");
    const track = chartElement("span", "chart-bar-track");
    const bar = chartElement("span", "chart-bar");
    bar.style.width = `${Math.max(0, Math.min(100, (row.value / Math.max(1, row.max)) * 100))}%`;
    if (row.color) bar.style.background = row.color;
    bar.style.setProperty("--i", String(index));
    track.append(bar);
    item.append(chartElement("span", "chart-bar-label", row.label), track, chartElement("span", "chart-bar-value", row.text));
    return item;
  }));
};

// A line chart for a total that grows over time, like the number of members.
//   points:  [{ label, value, added }] oldest first. "label" names the
//            hour/day/month, "value" is the total at its end, "added" how
//            much it grew in it.
//   describe: (point) => text shown when a point is picked
//   summary:  the line shown when nothing is picked
//   ends:     [left text, right text] under the line
// Move over the chart (or tap it) to pick the nearest point.
const drawLineChart = (container, { points, describe, summary, label, ends }) => {
  const ns = "http://www.w3.org/2000/svg";
  const width = Math.max(260, Math.round(container.clientWidth - 32) || 600);
  const height = width < 500 ? 120 : 160;
  const pad = 8;
  // Room above the line for the label of the highest total.
  const top = 22;
  const values = points.map((point) => point.value);
  // The line uses the full height between the lowest and highest total, so
  // even a few new members show as a clear climb.
  const low = Math.min(...values);
  const high = Math.max(low + 1, ...values);
  const xOf = (index) => (points.length < 2 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2));
  const yOf = (value) => top + (1 - (value - low) / (high - low)) * (height - top - pad);

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height + 20}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${label}. ${summary}`);
  svg.setAttribute("class", "chart-line-chart");
  const info = chartElement("span", "chart-info", summary);

  const add = (tag, attributes, className) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (className) node.setAttribute("class", className);
    svg.append(node);
    return node;
  };

  // Two faint lines with the highest and lowest total. A growing total is
  // low on the left and high on the right, so the highest label sits on the
  // left and the lowest on the right, where the line never covers them.
  [[high, top, 0, "start"], [low, height - pad, width, "end"]].forEach(([value, y, x, anchor]) => {
    add("line", { x1: 0, x2: width, y1: y, y2: y }, "chart-grid");
    const text = add("text", { x, y: y - 6, "text-anchor": anchor }, "chart-label");
    text.textContent = chartNumber(value);
  });

  const line = points.map((point, index) => `${index ? "L" : "M"}${xOf(index).toFixed(1)},${yOf(point.value).toFixed(1)}`).join(" ");
  if (points.length > 1) {
    add("path", { d: `${line} L${xOf(points.length - 1)},${height} L${xOf(0)},${height} Z` }, "chart-line-area");
  }
  // pathLength=1 lets the CSS draw the line from left to right.
  add("path", { d: line, pathLength: 1 }, "chart-line");

  // The picked point: a guide line and a dot.
  const guide = add("line", { y1: 0, y2: height }, "chart-line-guide");
  const dot = add("circle", { r: 5 }, "chart-line-dot");
  const last = points.length - 1;
  const show = (index) => {
    const x = xOf(index);
    guide.setAttribute("x1", x);
    guide.setAttribute("x2", x);
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", yOf(points[index].value));
    svg.classList.toggle("is-picking", index !== last || info.textContent !== summary);
  };
  show(last);

  ends.forEach((text, index) => {
    const end = add("text", { x: index ? width : 0, y: height + 15, "text-anchor": index ? "end" : "start" }, "chart-label");
    end.textContent = text;
  });

  const nearest = (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    const step = points.length < 2 ? 1 : (width - pad * 2) / (points.length - 1);
    return Math.max(0, Math.min(last, Math.round((x - pad) / step)));
  };
  svg.addEventListener("pointermove", (event) => {
    const index = nearest(event);
    info.textContent = describe(points[index]);
    show(index);
  });
  svg.addEventListener("pointerleave", (event) => {
    // Touch screens fire "leave" right after a tap, so keep the pick there.
    if (event.pointerType === "touch") return;
    info.textContent = summary;
    svg.classList.remove("is-picking");
    show(last);
  });
  svg.addEventListener("pointerdown", (event) => {
    const index = nearest(event);
    info.textContent = describe(points[index]);
    show(index);
  });

  container.replaceChildren(info, svg);
};
