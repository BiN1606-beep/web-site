// The sign-in page (public/login.html): switch between signing in and
// creating an account, send the form to the server, and show errors.
// Kept in its own file (not inline in the HTML) so the Content-Security-
// Policy can forbid inline scripts; see lua/osiris/security.lua.
(() => {
  const form = document.querySelector("#auth-form");
  const email = document.querySelector("#email");
  const password = document.querySelector("#password");
  const heading = document.querySelector("#heading");
  const submit = document.querySelector("#submit");
  const rememberMeLabel = document.querySelector("#remember-me-label");
  const rememberMe = document.querySelector("#remember-me");
  const switchMode = document.querySelector("#switch-mode");
  const status = document.querySelector("#status");
  let isSignup = false;

  const updateMode = () => {
    heading.textContent = isSignup ? "Create your account" : "Sign in";
    submit.textContent = isSignup ? "Create account" : "Sign in";
    switchMode.textContent = isSignup ? "Already have an account? Sign in" : "Create an account";
    password.autocomplete = isSignup ? "new-password" : "current-password";
    password.minLength = isSignup ? 12 : 1;
    rememberMeLabel.hidden = isSignup;
    status.textContent = "";
  };

  switchMode.addEventListener("click", () => {
    isSignup = !isSignup;
    updateMode();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = isSignup ? "Creating your account..." : "Signing in...";
    try {
      const response = await fetch(isSignup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.value,
          password: password.value,
          ...(isSignup ? {} : { rememberMe: rememberMe.checked }),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || (response.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : "Authentication failed."));
      }
      window.location.replace("/");
    } catch (error) {
      status.textContent = error.message || "Authentication failed.";
    } finally {
      submit.disabled = false;
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get("error") === "google-config") {
    status.textContent = "Google sign-in is not configured yet. Set up HTTPS for this site and configure its Google OAuth credentials.";
  } else if (params.get("error") === "google") {
    status.textContent = "Google sign-in failed. Try again or use your email.";
  }

  fetch("/api/auth/me", { cache: "no-store" })
    .then(async (response) => {
      if (response.ok) window.location.replace("/");
      else if (response.status !== 401) throw new Error("Could not check your sign-in status.");
    })
    .catch((error) => {
      status.textContent = error.message;
    });
})();
