// The progress network: the d3 graph of goals, steps and skills, its side-panel details and the timelapse.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

// ---- Drawing the progress tree ----
// The tree is an SVG drawn from the data the server sends: titles of
// finished steps, the current step, and how many steps there are in
// total. Titles of future steps are kept secret by the server on
// purpose, so they are drawn as locked, unnamed nodes.

const createSvg = (tag, attributes = {}) => {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
};

// Splits a title into at most two short lines for the SVG labels.
const wrapTreeLabel = (text, maxLength = 26) => {
  const lines = [""];
  for (const word of String(text).split(/\s+/)) {
    const current = lines.at(-1);
    if (current && `${current} ${word}`.length > maxLength) {
      if (lines.length === 2) {
        lines[1] = `${current}…`;
        break;
      }
      lines.push(word);
    } else {
      lines[lines.length - 1] = current ? `${current} ${word}` : word;
    }
  }
  return lines;
};

const drawProgressTree = (tree, sproutIndex = -1) => {
  const completed = Array.isArray(tree.completed) ? tree.completed : [];
  const total = Math.max(Number(tree.total_steps) || 0, completed.length + (tree.current_step ? 1 : 0));
  const doneCount = completed.length;
  const width = 380;
  const gap = 78;
  const height = 130 + total * gap;
  const labelX = 148;
  // Nodes sway left and right a little so the trunk looks grown.
  const nodes = Array.from({ length: total }, (_, index) => ({
    x: index % 2 ? 98 : 62,
    y: height - 70 - index * gap,
  }));
  const ground = { x: 80, y: height - 14 };
  const crown = { x: 80, y: 44 };
  const chain = [ground, ...nodes, crown];
  const curve = (from, to) => `C ${from.x} ${from.y - gap / 2}, ${to.x} ${to.y + gap / 2}, ${to.x} ${to.y}`;
  // The solid trunk reaches the current step (or the goal when finished).
  const reach = tree.finished ? chain.length - 1 : doneCount + 1;
  let grownPath = `M ${ground.x} ${ground.y}`;
  for (let index = 1; index <= reach; index += 1) grownPath += ` ${curve(chain[index - 1], chain[index])}`;
  let futurePath = `M ${chain[reach].x} ${chain[reach].y}`;
  for (let index = reach + 1; index < chain.length; index += 1) futurePath += ` ${curve(chain[index - 1], chain[index])}`;

  treeGrowth.replaceChildren();
  treeGrowth.setAttribute("viewBox", `0 0 ${width} ${height}`);
  treeGrowth.setAttribute("aria-label", `Your progress tree: ${doneCount} of ${total} steps done.`);

  // The goal at the top, drawn like the Osiris sun. It gets brighter
  // as you get closer and fully lights up when you finish.
  const defs = createSvg("defs");
  const gradient = createSvg("linearGradient", { id: "tree-sun", x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(
    createSvg("stop", { offset: 0, "stop-color": "#fab387" }),
    createSvg("stop", { offset: 1, "stop-color": "#f38ba8" }),
  );
  defs.append(gradient);
  treeGrowth.append(defs);
  const sun = createSvg("circle", {
    cx: crown.x, cy: crown.y, r: 24, fill: "url(#tree-sun)",
    opacity: tree.finished ? 1 : 0.3 + 0.5 * (doneCount / Math.max(total, 1)),
  });
  treeGrowth.append(sun);
  if (tree.finished) {
    treeGrowth.append(createSvg("circle", {
      class: "tree-pulse", cx: crown.x, cy: crown.y, r: 24, fill: "none", stroke: "#fab387", "stroke-width": 2,
    }));
  }
  const goalTag = createSvg("text", { class: "tree-node-tag", x: labelX, y: crown.y - 6 });
  goalTag.textContent = tree.finished ? "GOAL REACHED" : "YOUR GOAL";
  treeGrowth.append(goalTag);
  wrapTreeLabel(tree.goal || "Your goal").forEach((line, lineIndex) => {
    const text = createSvg("text", { x: labelX, y: crown.y + 12 + lineIndex * 17, "font-weight": 700 });
    text.textContent = line;
    treeGrowth.append(text);
  });

  treeGrowth.append(
    createSvg("path", { d: futurePath, fill: "none", stroke: "var(--panel-border)", "stroke-width": 3, "stroke-dasharray": "3 7", "stroke-linecap": "round" }),
    createSvg("path", { d: grownPath, fill: "none", stroke: "var(--accent)", "stroke-width": 6, "stroke-linecap": "round" }),
    createSvg("line", { x1: 16, y1: ground.y, x2: width - 16, y2: ground.y, stroke: "var(--panel-border)", "stroke-width": 2, "stroke-linecap": "round" }),
  );
  const startTag = createSvg("text", { class: "tree-node-tag", x: labelX, y: ground.y - 6 });
  startTag.textContent = "START";
  treeGrowth.append(startTag);

  nodes.forEach((point, index) => {
    const isDone = index < doneCount;
    const isCurrent = index === doneCount && Boolean(tree.current_step);
    const group = createSvg("g", { class: isDone ? "is-done" : isCurrent ? "is-current" : "is-locked" });

    // Finished steps grow a small branch with leaves.
    if (isDone) {
      const leaves = createSvg("g", { class: index === sproutIndex ? "tree-sprout" : "" });
      const tipX = point.x - 30;
      const tipY = point.y - 14;
      leaves.append(
        createSvg("path", { d: `M ${point.x} ${point.y} Q ${point.x - 14} ${point.y - 2} ${tipX} ${tipY}`, fill: "none", stroke: "var(--leaf)", "stroke-width": 3, "stroke-linecap": "round" }),
        createSvg("ellipse", { cx: tipX - 6, cy: tipY - 4, rx: 10, ry: 5, fill: "var(--leaf)", transform: `rotate(-30 ${tipX - 6} ${tipY - 4})` }),
        createSvg("ellipse", { cx: tipX + 2, cy: tipY - 10, rx: 9, ry: 4.5, fill: "var(--leaf)", opacity: 0.75, transform: `rotate(-70 ${tipX + 2} ${tipY - 10})` }),
        createSvg("ellipse", { cx: tipX - 4, cy: tipY + 5, rx: 8, ry: 4, fill: "var(--leaf)", opacity: 0.75, transform: `rotate(15 ${tipX - 4} ${tipY + 5})` }),
      );
      group.append(leaves);
    }

    group.append(createSvg("line", { x1: point.x + 16, y1: point.y, x2: labelX - 8, y2: point.y, stroke: "var(--panel-border)", "stroke-dasharray": "2 4" }));
    if (isCurrent) {
      group.append(createSvg("circle", { class: "tree-pulse", cx: point.x, cy: point.y, r: 14, fill: "none", stroke: "var(--accent)", "stroke-width": 2 }));
    }
    group.append(createSvg("circle", {
      cx: point.x, cy: point.y, r: 14,
      fill: isDone ? "var(--leaf)" : "var(--base)",
      stroke: isDone ? "var(--leaf)" : isCurrent ? "var(--accent)" : "var(--panel-border)",
      "stroke-width": isCurrent ? 3 : 2,
    }));
    if (isDone) {
      group.append(createSvg("path", { d: `M ${point.x - 5} ${point.y} l 3.5 3.5 l 6.5 -7`, fill: "none", stroke: "var(--base)", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    } else {
      const number = createSvg("text", { class: "tree-node-tag", x: point.x, y: point.y + 4, "text-anchor": "middle", "letter-spacing": 0 });
      number.textContent = String(index + 1);
      group.append(number);
    }

    const title = isDone ? completed[index].title : isCurrent ? tree.current_step.title : "Unlocks later";
    const lines = wrapTreeLabel(title);
    const tag = createSvg("text", { class: "tree-node-tag", x: labelX, y: point.y - (lines.length > 1 ? 14 : 6) });
    tag.textContent = isDone ? "DONE" : isCurrent ? "TODAY" : `STEP ${index + 1}`;
    group.append(tag);
    lines.forEach((line, lineIndex) => {
      const text = createSvg("text", { class: "tree-node-title", x: labelX, y: point.y + (lines.length > 1 ? 4 : 12) + lineIndex * 17 });
      text.textContent = line;
      group.append(text);
    });
    treeGrowth.append(group);
  });
};

// ---- The progress network (the home screen) ----
// Works like Obsidian's graph view. Every goal is a big dot attached to
// its life area (Health, Learning, ...). Steps hang off each goal in a
// chain: finished steps glow in the area's color, today's steps pulse,
// and future steps are faint "locked" dots whose names the server keeps
// secret. Skills the AI tagged on steps become their own dots and link
// every step that trains them, across all goals, so the network grows
// denser the more you finish. Names only show on hover or click.
// Node objects are kept between redraws (in `network.cache`) so the
// layout doesn't jump when something changes; only new dots appear.
// One goal is your "focus": its current step is the card in the panel.
const netStage = document.querySelector("#net-stage");
const netControls = document.querySelector("#net-controls");
const netLegend = document.querySelector("#net-legend");
const netSkillsButton = document.querySelector("#net-skills");
const netFocusOnlyButton = document.querySelector("#net-focus-only");
const netTimelapseButton = document.querySelector("#net-timelapse");
const netRecenterButton = document.querySelector("#net-recenter");
const netStatDone = document.querySelector("#net-stat-done");
const netStatGoals = document.querySelector("#net-stat-goals");
const netStatSkills = document.querySelector("#net-stat-skills");
const netGoalList = document.querySelector("#net-goal-list");
const netTopSkills = document.querySelector("#net-top-skills");
const treeNodeDetails = document.querySelector("#tree-node-details");
const homePanel = document.querySelector("#progress-tree-page");
// On phones the page scrolls, so wheel/trackpad zoom needs Ctrl there.
const narrowLayout = window.matchMedia("(max-width: 820px)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const AREA_COLORS = {
  Health: "var(--area-health)",
  Learning: "var(--area-learning)",
  Mind: "var(--area-mind)",
  Career: "var(--area-career)",
  Creativity: "var(--area-creativity)",
  Relationships: "var(--area-relationships)",
  Money: "var(--area-money)",
  Other: "var(--area-other)",
};
const areaColor = (area) => AREA_COLORS[area] || AREA_COLORS.Other;
const network = {
  cache: new Map(),
  hasDrawn: false,
  sim: null,
  zoom: null,
  world: null,
  linkLayer: null,
  nodeLayer: null,
  effectLayer: null,
  nodes: [],
  links: [],
  goals: [],
  hovered: null,
  selected: null,
  showSkills: true,
  focusOnly: false,
  lastTree: null,
  playing: false,
  confirmingDelete: null,
};

// When a finished step was completed, in milliseconds, or null. Steps
// finished before the site started saving dates have none.
const completedTime = (step) => {
  const time = step?.completed_at ? Date.parse(step.completed_at) : NaN;
  return Number.isFinite(time) ? time : null;
};

// Steps finished within this many days glow brightest in the network.
const RECENT_DAYS = 7;

// Is a goal's finished step (by its 0-based index) recent? With a date:
// finished in the last RECENT_DAYS days. Goals from before dates were
// saved fall back to the old rule: their last three steps glow.
const isRecentStep = (goal, index) => {
  const time = completedTime(goal.completed[index]);
  if (time !== null) return Date.now() - time < RECENT_DAYS * 24 * 60 * 60 * 1000;
  const goalHasDates = goal.completed.some((step) => completedTime(step) !== null);
  return !goalHasDates && index >= goal.completed.length - 3;
};

const formatCompletedDate = (time) => new Date(time).toLocaleDateString(undefined, {
  day: "numeric", month: "short", year: "numeric",
});

// Turns the server's answer into a list of goals. Older servers only
// send the active tree, so that becomes a one-goal list.
const goalsFromTree = (tree) => {
  if (Array.isArray(tree.goals) && tree.goals.length) {
    return tree.goals.map((goal) => ({
      ...goal,
      area: goal.area || "Other",
      completed: Array.isArray(goal.completed) ? goal.completed : [],
    }));
  }
  if (!tree.exists) return [];
  return [{
    id: tree.id ?? "focus",
    active: true,
    goal: tree.goal,
    area: tree.area || "Other",
    completed: Array.isArray(tree.completed) ? tree.completed : [],
    current_step: tree.current_step ? { title: tree.current_step.title, skills: tree.current_step.skills } : null,
    total_steps: tree.total_steps,
    finished: tree.finished,
  }];
};

const fitProgressNetwork = (animate = true) => {
  if (!network.zoom) return;
  const box = netStage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const shownGoals = network.focusOnly ? 1 : network.goals.length;
  const span = shownGoals > 1 ? 700 : 480;
  const scale = Math.min(1.3, Math.max(0.45, Math.min(box.width, box.height) / span));
  const transform = d3.zoomIdentity.translate(box.width / 2, box.height / 2).scale(scale);
  const svg = d3.select(treeGrowth);
  (animate ? svg.transition().duration(600) : svg).call(network.zoom.transform, transform);
};

const setUpProgressNetwork = () => {
  const svg = d3.select(treeGrowth);
  treeGrowth.replaceChildren();
  treeGrowth.removeAttribute("viewBox");
  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "net-glow")
    .attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%");
  glow.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "blur");
  const merge = glow.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");
  const sun = defs.append("radialGradient").attr("id", "net-sun");
  sun.append("stop").attr("offset", "0%").attr("stop-color", "#fab387");
  sun.append("stop").attr("offset", "100%").attr("stop-color", "#f38ba8");

  network.world = svg.append("g");
  network.linkLayer = network.world.append("g");
  network.nodeLayer = network.world.append("g");
  network.effectLayer = network.world.append("g");

  network.zoom = d3.zoom()
    .scaleExtent([0.3, 4])
    .filter((event) => (event.type === "wheel"
      ? !narrowLayout.matches || event.ctrlKey || event.metaKey
      : !event.button))
    .on("zoom", (event) => {
      network.world.attr("transform", event.transform);
      treeGrowth.classList.toggle("is-zoomed", event.transform.k > 1.5);
    });
  svg.call(network.zoom).on("dblclick.zoom", null);
  svg.on("click", () => selectNetworkNode(null));

  network.sim = d3.forceSimulation()
    .force("link", d3.forceLink().id((node) => node.id)
      .distance((link) => link.distance)
      .strength((link) => (link.kind === "skill" ? 0.08 : link.kind === "area" ? 0.5 : 0.9)))
    .force("charge", d3.forceManyBody().strength((node) => node.charge).distanceMax(420))
    .force("collide", d3.forceCollide((node) => node.r + 6))
    .force("x", d3.forceX(0).strength(0.07))
    .force("y", d3.forceY(0).strength(0.07))
    .alphaDecay(0.03)
    .on("tick", () => {
      network.linkLayer.selectAll("line")
        .attr("x1", (link) => link.source.x).attr("y1", (link) => link.source.y)
        .attr("x2", (link) => link.target.x).attr("y2", (link) => link.target.y);
      network.nodeLayer.selectAll("g.net-node")
        .attr("transform", (node) => `translate(${node.x},${node.y})`);
    });
  new ResizeObserver(() => fitProgressNetwork(false)).observe(netStage);
};

// Reuses a node object if it already exists, otherwise creates it next
// to the node it grows out of so it "blooms" from there.
const networkNode = (id, properties, growsFrom) => {
  let node = network.cache.get(id);
  if (node) {
    node.isNew = false;
  } else {
    const parent = network.cache.get(growsFrom);
    node = {
      id,
      x: (parent?.x ?? (Math.random() - 0.5) * 200) + (Math.random() - 0.5) * 20,
      y: (parent?.y ?? (Math.random() - 0.5) * 200) + (Math.random() - 0.5) * 20,
      // Only dots that appear after the first drawing get the bloom effect.
      isNew: network.hasDrawn,
    };
    network.cache.set(id, node);
  }
  return Object.assign(node, properties);
};

const highlightProgressNetwork = () => {
  if (!network.nodeLayer) return;
  const focus = network.hovered || network.selected;
  const nodes = network.nodeLayer.selectAll("g.net-node");
  const lines = network.linkLayer.selectAll("line");
  nodes.classed("is-hovered", (node) => node.id === network.hovered)
    .classed("is-selected", (node) => node.id === network.selected);
  if (!focus) {
    nodes.classed("net-dim", false).classed("is-near", false);
    lines.classed("net-dim", false).classed("is-lit", false);
    return;
  }
  const near = new Set([focus]);
  for (const link of network.links) {
    if (link.source.id === focus) near.add(link.target.id);
    if (link.target.id === focus) near.add(link.source.id);
  }
  const touches = (link) => link.source.id === focus || link.target.id === focus;
  nodes.classed("net-dim", (node) => !near.has(node.id)).classed("is-near", (node) => near.has(node.id));
  lines.classed("net-dim", (link) => !touches(link)).classed("is-lit", touches);
};

// Small helpers for building panel content safely: text from the AI
// is always set with textContent, never as HTML.
const createElement = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const networkListItem = (label, meta, swatchColor, targetId, filled = false) => {
  const button = createElement("button", "net-item");
  button.type = "button";
  const swatch = createElement("i", "net-swatch");
  swatch.style.borderColor = swatchColor;
  if (filled) swatch.style.background = swatchColor;
  button.append(swatch, createElement("span", "", label));
  if (meta) button.append(createElement("small", "", meta));
  button.addEventListener("click", () => selectNetworkNode(targetId));
  return button;
};

const panelButton = (label, className, onClick) => {
  const button = createElement("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
};

// Switches which goal is in focus (shown in the panel), or removes one.
const changeGoal = async (action, goalId, button) => {
  button.disabled = true;
  treeStatus.textContent = action === "focus_goal" ? "Switching your focus..." : "Removing the goal...";
  try {
    network.selected = null;
    // Switching goals closes the chat (it belongs to the previous goal).
    treeAssistantOpen = false;
    treeAssistant.hidden = true;
    await postProgressTree({ action, goalId });
    treeStatus.textContent = action === "focus_goal"
      ? "This goal is now your focus."
      : "The goal was removed from your network.";
  } catch (error) {
    treeStatus.textContent = error.message;
    button.disabled = false;
  }
};

const goalById = (goalId) => network.goals.find((goal) => String(goal.id) === String(goalId));

// The side panel shows details for the selected dot, or the overview
// (focus goal, stats, today's step) when nothing is selected.
const renderNetworkDetails = () => {
  const node = network.selected && network.nodes.find((item) => item.id === network.selected);
  if (!node || node.kind === "seed") {
    network.selected = null;
    homePanel.dataset.mode = "overview";
    treeNodeDetails.hidden = true;
    return;
  }
  homePanel.dataset.mode = "node";
  treeNodeDetails.hidden = false;
  treeNodeDetails.replaceChildren();
  const heading = createElement("div");
  treeNodeDetails.append(panelButton("← Back to today's step", "net-back", () => selectNetworkNode(null)), heading);

  if (node.kind === "area") {
    heading.append(createElement("span", "tree-step-label", "Life area"), createElement("h2", "", node.label));
    const list = createElement("div", "net-list");
    for (const goal of network.goals.filter((item) => item.area === node.label)) {
      list.append(networkListItem(goal.goal, `${goal.completed.length}/${goal.total_steps}`,
        areaColor(goal.area), `goal:${goal.id}`, true));
    }
    treeNodeDetails.append(list);
    return;
  }

  if (node.kind === "goal") {
    const goal = goalById(node.goalId);
    heading.append(
      createElement("span", "tree-step-label", `${goal.finished ? "Goal reached" : "Goal"} · ${goal.area}`),
      createElement("h2", "", goal.goal),
    );
    treeNodeDetails.append(createElement("p", "",
      `${goal.completed.length} of ${goal.total_steps} steps done.${goal.finished ? " This goal is now a permanent star in your network." : ""}`));
    const actions = createElement("div", "tree-actions");
    if (goal.active) {
      treeNodeDetails.append(createElement("p", "", "This is your focus goal: its current step is shown in the panel."));
    } else if (typeof goal.id === "number") {
      actions.append(panelButton("Focus on this goal", "save-button", (event) => changeGoal("focus_goal", goal.id, event.currentTarget)));
    }
    if (typeof goal.id === "number") {
      // Removing is permanent, so it takes two clicks.
      const confirming = network.confirmingDelete === goal.id;
      actions.append(panelButton(confirming ? "Click again to remove it for good" : "Remove goal",
        "profile-secondary-button", (event) => {
          if (network.confirmingDelete !== goal.id) {
            network.confirmingDelete = goal.id;
            renderNetworkDetails();
            return;
          }
          network.confirmingDelete = null;
          changeGoal("delete_goal", goal.id, event.currentTarget);
        }));
    }
    treeNodeDetails.append(actions);
    return;
  }

  if (node.kind === "skill") {
    const steps = node.stepIds.map((id) => network.nodes.find((item) => item.id === id)).filter(Boolean);
    const done = steps.filter((step) => step.status === "done");
    const goalCount = new Set(done.map((step) => step.goalId)).size;
    heading.append(createElement("span", "tree-step-label", "Skill"), createElement("h2", "", node.label));
    treeNodeDetails.append(createElement("p", "",
      `Practiced in ${done.length} finished ${done.length === 1 ? "step" : "steps"} across ${goalCount} ${goalCount === 1 ? "goal" : "goals"}. The dot grows each time a step trains it.`));
    const list = createElement("div", "net-list");
    for (const step of steps) {
      list.append(networkListItem(step.label, step.status === "done" ? "done" : "today",
        areaColor(goalById(step.goalId)?.area), step.id, step.status === "done"));
    }
    treeNodeDetails.append(list);
    return;
  }

  // A step.
  const goal = goalById(node.goalId);
  const position = `Step ${node.stepIndex + 1} of ${goal.total_steps}`;
  const goalChip = panelButton(goal.goal, "net-chip", () => selectNetworkNode(`goal:${goal.id}`));
  if (node.status === "locked") {
    heading.append(createElement("span", "tree-step-label", position), createElement("h2", "", "Locked step"));
    treeNodeDetails.append(createElement("p", "", `This step appears when you finish step ${node.stepIndex}.`), goalChip);
    return;
  }
  if (node.status === "current") {
    heading.append(createElement("span", "tree-step-label", `${position} · today`), createElement("h2", "", node.label));
    treeNodeDetails.append(goalChip, createElement("p", "",
      "Focus on this goal to see the whole step and complete it."));
    if (typeof goal.id === "number") {
      treeNodeDetails.append(panelButton("Focus on this goal", "save-button", (event) => changeGoal("focus_goal", goal.id, event.currentTarget)));
    }
    return;
  }
  heading.append(createElement("span", "tree-step-label", `${position} · done`), createElement("h2", "", node.label));
  treeNodeDetails.append(goalChip);
  if (node.completedAt !== null) {
    treeNodeDetails.append(createElement("p", "", `Completed on ${formatCompletedDate(node.completedAt)}.`));
  }
  if (node.skills.length) {
    const chips = createElement("div", "net-chips");
    for (const skill of node.skills) {
      chips.append(panelButton(skill, "net-chip", () => selectNetworkNode(`skill:${skill.trim().toLowerCase()}`)));
    }
    treeNodeDetails.append(createElement("span", "tree-step-label", "Skills it built"), chips);
  }
};

const selectNetworkNode = (id) => {
  if (id !== network.selected) network.confirmingDelete = null;
  if (id && id.startsWith("skill:") && !network.showSkills) {
    network.showSkills = true;
    netSkillsButton.setAttribute("aria-pressed", "true");
    renderNetwork();
  }
  network.selected = id;
  highlightProgressNetwork();
  renderNetworkDetails();
};

// Builds the dots and lines for a list of goals and updates the graph.
// `sproutId` is a step that was just completed (it gets a flash).
const renderNetwork = (goals = network.goals, sproutId = null) => {
  if (!network.sim) setUpProgressNetwork();
  const firstDraw = !network.hasDrawn;
  const shown = network.focusOnly ? goals.filter((goal) => goal.active).slice(0, 1) : goals;
  const nodes = [];
  const links = [];
  const skillUses = new Map();

  if (shown.length === 0) {
    nodes.push(networkNode("seed", { kind: "seed", label: "Your first goal will grow here", r: 12, charge: -200 }));
  }
  const areas = [...new Set(shown.map((goal) => goal.area))];
  if (!network.focusOnly) {
    for (const area of areas) {
      nodes.push(networkNode(`area:${area}`, {
        kind: "area", label: area, color: areaColor(area), r: 22, charge: -600,
      }));
    }
  }
  for (const goal of shown) {
    const color = areaColor(goal.area);
    const goalId = `goal:${goal.id}`;
    nodes.push(networkNode(goalId, {
      kind: "goal",
      goalId: goal.id,
      label: goal.goal,
      color,
      active: goal.active,
      finished: goal.finished,
      r: goal.finished ? 20 : 15,
      charge: -350,
    }, `area:${goal.area}`));
    if (!network.focusOnly) links.push({ source: `area:${goal.area}`, target: goalId, kind: "area", distance: 90 });
    const total = Math.max(Number(goal.total_steps) || 0, goal.completed.length + (goal.current_step ? 1 : 0));
    let previous = goalId;
    for (let index = 0; index < total; index += 1) {
      const isDone = index < goal.completed.length;
      const isCurrent = !isDone && index === goal.completed.length && Boolean(goal.current_step);
      const step = isDone ? goal.completed[index] : isCurrent ? goal.current_step : null;
      const skills = Array.isArray(step?.skills) ? step.skills.map(String) : [];
      const id = `${goalId}:step:${index}`;
      nodes.push(networkNode(id, {
        kind: "step",
        goalId: goal.id,
        // Not called "index": d3 uses that name for its own numbering.
        stepIndex: index,
        status: isDone ? "done" : isCurrent ? "current" : "locked",
        label: step ? step.title : "Locked",
        color,
        skills,
        completedAt: isDone ? completedTime(step) : null,
        recent: isDone && isRecentStep(goal, index),
        r: isCurrent ? 8 : isDone ? 6.5 : 4.5,
        charge: -120,
      }, previous));
      links.push({ source: previous, target: id, kind: "chain", grown: isDone || isCurrent, distance: index === 0 ? 46 : 30 });
      previous = id;
      for (const skill of skills) {
        const key = `skill:${skill.trim().toLowerCase()}`;
        if (!skillUses.has(key)) skillUses.set(key, { label: skill, stepIds: [], done: 0 });
        skillUses.get(key).stepIds.push(id);
        if (isDone) skillUses.get(key).done += 1;
      }
    }
  }
  if (network.showSkills) {
    for (const [key, skill] of skillUses) {
      nodes.push(networkNode(key, {
        kind: "skill",
        label: skill.label,
        stepIds: skill.stepIds,
        done: skill.done,
        // A skill grows each time a finished step trains it.
        r: 4 + Math.sqrt(Math.max(skill.done, 1)) * 2.6,
        charge: -160,
      }, skill.stepIds[0]));
      for (const stepId of skill.stepIds) {
        links.push({ source: stepId, target: key, kind: "skill", distance: 70 });
      }
    }
  }
  network.nodes = nodes;
  network.links = links;

  network.linkLayer.selectAll("line")
    .data(links, (link) => `${link.source.id || link.source}>${link.target.id || link.target}`)
    .join("line")
    .attr("class", (link) => `net-link is-${link.kind}${link.grown ? " is-grown" : ""}`);

  const nodeGroups = network.nodeLayer.selectAll("g.net-node")
    .data(nodes, (node) => node.id)
    .join((enter) => {
      const group = enter.append("g");
      group.append("g").attr("class", "net-reward-rings");
      group.append("circle").attr("class", "tree-pulse");
      group.append("circle").attr("class", "net-core");
      group.append("circle").attr("class", "net-focus-ring");
      group.append("text");
      group.append("title");
      group
        .on("mouseenter", (event, node) => {
          network.hovered = node.id;
          highlightProgressNetwork();
        })
        .on("mouseleave", () => {
          network.hovered = null;
          highlightProgressNetwork();
        })
        .on("click", (event, node) => {
          event.stopPropagation();
          if (network.playing || node.kind === "seed") return;
          // The focus goal's step for today lives in the panel's main card.
          if (node.status === "current" && goalById(node.goalId)?.active) {
            selectNetworkNode(null);
            treeCurrentStep.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return;
          }
          selectNetworkNode(network.selected === node.id ? null : node.id);
        })
        .call(d3.drag()
          .on("start", (event, node) => {
            if (!event.active) network.sim.alphaTarget(0.25).restart();
            node.fx = node.x;
            node.fy = node.y;
          })
          .on("drag", (event, node) => {
            node.fx = event.x;
            node.fy = event.y;
          })
          .on("end", (event, node) => {
            if (!event.active) network.sim.alphaTarget(0);
            node.fx = null;
            node.fy = null;
          }));
      return group;
    });

  nodeGroups.attr("class", (node) => [
    "net-node",
    `is-${node.kind}`,
    node.status ? `is-${node.status}` : "",
    node.isNew ? "net-bloom" : "",
  ].join(" "));
  nodeGroups.select(".tree-pulse")
    .attr("r", (node) => node.r)
    .attr("fill", "none")
    .attr("stroke", (node) => (node.kind === "goal" ? "#fab387" : "var(--accent)"))
    .attr("stroke-width", 2)
    .attr("display", (node) => (node.status === "current" || (node.kind === "goal" && node.finished) ? null : "none"));
  nodeGroups.select(".net-core")
    .attr("r", (node) => node.r)
    .attr("fill", (node) => {
      if (node.kind === "goal") return node.finished ? "url(#net-sun)" : node.color;
      if (node.kind === "area" || node.kind === "seed") return "var(--base)";
      if (node.kind === "skill" || node.status === "current") return "var(--base)";
      if (node.status === "locked") return "var(--surface)";
      return node.color;
    })
    .attr("stroke", (node) => {
      if (node.kind === "area") return node.color;
      if (node.kind === "goal") return "var(--base)";
      if (node.kind === "seed") return "var(--muted)";
      if (node.kind === "skill" || node.status === "current") return "var(--accent)";
      if (node.status === "locked") return "var(--muted)";
      return "none";
    })
    .attr("stroke-width", (node) => (node.kind === "area" || node.status === "current" ? 3 : node.kind === "goal" ? 2 : 1.8))
    .attr("stroke-dasharray", (node) => (node.status === "locked" || node.kind === "seed" ? "2 2" : null))
    .attr("opacity", (node) => (node.status === "done" && !node.recent ? 0.78 : 1))
    .attr("filter", (node) => (node.kind === "goal" || node.recent || (node.kind === "skill" && node.done >= 3) ? "url(#net-glow)" : null));
  // Rewards: one thin gold ring per reward earned, around every goal.
  nodeGroups.select(".net-reward-rings")
    .selectAll("circle")
    .data((node) => (node.kind === "goal" ? d3.range(network.rewardRings || 0) : []))
    .join("circle")
    .attr("r", (ring, index, rings) => {
      const node = d3.select(rings[index].parentNode).datum();
      return node.r + 9 + ring * 4;
    })
    .attr("fill", "none")
    .attr("stroke", "var(--sun)")
    .attr("stroke-width", 1)
    .attr("opacity", (ring) => 0.7 - ring * 0.08);
  // A thin ring marks the focus goal.
  nodeGroups.select(".net-focus-ring")
    .attr("r", (node) => node.r + 5)
    .attr("fill", "none")
    .attr("stroke", "var(--accent)")
    .attr("stroke-width", 1.5)
    .attr("display", (node) => (node.kind === "goal" && node.active && network.goals.length > 1 ? null : "none"));
  // Long names are shortened on the dot; the full name is in the
  // tooltip and in the side panel.
  nodeGroups.select("text")
    .text((node) => (node.label.length > 32 ? `${node.label.slice(0, 30).trimEnd()}…` : node.label))
    .attr("x", (node) => (node.kind === "area" ? 0 : node.r + 6))
    .attr("y", (node) => (node.kind === "area" ? node.r + 18 : 4))
    .attr("text-anchor", (node) => (node.kind === "area" ? "middle" : "start"));
  nodeGroups.select("title").text((node) => node.label);

  // A burst of light where a step was just completed.
  const sprouted = sproutId && network.cache.get(sproutId);
  if (sprouted && !reducedMotion.matches) {
    network.effectLayer.append("circle")
      .attr("class", "net-spark")
      .attr("cx", sprouted.x).attr("cy", sprouted.y).attr("r", 10)
      .attr("fill", "none").attr("stroke", sprouted.color || "var(--leaf)").attr("stroke-width", 2)
      .transition().delay(1000).remove();
  }

  network.sim.nodes(nodes);
  network.sim.force("link").links(links);
  network.sim.alpha(firstDraw ? 1 : 0.6).restart();
  network.hasDrawn = true;
  if (firstDraw) fitProgressNetwork(false);

  // Legend: one entry per life area in the network.
  netLegend.replaceChildren();
  for (const area of areas) {
    const swatch = createElement("b");
    swatch.style.background = areaColor(area);
    const entry = createElement("span");
    entry.append(swatch, document.createTextNode(area));
    netLegend.append(entry);
  }
  for (const [className, label] of [["is-today", "Today"], ["is-skill", "Skill"], ["is-locked", "Locked"]]) {
    const entry = createElement("span");
    entry.append(createElement("b", className), document.createTextNode(label));
    netLegend.append(entry);
  }

  treeGrowth.setAttribute("aria-label", shown.length
    ? `Your progress network: ${shown.length} ${shown.length === 1 ? "goal" : "goals"}, ${skillUses.size} skills.`
    : "Your progress network is empty. Create your first goal to start it.");
  highlightProgressNetwork();
  if (!network.playing) {
    renderNetworkSummary(goals, skillUses);
    renderNetworkDetails();
  }
};

// Stats, the goal list and the strongest skills in the panel overview.
const renderNetworkSummary = (goals, skillUses) => {
  netControls.hidden = goals.length === 0;
  netStatDone.textContent = String(goals.reduce((sum, goal) => sum + goal.completed.length, 0));
  netStatGoals.textContent = String(goals.filter((goal) => goal.finished).length);
  netStatSkills.textContent = String(skillUses.size);

  netGoalList.replaceChildren();
  netGoalList.hidden = goals.length === 0;
  if (goals.length) {
    netGoalList.append(createElement("span", "tree-step-label", "Your goals"));
    for (const goal of goals) {
      const meta = goal.finished ? "done" : `${goal.completed.length}/${goal.total_steps}${goal.active ? " · focus" : ""}`;
      netGoalList.append(networkListItem(goal.goal, meta, areaColor(goal.area), `goal:${goal.id}`, true));
    }
  }

  const topSkills = [...skillUses.entries()]
    .filter(([, skill]) => skill.done > 0)
    .sort((first, second) => second[1].done - first[1].done)
    .slice(0, 4);
  netTopSkills.replaceChildren();
  netTopSkills.hidden = topSkills.length === 0;
  if (topSkills.length) {
    netTopSkills.append(createElement("span", "tree-step-label", "Strongest skills"));
    for (const [key, skill] of topSkills) {
      netTopSkills.append(networkListItem(skill.label, `${skill.done} ${skill.done === 1 ? "step" : "steps"}`, "var(--accent)", key));
    }
  }
};

// Called with each answer from the server.
const drawProgressNetwork = (tree, sproutIndex = -1) => {
  network.lastTree = tree;
  network.goals = goalsFromTree(tree);
  const focusGoal = network.goals.find((goal) => goal.active);
  const sproutId = sproutIndex >= 0 && focusGoal ? `goal:${focusGoal.id}:step:${sproutIndex}` : null;
  if (!network.playing) renderNetwork(network.goals, sproutId);
};

// Replays the network growing: goal by goal, step by step.
const playNetworkTimelapse = () => {
  const goals = network.goals;
  if (!goals.length || network.playing) return;
  // Replay steps in the order they really happened. Steps without a
  // date (finished before dates were saved) come first, goal by goal;
  // the sort is stable, so their original order is kept.
  const order = goals
    .flatMap((goal, goalIndex) => goal.completed.map((step, stepIndex) =>
      [goalIndex, stepIndex, completedTime(step) ?? -Infinity]))
    .sort((a, b) => a[2] - b[2]);
  const frame = (count) => {
    const doneByGoal = goals.map(() => 0);
    for (const [goalIndex] of order.slice(0, count)) doneByGoal[goalIndex] += 1;
    return goals.map((goal, goalIndex) => {
      const done = doneByGoal[goalIndex];
      const replaying = done < goal.completed.length;
      return {
        ...goal,
        completed: goal.completed.slice(0, done),
        current_step: replaying ? goal.completed[done] : goal.current_step,
        finished: !replaying && goal.finished,
      };
    });
  };
  selectNetworkNode(null);
  network.playing = true;
  netTimelapseButton.disabled = true;
  network.cache.clear();
  network.hasDrawn = false;
  network.linkLayer.selectAll("*").remove();
  network.nodeLayer.selectAll("*").remove();
  renderNetwork(frame(0));
  fitProgressNetwork(true);
  let count = 0;
  const delay = reducedMotion.matches ? 150 : 500;
  const next = () => {
    if (count >= order.length) {
      network.playing = false;
      netTimelapseButton.disabled = false;
      renderNetwork(network.goals);
      return;
    }
    const [goalIndex, stepIndex] = order[count];
    count += 1;
    renderNetwork(frame(count), `goal:${goals[goalIndex].id}:step:${stepIndex}`);
    window.setTimeout(next, delay);
  };
  window.setTimeout(next, 700);
};

netSkillsButton.addEventListener("click", () => {
  network.showSkills = !network.showSkills;
  netSkillsButton.setAttribute("aria-pressed", String(network.showSkills));
  if (!network.showSkills && network.selected?.startsWith("skill:")) network.selected = null;
  renderNetwork();
});
netFocusOnlyButton.addEventListener("click", () => {
  network.focusOnly = !network.focusOnly;
  netFocusOnlyButton.setAttribute("aria-pressed", String(network.focusOnly));
  network.selected = null;
  renderNetwork();
  fitProgressNetwork(true);
});
netTimelapseButton.addEventListener("click", playNetworkTimelapse);
netRecenterButton.addEventListener("click", () => fitProgressNetwork(true));

// A short burst of leaves from the button when a step is completed.
const celebrateStep = (origin) => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const card = treeCurrentStep;
  const cardBox = card.getBoundingClientRect();
  const originBox = origin.getBoundingClientRect();
  for (let index = 0; index < 18; index += 1) {
    const leaf = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 90;
    leaf.className = "tree-leaf-burst";
    leaf.style.left = `${originBox.left - cardBox.left + originBox.width / 2}px`;
    leaf.style.top = `${originBox.top - cardBox.top + originBox.height / 2}px`;
    leaf.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    leaf.style.setProperty("--dy", `${Math.sin(angle) * distance - 40}px`);
    leaf.style.setProperty("--turn", `${Math.random() * 360}deg`);
    if (index % 3 === 0) leaf.style.background = "var(--accent)";
    card.append(leaf);
    window.setTimeout(() => leaf.remove(), 1100);
  }
};
