// Startup screen, top navigation, every page element the scripts use, and shared state.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const startupScreen = document.querySelector("#startup-screen");
const startupSkip = document.querySelector("#startup-skip");
const launcherActions = document.querySelector("#launcher-actions");
const mainPage = document.querySelector("main");
// Main navigation. The progress tree is the page itself, so it is not
// listed here. Each button shows a text label next to its icon.
const launcherItems = [
  {
    dialogId: "community-panel",
    label: "Community",
    icon: [
      { tag: "circle", attributes: { cx: "9", cy: "8", r: "3" } },
      { tag: "circle", attributes: { cx: "17", cy: "9", r: "2.5" } },
      { tag: "path", attributes: { d: "M3 20a6 6 0 0 1 12 0m0-3a5 5 0 0 1 6 3" } },
    ],
  },
  {
    dialogId: "profile-view-panel",
    label: "Profile",
    icon: [
      { tag: "circle", attributes: { cx: "12", cy: "8", r: "4" } },
      { tag: "path", attributes: { d: "M5 21a7 7 0 0 1 14 0" } },
    ],
  },
  {
    dialogId: "settings-panel",
    label: "Settings",
    icon: [
      // A classic cogwheel: eight square teeth around a ring with a hole.
      { tag: "path", attributes: { d: "M19.65 10.48 L22.14 10.88 L22.14 13.12 L19.65 13.52 L18.49 16.33 L19.96 18.38 L18.38 19.96 L16.33 18.49 L13.52 19.65 L13.12 22.14 L10.88 22.14 L10.48 19.65 L7.67 18.49 L5.62 19.96 L4.04 18.38 L5.51 16.33 L4.35 13.52 L1.86 13.12 L1.86 10.88 L4.35 10.48 L5.51 7.67 L4.04 5.62 L5.62 4.04 L7.67 5.51 L10.48 4.35 L10.88 1.86 L13.12 1.86 L13.52 4.35 L16.33 5.51 L18.38 4.04 L19.96 5.62 L18.49 7.67 Z" } },
      { tag: "circle", attributes: { cx: "12", cy: "12", r: "3.2" } },
    ],
  },
];
const launcherByDialog = new Map();
const svgNamespace = "http://www.w3.org/2000/svg";

for (const item of launcherItems) {
  const button = document.createElement("button");
  button.className = "launcher";
  button.type = "button";
  button.setAttribute("aria-controls", item.dialogId);
  button.setAttribute("aria-expanded", "false");

  const icon = document.createElementNS(svgNamespace, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  for (const shape of item.icon) {
    const element = document.createElementNS(svgNamespace, shape.tag);
    for (const [name, value] of Object.entries(shape.attributes)) {
      element.setAttribute(name, value);
    }
    icon.append(element);
  }

  const label = document.createElement("span");
  label.textContent = item.label;
  button.append(icon, label);
  launcherActions.append(button);
  launcherByDialog.set(item.dialogId, button);
}

const launcher = launcherActions.querySelector(".launcher");
const panel = document.querySelector("#content-panel");
const groqDialog = document.querySelector("#groq-panel");
const openSharedTextDemoButton = document.querySelector("#open-shared-text-demo");
const openGroqDemoButton = document.querySelector("#open-groq-demo");
const accountEmail = document.querySelector("#account-email");
const accountStatus = document.querySelector("#account-status");
const signOutButton = document.querySelector("#sign-out");
const settingsEditProfileButton = document.querySelector("#settings-edit-profile");
const profileEditorDialog = document.querySelector("#profile-editor");
const profileEditorForm = document.querySelector("#profile-form");
const profileEditorTitle = document.querySelector("#profile-editor-title");
const profileEditorSubtitle = document.querySelector("#profile-editor-subtitle");
const profileEditorClose = document.querySelector("#profile-editor-close");
const profilePictureInput = document.querySelector("#profile-picture");
const profilePicturePreview = document.querySelector("#profile-picture-preview");
const profilePicturePlaceholder = document.querySelector("#profile-picture-placeholder");
const removeProfilePictureButton = document.querySelector("#remove-profile-picture");
const profileDisplayNameInput = document.querySelector("#profile-display-name");
const profileGenderInput = document.querySelector("#profile-gender");
const profileBioInput = document.querySelector("#profile-bio");
const profileBioCount = document.querySelector("#profile-bio-count");
const profileGoalsInput = document.querySelector("#profile-goals");
const profileSaveButton = document.querySelector("#profile-save");
const profileSkipButton = document.querySelector("#profile-skip");
const profileStatus = document.querySelector("#profile-status");
const profileViewPicture = document.querySelector("#profile-view-picture");
const profileViewPlaceholder = document.querySelector("#profile-view-placeholder");
const profileViewDisplayName = document.querySelector("#profile-view-display-name");
const profileViewEmail = document.querySelector("#profile-view-email");
const profileViewStatus = document.querySelector("#profile-view-status");
const profileViewRetryButton = document.querySelector("#profile-view-retry");
const profileViewGender = document.querySelector("#profile-view-gender");
const profileViewBio = document.querySelector("#profile-view-bio");
const profileViewGoals = document.querySelector("#profile-view-goals");
const profileViewEditButton = document.querySelector("#profile-view-edit");
const communityDialog = document.querySelector("#community-panel");
const communityStatus = document.querySelector("#community-status");
const communitySearchForm = document.querySelector("#community-search-form");
const communitySearchInput = document.querySelector("#community-search-input");
const communityList = document.querySelector("#community-list");
const communityProfile = document.querySelector("#community-profile");
const communityPrivacy = document.querySelector("#community-privacy");
const communityViewTitle = document.querySelector("#community-view-title");
const communityReportForm = document.querySelector("#community-report");
const communityReportReason = document.querySelector("#community-report-reason");
const communityProfileVisibility = document.querySelector("#community-profile-visibility");
const communityShowGoals = document.querySelector("#community-show-goals");
const communityShowProgress = document.querySelector("#community-show-progress");
const communityShowActivity = document.querySelector("#community-show-activity");
const communityAllowRequests = document.querySelector("#community-allow-requests");
const communityShowSearch = document.querySelector("#community-show-search");
let communityState = null;
let communityView = "discover";
let communitySearchTimer = null;
let communitySearchSequence = 0;
let communityReportUserId = null;
const treeStatus = document.querySelector("#tree-status");
const treeEmptyState = document.querySelector("#tree-empty-state");
const treeCreateButton = document.querySelector("#tree-create");
const treeView = document.querySelector("#tree-view");
const treeDetails = document.querySelector("#tree-details");
const treeGoal = document.querySelector("#tree-goal");
const treeSummary = document.querySelector("#tree-summary");
const treeProgressCount = document.querySelector("#tree-progress-count");
const treeProgressPercent = document.querySelector("#tree-progress-percent");
const treeProgressBar = document.querySelector(".tree-progress-track");
const treeProgressFill = document.querySelector("#tree-progress-fill");
const treeGrowth = document.querySelector("#tree-growth");
const treeCurrentStep = document.querySelector("#tree-current-step");
const treeStepTitle = document.querySelector("#tree-step-title");
const treeStepNumber = document.querySelector("#tree-step-number");
const treeStepDescription = document.querySelector("#tree-step-description");
const treeStepWhy = document.querySelector("#tree-step-why");
const treeStepTip = document.querySelector("#tree-step-tip");
const treeStepTipContainer = document.querySelector("#tree-step-tip-container");
const treeStepChecklist = document.querySelector("#tree-step-checklist");
const treeStepTasks = document.querySelector("#tree-step-tasks");
const treeChecklistStatus = document.querySelector("#tree-checklist-status");
const treeCompleteButton = document.querySelector("#tree-complete");
const treeFinished = document.querySelector("#tree-finished");
const treeAskHelpButton = document.querySelector("#tree-ask-help");
const treeAdjustButton = document.querySelector("#tree-adjust");
const treeStartNewButton = document.querySelector("#tree-start-new");
const treeAssistant = document.querySelector("#tree-assistant");
const treeAssistantTitle = document.querySelector("#tree-assistant-title");
const treeChat = document.querySelector("#tree-chat");
const treeInterviewProgress = document.querySelector("#tree-interview-progress");
const treeInterviewChoices = document.querySelector("#tree-interview-choices");
const treeChatForm = document.querySelector("#tree-chat-form");
const treeChatInput = document.querySelector("#tree-chat-input");
const treeChatSendButton = document.querySelector("#tree-chat-send");
const treeChatCloseButton = document.querySelector("#tree-chat-close");
const treeChatStatus = document.querySelector("#tree-chat-status");
const debugMenuDialog = document.querySelector("#debug-panel");
const debugStatus = document.querySelector("#debug-status");
const debugResetButton = document.querySelector("#debug-reset-progress");
const debugSkipForm = document.querySelector("#debug-skip-form");
const debugSkipCount = document.querySelector("#debug-skip-count");
const debugSkipButton = document.querySelector("#debug-skip-steps");
let debugAccessRequest = null;
let accountProfile = null;
let progressTreeState = null;
const streakCard = document.querySelector("#streak-card");
const streakCount = document.querySelector("#streak-count");
const streakCountLabel = document.querySelector("#streak-count-label");
const streakBest = document.querySelector("#streak-best");
const streakWeek = document.querySelector("#streak-week");
const streakMessage = document.querySelector("#streak-message");
// The short streak line on the Today tab, next to the check-in.
const checkinCard = document.querySelector("#checkin-card");
const todayStreak = document.querySelector("#today-streak");
const todayStreakLabel = document.querySelector("#today-streak-label");
const checkinForm = document.querySelector("#checkin-form");
const checkinLabel = document.querySelector("#checkin-label");
const checkinInput = document.querySelector("#checkin-input");
const checkinButton = document.querySelector("#checkin-button");
const treeUndoButton = document.querySelector("#tree-undo");
const treeStepTime = document.querySelector("#tree-step-time");
const treeStepHowContainer = document.querySelector("#tree-step-how-container");
const treeStepHow = document.querySelector("#tree-step-how");
const treeStepGuideButton = document.querySelector("#tree-step-guide");
const rewardStrip = document.querySelector("#reward-strip");
const rewardMessage = document.querySelector("#reward-message");
// Undo takes two clicks, like removing a goal.
let confirmingUndo = false;
let progressTreeRequest = null;
let completingTreeStep = false;
let treeAssistantOpen = false;
let treeChatAction = "chat";
let profileLoaded = false;
let profileLoadRequest = null;
let profilePictureValue = "";
let isOnboarding = false;
let activePanel = null;
let queuedPanel = null;
const backgroundToggle = document.querySelector(".background-toggle");
const backgroundToggleLabel = document.querySelector("#background-toggle-label");
const sharedTextForm = document.querySelector("#shared-text-form");
const sharedTextInput = document.querySelector("#shared-text");
const savedText = document.querySelector("#saved-text");
const saveButton = document.querySelector("#save-button");
const saveStatus = document.querySelector("#save-status");
const groqForm = document.querySelector("#groq-form");
const groqPrompt = document.querySelector("#groq-prompt");
const groqSubmit = document.querySelector("#groq-submit");
const groqStatus = document.querySelector("#groq-status");
const groqAnswer = document.querySelector("#groq-answer");
