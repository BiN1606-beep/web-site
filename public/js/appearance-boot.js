// Paints the page in your color theme and fonts before it is shown, so it
// doesn't flash in the default colors first. It only reads what
// js/appearance.js remembered in this browser; your account still has the
// real choice and js/appearance.js applies it once the page has loaded.
// Runs in <head>, right after the light/dark cookie is read.
(() => {
  try {
    const saved = JSON.parse(localStorage.getItem("osiris-appearance") || "null");
    if (!saved) return;
    const root = document.documentElement;
    const look = root.classList.contains("is-dark") ? saved.dark : saved.light;
    if (typeof look === "string") root.dataset.look = look;
    if (typeof saved.heading === "string") root.style.setProperty("--font-display", saved.heading);
    if (typeof saved.text === "string") root.style.setProperty("--font-body", saved.text);
    if (typeof saved.fonts === "string" && saved.fonts.startsWith("https://fonts.googleapis.com/")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = saved.fonts;
      document.head.append(link);
    }
  } catch {
    // No storage (private window) or nothing saved: the default look.
  }
})();
