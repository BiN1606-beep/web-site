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

const showPanelTab = (name, { focus = false } = {}) => {
  for (const tab of panelTabs) {
    const selected = tab.dataset.tab === name;
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
