// Drawing a shared tree: the picture that grows when two friends both
// water it on the same day (see lua/osiris/shared_trees.lua).
//
// The tree is drawn from a seeded random number generator, so the same
// tree always gets the same shape: every new day only adds to it. Its
// size follows "grown", the number of days you both watered:
//   * the trunk is two strands twisted together, one in your color and
//     one in your friend's,
//   * it branches one level deeper at 1, 3, 7, 15, 31 and 63 days,
//   * every day adds two leaves, one for each of you,
//   * every 10th day hangs a golden fruit.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const SHARED_TREE_STAGES = [
  [0, "Seed"],
  [1, "Sprout"],
  [3, "Seedling"],
  [7, "Sapling"],
  [14, "Young tree"],
  [30, "Tree"],
  [60, "Big tree"],
  [100, "Giant tree"],
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

// mulberry32: a tiny random number generator that gives the same numbers
// for the same seed.
const sharedTreeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const SVG_NS = "http://www.w3.org/2000/svg";
const svgElement = (tag, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
};

// Builds the branches as a list of segments. Each segment knows its level
// (0 is the trunk) so the leaves can sit on the outer branches.
const sharedTreeBranches = (random, depth, trunkLength) => {
  const segments = [];
  const grow = (x, y, angle, length, width, level) => {
    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;
    // A slight bend makes the branches look grown, not drawn with a ruler.
    const bend = (random() - 0.5) * length * 0.35;
    const midX = (x + endX) / 2 + Math.cos(angle + Math.PI / 2) * bend;
    const midY = (y + endY) / 2 + Math.sin(angle + Math.PI / 2) * bend;
    segments.push({ x, y, midX, midY, endX, endY, angle, width, level, length });
    if (level + 1 >= depth) return;
    const spread = 0.32 + random() * 0.22;
    const shrink = 0.7 + random() * 0.08;
    grow(endX, endY, angle - spread, length * shrink, width * 0.68, level + 1);
    grow(endX, endY, angle + spread * (0.85 + random() * 0.3), length * shrink, width * 0.68, level + 1);
    // Big trees get an extra middle branch now and then, so they look full.
    if (level >= 1 && level < depth - 2 && random() < 0.35) {
      grow(endX, endY, angle + (random() - 0.5) * 0.3, length * shrink * 0.85, width * 0.6, level + 1);
    }
  };
  grow(120, 196, -Math.PI / 2, trunkLength, 5 + depth * 1.3, 0);
  return segments;
};

// Draws the tree into an <svg>. tree has id, grown and status. When
// animateFrom is a number, the leaves after that count pop in (the new
// growth); the first time a tree is shown, everything grows in.
const drawSharedTree = (svg, tree, animateFrom = null) => {
  const grown = Math.max(0, Number(tree.grown) || 0);
  const random = sharedTreeRandom((Number(tree.id) || 1) * 9973);
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 240 220");
  svg.classList.toggle("is-animated", animateFrom !== null);

  // The ground: a soft hill both of you stand on.
  svg.append(svgElement("ellipse", { class: "shared-ground", cx: 120, cy: 204, rx: 92, ry: 12 }));

  if (grown === 0) {
    // Not grown yet: a seed in the soil with a tiny shoot once it's planted.
    svg.append(svgElement("ellipse", { class: "shared-seed", cx: 120, cy: 196, rx: 9, ry: 6 }));
    if (tree.status === "growing") {
      svg.append(svgElement("path", { class: "shared-shoot", d: "M120 192 q-2 -10 2 -16" }));
      svg.append(svgElement("ellipse", { class: "shared-leaf leaf-you", cx: 117, cy: 177, rx: 5, ry: 2.6, transform: "rotate(-30 117 177)" }));
      svg.append(svgElement("ellipse", { class: "shared-leaf leaf-friend", cx: 126, cy: 175, rx: 5, ry: 2.6, transform: "rotate(25 126 175)" }));
    }
    return;
  }

  // Size grows fast at first and slower later, so day 1 already shows a
  // little tree and day 100 fills the picture.
  const progress = Math.min(1, Math.log(grown + 1) / Math.log(101));
  const depth = Math.min(7, 1 + Math.floor(Math.log2(grown + 1)));
  const trunkLength = 20 + 34 * progress;
  const segments = sharedTreeBranches(random, depth, trunkLength);

  // Branches, thickest first. The trunk is two strands twisted together.
  const branches = svgElement("g", { class: "shared-branches" });
  segments.forEach((segment, index) => {
    const path = `M${segment.x.toFixed(1)} ${segment.y.toFixed(1)} Q${segment.midX.toFixed(1)} ${segment.midY.toFixed(1)} ${segment.endX.toFixed(1)} ${segment.endY.toFixed(1)}`;
    if (segment.level === 0) {
      const twist = segment.width * 0.45;
      for (const [side, className] of [[-1, "strand-you"], [1, "strand-friend"]]) {
        branches.append(svgElement("path", {
          class: `shared-strand ${className}`,
          d: `M${(segment.x + side * twist).toFixed(1)} ${segment.y.toFixed(1)} C${(segment.x - side * twist * 1.6).toFixed(1)} ${(segment.y - segment.length * 0.35).toFixed(1)} ${(segment.endX + side * twist * 1.6).toFixed(1)} ${(segment.endY + segment.length * 0.35).toFixed(1)} ${(segment.endX - side * twist * 0.4).toFixed(1)} ${segment.endY.toFixed(1)}`,
          "stroke-width": (segment.width * 0.7).toFixed(2),
          style: `--delay: 0ms`,
        }));
      }
      return;
    }
    branches.append(svgElement("path", {
      class: "shared-branch",
      d: path,
      "stroke-width": Math.max(0.8, segment.width).toFixed(2),
      pathLength: 1,
      style: `--delay: ${Math.min(600, segment.level * 90 + (index % 7) * 6)}ms`,
    }));
  });
  svg.append(branches);

  // A soft crown behind the leaves, so a big tree looks full.
  const tips = segments.filter((segment) => segment.level === depth - 1);
  if (depth >= 3) {
    const crown = svgElement("g", { class: "shared-crown" });
    for (const tip of tips) {
      crown.append(svgElement("circle", {
        cx: tip.endX.toFixed(1),
        cy: tip.endY.toFixed(1),
        r: (5 + 9 * progress).toFixed(1),
      }));
    }
    svg.insertBefore(crown, branches);
  }

  // Leaves: two per day, on the outer branches. They are placed in order,
  // so tomorrow's leaves are added and today's stay where they are. Each
  // leaf sits in its own group that moves and turns it, so the leaf itself
  // can pop from its own middle.
  const outer = segments.filter((segment) => segment.level >= Math.max(1, depth - 2) || depth <= 2);
  const leaves = svgElement("g", { class: "shared-leaves" });
  const leafCount = Math.min(grown * 2, 260);
  for (let index = 0; index < leafCount; index += 1) {
    const segment = outer[Math.floor(random() * outer.length)];
    const along = 0.45 + random() * 0.55;
    const inverse = 1 - along;
    // A point on the curved branch (a quadratic Bézier curve).
    const x = inverse * inverse * segment.x + 2 * inverse * along * segment.midX + along * along * segment.endX;
    const y = inverse * inverse * segment.y + 2 * inverse * along * segment.midY + along * along * segment.endY;
    const offset = (random() - 0.5) * 10;
    const leafX = x + Math.cos(segment.angle + Math.PI / 2) * offset;
    const leafY = y + Math.sin(segment.angle + Math.PI / 2) * offset;
    const turn = (segment.angle * 180) / Math.PI + (random() - 0.5) * 120;
    const size = 4.6 + random() * 2.2 + progress * 1.6;
    const isNew = animateFrom !== null && index >= animateFrom * 2;
    const holder = svgElement("g", { transform: `translate(${leafX.toFixed(1)} ${leafY.toFixed(1)}) rotate(${turn.toFixed(0)})` });
    holder.append(svgElement("ellipse", {
      class: `shared-leaf ${index % 2 ? "leaf-friend" : "leaf-you"}${isNew ? " is-new" : ""}`,
      rx: size.toFixed(1),
      ry: (size * 0.5).toFixed(1),
      style: `--delay: ${isNew ? Math.min(900, 250 + (index - animateFrom * 2) * 25) : 0}ms`,
    }));
    leaves.append(holder);
  }
  svg.append(leaves);

  // A golden fruit for every 10 days, at the branch tips.
  const fruitCount = Math.min(Math.floor(grown / 10), 40);
  const fruitRandom = sharedTreeRandom((Number(tree.id) || 1) * 31337);
  for (let index = 0; index < fruitCount && tips.length; index += 1) {
    const tip = tips[Math.floor(fruitRandom() * tips.length)];
    const isNew = animateFrom !== null && index >= Math.floor(animateFrom / 10);
    const holder = svgElement("g", {
      transform: `translate(${(tip.endX + (fruitRandom() - 0.5) * 6).toFixed(1)} ${(tip.endY + 3 + fruitRandom() * 4).toFixed(1)})`,
    });
    holder.append(svgElement("circle", {
      class: `shared-fruit${isNew ? " is-new" : ""}`,
      r: 3.4,
      style: `--delay: ${isNew ? 900 : 0}ms`,
    }));
    svg.append(holder);
  }
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
