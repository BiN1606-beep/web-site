// A friend's network on their Community profile: a small, read-only copy
// of the progress network, with their streak and rewards. The server only
// sends it when they share their progress (lua/osiris/community.lua,
// friend_network), and never their check-in notes.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

// Lays the network out once with d3's physics (300 quiet steps, no
// animation) and draws it as a still picture. Hover a dot to see its name.
const drawFriendNetwork = (svg, goals, rewardRings) => {
  const nodes = [];
  const links = [];
  goals.forEach((goal) => {
    const color = areaColor(goal.area);
    const hub = { id: `g${goal.id}`, kind: "goal", label: goal.goal, color, r: goal.finished ? 12 : 10, finished: goal.finished };
    nodes.push(hub);
    let previous = hub.id;
    const steps = [
      ...(goal.completed || []).map((step) => ({ ...step, done: true })),
      ...(goal.current_step ? [{ ...goal.current_step, done: false }] : []),
    ];
    steps.forEach((step, index) => {
      const id = `g${goal.id}s${index}`;
      nodes.push({ id, kind: "step", label: step.title, color, r: step.done ? 4.5 : 5.5, done: step.done });
      links.push({ source: previous, target: id });
      previous = id;
    });
  });
  if (!nodes.length) return false;

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((node) => node.id).distance(18).strength(1))
    .force("charge", d3.forceManyBody().strength(-45))
    .force("collide", d3.forceCollide((node) => node.r + 3))
    .force("x", d3.forceX(0).strength(0.04))
    .force("y", d3.forceY(0).strength(0.04))
    .stop();
  for (let tick = 0; tick < 300; tick += 1) simulation.tick();

  // Fit the picture: the viewBox is the area the dots ended up in.
  const pad = 24;
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 120);
  const height = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 120);
  const root = d3.select(svg).attr("viewBox", `${minX} ${minY} ${width} ${height}`);
  root.selectAll("*").remove();

  root.append("g").selectAll("line").data(links).join("line")
    .attr("class", "friend-link")
    .attr("x1", (link) => link.source.x).attr("y1", (link) => link.source.y)
    .attr("x2", (link) => link.target.x).attr("y2", (link) => link.target.y);

  const groups = root.append("g").selectAll("g").data(nodes).join("g")
    .attr("transform", (node) => `translate(${node.x},${node.y})`);
  // Their rewards, like in your own network: one gold ring per reward.
  groups.filter((node) => node.kind === "goal").each(function drawRings() {
    for (let ring = 0; ring < rewardRings; ring += 1) {
      d3.select(this).append("circle")
        .attr("class", "friend-ring")
        .attr("r", (node) => node.r + 6 + ring * 3);
    }
  });
  groups.append("circle")
    .attr("r", (node) => node.r)
    .attr("fill", (node) => (node.kind === "step" && !node.done ? "var(--base)" : node.color))
    .attr("stroke", (node) => (node.kind === "step" && !node.done ? "var(--accent)" : "none"))
    .attr("stroke-width", 2);
  groups.append("title").text((node) => (node.kind === "goal" ? node.label : `${node.label}${node.done ? "" : " (now)"}`));
  return true;
};

const renderFriendNetwork = (container, data) => {
  const goals = Array.isArray(data.goals) ? data.goals : [];
  const checkins = (Array.isArray(data.checkin_days) ? data.checkin_days : []).map((day) => ({ day }));
  const streak = computeStreak(checkins);
  const stepsDone = goals.reduce((sum, goal) => sum + (goal.completed?.length || 0), 0);
  const rewards = computeRewards(stepsDone, streak.best).filter((reward) => reward.earned);

  const section = document.createElement("section");
  section.className = "friend-network";
  const title = document.createElement("strong");
  title.textContent = "Their network";
  const stats = document.createElement("p");
  stats.className = "friend-network-stats";
  const streakText = streak.current > 0 ? `${streak.current}-day streak` : "No streak right now";
  stats.textContent = `${streakText} · best ${streak.best} · ${stepsDone} ${stepsDone === 1 ? "step" : "steps"} done`;
  section.append(title, stats);

  if (window.d3 && goals.length) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "friend-network-graph");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Their progress network: ${goals.length} ${goals.length === 1 ? "goal" : "goals"} and ${stepsDone} finished steps`);
    section.append(svg);
    drawFriendNetwork(svg, goals, rewards.length);
  }

  if (rewards.length) {
    const list = document.createElement("p");
    list.className = "friend-network-rewards";
    list.textContent = `Rewards: ${rewards.map((reward) => reward.label).join(", ")}`;
    section.append(list);
  }
  container.append(section);
};
