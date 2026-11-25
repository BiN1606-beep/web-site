// The three tabs in the side panel: Today, Progress and Week.
//
// Before, the panel stacked the step, streak, rewards and weekly review on
// top of each other, which was a lot to take in at once. Now it shows one
// part at a time. A small dot on a tab means something there is waiting for
// you (no check-in yet today, a new reward, a weekly review to do).
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const panelTabs = [...document.querySelectorAll(".panel-tab")];
const PANEL_TAB_STORAGE = "osiris-panel-tab";

const panelTabList = document.querySelector(".panel-tabs");
// The sliding pill behind the chosen tab (css/motion.css) is drawn by the
// tab list itself; the tabs only say where it should be.
panelTabList?.classList.add("has-pill");

const showPanelTab = (name, { focus = false } = {}) => {
  panelTabs.forEach((tab, index) => {
    if (tab.dataset.tab === name) panelTabList?.style.setProperty("--tab-index", String(index));
  });
  for (const tab of panelTabs) {
    const selected = tab.dataset.tab === name;
    const page = document.getElementById(tab.getAttribute("aria-controls"));
    // The newly shown page's cards rise in (only on a real switch).
    if (selected && page.hidden) {
      page.classList.remove("is-entering");
      void page.offsetWidth;
      page.classList.add("is-entering");
      window.setTimeout(() => page.classList.remove("is-entering"), 900);
    }
    tab.setAttribute("aria-selected", String(selected));
    // Only the selected tab is reached with Tab; arrow keys move between them.
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
    if (selected && focus) tab.focus();
  }
  // A new reward has been seen once you open Progress.
  if (name === "progress") setPanelTabDot("progress", false);
  try {
    localStorage.setItem(PANEL_TAB_STORAGE, name);
  } catch {
    // Private windows may block storage; the tab just isn't remembered.
  }
};

// Shows or hides the "something is waiting here" dot on a tab.
const setPanelTabDot = (name, on) => {
  const tab = panelTabs.find((item) => item.dataset.tab === name);
  if (tab) tab.classList.toggle("has-dot", on);
};

for (const tab of panelTabs) {
  tab.addEventListener("click", () => showPanelTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = (panelTabs.indexOf(tab) + step + panelTabs.length) % panelTabs.length;
    showPanelTab(panelTabs[index].dataset.tab, { focus: true });
  });
}

// Open the tab used last time on this device (Today the first time).
try {
  const saved = localStorage.getItem(PANEL_TAB_STORAGE);
  if (panelTabs.some((tab) => tab.dataset.tab === saved)) showPanelTab(saved);
} catch {
  // Keep Today.
}

// The one-line explanations under Streak, Rewards and Your week start folded
// away behind a small "What's this?" button, so the panel stays calm.
for (const help of document.querySelectorAll(".home-panel .section-help")) {
  if (!help.id) help.id = `help-${Math.random().toString(36).slice(2, 8)}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "help-toggle";
  button.textContent = "What's this?";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", help.id);
  help.hidden = true;
  help.before(button);
  button.addEventListener("click", () => {
    help.hidden = !help.hidden;
    button.setAttribute("aria-expanded", String(!help.hidden));
  });
}
