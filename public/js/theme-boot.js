// Light or dark background, before the page is shown (the cookie set by
// theme.js). Runs first so the page never flashes the wrong color. Kept in
// its own file so the Content-Security-Policy can forbid inline scripts.
if (document.cookie.split(";").some((cookie) => cookie.trim() === "background-theme=dark")) {
  document.documentElement.classList.add("is-dark");
}
