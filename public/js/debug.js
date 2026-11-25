// The debug menu (only for the accounts in DEBUG_MENU_EMAIL).
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

debugResetButton.addEventListener("click", async () => {
  if (!window.confirm("Reset your entire progress tree, including completed steps, interview answers, chat, and AI memory?")) {
    return;
  }
  debugResetButton.disabled = true;
  debugStatus.textContent = "Resetting your progress tree...";
  treeAssistantOpen = true;
  try {
    await postProgressTree({ action: "debug_reset" });
    treeStatus.textContent = "Progress reset. Start with the first interview question.";
    openProgressTreeAfterDebug();
  } catch (error) {
    debugStatus.textContent = error.message;
  } finally {
    debugResetButton.disabled = false;
  }
});

debugSkipForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!debugSkipForm.reportValidity()) return;
  const count = Number(debugSkipCount.value);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    debugStatus.textContent = "Choose a whole number between 1 and 20.";
    return;
  }
  debugSkipButton.disabled = true;
  debugStatus.textContent = "Skipping skill-tree steps...";
  try {
    const result = await postProgressTree({ action: "debug_skip", count });
    treeStatus.textContent = result.tree.finished
      ? "Debug test: moved to the end of the skill tree."
      : `Debug test: now showing step ${result.tree.completed_count + 1}.`;
    openProgressTreeAfterDebug();
  } catch (error) {
    debugStatus.textContent = error.message;
  } finally {
    debugSkipButton.disabled = false;
  }
});

