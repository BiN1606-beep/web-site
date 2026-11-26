// The growing network on the welcome page (welcome.html).

// A small hand-placed network that grows step by step, like the real
// one does. The real site uses the d3 library; this page stays light.
(() => {
  const svg = document.querySelector("#demo");
  const ns = "http://www.w3.org/2000/svg";
  const css = (name) => `var(--${name})`;
  // [id, x, y, radius, color, grows from]
  const nodes = [
    ["g1", 150, 170, 16, "leaf", null],
    ["a1", 120, 120, 6, "leaf", "g1"],
    ["a2", 95, 160, 6, "leaf", "a1"],
    ["a3", 92, 205, 6, "leaf", "a2"],
    ["a4", 118, 240, 6, "leaf", "a3"],
    ["s1", 60, 110, 5, "accent", "a2"],
    ["g2", 265, 245, 16, "learning", null],
    ["b1", 300, 205, 6, "learning", "g2"],
    ["b2", 320, 250, 6, "learning", "b1"],
    ["b3", 305, 292, 6, "learning", "b2"],
    ["s2", 215, 300, 5, "accent", "b3"],
    ["a5", 160, 270, 6, "leaf", "a4"],
    ["g3", 270, 110, 14, "mind", null],
    ["c1", 235, 75, 6, "mind", "g3"],
    ["c2", 310, 80, 6, "mind", "g3"],
    ["s3", 200, 205, 5, "accent", "a5"],
  ];
  const byId = Object.fromEntries(nodes.map((node) => [node[0], node]));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const links = document.createElementNS(ns, "g");
  const dots = document.createElementNS(ns, "g");
  svg.append(links, dots);

  // Adds one dot (and the line it grows from). Only the new dot
  // animates; the ones already there stay put.
  const addNode = ([id, x, y, r, color, from]) => {
      if (from) {
        const parent = byId[from];
        const line = document.createElementNS(ns, "line");
        line.setAttribute("class", "link");
        line.setAttribute("x1", parent[1]);
        line.setAttribute("y1", parent[2]);
        line.setAttribute("x2", x);
        line.setAttribute("y2", y);
        links.append(line);
      }
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("class", "node");
      circle.setAttribute("cx", x);
      circle.setAttribute("cy", y);
      circle.setAttribute("r", r);
      circle.style.fill = id.startsWith("s") ? css("base") : css(color);
      circle.style.stroke = id.startsWith("s") ? css("accent") : "none";
      circle.style.strokeWidth = "2";
      dots.append(circle);
  };

  // Once everything has grown, the skills link to more steps.
  const addSkillLinks = () => {
      for (const [skill, step] of [["s1", "c1"], ["s3", "b1"], ["s2", "a5"]]) {
        const line = document.createElementNS(ns, "line");
        line.setAttribute("class", "link");
        line.setAttribute("stroke-dasharray", "3 4");
        line.setAttribute("x1", byId[skill][1]);
        line.setAttribute("y1", byId[skill][2]);
        line.setAttribute("x2", byId[step][1]);
        line.setAttribute("y2", byId[step][2]);
        links.prepend(line);
      }
  };

  if (reduced) {
    nodes.forEach(addNode);
    addSkillLinks();
    return;
  }
  // Grow one dot at a time, pause on the full network, then start over.
  const PAUSE_TICKS = 6;
  let tickCount = 0;
  const tick = () => {
    if (tickCount < nodes.length) {
      addNode(nodes[tickCount]);
      if (tickCount === nodes.length - 1) addSkillLinks();
    } else if (tickCount >= nodes.length + PAUSE_TICKS) {
      links.replaceChildren();
      dots.replaceChildren();
      tickCount = -1;
    }
    tickCount += 1;
  };
  setInterval(tick, 650);
  tick();
})();
