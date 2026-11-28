// The focus goal: drawing the panel, loading and saving, the interview and AI coach, check-ins, undo and step guides.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const renderTreeConversation = (conversation = []) => {
  treeChat.replaceChildren();
  treeInterviewChoices.replaceChildren();
  const answerCount = conversation.filter((message) => message.role === "user").length;
  const currentQuestion = conversation.at(-1);
  const choices = !progressTreeState?.exists && Array.isArray(currentQuestion?.choices)
    ? currentQuestion.choices
    : [];
  treeInterviewProgress.hidden = progressTreeState?.exists || choices.length === 0;
  treeInterviewProgress.textContent = `Question ${Math.min(answerCount + 1, 10)} of 10`;
  treeInterviewChoices.hidden = choices.length === 0;
  for (const message of conversation) {
    const bubble = document.createElement("div");
    bubble.className = `tree-chat-message${message.role === "user" ? " is-user" : ""}`;
    bubble.textContent = message.content;
    treeChat.append(bubble);
  }
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-interview-choice";
    button.textContent = choice;
    button.addEventListener("click", () => sendTreeAnswer(choice));
    treeInterviewChoices.append(button);
  }
  if (choices.length > 0) treeInterviewChoices.append(...buildOwnAnswer());
  treeChat.scrollTop = treeChat.scrollHeight;
};

// "Describe your own": a button under the choices. Tapping it slides a
// small text field out right below, so the user can write the answer in
// their own words when no choice fits. The server checks the text again.
const OWN_ANSWER_MAX = 160;

const pencilIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("tree-own-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4");
  svg.append(path);
  return svg;
};

const buildOwnAnswer = () => {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-interview-choice tree-own-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "tree-own-answer");
  const label = document.createElement("span");
  label.textContent = "Describe your own";
  toggle.append(pencilIcon(), label);

  // The outer box animates its height; the form inside keeps its size.
  const drawer = document.createElement("div");
  drawer.className = "tree-own-drawer";
  drawer.id = "tree-own-answer";
  const form = document.createElement("form");
  form.className = "tree-own-form";
  form.noValidate = true;
  // A one-line textarea that grows as the user writes, so a long goal
  // stays readable. Enter sends, like a chat app.
  const input = document.createElement("textarea");
  input.rows = 1;
  input.className = "tree-own-input";
  input.maxLength = OWN_ANSWER_MAX;
  input.autocomplete = "off";
  input.enterKeyHint = "send";
  input.placeholder = "In your own words...";
  input.setAttribute("aria-label", "Your own answer");
  input.tabIndex = -1;
  const count = document.createElement("span");
  count.className = "tree-own-count";
  count.setAttribute("aria-hidden", "true");
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "tree-own-send";
  send.setAttribute("aria-label", "Send your answer");
  send.textContent = "\u2192";
  send.disabled = true;
  send.tabIndex = -1;
  form.append(input, count, send);
  drawer.append(form);

  const refresh = () => {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
    const length = input.value.trim().length;
    send.disabled = length < 2;
    // The counter only shows near the limit, to keep the field calm.
    count.textContent = input.value.length > OWN_ANSWER_MAX - 30
      ? String(OWN_ANSWER_MAX - input.value.length)
      : "";
  };
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("is-open", open);
    drawer.classList.toggle("is-open", open);
    input.tabIndex = open ? 0 : -1;
    send.tabIndex = open ? 0 : -1;
    if (open) {
      input.focus({ preventScroll: true });
      drawer.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  toggle.addEventListener("click", () => setOpen(!drawer.classList.contains("is-open")));
  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim().replace(/\s+/g, " ");
    if (text.length < 2) {
      form.classList.remove("is-shaking");
      void form.offsetWidth;
      form.classList.add("is-shaking");
      return;
    }
    sendTreeAnswer(text, { custom: true });
  });
  return [toggle, drawer];
};

const updateTreeChecklist = () => {
  const checkboxes = [...treeStepTasks.querySelectorAll("input[type='checkbox']")];
  const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  const remaining = checkboxes.length - checkedCount;
  treeStepChecklist.hidden = checkboxes.length === 0;
  treeChecklistStatus.textContent = checkboxes.length
    ? `${checkedCount} of ${checkboxes.length} tasks checked.`
    : "";
  treeCompleteButton.disabled = completingTreeStep || remaining > 0;
  // The button says what is missing instead of just looking disabled.
  treeCompleteButton.textContent = remaining > 0
    ? `${remaining} left to check`
    : "Complete step";
};

const renderProgressTree = (tree) => {
  // If exactly one more step is done than last time, that step's
  // leaves get a "sprout" animation.
  const previousCount = progressTreeState?.exists && progressTreeState.goal === tree.goal
    ? progressTreeState.completed_count
    : null;
  const sproutIndex = previousCount !== null && tree.completed_count === previousCount + 1
    ? previousCount
    : -1;
  progressTreeState = tree;
  const conversation = Array.isArray(tree.conversation) ? tree.conversation : [];
  const hasConversation = conversation.length > 0;
  treeEmptyState.hidden = tree.exists || hasConversation;
  treeView.hidden = !tree.exists && !hasConversation;
  treeDetails.hidden = !tree.exists;
  treeAssistant.hidden = !treeAssistantOpen;
  treeChatForm.hidden = tree.exists === false;
  treeAssistantTitle.textContent = tree.exists ? "Your AI coach" : "Build your personalized skill tree";
  renderTreeConversation(conversation);
  treeStatus.textContent = "";
  if (!tree.exists) {
    treeActions.hidden = true;
    // No goal in focus (for example during an interview): no wilting.
    netStage.style.setProperty("--wilt", "0");
    // During an interview (or before the first goal) the network still
    // shows every other goal, or a single seed when there are none.
    if (window.d3) drawProgressNetwork(tree);
    if (hasConversation) {
      treeAssistantOpen = true;
      treeAssistant.hidden = false;
    }
    return;
  }

  treeActions.hidden = false;
  renderStreak(tree);
  renderWeeklyReview(tree);
  treeGoal.textContent = tree.goal;
  treeSummary.textContent = tree.summary;
  treeProgressCount.textContent = tree.finished
    ? `All ${tree.total_steps} steps done`
    : `Step ${tree.completed_count + 1} of ${tree.total_steps}`;
  treeProgressPercent.textContent = `${tree.progress}%`;
  treeProgressBar.setAttribute("aria-valuenow", String(tree.progress));
  treeProgressFill.style.width = `${tree.progress}%`;
  // Use the moving network when the d3 library loaded; otherwise keep
  // the simpler static tree so the page still works.
  if (window.d3) {
    drawProgressNetwork(tree, sproutIndex);
  } else {
    drawProgressTree(tree, sproutIndex);
  }
  if (tree.current_step) {
    treeCurrentStep.hidden = false;
    treeStepNumber.textContent = `Step ${tree.completed_count + 1} of ${tree.total_steps}`;
    treeStepTitle.textContent = tree.current_step.title;
    treeStepDescription.textContent = tree.current_step.description;
    treeStepWhy.textContent = shortWhy(tree.current_step.why);
    treeStepTip.textContent = tree.current_step.tip || "";
    treeStepTipContainer.hidden = !tree.current_step.tip;
    treeStepTime.textContent = tree.current_step.time ? `About ${tree.current_step.time}` : "";
    treeStepTime.hidden = !tree.current_step.time;
    const how = Array.isArray(tree.current_step.how) ? tree.current_step.how : [];
    treeStepHow.replaceChildren(...how.map((item) => createElement("li", "", item)));
    treeStepHowContainer.hidden = how.length === 0;
    treeStepGuideButton.hidden = how.length > 0;
    treeStepGuideButton.disabled = false;
    treeStepGuideButton.textContent = "How do I do this?";
    treeStepTasks.replaceChildren();
    const tasks = Array.isArray(tree.current_step.tasks) ? tree.current_step.tasks : [];
    for (const [index, task] of tasks.entries()) {
      const taskItem = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(index + 1);
      checkbox.addEventListener("change", updateTreeChecklist);
      const taskText = document.createElement("span");
      taskText.textContent = task;
      label.append(checkbox, taskText);
      taskItem.append(label);
      treeStepTasks.append(taskItem);
    }
    treeCompleteButton.hidden = false;
    updateTreeChecklist();
  } else {
    treeCurrentStep.hidden = true;
    treeFinished.hidden = false;
    treeCompleteButton.hidden = true;
  }
  treeFinished.hidden = !tree.finished;
  treeAskHelpButton.hidden = tree.finished;
  treeAdjustButton.hidden = false;
  treeStartNewButton.hidden = false;
  confirmingUndo = false;
  treeUndoButton.textContent = "Undo last step";
  treeUndoButton.hidden = !(tree.completed_count > 0);
  refreshLesson(tree);
};

const loadProgressTree = async () => {
  if (progressTreeRequest) return progressTreeRequest;
  treeStatus.textContent = "Loading your progress tree...";
  treeEmptyState.hidden = true;
  progressTreeRequest = (async () => {
    try {
      const response = await fetch("/api/progress-tree", { cache: "no-store" });
      const result = await readApiResponse(response, "Progress tree");
      if (!response.ok) throw new Error(result.error || "Could not load your progress tree.");
      useSavedNetworkStyle(result.network_style);
      useSavedAppearance(result.appearance);
      renderProgressTree(result.tree);
      autoplayTimelapse();
      setupReminders(result.reminders_key);
      showDevToolsButton(result.dev === true);
    } catch (error) {
      treeStatus.textContent = error.message;
      treeEmptyState.hidden = false;
      treeView.hidden = true;
    } finally {
      progressTreeRequest = null;
    }
  })();
  return progressTreeRequest;
};

const postProgressTree = async (body) => {
  const response = await fetch("/api/progress-tree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await readApiResponse(response, "Progress tree");
  if (!response.ok) {
    if (result.tree) renderProgressTree(result.tree);
    throw new Error(result.error || "Could not update your progress tree.");
  }
  renderProgressTree(result.tree);
  return result;
};

const startProgressTree = async () => {
  treeCreateButton.disabled = true;
  treeStatus.textContent = "Preparing your personalized skill-tree interview...";
  treeAssistantOpen = true;
  try {
    await postProgressTree({ action: "begin" });
    treeInterviewChoices.querySelector("button")?.focus();
  } catch (error) {
    treeStatus.textContent = error.message;
  } finally {
    treeCreateButton.disabled = false;
  }
};

const startNewProgressTree = async () => {
  treeStartNewButton.disabled = true;
  treeStatus.textContent = "Starting the interview for your new goal...";
  treeAssistantOpen = true;
  try {
    await postProgressTree({ action: "start_new" });
    treeInterviewChoices.querySelector("button")?.focus();
  } catch (error) {
    treeStatus.textContent = error.message;
  } finally {
    treeStartNewButton.disabled = false;
  }
};

const sendTreeAnswer = async (choice, { custom = false } = {}) => {
  const answerNumber = (progressTreeState?.conversation || [])
    .filter((message) => message.role === "user").length + 1;
  const choiceButtons = [...treeInterviewChoices.querySelectorAll("button, input")];
  for (const button of choiceButtons) button.disabled = true;
  treeChatStatus.textContent = `Saving answer ${Math.min(answerNumber, 10)} of 10...`;
  try {
    const body = { action: "interview_answer", choice };
    if (custom) body.custom = true;
    const result = await postProgressTree(body);
    if (result.created) {
      treeAssistantOpen = false;
      treeAssistant.hidden = true;
      treeChatStatus.textContent = "";
      treeStatus.textContent = "Your personalized skill tree is ready. Here is the step to focus on now.";
    } else {
      treeChatStatus.textContent = "";
      treeInterviewChoices.querySelector("button")?.focus();
    }
  } catch (error) {
    treeChatStatus.textContent = error.message;
    for (const button of choiceButtons) button.disabled = false;
  }
};

const sendTreeMessage = async (message, action = treeChatAction) => {
  const content = message.trim();
  if (!content) return;
  treeChatSendButton.disabled = true;
  treeChatInput.disabled = true;
  treeChatStatus.textContent = "Your AI coach is thinking...";
  try {
    const result = await postProgressTree({ action, message: content });
    treeChatAction = action === "adjust" && !result.adjusted ? "adjust" : "chat";
    treeAssistantOpen = true;
    treeAssistant.hidden = false;
    renderTreeConversation(result.tree.conversation || []);
    treeChatInput.value = "";
    if (result.created) {
      treeStatus.textContent = "Your personalized path is ready. Your first step is waiting.";
    }
    if (result.adjusted) {
      treeStatus.textContent = "Your path has been adjusted. Your completed steps are still growing with you.";
    }
    treeChatStatus.textContent = "";
  } catch (error) {
    treeChatStatus.textContent = error.message;
  } finally {
    treeChatSendButton.disabled = false;
    treeChatInput.disabled = false;
    treeChatInput.focus();
  }
};

const treeActions = document.querySelector(".tree-actions");

treeCreateButton.addEventListener("click", startProgressTree);
treeStartNewButton.addEventListener("click", startNewProgressTree);

treeCompleteButton.addEventListener("click", async () => {
  if (!progressTreeState?.current_step) return;
  completingTreeStep = true;
  updateTreeChecklist();
  treeStatus.textContent = "Growing your progress tree...";
  try {
    const result = await postProgressTree({
      action: "complete",
      expectedStep: progressTreeState.completed_count,
      // Finishing a step also counts as today's check-in.
      day: localDay(),
      checkedTasks: [...treeStepTasks.querySelectorAll("input[type='checkbox']:checked")]
        .map((checkbox) => Number(checkbox.value)),
    });
    treeStatus.textContent = result.completed
      ? "Step complete. A new branch has grown!"
      : "";
    if (result.completed) celebrateStep(treeCompleteButton);
  } catch (error) {
    treeStatus.textContent = error.message;
  } finally {
    completingTreeStep = false;
    updateTreeChecklist();
  }
});

treeStepGuideButton.addEventListener("click", async () => {
  if (!progressTreeState?.current_step) return;
  treeStepGuideButton.disabled = true;
  treeStepGuideButton.textContent = "Asking your AI coach...";
  try {
    await postProgressTree({ action: "step_guide", expectedStep: progressTreeState.completed_count });
  } catch (error) {
    treeStatus.textContent = error.message;
    treeStepGuideButton.disabled = false;
    treeStepGuideButton.textContent = "How do I do this?";
  }
});

treeUndoButton.addEventListener("click", async () => {
  const tree = progressTreeState;
  if (!tree?.exists || !(tree.completed_count > 0)) return;
  const lastStep = tree.completed?.[tree.completed_count - 1];
  if (!confirmingUndo) {
    confirmingUndo = true;
    treeUndoButton.textContent = `Click again to undo "${lastStep?.title || "the last step"}"`;
    return;
  }
  treeUndoButton.disabled = true;
  treeStatus.textContent = "Undoing the step...";
  try {
    await postProgressTree({ action: "undo_step", expectedStep: tree.completed_count, day: localDay() });
    treeStatus.textContent = "Step undone. It's your current step again.";
  } catch (error) {
    treeStatus.textContent = error.message;
  } finally {
    treeUndoButton.disabled = false;
  }
});

checkinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = checkinInput.value.trim();
  if (!note) return;
  const wasWilting = streakCard.classList.contains("is-wilting");
  checkinButton.disabled = true;
  treeStatus.textContent = "Saving your check-in...";
  try {
    await postProgressTree({ action: "checkin", day: localDay(), note });
    checkinInput.blur();
    renderStreak(progressTreeState);
    treeStatus.textContent = wasWilting
      ? "Checked in. Your network is coming back to life."
      : "Checked in for today.";
  } catch (error) {
    treeStatus.textContent = error.message;
  } finally {
    checkinButton.disabled = false;
  }
});

// A page left open overnight should notice that a new day began.
const refreshStreakIfVisible = () => {
  if (document.visibilityState === "visible" && progressTreeState?.exists) renderStreak(progressTreeState);
};
document.addEventListener("visibilitychange", refreshStreakIfVisible);
window.addEventListener("focus", refreshStreakIfVisible);

treeAskHelpButton.addEventListener("click", () => {
  const step = progressTreeState?.current_step;
  if (!step) return;
  treeAssistantOpen = true;
  treeAssistant.hidden = false;
  treeChatAction = "chat";
  sendTreeMessage(`I'm working on "${step.title}". Could you help me figure out a manageable way to approach it?`, "help");
});

treeAdjustButton.addEventListener("click", () => {
  treeAssistantOpen = true;
  treeAssistant.hidden = false;
  treeChatAction = "adjust";
  sendTreeMessage("I'd like to adjust my path. Please ask what has changed or what is not working before suggesting a revised set of future steps.", "adjust");
});

treeChatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendTreeMessage(treeChatInput.value);
});

treeChatCloseButton.addEventListener("click", () => {
  treeAssistantOpen = false;
  treeAssistant.hidden = true;
});
