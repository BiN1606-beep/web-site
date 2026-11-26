// Customize your network: the small button in the corner of the network.
//
// It opens a panel where you choose how your journey looks:
// - Shape: a free web (the default), a tree, a galaxy, orbits or lines.
// - Colors for the life areas, and a "sky" behind the network.
// - How it feels: how hard the lines pull, how spread out it is, dot size.
// - Curvy lines and goal names on or off.
// - Timelapse: replay your network growing, pick its speed, and choose if
//   it plays by itself each time you open Osiris (off by default), and if
//   all paths grow at the same time (on by default) or in real order.
// Every change shows at once. It is saved on your account
// (POST /api/network-style, lua/osiris/network_style.lua), so it looks the
// same on every device. GET /api/progress-tree sends it back with the goals.
//
// Loaded after js/network.js, which calls the style* helpers, the shape
// layout (layoutNetworkShape) and networkLinkPath while it draws.

const NETWORK_STYLE_DEFAULTS = {
  shape: "web",
  palette: "areas",
  sky: "plain",
  pull: 0.5,
  spread: 0.5,
  dots: 0.5,
  curved: false,
  names: true,
  lapse: "normal",
  autoplay: false,
  together: true,
};
// Keep these in step with CHOICES in lua/osiris/network_style.lua.
const STYLE_CHOICES = {
  shape: ["web", "tree", "galaxy", "orbit", "lines"],
  palette: ["areas", "forest", "sunset", "ocean", "ink"],
  sky: ["plain", "dots", "stars"],
  lapse: ["slow", "normal", "fast", "turbo"],
};
const networkStyle = { ...NETWORK_STYLE_DEFAULTS };

// Keeps only known values, so an old or broken saved style can't break
// the drawing.
const cleanNetworkStyle = (style) => {
  const clean = { ...NETWORK_STYLE_DEFAULTS };
  if (!style || typeof style !== "object") return clean;
  for (const [key, allowed] of Object.entries(STYLE_CHOICES)) {
    if (allowed.includes(style[key])) clean[key] = style[key];
  }
  for (const key of ["pull", "spread", "dots"]) {
    const value = Number(style[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) clean[key] = value;
  }
  for (const key of ["curved", "names", "autoplay", "together"]) {
    if (typeof style[key] === "boolean") clean[key] = style[key];
  }
  return clean;
};

// ---- Numbers the forces in js/network.js read ----
// Every slider is 0..1 with 0.5 in the middle, and 0.5 gives exactly the
// old look, so the default network didn't change. "Pull" is how hard the
// lines pull in the web, and how firmly dots keep their place in a shape.
const styleSpread = () => 0.6 + networkStyle.spread * 0.8;
const styleCharge = () => styleSpread() * (networkStyle.shape === "web" ? 1 : 0.4);
const styleDotScale = () => 0.7 + networkStyle.dots * 0.6;
const styleLinkStrength = (link) => {
  // In a shape the dots are held by their places, so the lines only pull
  // gently (otherwise they would drag the shape out of form).
  if (networkStyle.shape !== "web") return link.kind === "skill" ? 0.02 : 0.04;
  const base = link.kind === "skill" ? 0.08 : link.kind === "area" ? 0.5 : 0.9;
  return Math.min(1, base * (0.35 + networkStyle.pull * 1.3));
};
// In a shape every dot is pulled towards its own place; "Pull" decides
// how firmly. Skills have no place and float near the steps they train.
const styleTargetStrength = (node) => {
  if (networkStyle.shape === "web") return 0.07;
  return node.tx === undefined ? 0.02 : 0.12 + networkStyle.pull * 0.5;
};

// ---- Shapes ----
// The network is really a family tree: life areas, their goals, and each
// goal's steps one after another (a "Keep evolving" goal hangs off the
// last step of the goal it grew from). Every dot gets a depth (how far
// from the root) and a slot (where it sits among its "cousins", 0..1). A
// shape turns depth and slot into a place on screen.
const networkFamily = (nodes, links) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map();
  const hasParent = new Set();
  for (const link of links) {
    if (!["area", "chain", "sprout"].includes(link.kind)) continue;
    const parent = link.source.id ?? link.source;
    const child = link.target.id ?? link.target;
    if (!byId.has(parent) || !byId.has(child) || hasParent.has(child)) continue;
    hasParent.add(child);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const tops = nodes.filter((node) => node.kind !== "skill" && node.kind !== "root" && !hasParent.has(node.id));
  // Count leaves (ends of branches) so wide families get more room.
  const places = new Map();
  let leaves = 0;
  let deepest = 1;
  // "along" is how far down its branch a dot is. A goal's name needs room,
  // so the first step after a goal sits a bit further out.
  const visit = (id, depth, along) => {
    deepest = Math.max(deepest, along);
    const kids = children.get(id) || [];
    const step = byId.get(id).kind === "goal" ? 3.2 : 1;
    if (!kids.length) {
      places.set(id, { depth, along, first: leaves, last: leaves });
      leaves += 1;
      return;
    }
    const start = leaves;
    for (const kid of kids) visit(kid, depth + 1, along + step);
    const firstKid = places.get(kids[0]);
    const lastKid = places.get(kids.at(-1));
    places.set(id, { depth, along, first: start, last: leaves - 1, middle: (firstKid.first + lastKid.last) / 2 });
  };
  for (const top of tops) visit(top.id, 1, 1);
  for (const place of places.values()) {
    const middle = place.middle ?? place.first;
    place.slot = (middle + 0.5) / Math.max(leaves, 1);
  }
  return { places, tops, leaves: Math.max(leaves, 1), deepest };
};

// Where a dot goes in each shape. `spot` has the dot's place in the family
// (along its branch and its slot among the others); `size` the spacing.
const SHAPE_PLACES = {
  // Rows from left to right: each goal is a straight line of steps.
  lines: (node, spot, size) => ({
    x: (spot.along - 1 - (size.deepest - 1) / 2) * size.gap,
    y: (spot.slot - 0.5) * size.leaves * size.gap * 1.15,
  }),
  // A trunk grows up from the ground and splits into branches that spread
  // out like a crown. Steps climb the branches; they sway a little so it
  // looks grown, not drawn with a ruler.
  tree: (node, spot, size) => {
    const span = Math.min(Math.PI * 0.95, 0.9 + size.leaves * 0.22);
    const angle = (spot.slot - 0.5) * span + Math.sin(spot.along * 1.1 + spot.slot * 7) * 0.05;
    const radius = (spot.along + 1.4) * size.gap * 0.85;
    return { x: Math.sin(angle) * radius * 1.7, y: size.crownY - Math.cos(angle) * radius * 0.9 };
  },
  // A sun in the middle and one ring per goal: the steps of a goal travel
  // around its ring, like a planet on its orbit. Life areas sit by the sun.
  orbit: (node, spot, size) => {
    if (node.kind === "area") {
      const angle = spot.slot * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(angle) * size.gap * 1.1, y: Math.sin(angle) * size.gap * 1.1 };
    }
    const ring = size.rings.get(node.goalId) ?? 0;
    const radius = size.gap * (2.4 + ring * 1.15);
    const total = size.stepCounts.get(node.goalId) || 1;
    // Each goal starts at its own angle so the rings don't line up.
    const start = ring * 2.4 - Math.PI / 2;
    const turn = node.kind === "step" ? ((node.stepIndex + 1) / (total + 1)) * Math.PI * 1.7 : 0;
    return { x: Math.cos(start + turn) * radius, y: Math.sin(start + turn) * radius };
  },
  // Like a spiral galaxy: every step turns a little, so goals curl into
  // arms around a glowing core.
  galaxy: (node, spot, size) => {
    const angle = spot.slot * Math.PI * 2 + spot.along * 0.3;
    const radius = 30 + spot.along * size.gap * 0.78;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  },
};

// Gives each dot its place (tx, ty) for the chosen shape. A tree gets a
// hidden root at the bottom with thick trunk lines to each big branch.
const layoutNetworkShape = (nodes, links) => {
  for (const node of nodes) {
    delete node.tx;
    delete node.ty;
  }
  const place = SHAPE_PLACES[networkStyle.shape];
  const onlySeed = nodes.length === 1 && nodes[0].kind === "seed";
  network.shapeBounds = null;
  if (!place || onlySeed) {
    drawShapeDecor(null);
    return;
  }
  const family = networkFamily(nodes, links);
  const size = {
    gap: 46 * styleSpread(),
    leaves: family.leaves,
    deepest: family.deepest,
    // Orbits: which ring each goal gets, and how many steps it has.
    rings: new Map(),
    stepCounts: new Map(),
  };
  for (const node of nodes) {
    if (node.kind === "goal") size.rings.set(node.goalId, size.rings.size);
    if (node.kind === "step") size.stepCounts.set(node.goalId, (size.stepCounts.get(node.goalId) || 0) + 1);
  }
  // The tree: the crown starts on top of a trunk that stands on the ground.
  size.crownY = 0;
  size.rootY = size.gap * 2.2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const grow = (x, y) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const node of nodes) {
    const spot = family.places.get(node.id);
    if (!spot) continue;
    const { x, y } = place(node, spot, size);
    node.tx = x;
    node.ty = y;
    grow(x, y);
  }
  if (networkStyle.shape === "tree") {
    const root = networkNode("root", { kind: "root", label: "", r: 0, charge: 0 });
    root.fx = 0;
    root.fy = size.rootY;
    root.tx = 0;
    root.ty = size.rootY;
    nodes.push(root);
    for (const top of family.tops) {
      links.push({ source: "root", target: top.id, kind: "trunk", grown: true, distance: 2.2 * size.gap });
    }
    grow(0, size.rootY + 20);
  }
  // Leave room for names next to the dots.
  network.shapeBounds = {
    width: maxX - minX + 160,
    height: maxY - minY + 60,
    centerX: (minX + maxX) / 2 + 40,
    centerY: (minY + maxY) / 2,
  };
  drawShapeDecor(size);
};

// js/network.js fits the view to this when a shape is on.
const networkShapeBounds = () => (networkStyle.shape === "web" ? null : network.shapeBounds);

// Quiet drawings behind the network that make each shape read at once.
const drawShapeDecor = (size) => {
  if (!network.decorLayer) return;
  network.decorLayer.selectAll("*").remove();
  if (!size) return;
  const layer = network.decorLayer;
  if (networkStyle.shape === "orbit") {
    for (let ring = 0; ring < size.rings.size; ring += 1) {
      layer.append("circle").attr("class", "net-decor-ring").attr("r", size.gap * (2.4 + ring * 1.15));
    }
    layer.append("circle").attr("class", "net-decor-core is-inner").attr("r", 7);
  } else if (networkStyle.shape === "galaxy") {
    layer.append("circle").attr("class", "net-decor-core").attr("r", 34);
    layer.append("circle").attr("class", "net-decor-core is-inner").attr("r", 9);
  } else if (networkStyle.shape === "tree") {
    layer.append("ellipse").attr("class", "net-decor-ground")
      .attr("cx", 0).attr("cy", size.rootY + 4).attr("rx", size.gap * 2.6).attr("ry", 9);
  }
};

// A link is a straight line, or a soft curve with "Curvy lines" on.
// Trunk lines in a tree always curve a little, like real branches.
const networkLinkPath = (link) => {
  const { x: x1, y: y1 } = link.source;
  const { x: x2, y: y2 } = link.target;
  if (!networkStyle.curved && link.kind !== "trunk") return `M${x1},${y1}L${x2},${y2}`;
  const bend = link.kind === "trunk" ? 0.12 : 0.22;
  const controlX = (x1 + x2) / 2 - (y2 - y1) * bend;
  const controlY = (y1 + y2) / 2 + (x2 - x1) * bend;
  if (link.kind === "trunk") {
    // Rise straight up first, then bend out to the branch.
    return `M${x1},${y1}Q${x1},${(y1 + y2) / 2} ${x2},${y2}`;
  }
  return `M${x1},${y1}Q${controlX},${controlY} ${x2},${y2}`;
};

// ---- Timelapse ----
// How long each step of the replay waits (js/network.js reads this).
const LAPSE_DELAYS = { slow: 900, normal: 500, fast: 250, turbo: 110 };
const timelapseStepDelay = () => LAPSE_DELAYS[networkStyle.lapse] ?? 500;
// All goal paths grow side by side, or one step at a time in real order.
const timelapseTogether = () => networkStyle.together;

// js/network.js calls this while the timelapse plays: a number from 0 to 1
// fills the bar on the play button, null means it has stopped.
const showTimelapseProgress = (part) => {
  const play = document.querySelector("#net-lapse-play");
  if (!play) return;
  const playing = part !== null;
  play.classList.toggle("is-playing", playing);
  play.setAttribute("aria-label", playing ? "Stop the timelapse" : "Play the timelapse");
  play.style.setProperty("--lapse-done", String(playing ? part : 0));
};

// "Play when I open Osiris": runs once per page load, after the startup
// animation has gone, so you see your journey grow as you arrive.
let timelapseAutoplayed = false;
const autoplayTimelapse = () => {
  if (timelapseAutoplayed || !networkStyle.autoplay) return;
  timelapseAutoplayed = true;
  let waited = 0;
  const start = () => {
    const startupShowing = document.querySelector("#startup-screen") && waited < 4000;
    if (startupShowing || !network.sim) {
      waited += 200;
      if (waited < 6000) window.setTimeout(start, 200);
      return;
    }
    if (network.goals.length) playNetworkTimelapse();
  };
  window.setTimeout(start, 300);
};

// ---- The panel ----
const netStyleButton = document.querySelector("#net-style-button");
const netStylePanel = document.querySelector("#net-style-panel");

// Tiny pictures for the shape buttons, drawn with SVG.
const SHAPE_ICONS = {
  web: '<circle cx="12" cy="10" r="3"/><circle cx="30" cy="8" r="2.5"/><circle cx="22" cy="22" r="3.5"/><circle cx="38" cy="22" r="2.5"/><circle cx="9" cy="27" r="2.5"/><path d="M12 10 22 22 30 8M22 22 38 22M22 22 9 27M12 10 30 8"/>',
  tree: '<path d="M24 34V22M24 22 14 12M24 22 34 11M24 26 33 20M14 12 9 5M14 12 16 4M34 11 40 6M34 11 31 3"/><circle cx="9" cy="5" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="40" cy="6" r="2"/><circle cx="31" cy="3" r="2"/><circle cx="33" cy="20" r="2"/><path d="M12 34h24"/>',
  galaxy: '<circle cx="24" cy="18" r="3.5"/><path d="M24 18c6-1 8 4 5 8s-11 4-14-2 1-14 9-15 15 4 15 11"/><circle cx="38" cy="11" r="1.8"/><circle cx="12" cy="26" r="1.8"/><circle cx="31" cy="27" r="1.8"/><circle cx="16" cy="9" r="1.8"/>',
  orbit: '<circle cx="24" cy="18" r="3"/><circle cx="24" cy="18" r="9" fill="none"/><circle cx="24" cy="18" r="15" fill="none"/><circle cx="33" cy="18" r="2"/><circle cx="14" cy="8" r="2"/><circle cx="31" cy="31" r="2"/>',
  lines: '<path d="M6 8h36M6 18h36M6 28h36"/><circle cx="6" cy="8" r="2.5"/><circle cx="18" cy="8" r="2"/><circle cx="30" cy="8" r="2"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2"/><circle cx="6" cy="28" r="2.5"/><circle cx="18" cy="28" r="2"/><circle cx="30" cy="28" r="2"/><circle cx="42" cy="28" r="2"/>',
};
const SHAPE_NAMES = { web: "Web", tree: "Tree", galaxy: "Galaxy", orbit: "Orbit", lines: "Lines" };
const PALETTE_NAMES = { areas: "Areas", forest: "Forest", sunset: "Sunset", ocean: "Ocean", ink: "Ink" };
const SKY_NAMES = { plain: "Paper", dots: "Dots", stars: "Stars" };
const SLIDER_NAMES = { pull: "Pull", spread: "Spread", dots: "Dot size" };
// Speed buttons: more arrows is faster.
const LAPSE_NAMES = { slow: "Slow", normal: "Normal", fast: "Fast", turbo: "Turbo" };
const LAPSE_ARROWS = { slow: 1, normal: 2, fast: 3, turbo: 4 };

const styleChoiceButton = (group, value, label, content) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `net-style-choice is-${group}`;
  button.dataset.group = group;
  button.dataset.value = value;
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = content;
  const name = document.createElement("span");
  name.textContent = label;
  button.append(name);
  return button;
};

const styleSection = (title) => {
  const section = document.createElement("section");
  section.className = "net-style-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  return section;
};

const buildNetworkStylePanel = () => {
  const head = document.createElement("header");
  head.className = "net-style-head";
  const title = document.createElement("h2");
  title.textContent = "Your network";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "net-style-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "✕";
  close.addEventListener("click", () => closeNetworkStylePanel());
  head.append(title, close);

  const shapes = styleSection("Shape");
  const shapeRow = document.createElement("div");
  shapeRow.className = "net-style-row is-shapes";
  for (const shape of STYLE_CHOICES.shape) {
    shapeRow.append(styleChoiceButton("shape", shape, SHAPE_NAMES[shape],
      `<svg viewBox="0 0 48 36" aria-hidden="true">${SHAPE_ICONS[shape]}</svg>`));
  }
  shapes.append(shapeRow);

  const colors = styleSection("Colors");
  const colorRow = document.createElement("div");
  colorRow.className = "net-style-row";
  for (const palette of STYLE_CHOICES.palette) {
    const button = styleChoiceButton("palette", palette, PALETTE_NAMES[palette],
      '<i class="net-style-swatch" aria-hidden="true"><b></b><b></b><b></b><b></b></i>');
    // The swatch shows that palette's own colors (css/network-style.css).
    button.dataset.palette = palette;
    colorRow.append(button);
  }
  colors.append(colorRow);

  const skies = styleSection("Sky");
  const skyRow = document.createElement("div");
  skyRow.className = "net-style-row";
  for (const sky of STYLE_CHOICES.sky) {
    skyRow.append(styleChoiceButton("sky", sky, SKY_NAMES[sky],
      `<i class="net-style-sky is-${sky}" aria-hidden="true"></i>`));
  }
  skies.append(skyRow);

  const feel = styleSection("Feel");
  for (const key of ["pull", "spread", "dots"]) {
    const label = document.createElement("label");
    label.className = "net-style-slider";
    const name = document.createElement("span");
    name.textContent = SLIDER_NAMES[key];
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.05";
    input.dataset.slider = key;
    input.addEventListener("input", () => changeNetworkStyle({ [key]: Number(input.value) }));
    label.append(name, input);
    feel.append(label);
  }
  const switches = document.createElement("div");
  switches.className = "net-style-row is-switches";
  for (const [key, label] of [["curved", "Curvy lines"], ["names", "Goal names"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "net-style-switch";
    button.dataset.switch = key;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = '<i aria-hidden="true"></i>';
    button.append(document.createTextNode(label));
    button.addEventListener("click", () => changeNetworkStyle({ [key]: !networkStyle[key] }));
    switches.append(button);
  }
  feel.append(switches);

  const lapse = styleSection("Timelapse");
  lapse.classList.add("is-lapse");
  const lapseTop = document.createElement("div");
  lapseTop.className = "net-lapse-top";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "net-lapse-play";
  play.id = "net-lapse-play";
  play.setAttribute("aria-label", "Play the timelapse");
  play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="is-play" d="M8 5.5v13l10.5-6.5z"/>'
    + '<rect class="is-stop" x="7" y="7" width="10" height="10" rx="1.5"/></svg>';
  play.addEventListener("click", () => {
    // On phones the panel covers the network, so it steps aside to watch.
    if (!network.playing && phoneLayout.matches) closeNetworkStylePanel(false);
    playNetworkTimelapse();
  });
  const speedRow = document.createElement("div");
  speedRow.className = "net-style-row is-speeds";
  for (const speed of STYLE_CHOICES.lapse) {
    let arrows = "";
    for (let index = 0; index < LAPSE_ARROWS[speed]; index += 1) {
      arrows += `<path d="M${index * 5} 0l5 4-5 4z"/>`;
    }
    speedRow.append(styleChoiceButton("lapse", speed, LAPSE_NAMES[speed],
      `<svg class="net-lapse-arrows" viewBox="-1 -1 22 10" aria-hidden="true">${arrows}</svg>`));
  }
  lapseTop.append(play, speedRow);
  const lapseSwitches = document.createElement("div");
  lapseSwitches.className = "net-style-row is-switches";
  for (const [key, label] of [["together", "All at once"], ["autoplay", "Play on open"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "net-style-switch";
    button.dataset.switch = key;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = '<i aria-hidden="true"></i>';
    button.append(document.createTextNode(label));
    button.addEventListener("click", () => changeNetworkStyle({ [key]: !networkStyle[key] }));
    lapseSwitches.append(button);
  }
  lapse.append(lapseTop, lapseSwitches);

  const foot = document.createElement("footer");
  foot.className = "net-style-foot";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "net-style-reset";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => changeNetworkStyle({ ...NETWORK_STYLE_DEFAULTS }));
  const status = document.createElement("span");
  status.className = "net-style-status";
  status.id = "net-style-status";
  status.setAttribute("role", "status");
  foot.append(reset, status);

  netStylePanel.replaceChildren(head, shapes, lapse, colors, skies, feel, foot);
  netStylePanel.addEventListener("click", (event) => {
    const choice = event.target.closest(".net-style-choice");
    if (!choice) return;
    const change = { [choice.dataset.group]: choice.dataset.value };
    // A galaxy shines best on a night sky, so it brings the stars along
    // (only from the plain paper; any sky you picked yourself stays).
    if (change.shape === "galaxy" && networkStyle.sky === "plain") change.sky = "stars";
    changeNetworkStyle(change);
  });
};

// Shows the current style on the buttons, the sliders and the page.
const showNetworkStyle = () => {
  homeApp.dataset.palette = networkStyle.palette;
  netStage.dataset.sky = networkStyle.sky;
  netStage.dataset.shape = networkStyle.shape;
  netStage.classList.toggle("hide-goal-names", !networkStyle.names);
  for (const button of netStylePanel.querySelectorAll(".net-style-choice")) {
    button.setAttribute("aria-pressed", String(networkStyle[button.dataset.group] === button.dataset.value));
  }
  for (const input of netStylePanel.querySelectorAll("[data-slider]")) {
    input.value = String(networkStyle[input.dataset.slider]);
  }
  for (const button of netStylePanel.querySelectorAll("[data-switch]")) {
    button.setAttribute("aria-pressed", String(networkStyle[button.dataset.switch]));
  }
};

// Redraws the network in the new style. A new shape moves every dot, so
// the view is fitted again once they have a new place.
const restyleNetwork = (reshaped) => {
  if (!network.sim || network.playing) return;
  renderNetwork();
  network.sim.alpha(reshaped ? 1 : 0.7).restart();
  if (reshaped) fitProgressNetwork(!reducedMotion.matches);
};

// Saving waits until you stop dragging a slider for a moment, so one
// slide is one request.
let networkStyleSaveTimer = null;
const saveNetworkStyle = () => {
  window.clearTimeout(networkStyleSaveTimer);
  const status = document.querySelector("#net-style-status");
  if (status) status.textContent = "";
  networkStyleSaveTimer = window.setTimeout(async () => {
    try {
      const response = await fetch("/api/network-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: networkStyle }),
      });
      if (!response.ok) throw new Error("not saved");
      if (status) status.textContent = "Saved";
    } catch {
      if (status) status.textContent = "Not saved, try again";
    }
  }, 700);
};

const changeNetworkStyle = (change) => {
  const before = { ...networkStyle };
  Object.assign(networkStyle, cleanNetworkStyle({ ...networkStyle, ...change }));
  showNetworkStyle();
  const changed = (key) => before[key] !== networkStyle[key];
  // Colors, sky and names are pure CSS. Curves only redraw the lines.
  // Everything else moves the dots.
  if (["shape", "spread", "dots", "pull"].some(changed)) {
    restyleNetwork(["shape", "spread", "dots"].some(changed));
  } else if (changed("curved") && network.linkLayer) {
    network.linkLayer.selectAll("path").attr("d", (link) => networkLinkPath(link));
  }
  saveNetworkStyle();
};

// Called by js/goals.js with the style the server sent, before the
// network is drawn, so it appears in your style from the first frame.
const useSavedNetworkStyle = (saved) => {
  Object.assign(networkStyle, cleanNetworkStyle(saved));
  showNetworkStyle();
};

// How much of the network the panel hides: on phones it is a sheet over
// the bottom, so js/network.js fits the network into the space above it.
const phoneLayout = window.matchMedia("(max-width: 560px)");
const networkStyleSheetHeight = () => {
  if (!netStylePanel.open || !phoneLayout.matches) return 0;
  const stageBox = netStage.getBoundingClientRect();
  return Math.max(0, stageBox.bottom - netStylePanel.getBoundingClientRect().top);
};

const openNetworkStylePanel = () => {
  netStylePanel.show();
  netStyleButton.setAttribute("aria-expanded", "true");
  showNetworkStyle();
  if (phoneLayout.matches) fitProgressNetwork(true);
  netStylePanel.querySelector('.net-style-choice[aria-pressed="true"]')?.focus();
};

const closeNetworkStylePanel = (returnFocus = true) => {
  if (!netStylePanel.open) return;
  netStylePanel.close();
  netStyleButton.setAttribute("aria-expanded", "false");
  if (phoneLayout.matches) fitProgressNetwork(true);
  if (returnFocus) netStyleButton.focus();
};

netStyleButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (netStylePanel.open) closeNetworkStylePanel();
  else openNetworkStylePanel();
});
// Clicks inside the panel shouldn't reach the network (which deselects).
netStylePanel.addEventListener("pointerdown", (event) => event.stopPropagation());
netStylePanel.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("pointerdown", (event) => {
  if (netStylePanel.open && !netStylePanel.contains(event.target) && event.target !== netStyleButton
    && !netStyleButton.contains(event.target)) {
    closeNetworkStylePanel(false);
  }
});
netStylePanel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeNetworkStylePanel();
  }
});

buildNetworkStylePanel();
showNetworkStyle();
