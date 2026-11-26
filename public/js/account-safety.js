// Settings > Privacy and safety: sign out on every device, and delete your
// account. Both talk to lua/osiris/accounts.lua (handle_logout with
// "everywhere", and handle_delete_account).

const safetyStatus = document.querySelector("#safety-status");
const signOutEverywhereButton = document.querySelector("#sign-out-everywhere");
const deleteAccountOpen = document.querySelector("#delete-account-open");
const deleteAccountForm = document.querySelector("#delete-account-form");
const deleteAccountConfirm = document.querySelector("#delete-account-confirm");
const deleteAccountCancel = document.querySelector("#delete-account-cancel");
const deleteAccountSubmit = document.querySelector("#delete-account-submit");

const postJson = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Try again.");
  return result;
};

signOutEverywhereButton.addEventListener("click", async () => {
  signOutEverywhereButton.disabled = true;
  safetyStatus.textContent = "Signing out everywhere...";
  try {
    await postJson("/api/auth/logout", { everywhere: true });
    window.location.replace("/login");
  } catch (error) {
    safetyStatus.textContent = error.message;
    signOutEverywhereButton.disabled = false;
  }
});

const showDeleteForm = (show) => {
  deleteAccountForm.hidden = !show;
  deleteAccountOpen.hidden = show;
  safetyStatus.textContent = "";
  if (show) {
    deleteAccountConfirm.value = "";
    deleteAccountConfirm.focus();
  }
};

deleteAccountOpen.addEventListener("click", () => showDeleteForm(true));
deleteAccountCancel.addEventListener("click", () => showDeleteForm(false));

deleteAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  deleteAccountSubmit.disabled = true;
  safetyStatus.textContent = "Deleting your account...";
  try {
    await postJson("/api/auth/delete-account", { confirm: deleteAccountConfirm.value });
    window.location.replace("/welcome");
  } catch (error) {
    safetyStatus.textContent = error.message;
    deleteAccountSubmit.disabled = false;
  }
});
