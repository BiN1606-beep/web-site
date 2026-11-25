// Settings > Appearance: your color theme and your fonts.
//
// - Theme: Osiris (warm paper and deep green, the default), the four
//   Catppuccin flavors, Nord, Gruvbox, Rose Pine, Solarized, Tokyo Night
//   and Everforest. Every theme has a light and a dark look, so the
//   sun/moon switch keeps working. The colors live in css/themes.css.
// - Fonts: one for headings and one for text, all free (Google Fonts,
//   plus JetBrains Mono Nerd Font from our own server).
//
// Every tap shows at once. The choice is saved on your account
// (POST /api/appearance, lua/osiris/appearance.lua), the same way as
// "Customize your network", and GET /api/progress-tree sends it back.
// A copy is also kept in this browser (localStorage) so js/appearance-boot.js
// can paint the page in your colors before anything else loads.
//
// Loaded before js/theme.js, which calls refreshAppearanceLook() when
// you flip between light and dark.

// light/dark: the look (css/themes.css) used in each mode. "mode" means
// the theme is really a light or a dark one (like Catppuccin Mocha), so
// picking it also flips the sun/moon switch.
// Keep the ids in step with THEMES in lua/osiris/appearance.lua.
const APPEARANCE_THEMES = [
  { id: "osiris", name: "Osiris", light: "osiris-light", dark: "osiris-dark" },
  { id: "latte", name: "Latte", group: "Catppuccin", light: "latte", dark: "mocha", mode: "light" },
  { id: "frappe", name: "Frappé", group: "Catppuccin", light: "latte", dark: "frappe", mode: "dark" },
  { id: "macchiato", name: "Macchiato", group: "Catppuccin", light: "latte", dark: "macchiato", mode: "dark" },
  { id: "mocha", name: "Mocha", group: "Catppuccin", light: "latte", dark: "mocha", mode: "dark" },
  { id: "nord", name: "Nord", light: "nord-light", dark: "nord-dark" },
  { id: "gruvbox", name: "Gruvbox", light: "gruvbox-light", dark: "gruvbox-dark" },
  { id: "rose-pine", name: "Rosé Pine", light: "rose-pine-dawn", dark: "rose-pine" },
  { id: "solarized", name: "Solarized", light: "solarized-light", dark: "solarized-dark" },
  { id: "tokyo-night", name: "Tokyo Night", light: "tokyo-day", dark: "tokyo-night" },
  { id: "everforest", name: "Everforest", light: "everforest-light", dark: "everforest-dark" },
];

// stack: the CSS font list (with a fallback). google: the family as the
// Google Fonts address writes it (null = already loaded, or self-hosted).
// headingOnly: playful fonts that are too hard to read in long text.
// Keep the ids in step with the font lists in lua/osiris/appearance.lua.
const APPEARANCE_FONTS = [
  { id: "fraunces", name: "Fraunces", stack: '"Fraunces", Georgia, serif', google: null },
  { id: "ibm-plex-sans", name: "IBM Plex Sans", stack: '"IBM Plex Sans", system-ui, sans-serif', google: null },
  { id: "jetbrains-mono-nerd", name: "JetBrains Mono Nerd Font", short: "JetBrains Mono Nerd", stack: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace', google: null },
  { id: "inter", name: "Inter", stack: '"Inter", system-ui, sans-serif', google: "Inter:wght@400;500;600;700" },
  { id: "nunito", name: "Nunito", stack: '"Nunito", system-ui, sans-serif', google: "Nunito:wght@400;600;700" },
  { id: "lexend", name: "Lexend", stack: '"Lexend", system-ui, sans-serif', google: "Lexend:wght@400;500;600" },
  { id: "atkinson", name: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", system-ui, sans-serif', google: "Atkinson+Hyperlegible:wght@400;700" },
  { id: "space-grotesk", name: "Space Grotesk", stack: '"Space Grotesk", system-ui, sans-serif', google: "Space+Grotesk:wght@400;500;600" },
  { id: "outfit", name: "Outfit", stack: '"Outfit", system-ui, sans-serif', google: "Outfit:wght@400;500;600" },
  { id: "playfair", name: "Playfair Display", stack: '"Playfair Display", Georgia, serif', google: "Playfair+Display:wght@500;600;700" },
  { id: "lora", name: "Lora", stack: '"Lora", Georgia, serif', google: "Lora:wght@400;500;600" },
  { id: "merriweather", name: "Merriweather", stack: '"Merriweather", Georgia, serif', google: "Merriweather:wght@400;700" },
  { id: "source-serif", name: "Source Serif", stack: '"Source Serif 4", Georgia, serif', google: "Source+Serif+4:opsz,wght@8..60,400;8..60,600" },
  { id: "fira-code", name: "Fira Code", stack: '"Fira Code", ui-monospace, monospace', google: "Fira+Code:wght@400;500;600" },
  { id: "space-mono", name: "Space Mono", stack: '"Space Mono", ui-monospace, monospace', google: "Space+Mono:wght@400;700" },
  { id: "comic-neue", name: "Comic Neue", stack: '"Comic Neue", "Comic Sans MS", cursive', google: "Comic+Neue:wght@400;700" },
  { id: "caveat", name: "Caveat", stack: '"Caveat", cursive', google: "Caveat:wght@500;700", headingOnly: true },
  { id: "press-start", name: "Press Start 2P", stack: '"Press Start 2P", ui-monospace, monospace', google: "Press+Start+2P", headingOnly: true },
];

const APPEARANCE_DEFAULTS = { theme: "osiris", heading_font: "fraunces", text_font: "ibm-plex-sans" };
const APPEARANCE_STORAGE_KEY = "osiris-appearance";
const appearance = { ...APPEARANCE_DEFAULTS };

const findTheme = (id) => APPEARANCE_THEMES.find((theme) => theme.id === id) || APPEARANCE_THEMES[0];
const findFont = (id) => APPEARANCE_FONTS.find((font) => font.id === id);

// Keeps only known values, so an old or broken saved choice can't break
// the page.
const cleanAppearance = (saved) => {
  const clean = { ...APPEARANCE_DEFAULTS };
  if (!saved || typeof saved !== "object") return clean;
  if (APPEARANCE_THEMES.some((theme) => theme.id === saved.theme)) clean.theme = saved.theme;
  if (findFont(saved.heading_font)) clean.heading_font = saved.heading_font;
  const textFont = findFont(saved.text_font);
  if (textFont && !textFont.headingOnly) clean.text_font = saved.text_font;
  return clean;
};

// One Google Fonts address for a list of fonts (skipping the ones that
// are already on the page). Browsers only download a font file once some
// text actually uses it, so listing a font here costs almost nothing.
const googleFontsHref = (fonts) => {
  const families = fonts.filter((font) => font && font.google).map((font) => `family=${font.google}`);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap` : "";
};

const addFontLink = (href) => {
  if (!href || document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
};

const isDarkMode = () => document.documentElement.classList.contains("is-dark");

// Puts the current choice on the page: the look for light or dark, and
// the two fonts. Also remembers it in this browser for the next visit.
const refreshAppearanceLook = () => {
  const root = document.documentElement;
  const theme = findTheme(appearance.theme);
  root.dataset.look = isDarkMode() ? theme.dark : theme.light;
  const headingFont = findFont(appearance.heading_font);
  const textFont = findFont(appearance.text_font);
  root.style.setProperty("--font-display", headingFont.stack);
  root.style.setProperty("--font-body", textFont.stack);
  const fontsHref = googleFontsHref([headingFont, textFont]);
  addFontLink(fontsHref);
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
      ...appearance,
      light: theme.light,
      dark: theme.dark,
      heading: headingFont.stack,
      text: textFont.stack,
      fonts: fontsHref,
    }));
  } catch {
    // Private windows can block storage; the page still works.
  }
  showAppearanceChoices();
};

// Flips the sun/moon switch (the same cookie js/theme.js sets).
const setDarkMode = (dark) => {
  if (isDarkMode() === dark) return;
  document.documentElement.classList.toggle("is-dark", dark);
  const secureAttribute = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `background-theme=${dark ? "dark" : "light"}; Path=/; Max-Age=31536000; SameSite=Lax${secureAttribute}`;
  if (typeof updateBackgroundToggle === "function") updateBackgroundToggle();
};

// ---- Saving (like js/network-style.js) ----
// Waits a moment so quick taps through the tiles are one request.
let appearanceSaveTimer = null;
const saveAppearance = () => {
  window.clearTimeout(appearanceSaveTimer);
  const status = document.querySelector("#appearance-status");
  if (status) status.textContent = "";
  appearanceSaveTimer = window.setTimeout(async () => {
    try {
      const response = await fetch("/api/appearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: appearance }),
      });
      if (!response.ok) throw new Error("not saved");
      if (status) status.textContent = "Saved";
    } catch {
      if (status) status.textContent = "Not saved, try again";
    }
  }, 600);
};

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

// A new theme washes over the page in a circle from the tile you tapped
// (a short View Transition). Browsers without it just switch.
const changeAppearance = (change, origin) => {
  const apply = () => {
    Object.assign(appearance, cleanAppearance({ ...appearance, ...change }));
    const theme = findTheme(appearance.theme);
    if (change.theme && theme.mode) setDarkMode(theme.mode === "dark");
    refreshAppearanceLook();
  };
  if (change.theme && origin && document.startViewTransition && !reducedMotionQuery.matches) {
    const box = origin.getBoundingClientRect();
    const root = document.documentElement;
    root.style.setProperty("--wash-x", `${box.left + box.width / 2}px`);
    root.style.setProperty("--wash-y", `${box.top + box.height / 2}px`);
    root.classList.add("theme-washing");
    const transition = document.startViewTransition(apply);
    transition.finished.finally(() => root.classList.remove("theme-washing"));
  } else {
    apply();
  }
  saveAppearance();
};

// Called by js/goals.js with what the server sent. On a device where
// the sun/moon switch was never touched, a dark-only theme (like
// Catppuccin Mocha) also turns dark mode on.
const useSavedAppearance = (saved) => {
  Object.assign(appearance, cleanAppearance(saved));
  const theme = findTheme(appearance.theme);
  const switchTouched = document.cookie.split(";").some((cookie) => cookie.trim().startsWith("background-theme="));
  if (theme.mode && !switchTouched) setDarkMode(theme.mode === "dark");
  refreshAppearanceLook();
};

// ---- The tiles in Settings ----
const themeGrid = document.querySelector("#theme-grid");
const headingFontRow = document.querySelector("#heading-font-row");
const textFontRow = document.querySelector("#text-font-row");

const makeChoice = (className, label, onPick) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", () => onPick(button));
  return button;
};

const buildAppearancePanel = () => {
  if (!themeGrid) return;
  for (const theme of APPEARANCE_THEMES) {
    const label = theme.group ? `${theme.group} ${theme.name}` : theme.name;
    const tile = makeChoice("theme-tile", label, (button) => changeAppearance({ theme: theme.id }, button));
    tile.dataset.theme = theme.id;
    // A tiny page in the theme's own colors: a header bar, two lines of
    // text, a button and three colored dots.
    tile.innerHTML = `
      <span class="theme-tile-page" aria-hidden="true">
        <span class="theme-tile-bar"></span>
        <span class="theme-tile-line"></span>
        <span class="theme-tile-line is-short"></span>
        <span class="theme-tile-dots"><i></i><i></i><i></i></span>
        <span class="theme-tile-button"></span>
      </span>
      <span class="theme-tile-name"></span>`;
    tile.querySelector(".theme-tile-name").textContent = theme.name;
    if (theme.group) {
      const group = document.createElement("span");
      group.className = "theme-tile-group";
      group.textContent = theme.group;
      tile.querySelector(".theme-tile-page").append(group);
    }
    themeGrid.append(tile);
  }
  for (const [row, key] of [[headingFontRow, "heading_font"], [textFontRow, "text_font"]]) {
    for (const font of APPEARANCE_FONTS) {
      if (key === "text_font" && font.headingOnly) continue;
      const tile = makeChoice("font-tile", font.name, () => changeAppearance({ [key]: font.id }));
      tile.dataset.font = font.id;
      tile.style.fontFamily = font.stack;
      tile.innerHTML = `<span class="font-tile-sample" aria-hidden="true">Aa</span><span class="font-tile-name"></span>`;
      tile.querySelector(".font-tile-name").textContent = font.short || font.name;
      row.append(tile);
    }
  }
};

// Marks the chosen tiles, and gives each theme tile the look it would
// have right now (light or dark).
const showAppearanceChoices = () => {
  if (!themeGrid) return;
  const dark = isDarkMode();
  for (const tile of themeGrid.children) {
    const theme = findTheme(tile.dataset.theme);
    const mode = theme.mode || (dark ? "dark" : "light");
    tile.firstElementChild.dataset.look = mode === "dark" ? theme.dark : theme.light;
    tile.setAttribute("aria-pressed", String(theme.id === appearance.theme));
  }
  for (const [row, key] of [[headingFontRow, "heading_font"], [textFontRow, "text_font"]]) {
    for (const tile of row.children) {
      tile.setAttribute("aria-pressed", String(tile.dataset.font === appearance[key]));
    }
  }
};

// The font tiles show each font, so all of them are fetched the first
// time Settings opens (not before, to keep the first visit light).
const loadAllFontPreviews = () => addFontLink(googleFontsHref(APPEARANCE_FONTS));
const settingsPanelElement = document.querySelector("#settings-panel");
if (settingsPanelElement) {
  new MutationObserver(() => {
    if (settingsPanelElement.open) loadAllFontPreviews();
  }).observe(settingsPanelElement, { attributes: true, attributeFilter: ["open"] });
}

document.querySelector("#appearance-reset")?.addEventListener("click", () => {
  changeAppearance({ ...APPEARANCE_DEFAULTS });
});

buildAppearancePanel();
// Start from what this browser remembers until the server answers.
try {
  const remembered = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || "null");
  if (remembered) Object.assign(appearance, cleanAppearance(remembered));
} catch {
  // Nothing remembered; the default look it is.
}
refreshAppearanceLook();
