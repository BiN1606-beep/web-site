// Drawing a shared network: the picture that grows when two friends both
// check in on the same day (see lua/osiris/shared_trees.lua, where it is
// still called a "tree").
//
// It is drawn exactly like your own progress network (js/network.js),
// with the same dots, lines, glow and physics, and it follows your
// Customize choices (dot size, spread, pull, curvy lines and sky):
// - The shared goal is the big dot in the middle, half green (you) and
//   half gold (your friend).
// - You and your friend are the two big rings, like the life areas in
//   your own network.
// - Every day you BOTH checked in is a step on the goal's chain. Recent
//   days glow, and every 10th day is a gold milestone.
// - Today is the ringed step that pulses. When one of you has checked in,
//   it fills with that person's color while it waits for the other.
// - The dashed steps are the days left to the next stage.
// - A side quest is a small open dot hanging off the person who did it:
//   it saved the streak but didn't grow the chain.
// Every 30 days together adds a thin gold ring around the goal.
//
// Hover or tap a dot to see its day and what you both wrote. Drag the
// dots around. The expand button opens it big, where you can also zoom.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const SHARED_TREE_STAGES = [
  [0, "Spark"],
  [1, "First link"],
  [3, "Small web"],
  [7, "Network"],
  [14, "Growing network"],
  [30, "Big network"],
  [60, "Huge network"],
  [100, "Giant network"],
];

// The stage for a size, and how many days are left until the next one.
const sharedTreeStage = (grown) => {
  let index = 0;
  while (index + 1 < SHARED_TREE_STAGES.length && grown >= SHARED_TREE_STAGES[index + 1][0]) index += 1;
  const next = SHARED_TREE_STAGES[index + 1];
  return {
    name: SHARED_TREE_STAGES[index][1],
    next: next ? next[1] : null,
    daysToNext: next ? next[0] - grown : 0,
  };
};

const SVG_NS = "http://www.w3.org/2000/svg";
const svgElement = (tag, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
};

// The most days drawn as steps. Older days still count (the gold rings
// around the goal show them), they just aren't drawn one by one.
const SHARED_MAX_STEPS = 90;
// Days that glow, like the steps you finished this week in your network.
const SHARED_RECENT_DAYS = 7;
// How many of the days left to the next stage are drawn as dashed steps.
const SHARED_LOCKED_STEPS = 5;

// Each drawing needs its own id for the half green, half gold fill.
let sharedDrawings = 0;

// "Mon 24 Nov" for a "YYYY-MM-DD" day.
const sharedDayName = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
  weekday: "short", day: "numeric", month: "short",
});

// Builds the dots and lines. Sizes and distances are the same as in your
// own network (renderNetwork in js/network.js).
const sharedNetworkGraph = (tree) => {
  const grown = Math.max(0, Number(tree.grown) || 0);
  const friendName = tree.partner_name || "Friend";
  const days = Array.isArray(tree.days) ? tree.days : [];
  const growing = tree.status === "growing";
  const nodes = [
    { id: "you", kind: "area", side: "you", label: "You", r: 22, charge: -600, tx: -95, ty: 110 },
    { id: "friend", kind: "area", side: "friend", label: friendName, r: 22, charge: -600, tx: 95, ty: 110 },
    { id: "goal", kind: "goal", label: tree.title || "", r: 15, charge: -350, rings: Math.min(Math.floor(grown / 30), 6), tx: 0, ty: 0 },
  ];
  const links = [
    { source: "you", target: "goal", kind: "area", grown: growing, distance: 90 },
    { source: "friend", target: "goal", kind: "area", grown: growing, distance: 90 },
  ];

  // The days you both checked in, oldest first. The server sends the last
  // 60 days, so older steps have no notes, only their number.
  const together = days.filter((day) => day.me && day.partner)
    .sort((first, second) => (first.day < second.day ? -1 : 1));
  const firstShown = Math.max(0, grown - SHARED_MAX_STEPS);
  const recentFrom = Date.now() - SHARED_RECENT_DAYS * 24 * 60 * 60 * 1000;
  let previous = "goal";
  for (let number = firstShown + 1; number <= grown; number += 1) {
    const entry = together[together.length - (grown - number) - 1];
    const id = `day${number}`;
    const milestone = number % 10 === 0;
    nodes.push({
      id,
      kind: "step",
      status: "done",
      number,
      entry,
      label: milestone ? `Day ${number}` : entry ? sharedDayName(entry.day) : `Day ${number}`,
      milestone,
      recent: Boolean(entry) && Date.parse(`${entry.day}T23:59:59`) >= recentFrom,
      r: milestone ? 9 : 6.5,
      charge: -120,
    });
    links.push({ source: previous, target: id, kind: "chain", grown: true, distance: previous === "goal" ? 46 : 30 });
    previous = id;
  }

  // Today, and the days left to the next stage.
  if (growing) {
    const todayEntry = days.find((day) => day.day === tree.today) || {};
    if (!(todayEntry.me && todayEntry.partner)) {
      nodes.push({
        id: "today",
        kind: "step",
        status: "current",
        entry: todayEntry.day ? todayEntry : null,
        waiting: tree.waitingSide || null,
        label: "Today",
        r: 8,
        charge: -120,
      });
      links.push({ source: previous, target: "today", kind: "chain", grown: false, distance: previous === "goal" ? 46 : 30 });
      previous = "today";
    }
    const locked = Math.min(SHARED_LOCKED_STEPS, sharedTreeStage(grown).daysToNext - (previous === "today" ? 1 : 0));
    for (let index = 0; index < locked; index += 1) {
      const id = `locked${index}`;
      nodes.push({ id, kind: "step", status: "locked", label: "Locked", r: 4.5, charge: -120 });
      links.push({ source: previous, target: id, kind: "chain", grown: false, distance: 30 });
      previous = id;
    }
  }

  // Side quests: open dots off the person who did them, like skills.
  days.filter((day) => day.saved).slice(0, 12).forEach((day, index) => {
    const side = day.saved === "me" ? "you" : "friend";
    const id = `save${index}`;
    nodes.push({ id, kind: "skill", side, entry: day, label: `Side quest: ${day.quest || "saved the streak"}`, r: 5, charge: -160 });
    links.push({ source: side, target: id, kind: "skill", distance: 70 });
  });

  return { nodes, links };
};

// The colors for each side: you are the accent green, your friend gold.
const SHARED_SIDE_COLORS = { you: "var(--accent)", friend: "var(--sun)" };

// What a dot says when you hover or tap it: the day and both notes.
const sharedNodeDetails = (node, friendName) => {
  const lines = [];
  if (node.kind === "goal") lines.push(node.label);
  if (node.kind === "area") lines.push(node.side === "you" ? "You" : friendName);
  if (node.kind === "step" && node.status === "done") {
    lines.push(node.entry ? `Day ${node.number} · ${sharedDayName(node.entry.day)}` : `Day ${node.number}`);
  }
  if (node.status === "current") {
    lines.push(node.waiting === "you" ? `Today · waiting for ${friendName}`
      : node.waiting === "friend" ? `Today · ${friendName} checked in, your turn`
        : "Today · check in together to grow");
  }
  if (node.status === "locked") lines.push("A day still to grow");
  if (node.kind === "skill") lines.push(`${sharedDayName(node.entry.day)} · ${node.label}`);
  if (node.entry && node.kind !== "skill") {
    if (node.entry.me) lines.push(`You: ${node.entry.me}`);
    if (node.entry.partner) lines.push(`${friendName}: ${node.entry.partner}`);
  }
  return lines;
};

// A few quiet steps of physics without drawing, for when d3 isn't loaded:
// the steps then sit on a spiral around the goal.
const sharedSpiralLayout = (nodes, links) => {
  let step = 0;
  for (const node of nodes) {
    if (node.tx !== undefined) {
      node.x = node.tx;
      node.y = node.ty;
      continue;
    }
    step += 1;
    const angle = step * 0.55;
    const radius = 40 + step * 4;
    node.x = Math.cos(angle) * radius;
    node.y = Math.sin(angle) * radius;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const link of links) {
    link.source = byId.get(link.source) || link.source;
    link.target = byId.get(link.target) || link.target;
  }
};

// Draws the shared network into an <svg>, the same way js/network.js draws
// yours. tree has title, partner_name, grown, status, days, today and
// optionally waitingSide ("you" or "friend").
// options:
// - animateFrom: a day number; days after it bloom in (the new growth).
// - zoom: true lets you zoom and pan (the big view). In a card the page
//   has to scroll, so there you can only drag the dots.
// - onSelect(lines): called with a dot's details when it is tapped, or
//   with null when the tap is on the background.
const drawSharedTree = (svg, tree, options = {}) => {
  const settings = typeof options === "number" || options === null ? { animateFrom: options } : options;
  const animateFrom = settings.animateFrom ?? null;
  const friendName = tree.partner_name || "Friend";
  svg.sharedSimulation?.stop();
  svg.replaceChildren();
  svg.classList.add("tree-growth", "shared-growth");
  const drawing = (sharedDrawings += 1);
  const { nodes, links } = sharedNetworkGraph(tree);

  // Your Customize choices (js/network-style.js), when they are loaded.
  const hasStyle = typeof networkStyle !== "undefined";
  const spread = hasStyle ? styleSpread() : 1;
  const dotScale = hasStyle ? styleDotScale() : 1;
  const pull = hasStyle ? networkStyle.pull : 0.5;
  for (const node of nodes) {
    node.r *= dotScale;
    node.isNew = animateFrom !== null && node.number > animateFrom;
    if (node.tx !== undefined) {
      node.tx *= spread;
      node.ty *= spread;
    }
  }
  const linkPath = (link) => (hasStyle ? networkLinkPath(link)
    : `M${link.source.x},${link.source.y}L${link.target.x},${link.target.y}`);

  // Starting places: the people on their sides, the steps fanning out
  // from the goal, so the physics only has to settle them.
  nodes.forEach((node, index) => {
    if (node.tx !== undefined) {
      node.x = node.tx;
      node.y = node.ty;
      return;
    }
    const angle = index * 0.5;
    const radius = 30 + index * 3;
    node.x = Math.cos(angle) * radius;
    node.y = Math.sin(angle) * radius;
  });

  const d3Ready = Boolean(window.d3);
  let simulation = null;
  if (d3Ready) {
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((node) => node.id)
        .distance((link) => link.distance * spread)
        .strength((link) => Math.min(1, (link.kind === "skill" ? 0.08 : link.kind === "area" ? 0.5 : 0.9) * (0.35 + pull * 1.3))))
      .force("charge", d3.forceManyBody().strength((node) => node.charge * spread).distanceMax(420))
      .force("collide", d3.forceCollide((node) => node.r + 6))
      .force("x", d3.forceX((node) => node.tx ?? 0).strength((node) => (node.kind === "area" ? 0.3 : 0.07)))
      // The people sit below the goal and the days grow up and out above it.
      .force("y", d3.forceY((node) => node.ty ?? (node.kind === "step" ? -70 * spread : 0)).strength((node) => (node.kind === "area" ? 0.3 : 0.07)))
      .alphaDecay(0.03)
      .stop();
    // Settle it before the first picture, then let it breathe a little.
    for (let tick = 0; tick < 260; tick += 1) simulation.tick();
  } else {
    sharedSpiralLayout(nodes, links);
  }

  // Fit the view around the dots, with room for the names.
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs) - 40;
  const maxX = Math.max(...xs) + 110;
  const minY = Math.min(...ys) - 34;
  const maxY = Math.max(...ys) + 46;
  const width = Math.max(maxX - minX, 260);
  const height = Math.max(maxY - minY, 200);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  svg.setAttribute("viewBox", `${(centerX - width / 2).toFixed(1)} ${(centerY - height / 2).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`);

  // The same glow and gold as your own network, plus the half and half
  // fill for the goal and for every day you both showed up.
  const defs = svgElement("defs");
  const glow = svgElement("filter", { id: `shared-glow-${drawing}`, x: "-100%", y: "-100%", width: "300%", height: "300%" });
  glow.append(svgElement("feGaussianBlur", { stdDeviation: 4, result: "blur" }));
  const merge = svgElement("feMerge");
  merge.append(svgElement("feMergeNode", { in: "blur" }), svgElement("feMergeNode", { in: "SourceGraphic" }));
  glow.append(merge);
  const split = svgElement("linearGradient", { id: `shared-split-${drawing}` });
  split.append(
    svgElement("stop", { offset: "50%", "stop-color": "var(--accent)" }),
    svgElement("stop", { offset: "50%", "stop-color": "var(--sun)" }),
  );
  defs.append(glow, split);
  svg.append(defs);
  const glowUrl = `url(#shared-glow-${drawing})`;
  const splitUrl = `url(#shared-split-${drawing})`;

  const world = svgElement("g", { class: "shared-world" });
  const linkLayer = svgElement("g");
  const nodeLayer = svgElement("g");
  world.append(linkLayer, nodeLayer);
  svg.append(world);

  const linkPaths = links.map((link) => {
    const path = svgElement("path", {
      class: `net-link is-${link.kind}${link.grown ? " is-grown" : ""}${link.kind === "area" ? ` is-${link.source.side}` : ""}`,
      d: linkPath(link),
    });
    linkLayer.append(path);
    return path;
  });

  const groups = nodes.map((node) => {
    const classes = ["net-node", `is-${node.kind}`];
    if (node.status) classes.push(`is-${node.status}`);
    if (node.milestone) classes.push("is-milestone");
    if (node.isNew) classes.push("net-bloom");
    const group = svgElement("g", { class: classes.join(" "), transform: `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})` });
    if (node.isNew) group.style.setProperty("--delay", `${Math.min(900, (node.number - animateFrom) * 40)}ms`);
    group.append(svgElement("circle", { class: "net-hit", r: Math.max(node.r + 8, 16), fill: "transparent" }));
    // Thin gold rings around the goal, one per 30 days together.
    for (let ring = 0; ring < (node.rings || 0); ring += 1) {
      group.append(svgElement("circle", {
        r: node.r + 9 + ring * 4, fill: "none", stroke: "var(--sun)", "stroke-width": 1, opacity: 0.7 - ring * 0.08,
      }));
    }
    const sideColor = SHARED_SIDE_COLORS[node.side] || SHARED_SIDE_COLORS[node.waiting] || "var(--accent)";
    if (node.status === "current" || node.milestone) {
      group.append(svgElement("circle", {
        class: "tree-pulse", r: node.r, fill: "none", "stroke-width": 2,
        stroke: node.milestone ? "#e8b65a" : sideColor,
      }));
    }
    let fill = splitUrl;
    let stroke = "none";
    let strokeWidth = 1.8;
    if (node.kind === "area") {
      fill = "var(--base)";
      stroke = sideColor;
      strokeWidth = 3;
    } else if (node.kind === "goal") {
      stroke = "var(--base)";
      strokeWidth = 2;
    } else if (node.kind === "skill") {
      fill = "var(--base)";
      stroke = sideColor;
    } else if (node.status === "current") {
      // Waiting: filled with the color of the one who checked in.
      fill = node.waiting ? sideColor : "var(--base)";
      stroke = node.waiting ? "var(--base)" : "var(--accent)";
      strokeWidth = node.waiting ? 2 : 3;
    } else if (node.status === "locked") {
      fill = "var(--surface)";
      stroke = "var(--muted)";
    } else if (node.milestone) {
      stroke = "var(--sun)";
      strokeWidth = 3;
    }
    const core = svgElement("circle", { class: "net-core", r: node.r, fill, stroke, "stroke-width": strokeWidth });
    if (node.status === "locked") core.setAttribute("stroke-dasharray", "2 2");
    if (node.status === "done" && !node.recent && !node.milestone) core.setAttribute("opacity", 0.78);
    if (node.kind === "goal" || node.recent || node.milestone || node.waiting) core.setAttribute("filter", glowUrl);
    group.append(core);
    const label = node.label.length > 32 ? `${node.label.slice(0, 30).trimEnd()}…` : node.label;
    const text = svgElement("text", node.kind === "area"
      ? { x: 0, y: node.r + 18, "text-anchor": "middle" }
      : { x: node.r + 6, y: 4 });
    text.textContent = label;
    const title = svgElement("title");
    title.textContent = sharedNodeDetails(node, friendName).join("\n");
    group.append(text, title);
    nodeLayer.append(group);
    return group;
  });

  // Hovering or tapping a dot lights up its neighbours and shows its name,
  // like in your own network.
  let hovered = null;
  let selected = null;
  const highlight = () => {
    const focus = hovered || selected;
    const near = new Set(focus ? [focus] : []);
    for (const link of links) {
      if (link.source.id === focus) near.add(link.target.id);
      if (link.target.id === focus) near.add(link.source.id);
    }
    groups.forEach((group, index) => {
      const id = nodes[index].id;
      group.classList.toggle("is-hovered", id === hovered);
      group.classList.toggle("is-selected", id === selected);
      group.classList.toggle("net-dim", Boolean(focus) && !near.has(id));
      group.classList.toggle("is-near", Boolean(focus) && near.has(id));
    });
    links.forEach((link, index) => {
      const touches = Boolean(focus) && (link.source.id === focus || link.target.id === focus);
      linkPaths[index].classList.toggle("net-dim", Boolean(focus) && !touches);
      linkPaths[index].classList.toggle("is-lit", touches);
    });
  };
  const select = (node) => {
    selected = node ? node.id : null;
    highlight();
    settings.onSelect?.(node ? sharedNodeDetails(node, friendName) : null);
  };
  groups.forEach((group, index) => {
    const node = nodes[index];
    group.addEventListener("mouseenter", () => { hovered = node.id; highlight(); });
    group.addEventListener("mouseleave", () => { hovered = null; highlight(); });
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      select(selected === node.id ? null : node);
    });
  });
  svg.addEventListener("click", () => select(null));

  const place = () => {
    groups.forEach((group, index) => {
      group.setAttribute("transform", `translate(${nodes[index].x.toFixed(1)} ${nodes[index].y.toFixed(1)})`);
    });
    links.forEach((link, index) => linkPaths[index].setAttribute("d", linkPath(link)));
  };

  if (!d3Ready) return;
  simulation.on("tick", place);
  svg.sharedSimulation = simulation;
  // Drag the dots, and the rest of the network follows.
  d3.selectAll(groups).data(nodes).call(d3.drag()
    .on("start", (event, node) => {
      if (!event.active) simulation.alphaTarget(0.25).restart();
      node.fx = node.x;
      node.fy = node.y;
    })
    .on("drag", (event, node) => {
      node.fx = event.x;
      node.fy = event.y;
    })
    .on("end", (event) => {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }));
  if (settings.zoom) {
    const zoom = d3.zoom().scaleExtent([0.4, 4]).on("zoom", (event) => {
      world.setAttribute("transform", event.transform);
      svg.classList.toggle("is-zoomed", event.transform.k > 1.5);
    });
    d3.select(svg).call(zoom).on("dblclick.zoom", null);
  }
  // New growth blooms out of the chain, and the network settles again.
  if (!communityReduceMotion()) simulation.alpha(nodes.some((node) => node.isNew) ? 0.5 : 0.12).restart();
};

// The day as "YYYY-MM-DD" in the user's own time zone.
const sharedTreeToday = () => chartLastDays(1)[0];

// Days in a row that count: days you both checked in, and days one of
// you saved with a side quest. Counted back from today (or from yesterday
// when today isn't done yet, so the streak doesn't look lost in the
// morning). days comes from the server, newest first.
const sharedTreeStreak = (days, today) => {
  const counted = new Set(days.filter((day) => (day.me && day.partner) || day.saved).map((day) => day.day));
  const calendar = chartLastDays(61, new Date(`${today}T12:00:00`)).reverse();
  const start = counted.has(calendar[0]) ? 0 : 1;
  let streak = 0;
  for (let index = start; index < calendar.length && counted.has(calendar[index]); index += 1) streak += 1;
  return streak;
};
