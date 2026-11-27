// Today's step as a short game, one card at a time, like a language-learning
// app: why it matters → how to do it → your tasks → finish.
//
// The step card in the panel only shows the title and a Start button, so the
// instructions don't crowd the screen. Everything the lesson shows comes from
// the step the server sent (progressTreeState.current_step). Ticking a task
// here ticks the same hidden checkbox the old checklist used, so "Complete
// step" stays locked until every task is done, exactly as before.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const lessonDialog = document.querySelector("#lesson");
const lessonBar = document.querySelector(".lesson-bar");
const lessonBarFill = document.querySelector("#lesson-bar-fill");
const lessonCard = document.querySelector("#lesson-card");
const lessonLabel = document.querySelector("#lesson-label");
const lessonTitle = document.querySelector("#lesson-title");
const lessonText = document.querySelector("#lesson-text");
const lessonCheer = document.querySelector("#lesson-cheer");
const lessonNext = document.querySelector("#lesson-next");
const lessonSecondary = document.querySelector("#lesson-secondary");
const lessonClose = document.querySelector("#lesson-close");
const lessonStartButton = document.querySelector("#lesson-start");
const stepTaskCount = document.querySelector("#step-task-count");

const CHEERS = ["Nice!", "Great job!", "Keep going!", "That's it!", "You've got this!"];

let lessonCards = [];
let lessonIndex = 0;
// Which step the open lesson is about, to notice when it gets completed.
let lessonStepNumber = null;

const taskCheckboxes = () => [...treeStepTasks.querySelectorAll("input[type='checkbox']")];

// Turns the step into a list of cards. Each card has a label, a title or a
// text, and what the big button says.
const buildLessonCards = (step) => {
  const cards = [{ kind: "intro", label: "Today's step", title: step.title, text: step.description, button: "Let's go" }];
  if (step.why) cards.push({ kind: "why", label: "Why it matters", text: shortWhy(step.why), button: "Got it" });
  const how = Array.isArray(step.how) ? step.how : [];
  how.forEach((item, index) => {
    cards.push({ kind: "how", label: `How to do it · ${index + 1} of ${how.length}`, text: item, button: "Next" });
  });
  if (!how.length) {
    cards.push({
      kind: "ask",
      label: "How to do it",
      text: "Want your AI coach to break this step into small, simple moves?",
      button: "Show me how",
      secondary: "Skip",
    });
  }
  if (step.tip) cards.push({ kind: "tip", label: "Tip", text: step.tip, button: "Nice" });
  const tasks = Array.isArray(step.tasks) ? step.tasks : [];
  tasks.forEach((task, index) => {
    cards.push({
      kind: "task",
      task: index,
      label: `Your turn · ${index + 1} of ${tasks.length}`,
      title: task,
      button: "I did it",
      secondary: "Not yet",
    });
  });
  cards.push({
    kind: "finish",
    label: "Last step",
    title: "All done?",
    text: "Mark the step complete and watch your network grow.",
    button: "Complete step",
    secondary: "Not yet",
  });
  return cards;
};

const showLessonCard = (index) => {
  lessonIndex = Math.max(0, Math.min(index, lessonCards.length - 1));
  const card = lessonCards[lessonIndex];
  const progress = Math.round((lessonIndex / Math.max(1, lessonCards.length - 1)) * 100);
  lessonBarFill.style.width = `${progress}%`;
  lessonBar.setAttribute("aria-valuenow", String(progress));
  lessonLabel.textContent = card.label;
  lessonTitle.textContent = card.title || "";
  lessonTitle.hidden = !card.title;
  lessonText.textContent = card.text || "";
  lessonText.hidden = !card.text;
  lessonNext.textContent = card.button;
  lessonNext.disabled = false;
  lessonSecondary.textContent = card.secondary || "";
  lessonSecondary.hidden = !card.secondary;
  // Replay the slide-in animation for every new card.
  lessonCard.classList.remove("is-entering");
  void lessonCard.offsetWidth;
  lessonCard.classList.add("is-entering");
  lessonNext.focus();
};

const cheer = () => {
  lessonCheer.textContent = CHEERS[Math.floor(Math.random() * CHEERS.length)];
  lessonCheer.classList.remove("is-showing");
  void lessonCheer.offsetWidth;
  lessonCheer.classList.add("is-showing");
};

// Falling leaves inside the lesson, like the panel's celebration.
const lessonConfetti = () => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let index = 0; index < 22; index += 1) {
    const leaf = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const distance = 70 + Math.random() * 110;
    leaf.className = "tree-leaf-burst";
    leaf.style.left = "50%";
    leaf.style.top = "40%";
    leaf.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    leaf.style.setProperty("--dy", `${Math.sin(angle) * distance - 40}px`);
    leaf.style.setProperty("--turn", `${Math.random() * 360}deg`);
    if (index % 3 === 0) leaf.style.background = "var(--accent)";
    lessonDialog.append(leaf);
    window.setTimeout(() => leaf.remove(), 1100);
  }
};

const openLesson = () => {
  const step = progressTreeState?.current_step;
  if (!step) return;
  lessonStepNumber = progressTreeState.completed_count;
  lessonCards = buildLessonCards(step);
  lessonCheer.textContent = "";
  // Coming back: jump to the first task that isn't ticked yet.
  const boxes = taskCheckboxes();
  const firstOpen = boxes.findIndex((box) => !box.checked);
  const someDone = boxes.some((box) => box.checked);
  const start = someDone
    ? lessonCards.findIndex((card) => (firstOpen === -1 ? card.kind === "finish" : card.kind === "task" && card.task === firstOpen))
    : 0;
  if (!lessonDialog.open) lessonDialog.showModal();
  showLessonCard(start);
};

const closeLesson = () => {
  if (lessonDialog.open) lessonDialog.close();
};

// The step is finished: one last card, then back to the network.
const showLessonDone = () => {
  lessonCheer.textContent = "";
  lessonCards = [{
    kind: "done",
    label: "Step complete",
    title: "You did it!",
    text: "A new branch has grown on your network.",
    button: "Back to my network",
  }];
  showLessonCard(0);
  lessonBarFill.style.width = "100%";
  lessonConfetti();
};

lessonNext.addEventListener("click", async () => {
  const card = lessonCards[lessonIndex];
  if (card.kind === "done") {
    closeLesson();
    return;
  }
  if (card.kind === "ask") {
    // Ask the coach; the new "how" cards appear when the answer arrives
    // (refreshLesson below). Until then, the button says it's working.
    lessonNext.disabled = true;
    lessonNext.textContent = "Asking your coach...";
    treeStepGuideButton.click();
    return;
  }
  if (card.kind === "task") {
    const box = taskCheckboxes()[card.task];
    if (box && !box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    }
    cheer();
  }
  if (card.kind === "finish") {
    if (treeCompleteButton.disabled) {
      // Shouldn't happen (every task card ticks its box), but say why.
      lessonCheer.textContent = treeCompleteButton.textContent;
      return;
    }
    lessonNext.disabled = true;
    lessonNext.textContent = "Growing your network...";
    treeCompleteButton.click();
    return;
  }
  showLessonCard(lessonIndex + 1);
});

lessonSecondary.addEventListener("click", () => {
  const card = lessonCards[lessonIndex];
  if (card.kind === "ask") {
    showLessonCard(lessonIndex + 1);
  } else {
    // "Not yet": come back later, the ticked tasks are kept.
    closeLesson();
  }
});

lessonClose.addEventListener("click", closeLesson);
// Tapping outside works like "Not yet": ticked tasks are kept.
closeOnOutsideTap(lessonDialog, closeLesson);
lessonStartButton.addEventListener("click", openLesson);

// Called by renderProgressTree (goals.js) every time the server answers.
const refreshLesson = (tree) => {
  // The button on the step card says how far along you are.
  const tasks = Array.isArray(tree.current_step?.tasks) ? tree.current_step.tasks : [];
  const done = taskCheckboxes().filter((box) => box.checked).length;
  stepTaskCount.hidden = tasks.length === 0;
  stepTaskCount.textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} · about ${tree.current_step?.time || "a little while"}`;
  lessonStartButton.textContent = done > 0 ? "Continue" : "Start";

  if (!lessonDialog.open) return;
  if (tree.completed_count !== lessonStepNumber) {
    showLessonDone();
    return;
  }
  // Still the same step, for example the coach's how-to arrived: rebuild
  // the cards and stay on the first new one.
  const wasAsking = lessonCards[lessonIndex]?.kind === "ask";
  lessonCards = buildLessonCards(tree.current_step);
  if (wasAsking) {
    const firstHow = lessonCards.findIndex((card) => card.kind === "how");
    showLessonCard(firstHow === -1 ? lessonIndex : firstHow);
  }
};

// If the coach couldn't answer, put the "ask" card's button back.
const guideObserver = new MutationObserver(() => {
  const card = lessonCards[lessonIndex];
  if (lessonDialog.open && card?.kind === "ask" && !treeStepGuideButton.disabled) {
    lessonNext.disabled = false;
    lessonNext.textContent = card.button;
    lessonCheer.textContent = treeStatus.textContent;
  }
});
guideObserver.observe(treeStepGuideButton, { attributes: true, attributeFilter: ["disabled"] });

// If completing the step failed (the server said no), let the user retry.
const completeObserver = new MutationObserver(() => {
  const card = lessonCards[lessonIndex];
  if (lessonDialog.open && card?.kind === "finish" && !completingTreeStep && lessonNext.disabled) {
    lessonNext.disabled = false;
    lessonNext.textContent = card.button;
    lessonCheer.textContent = treeStatus.textContent;
  }
});
completeObserver.observe(treeCompleteButton, { attributes: true, attributeFilter: ["disabled"] });
