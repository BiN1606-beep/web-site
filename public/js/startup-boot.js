// Show the start-up animation, unless the visitor asked for less motion.
// In its own file so the Content-Security-Policy can forbid inline scripts.
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.classList.add("show-startup");
}
