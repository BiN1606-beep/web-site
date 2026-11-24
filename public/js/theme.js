// The light/dark theme switch.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

backgroundToggle.addEventListener("click", () => {
  const isDark = document.documentElement.classList.toggle("is-dark");
  const secureAttribute = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `background-theme=${isDark ? "dark" : "light"}; Path=/; Max-Age=31536000; SameSite=Lax${secureAttribute}`;
  backgroundToggle.setAttribute("aria-pressed", String(isDark));
  backgroundToggleLabel.textContent = isDark ? "Switch to light theme" : "Switch to dark theme";
  backgroundToggle.setAttribute("aria-label", backgroundToggleLabel.textContent);
});

const isDark = document.documentElement.classList.contains("is-dark");
backgroundToggle.setAttribute("aria-pressed", String(isDark));
backgroundToggleLabel.textContent = isDark ? "Switch to light theme" : "Switch to dark theme";
backgroundToggle.setAttribute("aria-label", backgroundToggleLabel.textContent);
