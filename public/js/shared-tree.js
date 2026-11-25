// Drawing a shared network: the picture that grows when two friends both
// check in on the same day (see lua/osiris/shared_trees.lua, where it is
// still called a "tree").
//
// It looks like your own progress network. In the middle is your shared
// goal, with you on one side and your friend on the other. Every week
// together is a branch from the goal (like a goal in your own network),
// and every day you BOTH checked in adds one dot for you and one for your
// friend on that branch, joined by a dashed line. Every 10th day is a bigger gold dot, and every 30 days puts a
// gold ring around the goal. When only one of you has checked in today,
// a glowing dot waits at the end of that person's chain.
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

// The most days drawn as dots; older days still count, they just aren't
// drawn one by one (the gold rings show them).
const SHARED_MAX_DOTS = 150;

// Builds the dots and lines for a shared network.
const sharedNetworkGraph = (tree) => {
  const grown = Math.max(0, Number(tree.grown) || 0);
  const shown = Math.min(grown, SHARED_MAX_DOTS);
  const nodes = [
    { id: "goal", kind: "goal", r: 10 + Math.min(6, grown / 15) },
    { id: "you", kind: "person", side: "you", r: 7 },
    { id: "friend", kind: "person", side: "friend", r: 7 },
  ];
  const links = [
    { source: "goal", target: "you", kind: tree.status === "growing" ? "chain" : "pending" },
    { source: "goal", target: "friend", kind: tree.status === "growing" ? "chain" : "pending" },
  ];
  // Each week of days together is its own branch from the goal, like the
  // goals in your own network, so a big network spreads out all around.
  const last = { you: "you", friend: "friend" };
  for (let day = 0; day < shown; day += 1) {
    if (day % 7 === 0) {
      const week = `week${day / 7}`;
      nodes.push({ id: week, kind: "week", day, r: 5.5 });
      links.push({ source: "goal", target: week, kind: "chain" });
      last.you = week;
      last.friend = week;
    }
    const milestone = (day + 1) % 10 === 0;
    for (const side of ["you", "friend"]) {
      const id = `${side}${day}`;
      nodes.push({ id, kind: "day", side, day, milestone, r: milestone ? 6 : 3.8 });
      links.push({ source: last[side], target: id, kind: "chain" });
      last[side] = id;
    }
    links.push({ source: `you${day}`, target: `friend${day}`, kind: "pair" });
  }
  if (tree.waitingSide) {
    nodes.push({ id: "waiting", kind: "waiting", side: tree.waitingSide, r: 4.5 });
    links.push({ source: last[tree.waitingSide], target: "waiting", kind: "pending" });
  }
  return { nodes, links, rings: Math.min(Math.floor(grown / 30), 6) };
};

// Places the dots. With d3 (loaded for the main network) the same physics
// as your own network settles them; without it they sit on two spirals.
const sharedNetworkLayout = (nodes, links) => {
  if (window.d3) {
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((node) => node.id)
        .distance((link) => (link.kind === "pair" ? 12 : link.source.kind === "goal" || link.source.id === "goal" ? 26 : 14))
        .strength((link) => (link.kind === "pair" ? 0.5 : 1)))
      .force("charge", d3.forceManyBody().strength(-38))
      .force("collide", d3.forceCollide((node) => node.r + 2.5))
      .force("x", d3.forceX(0).strength(0.05))
      .force("y", d3.forceY(0).strength(0.05))
      .stop();
    // The goal stays in the middle; you start on the left, your friend on the right.
    nodes[0].fx = 0;
    nodes[0].fy = 0;
    for (const node of nodes) {
      if (node.kind === "goal") continue;
      if (node.kind === "person") {
        node.x = node.side === "you" ? -24 : 24;
        node.y = 0;
        continue;
      }
      // Weeks start out spread around the goal like the hours on a clock.
      const day = node.day ?? 0;
      const angle = Math.floor(day / 7) * 2.4 + 0.8;
      const distance = 30 + (day % 7) * 12 + (node.side === "friend" ? 6 : 0);
      node.x = Math.cos(angle) * distance;
      node.y = Math.sin(angle) * distance;
    }
    for (let tick = 0; tick < 300; tick += 1) simulation.tick();
    return;
  }
  for (const node of nodes) {
    if (node.kind === "goal") { node.x = 0; node.y = 0; continue; }
    const day = node.kind === "person" ? 0 : node.kind === "waiting" ? SHARED_MAX_DOTS : node.day;
    const angle = Math.floor(day / 7) * 2.4 + 0.8 + (node.side === "friend" ? 0.12 : 0);
    const radius = (node.kind === "person" ? 22 : 30) + (day % 7) * 11;
    node.x = Math.cos(angle) * radius;
    node.y = Math.sin(angle) * radius;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const link of links) {
    link.source = byId.get(link.source) || link.source;
    link.target = byId.get(link.target) || link.target;
  }
};

// Draws the shared network into an <svg>. tree has grown, status and
// optionally waitingSide ("you" or "friend"). When animateFrom is a
// number, the days after it pop in (the new growth).
const drawSharedTree = (svg, tree, animateFrom = null) => {
  const { nodes, links, rings } = sharedNetworkGraph(tree);
  sharedNetworkLayout(nodes, links);
  svg.replaceChildren();

  // Fit the picture around the dots, never smaller than a small square.
  const pad = 18;
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const width = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 150);
  const height = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 120);
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const centerY = (Math.max(...ys) + Math.min(...ys)) / 2;
  svg.setAttribute("viewBox", `${(centerX - width / 2).toFixed(1)} ${(centerY - height / 2).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`);

  const isNew = (node) => animateFrom !== null && (node.kind === "day" || node.kind === "week") && node.day >= animateFrom;
  const delay = (node) => (isNew(node) ? Math.min(900, 150 + (node.day - animateFrom) * 30) : 0);

  const lines = svgElement("g", { class: "shared-links" });
  for (const link of links) {
    const fresh = isNew(link.target);
    lines.append(svgElement("line", {
      class: `shared-link is-${link.kind}${fresh ? " is-new-line" : ""}`,
      x1: link.source.x.toFixed(1),
      y1: link.source.y.toFixed(1),
      x2: link.target.x.toFixed(1),
      y2: link.target.y.toFixed(1),
      style: `--delay: ${delay(link.target)}ms`,
    }));
  }
  svg.append(lines);

  const dots = svgElement("g", { class: "shared-dots" });
  for (const node of nodes) {
    const holder = svgElement("g", { transform: `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})` });
    if (node.kind === "goal") {
      for (let ring = 0; ring < rings; ring += 1) {
        holder.append(svgElement("circle", { class: "shared-ring", r: (node.r + 5 + ring * 3).toFixed(1) }));
      }
      // The goal is half yours and half your friend's.
      const r = node.r;
      holder.append(svgElement("path", { class: "shared-node is-you", d: `M0 ${-r} A${r} ${r} 0 0 0 0 ${r} Z` }));
      holder.append(svgElement("path", { class: "shared-node is-friend", d: `M0 ${-r} A${r} ${r} 0 0 1 0 ${r} Z` }));
    } else if (node.kind === "week") {
      const r = node.r;
      const fresh = isNew(node) ? " is-new" : "";
      holder.append(svgElement("path", { class: `shared-node is-you is-week${fresh}`, d: `M0 ${-r} A${r} ${r} 0 0 0 0 ${r} Z`, style: `--delay: ${delay(node)}ms` }));
      holder.append(svgElement("path", { class: `shared-node is-friend is-week${fresh}`, d: `M0 ${-r} A${r} ${r} 0 0 1 0 ${r} Z`, style: `--delay: ${delay(node)}ms` }));
    } else if (node.kind === "waiting") {
      holder.append(svgElement("circle", { class: "shared-bud-glow", r: 10 }));
      holder.append(svgElement("circle", { class: `shared-node is-${node.side} is-waiting`, r: node.r }));
    } else {
      holder.append(svgElement("circle", {
        class: `shared-node is-${node.side}${node.kind === "person" ? " is-person" : ""}${node.milestone ? " is-milestone" : ""}${isNew(node) ? " is-new" : ""}`,
        r: node.r,
        style: `--delay: ${delay(node)}ms`,
      }));
    }
    dots.append(holder);
  }
  svg.append(dots);
};

// The day as "YYYY-MM-DD" in the user's own time zone.
const sharedTreeToday = () => chartLastDays(1)[0];

// Days in a row that you both watered, counting back from today (or from
// yesterday when today isn't done yet, so the streak doesn't look lost
// in the morning). days comes from the server, newest first.
const sharedTreeStreak = (days, today) => {
  const both = new Set(days.filter((day) => day.me && day.partner).map((day) => day.day));
  const calendar = chartLastDays(61, new Date(`${today}T12:00:00`)).reverse();
  const start = both.has(calendar[0]) ? 0 : 1;
  let streak = 0;
  for (let index = start; index < calendar.length && both.has(calendar[index]); index += 1) streak += 1;
  return streak;
};
