// Osiris as a phone app (a "PWA", progressive web app).
//
// Loaded on the home page and the welcome page. It:
//   1. Registers the service worker (sw.js), which shows a friendly screen
//      when the phone is offline and delivers daily reminders.
//   2. Marks the page with "is-standalone" when Osiris runs from the home
//      screen, so the CSS can drop browser-only things.
//   3. Keeps the phone's status bar the same color as the current theme.
//   4. Offers "Get the app": a small floating chip on phones. On Android
//      (Chrome, Edge, Samsung) it opens the browser's own install prompt.
//      On iPhone, where Safari has no install prompt, it shows three
//      animated steps: Share, Add to Home Screen, open.
//
// Any button with data-install-open (for example in Settings) opens the
// same flow. Nothing here is sent to the server.

(() => {
  const root = document.documentElement;
  const DISMISS_KEY = "osiris-install-dismissed";
  const DISMISS_DAYS = 14;

  // ---- 1. Service worker ----
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker not registered:", error);
    });
  }

  // ---- 2. Running as an installed app? ----
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  if (isStandalone()) root.classList.add("is-standalone");

  // ---- 3. Status bar color follows the theme ----
  const themeMeta = (() => {
    // The page starts with a light and a dark color picked by the phone's
    // setting; once the theme is known, one exact color replaces both.
    for (const meta of document.querySelectorAll('meta[name="theme-color"][media]')) meta.remove();
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    return meta;
  })();
  const syncThemeColor = () => {
    const color = getComputedStyle(document.body || root).backgroundColor;
    if (color && color !== "rgba(0, 0, 0, 0)") themeMeta.content = color;
  };
  const watchTheme = () => {
    syncThemeColor();
    // Themes switch by changing classes or inline colors on <html> and <body>.
    // The body fades between colors (200 ms), so read the color once it settles.
    const observer = new MutationObserver(() => setTimeout(syncThemeColor, 260));
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTimeout(syncThemeColor, 260));
  };

  // ---- 4. Get the app ----
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isPhoneSized = () => window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
  let installPrompt = null;

  const readDismissed = () => {
    try {
      return Number(localStorage.getItem(DISMISS_KEY)) || 0;
    } catch {
      return 0;
    }
  };
  const rememberDismissed = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private browsing: the chip simply comes back next time.
    }
  };
  const recentlyDismissed = () => Date.now() - readDismissed() < DISMISS_DAYS * 86400000;
  const canInstall = () => !isStandalone() && (installPrompt !== null || isIos);

  // Small icons used by the chip and the iPhone steps (static markup only).
  const ICONS = {
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg>',
    add: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m0 0-6-6m6 6 6-6"/></svg>',
  };

  let chip = null;
  let sheet = null;

  const hideChip = () => {
    if (!chip) return;
    chip.classList.add("is-leaving");
    const old = chip;
    chip = null;
    setTimeout(() => old.remove(), 300);
  };

  const showChip = () => {
    if (chip || !canInstall() || recentlyDismissed() || !isPhoneSized()) return;
    // Wait for the intro animation on the home page to finish.
    if (root.classList.contains("show-startup") && document.querySelector("#startup-screen")) {
      setTimeout(showChip, 1500);
      return;
    }
    chip = document.createElement("div");
    chip.className = "install-chip";
    chip.innerHTML = `
      <button class="install-chip-open" type="button">
        <img src="/icons/icon-192.png" alt="" width="34" height="34">
        <span>Get the app</span>
      </button>
      <button class="install-chip-close" type="button" aria-label="Not now">${ICONS.close}</button>`;
    chip.querySelector(".install-chip-open").addEventListener("click", openInstall);
    chip.querySelector(".install-chip-close").addEventListener("click", () => {
      rememberDismissed();
      hideChip();
    });
    document.body.append(chip);
  };

  // Confetti and a cheer when the app lands on the home screen.
  const celebrate = () => {
    hideChip();
    if (sheet?.open) sheet.close();
    const party = document.createElement("div");
    party.className = "install-party";
    party.setAttribute("role", "status");
    party.innerHTML = '<div class="install-party-card"><img src="/icons/icon-192.png" alt="" width="64" height="64"><strong>Osiris is on your home screen!</strong></div>';
    const colors = ["#c98a1b", "#4f8a3c", "#3d6fa8", "#a8557a", "#2b8580", "#c2642a"];
    for (let index = 0; index < 28; index += 1) {
      const bit = document.createElement("i");
      bit.style.setProperty("--x", `${Math.round(Math.random() * 100)}vw`);
      bit.style.setProperty("--drift", `${Math.round(Math.random() * 120 - 60)}px`);
      bit.style.setProperty("--delay", `${Math.round(Math.random() * 400)}ms`);
      bit.style.setProperty("--spin", `${Math.round(Math.random() * 720 - 360)}deg`);
      bit.style.background = colors[index % colors.length];
      party.append(bit);
    }
    document.body.append(party);
    setTimeout(() => party.classList.add("is-leaving"), 2600);
    setTimeout(() => party.remove(), 3000);
  };

  // iPhone: three animated steps, pointing at Safari's Share button.
  const buildSheet = () => {
    const dialog = document.createElement("dialog");
    dialog.className = "install-sheet";
    dialog.setAttribute("aria-labelledby", "install-sheet-title");
    dialog.innerHTML = `
      <button class="install-sheet-close" type="button" aria-label="Close">${ICONS.close}</button>
      <img class="install-sheet-icon" src="/icons/icon-192.png" alt="" width="72" height="72">
      <h2 id="install-sheet-title">Add Osiris to your home screen</h2>
      <ol class="install-steps">
        <li style="--step: 0"><span class="install-step-art">${ICONS.share}</span><span>Tap <b>Share</b></span></li>
        <li style="--step: 1"><span class="install-step-art">${ICONS.add}</span><span><b>Add to Home Screen</b></span></li>
        <li style="--step: 2"><span class="install-step-art"><img src="/icons/icon-192.png" alt="" width="30" height="30"></span><span>Open <b>Osiris</b></span></li>
      </ol>
      <div class="install-sheet-arrow" aria-hidden="true">${ICONS.down}</div>`;
    dialog.querySelector(".install-sheet-close").addEventListener("click", () => dialog.close());
    // A tap on the dimmed background closes the sheet (not one on its padding).
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientY < box.top || event.clientX < box.left || event.clientX > box.right) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  };

  async function openInstall() {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") {
        celebrate();
      } else {
        rememberDismissed();
        hideChip();
      }
      return;
    }
    sheet ??= buildSheet();
    if (!sheet.open) sheet.showModal();
  }

  // Android: the browser says Osiris can be installed.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallButtons();
    setTimeout(showChip, 2500);
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    updateInstallButtons();
    celebrate();
  });

  // Buttons elsewhere on the page (Settings) that open the same flow.
  const updateInstallButtons = () => {
    for (const button of document.querySelectorAll("[data-install-open]")) {
      const status = button.parentElement.querySelector("[data-install-status]");
      const installed = isStandalone();
      button.hidden = installed || !canInstall();
      if (status) {
        status.textContent = installed
          ? "You are using the Osiris app."
          : canInstall()
            ? ""
            : "Open Osiris in Chrome (Android) or Safari (iPhone) to add it to your home screen.";
      }
    }
  };

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-install-open]")) openInstall();
  });

  const start = () => {
    watchTheme();
    updateInstallButtons();
    if (isIos) setTimeout(showChip, 2500);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
