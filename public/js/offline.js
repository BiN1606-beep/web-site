// The offline screen (offline.html): goes back into Osiris as soon as the
// internet returns, either on its own or when "Try again" is pressed.

const goBack = () => {
  document.body.classList.add("is-back");
  // A short pause so the sprout can wake up before the page changes.
  setTimeout(() => window.location.replace("/"), 450);
};

document.querySelector("#offline-retry").addEventListener("click", goBack);
window.addEventListener("online", goBack);
