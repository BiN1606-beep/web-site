// Opening and closing the pop-up panels (Community, Profile, Settings).
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const closePanel = (dialog) => {
  if (dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  dialog.querySelector(".close-button").disabled = true;
};

const openPanel = (dialog, trigger) => {
  if (activePanel === dialog && dialog.open) return;
  if (activePanel?.open) {
    queuedPanel = { dialog, trigger };
    closePanel(activePanel);
    return;
  }

  dialog.showModal();
  activePanel = dialog;
  homeLauncher.removeAttribute("aria-current");
  if (trigger?.getAttribute("aria-controls") === dialog.id) {
    trigger.setAttribute("aria-expanded", "true");
  }
};

const dialogs = [
  ...launcherItems.map(({ dialogId }) => [
    document.getElementById(dialogId),
    launcherByDialog.get(dialogId),
  ]),
  [profileEditorDialog, null],
  [debugMenuDialog, null],
  [panel, openSharedTextDemoButton],
  [groqDialog, openGroqDemoButton],
];

for (const [dialog, dialogTrigger] of dialogs) {
  const dialogCloseButton = dialog.querySelector(".close-button");

  dialogCloseButton.addEventListener("click", () => closePanel(dialog));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (dialog === profileEditorDialog && isOnboarding) return;
    closePanel(dialog);
  });
  dialog.addEventListener("animationend", (event) => {
    // "sheet-down" is the phone version, where panels slide away downwards (css/phone.css).
    if (["collapse-out", "menu-slide-out", "sheet-down"].includes(event.animationName)) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    dialog.classList.remove("is-closing");
    dialogCloseButton.disabled = false;
    if (dialogTrigger?.getAttribute("aria-controls") === dialog.id) {
      dialogTrigger.setAttribute("aria-expanded", "false");
    }
    if (activePanel === dialog) {
      activePanel = null;
      homeLauncher.setAttribute("aria-current", "page");
    }

    if (queuedPanel) {
      const nextPanel = queuedPanel;
      queuedPanel = null;
      openPanel(nextPanel.dialog, nextPanel.trigger);
      return;
    }

    dialogTrigger?.focus();
  });
}

// The Home tab on phones: back to the network.
homeLauncher.addEventListener("click", () => {
  if (activePanel?.open) closePanel(activePanel);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

for (const [dialog, trigger] of dialogs) {
  trigger?.addEventListener("click", () => {
    openPanel(dialog, trigger);
    if (dialog.id === "profile-view-panel" && !profileLoaded) loadAccount();
    if (dialog === communityDialog) loadCommunity();
  });
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (event.key.toLocaleLowerCase() !== "ä" || event.repeat
    || event.ctrlKey || event.metaKey || event.altKey
    || (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']"))) {
    return;
  }
  event.preventDefault();
  openDebugMenu();
});
