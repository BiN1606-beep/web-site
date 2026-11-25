// "Keep evolving": when every step of a goal is done, the Today tab asks if
// you want to keep going. Say yes, write your actual goal in your own words,
// and the AI coach builds an optimized roadmap for it (the "evolve" action,
// lua/osiris/coach.lua). The finished goal stays in your network.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const evolveChoice = document.querySelector("#evolve-choice");
const evolveYes = document.querySelector("#evolve-yes");
const evolveNo = document.querySelector("#evolve-no");
const evolveLater = document.querySelector("#evolve-later");
const evolveForm = document.querySelector("#evolve-form");
const evolveLabel = document.querySelector("#evolve-label");
const evolveInput = document.querySelector("#evolve-input");
const evolveSubmit = document.querySelector("#evolve-submit");
const evolveStatus = document.querySelector("#evolve-status");

// Back to the first question, for the next time a goal is finished.
const resetEvolve = () => {
  evolveChoice.hidden = false;
  evolveLater.hidden = true;
  evolveForm.hidden = true;
  evolveStatus.textContent = "";
};

evolveYes.addEventListener("click", () => {
  const finishedGoal = progressTreeState?.goal;
  evolveLabel.textContent = finishedGoal
    ? `You reached "${finishedGoal}". What is the actual goal behind it?`
    : "What is your actual goal?";
  evolveChoice.hidden = true;
  evolveForm.hidden = false;
  evolveInput.focus();
});

evolveNo.addEventListener("click", () => {
  evolveChoice.hidden = true;
  evolveLater.hidden = false;
});

evolveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const dream = evolveInput.value.trim();
  if (dream.length < 3) {
    evolveStatus.textContent = "Tell your coach a little more about your goal.";
    return;
  }
  evolveSubmit.disabled = true;
  evolveInput.disabled = true;
  evolveStatus.textContent = "Your coach is building your roadmap. This can take up to a minute...";
  try {
    const result = await postProgressTree({ action: "evolve", dream });
    evolveInput.value = "";
    resetEvolve();
    // The new goal is now in focus; show its first step.
    showPanelTab("today");
    treeStatus.textContent = result.reply || "Your new roadmap is ready. Your first step is waiting.";
  } catch (error) {
    evolveStatus.textContent = error.message;
  } finally {
    evolveSubmit.disabled = false;
    evolveInput.disabled = false;
  }
});
