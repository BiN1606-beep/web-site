// Community: search, friends, follows, the activity feed, notifications and profiles.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const communityBool = (value) => value === true || value === "t" || value === "true" || value === 1;
const communityGet = async (action, params = {}) => {
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`/api/community?${query}`, { cache: "no-store" });
  const result = await readApiResponse(response, "Community");
  if (!response.ok) throw new Error(result.error || "Could not load Community.");
  return result;
};
const communityPost = async (payload) => {
  const response = await fetch("/api/community", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await readApiResponse(response, "Community");
  if (!response.ok) throw new Error(result.error || "Could not update Community.");
  return result;
};
const updateCommunityBadge = (count) => {
  const button = launcherByDialog.get("community-panel");
  let badge = button.querySelector(".community-unread");
  if (!count) {
    badge?.remove();
    button.removeAttribute("aria-label");
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "community-unread";
    badge.setAttribute("aria-label", "Unread community notifications");
    button.append(badge);
  }
  badge.textContent = count > 99 ? "99+" : String(count);
  button.setAttribute("aria-label", `Community, ${count} unread notifications`);
};
const communityAvatar = (person) => {
  const avatar = document.createElement("div");
  avatar.className = "community-avatar";
  if (person.picture) {
    const image = document.createElement("img");
    image.src = person.picture;
    image.alt = "";
    image.loading = "lazy";
    avatar.append(image);
  } else {
    avatar.textContent = (person.display_name || person.actor_name || "?").trim().charAt(0).toUpperCase();
  }
  return avatar;
};
const communityActionButton = (label, action, person, secondary = false) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = secondary ? "profile-secondary-button" : "save-button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    const wasProfile = !communityProfile.hidden
      && communityProfile.dataset.userId === String(person.id);
    try {
      await communityPost({ action, userId: String(person.id) });
      await refreshCommunity();
      if (action === "accept" || action === "decline" || action === "cancel" || action === "remove_friend" || action === "unblock") {
        await loadCommunitySection(communityView);
      } else if (communityView === "discover" && communitySearchInput.value.trim()) {
        await searchCommunity(communitySearchInput.value.trim());
      } else if (wasProfile) {
        await openCommunityProfile(person.id);
      }
    } catch (error) {
      communityStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  return button;
};
const communityProfileButton = (person) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "community-profile-link";
  button.textContent = person.display_name || person.actor_name || "Community member";
  if (person.id) button.addEventListener("click", () => openCommunityProfile(person.id));
  else button.disabled = true;
  return button;
};
const addPersonActions = (actions, person, mode = "discover") => {
  const status = person.requestDirection === "incoming"
    ? "incoming"
    : person.requestDirection === "outgoing"
      ? "outgoing"
      : person.friend_status;
  if (mode === "requests") {
    if (person.requestDirection === "incoming") {
      actions.append(
        communityActionButton("Accept", "accept", person),
        communityActionButton("Decline", "decline", person, true),
      );
    } else {
      actions.append(
        communityActionButton("Cancel request", "cancel", person, true),
      );
    }
  } else if (mode === "friends") {
    actions.append(
      communityActionButton("Remove friend", "remove_friend", person, true),
    );
  } else if (mode === "following" || mode === "followers") {
    actions.append(communityActionButton(
      communityBool(person.following) ? "Unfollow" : "Follow",
      communityBool(person.following) ? "unfollow" : "follow",
      person,
      true,
    ));
  } else if (mode === "blocked") {
    actions.append(communityActionButton("Unblock", "unblock", person, true));
  } else {
    if (status === "accepted") {
      const friends = document.createElement("span");
      friends.className = "community-muted";
      friends.textContent = "Friends";
      actions.append(friends);
    } else if (status === "pending" && String(person.requested_by) === String(communityState?.user_id)) {
      actions.append(communityActionButton("Request sent", "cancel", person, true));
    } else if (status === "pending") {
      actions.append(
        communityActionButton("Accept request", "accept", person),
        communityActionButton("Decline", "decline", person, true),
      );
    } else {
      actions.append(communityActionButton("Add friend", "request", person));
    }
    if (!communityBool(person.following)) {
      actions.append(communityActionButton("Follow", "follow", person, true));
    } else {
      actions.append(communityActionButton("Following", "unfollow", person, true));
    }
  }
};
const renderPersonCards = (people, mode = "discover") => {
  communityList.replaceChildren();
  if (!people?.length) {
    const empty = document.createElement("p");
    empty.className = "community-muted";
    empty.textContent = mode === "discover"
      ? "Search by display name, username, or user ID to find people."
      : "Nothing to show here yet.";
    communityList.append(empty);
    return;
  }
  for (const person of people) {
    const card = document.createElement("article");
    card.className = "community-card";
    card.append(communityAvatar(person));
    const details = document.createElement("div");
    details.className = "community-person";
    const heading = document.createElement("h3");
    heading.append(communityProfileButton(person));
    const username = document.createElement("p");
    username.className = "community-muted";
    username.textContent = `@${person.profile_username || `user${person.id}`}`;
    details.append(heading, username);
    if (person.profile_bio || person.bio) {
      const bio = document.createElement("p");
      bio.textContent = person.profile_bio || person.bio;
      details.append(bio);
    }
    if (person.profile_goals || person.goals) {
      const goal = document.createElement("p");
      goal.className = "community-muted";
      goal.textContent = `Goal: ${person.profile_goals || person.goals}`;
      details.append(goal);
    }
    card.append(details);
    const actions = document.createElement("div");
    actions.className = "community-actions";
    addPersonActions(actions, person, mode);
    card.append(actions);
    communityList.append(card);
  }
};
const renderActivityFeed = (activities) => {
  communityList.replaceChildren();
  if (!activities?.length) {
    const empty = document.createElement("p");
    empty.className = "community-muted";
    empty.textContent = "Your activity feed will grow as you follow people and make friends.";
    communityList.append(empty);
    return;
  }
  for (const activity of activities) {
    let details = activity.details || {};
    if (typeof details === "string") {
      try { details = JSON.parse(details); } catch { details = {}; }
    }
    const card = document.createElement("article");
    card.className = "community-card";
    card.append(communityAvatar(activity));
    const content = document.createElement("div");
    content.className = "community-person";
    const heading = document.createElement("h3");
    heading.append(communityProfileButton({
      id: activity.actor_id,
      display_name: activity.actor_name,
    }));
    const description = document.createElement("p");
    description.textContent = activity.activity_type === "milestone_completed"
      ? `completed a milestone${details.step_title ? `: ${details.step_title}` : ""}.`
      : "started a new journey.";
    const date = document.createElement("p");
    date.className = "community-muted";
    date.textContent = new Date(activity.created_at).toLocaleDateString();
    content.append(heading, description, date);
    card.append(content);
    const actions = document.createElement("div");
    actions.className = "community-actions";
    for (const [reaction, label] of [["like", "Like"], ["celebrate", "Celebrate"], ["support", "Support"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = activity.my_reaction === reaction ? "save-button" : "profile-secondary-button";
      let reactions = activity.reactions || {};
      if (typeof reactions === "string") {
        try { reactions = JSON.parse(reactions || "{}"); } catch { reactions = {}; }
      }
      const count = Number(reactions[reaction]) || 0;
      button.textContent = `${label}${count ? ` ${count}` : ""}`;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await communityPost({ action: "react", activityId: String(activity.id), reaction });
          await loadCommunitySection("feed");
        } catch (error) {
          communityStatus.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
    card.append(actions);
    communityList.append(card);
  }
};
const notificationText = {
  friend_request: "sent you a friend request.",
  friend_accepted: "accepted your friend request.",
  new_follower: "started following you.",
  milestone_completed: "completed a milestone.",
  reaction: "reacted to your progress.",
};
const renderNotifications = (notifications) => {
  communityList.replaceChildren();
  if (!notifications?.length) {
    const empty = document.createElement("p");
    empty.className = "community-muted";
    empty.textContent = "You're all caught up.";
    communityList.append(empty);
    return;
  }
  for (const notification of notifications) {
    const card = document.createElement("article");
    card.className = "community-card";
    card.append(communityAvatar(notification));
    const text = document.createElement("div");
    text.className = "community-person";
    const description = document.createElement("p");
    description.append(communityProfileButton({
      id: notification.actor_id,
      display_name: notification.actor_name,
    }));
    description.append(document.createTextNode(` ${notificationText[notification.notification_type] || "sent you an update."}`));
    const date = document.createElement("p");
    date.className = "community-muted";
    date.textContent = new Date(notification.created_at).toLocaleDateString();
    text.append(description, date);
    card.append(text);
    communityList.append(card);
  }
};
const communityViewNames = {
  discover: "Discover People",
  friends: "My Friends",
  requests: "Friend Requests",
  following: "Following",
  followers: "Followers",
  feed: "Community Activity",
  notifications: "Notifications",
  privacy: "Privacy Settings",
  blocked: "Blocked Members",
};
const loadCommunitySummary = async () => {
  const result = await communityGet("summary");
  communityState = result;
  updateCommunityBadge(Number(result.unread) || 0);
  communityProfile.hidden = true;
  communityReportForm.hidden = true;
  if (result.settings) {
    communityProfileVisibility.value = result.settings.profile_visibility || "private";
    communityShowGoals.checked = communityBool(result.settings.show_goals);
    communityShowProgress.checked = communityBool(result.settings.show_progress);
    communityShowActivity.checked = communityBool(result.settings.show_activity);
    communityAllowRequests.checked = communityBool(result.settings.allow_friend_requests);
    communityShowSearch.checked = communityBool(result.settings.show_in_search);
  }
  return result;
};
const loadCommunitySection = async (view) => {
  communityView = view;
  communityProfile.hidden = true;
  communityReportForm.hidden = true;
  communityPrivacy.hidden = view !== "privacy";
  communityList.hidden = view === "privacy";
  communityViewTitle.textContent = communityViewNames[view] || "Community";
  for (const tab of communityDialog.querySelectorAll("[data-community-view]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.communityView === view));
  }
  if (view === "privacy") return;
  if (!communityState) await loadCommunitySummary();
  if (view === "feed") {
    const result = await communityGet("feed");
    renderActivityFeed(result.activities);
  } else if (view === "notifications") {
    const result = await communityGet("notifications");
    renderNotifications(result.notifications);
    await communityPost({ action: "mark_read" });
    updateCommunityBadge(0);
  } else if (view === "requests") {
    renderPersonCards([
      ...(communityState.incoming || []).map((person) => ({ ...person, requestDirection: "incoming" })),
      ...(communityState.outgoing || []).map((person) => ({ ...person, requestDirection: "outgoing" })),
    ], "requests");
  } else if (view === "discover") {
    renderPersonCards([], "discover");
  } else {
    const collection = {
      friends: "friends",
      following: "following",
      followers: "followers",
      blocked: "blocked",
    }[view];
    renderPersonCards(communityState[collection] || [], view);
  }
};
const refreshCommunity = async () => {
  try {
    await loadCommunitySummary();
  } catch (error) {
    communityStatus.textContent = error.message;
  }
};
const searchCommunity = async (query) => {
  communityView = "discover";
  const sequence = ++communitySearchSequence;
  for (const tab of communityDialog.querySelectorAll("[data-community-view]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.communityView === "discover"));
  }
  communityPrivacy.hidden = true;
  communityProfile.hidden = true;
  communityList.hidden = false;
  communityViewTitle.textContent = "Search results";
  try {
    const result = await communityGet("search", { q: query });
    if (sequence !== communitySearchSequence) return;
    renderPersonCards(result.people, "discover");
    communityStatus.textContent = result.people.length ? `${result.people.length} people found.` : "No people found.";
  } catch (error) {
    if (sequence !== communitySearchSequence) return;
    communityStatus.textContent = error.message;
    communityList.replaceChildren();
  }
};
const openCommunityProfile = async (userId) => {
  communityStatus.textContent = "Loading profile...";
  communityList.hidden = true;
  communityPrivacy.hidden = true;
  communityProfile.hidden = false;
  communityProfile.replaceChildren();
  communityProfile.dataset.userId = String(userId);
  try {
    const result = await communityGet("profile", { userId: String(userId) });
    const profile = result.profile;
    communityViewTitle.textContent = profile.display_name;
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "profile-secondary-button";
    backButton.textContent = "Back to Community";
    backButton.addEventListener("click", () => {
      if (communityView === "discover" && communitySearchInput.value.trim()) {
        searchCommunity(communitySearchInput.value.trim());
      } else {
        loadCommunitySection(communityView);
      }
    });
    communityProfile.append(backButton);
    const heading = document.createElement("div");
    heading.className = "community-card";
    heading.append(communityAvatar(profile));
    const identity = document.createElement("div");
    identity.className = "community-person";
    const name = document.createElement("h3");
    name.textContent = profile.display_name;
    const username = document.createElement("p");
    username.className = "community-muted";
    username.textContent = `@${profile.username}`;
    const counts = document.createElement("p");
    counts.className = "community-muted";
    counts.textContent = `${profile.friend_count} friends · ${profile.follower_count} followers · ${profile.following_count} following`;
    identity.append(name, username, counts);
    heading.append(identity);
    communityProfile.append(heading);
    if (profile.bio) {
      const bio = document.createElement("p");
      bio.textContent = profile.bio;
      communityProfile.append(bio);
    }
    if (profile.goal) {
      const goal = document.createElement("p");
      goal.textContent = `Main goal: ${profile.goal}`;
      communityProfile.append(goal);
    }
    if (profile.progress?.exists) {
      const progress = document.createElement("section");
      progress.className = "community-progress";
      const progressTitle = document.createElement("strong");
      progressTitle.textContent = profile.progress.goal;
      const progressDescription = document.createElement("span");
      progressDescription.textContent = `${profile.progress.completed_count} of ${profile.progress.total_steps} steps completed (${profile.progress.progress}%).`;
      const steps = document.createElement("ol");
      for (const step of profile.progress.completed || []) {
        const item = document.createElement("li");
        item.textContent = step.title;
        steps.append(item);
      }
      if (profile.progress.current_step) {
        const current = document.createElement("li");
        current.textContent = `Current: ${profile.progress.current_step.title}`;
        steps.append(current);
        const currentSummary = document.createElement("p");
        currentSummary.textContent = profile.progress.current_step.description;
        progress.append(currentSummary);
      }
      progress.append(progressTitle, progressDescription, steps);
      communityProfile.append(progress);
    }
    if (profile.network) renderFriendNetwork(communityProfile, profile.network);
    const actions = document.createElement("div");
    actions.className = "community-actions";
    if (profile.friend_status === "accepted") {
      actions.append(communityActionButton("Remove friend", "remove_friend", profile, true));
    } else if (profile.friend_status === "pending" && String(profile.friend_requested_by) === String(communityState?.user_id)) {
      actions.append(communityActionButton("Request sent", "cancel", profile, true));
    } else if (profile.friend_status === "pending") {
      actions.append(
        communityActionButton("Accept request", "accept", profile),
        communityActionButton("Decline", "decline", profile, true),
      );
    } else {
      actions.append(communityActionButton("Add friend", "request", profile));
    }
    actions.append(communityActionButton(
      communityBool(profile.following) ? "Unfollow" : "Follow",
      communityBool(profile.following) ? "unfollow" : "follow",
      profile,
      true,
    ));
    const blockButton = document.createElement("button");
    blockButton.type = "button";
    blockButton.className = "profile-secondary-button";
    blockButton.textContent = "Block";
    blockButton.addEventListener("click", async () => {
      if (!confirm(`Block ${profile.display_name}? They will no longer find or contact you here.`)) return;
      try {
        await communityPost({ action: "block", userId: String(profile.id) });
        communityProfile.hidden = true;
        communityList.hidden = false;
        communityViewTitle.textContent = communityViewNames[communityView];
        await refreshCommunity();
        await loadCommunitySection(communityView);
      } catch (error) {
        communityStatus.textContent = error.message;
      }
    });
    const reportButton = document.createElement("button");
    reportButton.type = "button";
    reportButton.className = "profile-secondary-button";
    reportButton.textContent = "Report";
    reportButton.addEventListener("click", () => {
      communityReportUserId = profile.id;
      communityReportForm.hidden = false;
      communityReportReason.focus();
    });
    actions.append(blockButton, reportButton);
    communityProfile.append(actions);
    communityStatus.textContent = "";
  } catch (error) {
    communityStatus.textContent = error.message;
    communityViewTitle.textContent = "Profile unavailable";
    communityProfile.hidden = true;
    communityList.hidden = false;
  }
};
const loadCommunity = async () => {
  communityStatus.textContent = "Loading Community...";
  try {
    await loadCommunitySummary();
    communityStatus.textContent = "";
    await loadCommunitySection(communityView);
  } catch (error) {
    communityStatus.textContent = error.message;
  }
};

communitySearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = communitySearchInput.value.trim();
  if (query.length < 2) {
    communityStatus.textContent = "Enter at least two characters to search.";
    return;
  }
  searchCommunity(query);
});

communitySearchInput.addEventListener("input", () => {
  window.clearTimeout(communitySearchTimer);
  const query = communitySearchInput.value.trim();
  if (query.length < 2) {
    communitySearchSequence += 1;
    if (communityView === "discover") {
      communityViewTitle.textContent = communityViewNames.discover;
      communityStatus.textContent = "";
      renderPersonCards([], "discover");
    }
    return;
  }
  communitySearchTimer = window.setTimeout(() => searchCommunity(query), 250);
});

document.querySelector("#community-save-privacy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  communityStatus.textContent = "Saving privacy settings...";
  try {
    const result = await communityPost({
      action: "privacy",
      settings: {
        profile_visibility: communityProfileVisibility.value,
        show_goals: communityShowGoals.checked,
        show_progress: communityShowProgress.checked,
        show_activity: communityShowActivity.checked,
        allow_friend_requests: communityAllowRequests.checked,
        show_in_search: communityShowSearch.checked,
      },
    });
    communityState.settings = result.settings;
    communityStatus.textContent = "Privacy settings saved.";
  } catch (error) {
    communityStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

communityReportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!communityReportUserId) return;
  const button = communityReportForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await communityPost({
      action: "report",
      userId: String(communityReportUserId),
      reason: communityReportReason.value.trim(),
    });
    communityReportForm.hidden = true;
    communityReportReason.value = "";
    communityReportUserId = null;
    communityStatus.textContent = "Thank you. Your report was submitted.";
  } catch (error) {
    communityStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#community-report-cancel").addEventListener("click", () => {
  communityReportForm.hidden = true;
  communityReportReason.value = "";
  communityReportUserId = null;
});
