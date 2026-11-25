// Community: following people (like TikTok), friends, shared trees, the
// activity feed, the inbox and profiles.
//
// How people connect:
//   * Follow someone. A public profile is followed right away; a private
//     one gets a follow request that they accept or decline.
//   * When you follow each other you are friends.
//   * Friends can grow a shared network. It only grows on the days you
//     BOTH check in (shared-tree.js draws it, lua/osiris/shared_trees.lua
//     keeps it).
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const communityBool = (value) => value === true || value === "t" || value === "true" || value === 1;
const communityReduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

// Your shared trees, from the last load, and how big each one was when
// it was last drawn (so only new growth is animated).
let communityTrees = [];
const communityTreeSizes = new Map();
// The friend whose "plant a tree" form is open in the Trees view.
let communityPlantFor = null;
// The view to go back to when the search box is cleared.
let communityViewBeforeSearch = "friends";

// ---- Small building blocks ----

const communityElement = (tag, className = "", text = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const communityIcon = (paths) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths;
  return svg;
};
const COMMUNITY_ICONS = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"></path>',
  close: '<path d="M6 6l12 12M18 6 6 18"></path>',
  friends: '<path d="M7 9h11l-3-3M17 15H6l3 3"></path>',
  drop: '<circle cx="12" cy="12" r="3.5"></circle><circle cx="12" cy="12" r="8"></circle>',
  tree: '<circle cx="12" cy="12" r="2.6"></circle><circle cx="5" cy="6" r="2"></circle><circle cx="19" cy="6" r="2"></circle><circle cx="5" cy="18.5" r="2"></circle><circle cx="19" cy="18.5" r="2"></circle><path d="m6.6 7.3 3.4 3m4-0 3.4-3m-10.8 9.9 3.4-3m4 0 3.4 3"></path>',
  more: '<circle cx="5" cy="12" r="1.3"></circle><circle cx="12" cy="12" r="1.3"></circle><circle cx="19" cy="12" r="1.3"></circle>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"></rect><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"></path>',
  back: '<path d="m15 6-6 6 6 6"></path>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Zm4 4h4"></path>',
};

const communityAvatar = (person, size = "") => {
  const avatar = communityElement("div", `community-avatar${size ? ` is-${size}` : ""}`);
  const picture = person.picture || person.profile_picture || person.partner_picture;
  if (picture) {
    const image = document.createElement("img");
    image.src = picture;
    image.alt = "";
    image.loading = "lazy";
    avatar.append(image);
  } else {
    avatar.textContent = (person.display_name || person.actor_name || person.partner_name || "?").trim().charAt(0).toUpperCase();
  }
  return avatar;
};

const communityProfileButton = (person) => {
  const button = communityElement("button", "community-profile-link", person.display_name || person.actor_name || "Community member");
  button.type = "button";
  if (person.id) button.addEventListener("click", () => openCommunityProfile(person.id));
  else button.disabled = true;
  return button;
};

const communityButton = (label, className, onClick) => {
  const button = communityElement("button", className, label);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await onClick(button);
    } catch (error) {
      communityStatus.textContent = error.message;
    } finally {
      button.disabled = button.classList.contains("is-sent");
    }
  });
  return button;
};

// A "three dots" menu with a few buttons in it.
const communityMenu = (label, buttons) => {
  const menu = communityElement("details", "community-menu");
  const summary = communityElement("summary");
  summary.setAttribute("aria-label", label);
  summary.append(communityIcon(COMMUNITY_ICONS.more));
  const items = communityElement("div", "community-menu-items");
  items.append(...buttons);
  menu.append(summary, items);
  return menu;
};

// Leaves fly out of an element: the same celebration as finishing a step.
const communityCelebrate = (anchor, count = 18) => {
  if (communityReduceMotion() || !anchor?.isConnected) return;
  const dialogBox = communityDialog.getBoundingClientRect();
  const box = anchor.getBoundingClientRect();
  for (let index = 0; index < count; index += 1) {
    const leaf = communityElement("span", "tree-leaf-burst");
    const angle = Math.random() * Math.PI * 2;
    const distance = 50 + Math.random() * 90;
    leaf.style.left = `${box.left - dialogBox.left + box.width / 2 + communityDialog.scrollLeft}px`;
    leaf.style.top = `${box.top - dialogBox.top + box.height / 2 + communityDialog.scrollTop}px`;
    leaf.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    leaf.style.setProperty("--dy", `${Math.sin(angle) * distance - 30}px`);
    leaf.style.setProperty("--turn", `${Math.random() * 360}deg`);
    if (index % 2) leaf.style.background = index % 4 === 1 ? "var(--sun)" : "var(--accent)";
    communityDialog.append(leaf);
    window.setTimeout(() => leaf.remove(), 1100);
  }
};

// A short message at the bottom of Community, with an optional button.
const communityToast = (text, actionLabel = "", onAction = null) => {
  communityDialog.querySelector(".community-toast")?.remove();
  const toast = communityElement("div", "community-toast");
  toast.setAttribute("role", "status");
  toast.append(communityElement("span", "", text));
  if (actionLabel && onAction) {
    const action = communityElement("button", "community-toast-action", actionLabel);
    action.type = "button";
    action.addEventListener("click", () => {
      toast.remove();
      onAction();
    });
    toast.append(action);
  }
  communityDialog.append(toast);
  window.setTimeout(() => toast.remove(), 6000);
};

// ---- The follow button ----

// Where you and this person stand, as one word.
const followState = (person) => {
  const iFollow = person.i_follow || "none";
  const followsMe = communityBool(person.follows_me);
  if (iFollow === "accepted" && followsMe) return "friends";
  if (iFollow === "accepted") return "following";
  if (iFollow === "pending") return "requested";
  return followsMe ? "follow-back" : "follow";
};
const FOLLOW_LABELS = {
  follow: "Follow",
  "follow-back": "Follow back",
  requested: "Requested",
  following: "Following",
  friends: "Friends",
};

// One button that does everything, like on TikTok:
//   Follow / Follow back  -> follows (or sends a request to a private profile)
//   Requested / Following / Friends -> tap once to see "Unfollow?", tap
//   again within a few seconds to unfollow.
// onChange runs after the person's state changed.
const communityFollowButton = (person, onChange = null, size = "") => {
  const button = communityElement("button", `follow-button${size ? ` is-${size}` : ""}`);
  button.type = "button";
  let confirmTimer = null;
  const paint = () => {
    const state = followState(person);
    button.dataset.state = state;
    delete button.dataset.confirm;
    button.replaceChildren();
    if (state === "friends") button.append(communityIcon(COMMUNITY_ICONS.friends));
    button.append(document.createTextNode(FOLLOW_LABELS[state]));
  };
  paint();
  button.addEventListener("click", async () => {
    const state = followState(person);
    const isOn = state === "requested" || state === "following" || state === "friends";
    if (isOn && !button.dataset.confirm) {
      button.dataset.confirm = "true";
      button.textContent = state === "requested" ? "Cancel request?" : "Unfollow?";
      window.clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(paint, 3000);
      return;
    }
    window.clearTimeout(confirmTimer);
    button.disabled = true;
    try {
      if (isOn) {
        await communityPost({ action: "unfollow", userId: String(person.id) });
        person.i_follow = "none";
      } else {
        const result = await communityPost({ action: "follow", userId: String(person.id) });
        person.i_follow = result.i_follow;
        person.follows_me = result.follows_me;
        if (result.friends) {
          communityCelebrate(button);
          communityToast(`You and ${person.display_name} are friends now.`, "Grow together", () => openPlantForm(person.id));
        } else if (result.i_follow === "pending") {
          communityToast("Request sent. They'll see it in their Community.");
        }
      }
      paint();
      button.classList.remove("is-changed");
      void button.offsetWidth;
      button.classList.add("is-changed");
      refreshCommunityCounts();
      onChange?.(person);
    } catch (error) {
      communityStatus.textContent = error.message;
      paint();
    } finally {
      button.disabled = false;
    }
  });
  return button;
};

// ---- Badges and counts ----

const setCommunityTabBadge = (name, count) => {
  const badge = communityDialog.querySelector(`[data-community-badge="${name}"]`);
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = count > 99 ? "99+" : String(count || "");
};

const updateCommunityBadge = (count) => {
  setCommunityTabBadge("inbox", count);
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

// The numbers at the top and the follow requests bar.
const renderCommunityCounts = () => {
  if (!communityState) return;
  for (const name of ["friends", "following", "followers"]) {
    const count = communityDialog.querySelector(`[data-community-count="${name}"]`);
    const next = String((communityState[name] || []).filter((person) => name !== "following" || person.i_follow === "accepted").length);
    if (count.textContent !== next) {
      count.textContent = next;
      count.classList.remove("is-bumped");
      void count.offsetWidth;
      count.classList.add("is-bumped");
    }
  }
  const requests = communityState.requests || [];
  const bar = document.querySelector("#community-requests");
  bar.hidden = !requests.length || communityView === "requests";
  const first = requests[0]?.display_name || "";
  document.querySelector("#community-requests-count").textContent = requests.length > 1
    ? `${first} and ${requests.length - 1} more`
    : first;
  const faces = document.querySelector("#community-requests-faces");
  faces.replaceChildren(...requests.slice(0, 3).map((person) => communityAvatar(person, "tiny")));
};

// Reloads the counts in the background after a follow changed.
const refreshCommunityCounts = async () => {
  try {
    await loadCommunitySummary();
    renderCommunityCounts();
  } catch {
    // The counts catch up the next time Community opens.
  }
};

// ---- Lists of people ----

const EMPTY_TEXTS = {
  friends: "Friends are people you follow who follow you back. Find someone above and tap Follow.",
  following: "You don't follow anyone yet. Search for a name above.",
  followers: "No followers yet. Share your username so friends can find you.",
  requests: "No follow requests right now.",
  blocked: "You haven't blocked anyone.",
  search: "No one found. Try a name, @username or email.",
};

const communityPersonRow = (person, mode) => {
  const row = communityElement("article", "community-card");
  const avatarButton = communityElement("button", "community-avatar-button");
  avatarButton.type = "button";
  avatarButton.setAttribute("aria-label", `Open ${person.display_name}'s profile`);
  avatarButton.append(communityAvatar(person));
  avatarButton.addEventListener("click", () => openCommunityProfile(person.id));
  const details = communityElement("div", "community-person");
  details.append(communityProfileButton(person));
  const username = communityElement("p", "community-muted", `@${person.profile_username || `user${person.id}`}`);
  details.append(username);
  if (mode !== "requests" && mode !== "blocked" && communityBool(person.follows_me) && person.i_follow === "none") {
    details.append(communityElement("span", "community-tag", "Follows you"));
  }
  const actions = communityElement("div", "community-actions");
  if (mode === "requests") {
    actions.append(
      communityButton("Accept", "save-button", async (button) => {
        await communityPost({ action: "accept", userId: String(person.id) });
        communityCelebrate(button, 10);
        // Like TikTok: once you accept, offer to follow them back.
        actions.replaceChildren(communityFollowButton({ ...person, follows_me: true }, null, "small"));
        refreshCommunityCounts();
      }),
      communityButton("", "community-icon-button", async () => {
        await communityPost({ action: "decline", userId: String(person.id) });
        row.classList.add("is-leaving");
        window.setTimeout(() => row.remove(), 200);
        refreshCommunityCounts();
      }),
    );
    actions.lastChild.setAttribute("aria-label", `Decline ${person.display_name}`);
    actions.lastChild.append(communityIcon(COMMUNITY_ICONS.close));
  } else if (mode === "blocked") {
    actions.append(communityButton("Unblock", "profile-secondary-button", async () => {
      await communityPost({ action: "unblock", userId: String(person.id) });
      await loadCommunitySummary();
      await loadCommunitySection("blocked");
    }));
  } else {
    actions.append(communityFollowButton(person, null, "small"));
    if (mode === "friends") {
      const tree = communityTrees.find((item) => String(item.partner_id) === String(person.id));
      const treeButton = communityButton("", "community-icon-button is-tree", async () => {
        if (tree) await loadCommunitySection("trees");
        else openPlantForm(person.id);
      });
      treeButton.append(communityIcon(COMMUNITY_ICONS.tree));
      treeButton.setAttribute("aria-label", tree ? `Your network with ${person.display_name}` : `Grow together with ${person.display_name}`);
      treeButton.title = tree ? "Your shared network" : "Grow together";
      actions.prepend(treeButton);
    }
  }
  row.append(avatarButton, details, actions);
  return row;
};

const renderPeople = (people, mode) => {
  communityList.replaceChildren();
  if (!people?.length) {
    communityList.append(communityElement("p", "community-empty", EMPTY_TEXTS[mode] || "Nothing here yet."));
    return;
  }
  people.forEach((person, index) => {
    const row = communityPersonRow(person, mode);
    row.style.setProperty("--index", String(Math.min(index, 12)));
    communityList.append(row);
  });
};

// ---- Activity feed ----

const renderActivityFeed = (activities) => {
  communityList.replaceChildren();
  if (!activities?.length) {
    communityList.append(communityElement("p", "community-empty", "Follow people to see their milestones here."));
    return;
  }
  for (const activity of activities) {
    let details = activity.details || {};
    if (typeof details === "string") {
      try { details = JSON.parse(details); } catch { details = {}; }
    }
    const card = communityElement("article", "community-card");
    card.append(communityAvatar(activity));
    const content = communityElement("div", "community-person");
    content.append(communityProfileButton({ id: activity.actor_id, display_name: activity.actor_name }));
    content.append(communityElement("p", "", activity.activity_type === "milestone_completed"
      ? `finished a step${details.step_title ? `: ${details.step_title}` : ""}`
      : "started a new journey"));
    content.append(communityElement("p", "community-muted", new Date(activity.created_at).toLocaleDateString()));
    card.append(content);
    const actions = communityElement("div", "community-actions");
    let reactions = activity.reactions || {};
    if (typeof reactions === "string") {
      try { reactions = JSON.parse(reactions || "{}"); } catch { reactions = {}; }
    }
    for (const [reaction, label] of [["like", "Like"], ["celebrate", "Celebrate"], ["support", "Support"]]) {
      const count = Number(reactions[reaction]) || 0;
      actions.append(communityButton(
        `${label}${count ? ` ${count}` : ""}`,
        activity.my_reaction === reaction ? "save-button" : "profile-secondary-button",
        async () => {
          await communityPost({ action: "react", activityId: String(activity.id), reaction });
          await loadCommunitySection("feed");
        },
      ));
    }
    card.append(actions);
    communityList.append(card);
  }
};

// ---- Inbox ----

const NOTIFICATION_TEXTS = {
  follow_request: "wants to follow you.",
  follow_accepted: "accepted your follow request.",
  new_follower: "started following you.",
  new_friend: "followed you back. You're friends now.",
  milestone_completed: "finished a step.",
  reaction: "cheered on your progress.",
  tree_invite: "wants to grow together with you.",
  tree_started: "said yes. Your shared network has started.",
  tree_watered: "checked in on your shared goal. Your turn!",
  tree_grew: "checked in too. Your network grew!",
  tree_nudge: "nudged you: hop on and check in!",
};
const NOTIFICATION_VIEWS = {
  follow_request: "requests",
  tree_invite: "trees",
  tree_started: "trees",
  tree_watered: "trees",
  tree_grew: "trees",
  tree_nudge: "trees",
};

const renderNotifications = (notifications) => {
  communityList.replaceChildren();
  if (!notifications?.length) {
    communityList.append(communityElement("p", "community-empty", "You're all caught up."));
    return;
  }
  for (const notification of notifications) {
    const card = communityElement("article", `community-card${notification.read_at ? "" : " is-unread"}`);
    card.append(communityAvatar(notification));
    const text = communityElement("div", "community-person");
    const description = communityElement("p");
    description.append(communityProfileButton({ id: notification.actor_id, display_name: notification.actor_name }));
    description.append(document.createTextNode(` ${NOTIFICATION_TEXTS[notification.notification_type] || "sent you an update."}`));
    text.append(description, communityElement("p", "community-muted", new Date(notification.created_at).toLocaleDateString()));
    card.append(text);
    const view = NOTIFICATION_VIEWS[notification.notification_type];
    if (view) {
      const actions = communityElement("div", "community-actions");
      actions.append(communityButton(view === "requests" ? "See" : "Open", "profile-secondary-button", () => loadCommunitySection(view)));
      card.append(actions);
    }
    communityList.append(card);
  }
};

// ---- Shared trees ----

const loadCommunityTrees = async () => {
  const result = await communityGet("trees", { day: sharedTreeToday() });
  // An empty list can arrive as {} from the server's JSON encoder.
  communityTrees = (result.trees || []).map((tree) => ({ ...tree, days: Array.isArray(tree.days) ? tree.days : [] }));
  // The Trees badge counts what needs you: invites to answer, and trees
  // your friend watered today while you haven't.
  const needsYou = communityTrees.filter((tree) => {
    if (tree.status === "invited") return !communityBool(tree.planted_by_me);
    const today = (tree.days || []).find((day) => day.day === tree.today);
    return Boolean(today?.partner && !today?.me);
  }).length;
  setCommunityTabBadge("trees", needsYou);
  return communityTrees;
};

const PLANT_IDEAS = ["Move every day", "Read every day", "Study together", "Sleep before 11"];

// The form for planting a new tree with a friend.
const communityPlantCard = (friend) => {
  const card = communityElement("form", "shared-plant");
  const heading = communityElement("div", "shared-plant-head");
  heading.append(communityAvatar(friend, "small"), communityElement("strong", "", `Grow together with ${friend.display_name}`));
  const input = communityElement("input");
  input.type = "text";
  input.maxLength = 80;
  input.required = true;
  input.placeholder = "What will you both do?";
  input.setAttribute("aria-label", "What will you both do?");
  const ideas = communityElement("div", "shared-plant-ideas");
  for (const idea of PLANT_IDEAS) {
    const chip = communityElement("button", "shared-plant-idea", idea);
    chip.type = "button";
    chip.addEventListener("click", () => {
      input.value = idea;
      input.focus();
    });
    ideas.append(chip);
  }
  const rule = communityElement("p", "community-muted", "It only grows on days you both check in.");
  const actions = communityElement("div", "community-actions");
  const submit = communityElement("button", "save-button", "Start");
  submit.type = "submit";
  const cancel = communityElement("button", "profile-secondary-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    communityPlantFor = null;
    renderTrees();
  });
  actions.append(cancel, submit);
  card.append(heading, input, ideas, rule, actions);
  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await communityPost({ action: "tree_plant", userId: String(friend.id), title: input.value.trim() });
      communityPlantFor = null;
      await loadCommunityTrees();
      renderTrees();
      communityToast(`Invite sent. ${friend.display_name} needs to say yes.`);
    } catch (error) {
      communityStatus.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  window.setTimeout(() => input.focus(), 50);
  return card;
};

// The last seven days as dots: full when you both watered, half when one
// of you did.
const sharedTreeWeek = (tree) => {
  const week = communityElement("div", "shared-week");
  week.setAttribute("aria-label", "The last 7 days");
  const byDay = new Map((tree.days || []).map((day) => [day.day, day]));
  for (const day of chartLastDays(7, new Date(`${tree.today}T12:00:00`))) {
    const entry = byDay.get(day);
    const both = Boolean(entry?.me && entry?.partner);
    const one = Boolean(entry?.me || entry?.partner);
    const saved = Boolean(entry?.saved);
    const dot = communityElement("span", `shared-week-day${both ? " is-both" : one ? " is-one" : ""}${saved ? " is-saved" : ""}`);
    const name = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "narrow" });
    dot.append(communityElement("i"), communityElement("small", "", name));
    dot.title = both ? "You both checked in" : saved ? "Saved with a side quest" : one ? "Only one of you checked in" : "No check-in";
    week.append(dot);
  }
  return week;
};

const sharedTreePerson = (person, label, watered, note) => {
  const pill = communityElement("div", `shared-person${watered ? " is-watered" : ""}`);
  pill.append(communityAvatar(person, "small"));
  const text = communityElement("div", "shared-person-text");
  text.append(communityElement("strong", "", label));
  text.append(communityElement("span", "", watered ? note : "Not yet"));
  pill.append(text);
  const mark = communityElement("span", "shared-person-mark");
  mark.append(communityIcon(watered ? COMMUNITY_ICONS.check : COMMUNITY_ICONS.drop));
  pill.append(mark);
  return pill;
};

// The side quest box, shown when you checked in today and your friend
// hasn't: one small task keeps the streak alive, once in a row.
const sharedSideQuest = (tree, today) => {
  const box = communityElement("div", "shared-quest");
  const yesterday = chartLastDays(2, new Date(`${tree.today}T12:00:00`))[0];
  const savedYesterday = (tree.days || []).some((day) => day.day === yesterday && day.saved);
  const label = communityElement("span", "shared-quest-label", "Side quest");
  if (today.saved) {
    box.classList.add("is-done");
    box.append(label, communityElement("strong", "", today.quest || tree.side_quest),
      communityElement("p", "community-muted", `Streak saved. The network grows when ${tree.partner_name} checks in.`));
    return box;
  }
  if (savedYesterday) {
    box.classList.add("is-locked");
    box.append(label, communityElement("p", "", `A side quest saved yesterday. Today it's up to ${tree.partner_name}: it's teamwork.`));
    return box;
  }
  box.append(label, communityElement("strong", "", tree.side_quest),
    communityElement("p", "community-muted", `${tree.partner_name} hasn't shown up? Do this to keep your streak alive.`));
  box.append(communityButton("Done", "save-button", async (button) => {
    await communityPost({ action: "tree_side_quest", treeId: String(tree.id), day: sharedTreeToday() });
    communityCelebrate(button, 14);
    await loadCommunityTrees();
    renderTrees();
    communityToast("Streak saved!");
  }));
  return box;
};

const sharedTreeCard = (tree) => {
  const partner = { id: tree.partner_id, display_name: tree.partner_name, picture: tree.partner_picture };
  const card = communityElement("article", `shared-tree-card is-${tree.status}`);
  card.dataset.treeId = String(tree.id);

  const head = communityElement("header", "shared-tree-head");
  const titles = communityElement("div");
  titles.append(communityElement("h3", "", tree.title));
  const withLine = communityElement("p", "community-muted", "with ");
  withLine.append(communityProfileButton(partner));
  titles.append(withLine);
  head.append(titles);
  const menu = communityMenu("Options", [communityButton(tree.status === "invited" ? "Remove invite" : "Remove", "profile-secondary-button", async () => {
    if (tree.status === "growing" && !confirm(`Remove "${tree.title}"? It is removed for both of you.`)) return;
    await communityPost({ action: "tree_remove", treeId: String(tree.id) });
    await loadCommunityTrees();
    renderTrees();
  })]);
  head.append(menu);
  card.append(head);

  const picture = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  picture.classList.add("shared-tree-picture");
  picture.setAttribute("role", "img");
  picture.setAttribute("aria-label", `${tree.title}: ${sharedTreeStage(tree.grown).name.toLowerCase()}, grown ${tree.grown} days`);
  const before = communityTreeSizes.get(tree.id);
  const animateFrom = before === undefined ? 0 : before < tree.grown ? before : null;
  // One of you checked in today but not the other: a glowing dot waits.
  const todayEntry = (tree.days || []).find((day) => day.day === tree.today) || {};
  const waitingSide = tree.status !== "growing" || Boolean(todayEntry.me) === Boolean(todayEntry.partner)
    ? null
    : todayEntry.me ? "you" : "friend";
  drawSharedTree(picture, { ...tree, waitingSide }, communityReduceMotion() ? null : animateFrom);
  communityTreeSizes.set(tree.id, tree.grown);
  card.append(picture);

  if (tree.status === "invited") {
    const plantedByMe = communityBool(tree.planted_by_me);
    card.append(communityElement("p", "shared-tree-invite", plantedByMe
      ? `Waiting for ${tree.partner_name} to say yes.`
      : `${tree.partner_name} wants to grow this with you.`));
    if (!plantedByMe) {
      const actions = communityElement("div", "community-actions shared-tree-actions");
      actions.append(
        communityButton("Not now", "profile-secondary-button", async () => {
          await communityPost({ action: "tree_remove", treeId: String(tree.id) });
          await loadCommunityTrees();
          renderTrees();
        }),
        communityButton("Start", "save-button", async (button) => {
          await communityPost({ action: "tree_accept", treeId: String(tree.id) });
          communityCelebrate(button);
          await loadCommunityTrees();
          renderTrees();
        }),
      );
      card.append(actions);
    }
    return card;
  }

  // Growing: the size, the stage, and today.
  const stage = sharedTreeStage(tree.grown);
  const streak = sharedTreeStreak(tree.days || [], tree.today);
  const stats = communityElement("div", "shared-tree-stats");
  const grownStat = communityElement("div", "shared-stat");
  grownStat.append(communityElement("strong", "", String(tree.grown)), communityElement("span", "", tree.grown === 1 ? "day together" : "days together"));
  const stageStat = communityElement("div", "shared-stat");
  stageStat.append(communityElement("strong", "", stage.name), communityElement("span", "", stage.next ? `${stage.daysToNext} to ${stage.next.toLowerCase()}` : "fully grown"));
  const streakStat = communityElement("div", "shared-stat");
  streakStat.append(communityElement("strong", "", String(streak)), communityElement("span", "", "in a row"));
  stats.append(grownStat, stageStat, streakStat);
  card.append(stats);

  const today = (tree.days || []).find((day) => day.day === tree.today) || {};
  const people = communityElement("div", "shared-people");
  people.append(
    sharedTreePerson({ display_name: "You", picture: communityState?.me_picture }, "You", Boolean(today.me), today.me),
    sharedTreePerson(partner, tree.partner_name, Boolean(today.partner), today.partner),
  );
  // Nudge: remind your friend to hop on and check in. Their phone gets a
  // notification (when they turned reminders on) and their inbox a note.
  if (!today.partner && communityBool(tree.still_friends)) {
    const partnerPill = people.lastChild;
    const nudged = communityBool(tree.nudged_today);
    const nudge = communityButton("", `shared-nudge${nudged ? " is-sent" : ""}`, async (button) => {
      await communityPost({ action: "tree_nudge", treeId: String(tree.id), day: sharedTreeToday() });
      tree.nudged_today = true;
      button.classList.add("is-sent");
      button.replaceChildren(communityIcon(COMMUNITY_ICONS.check), document.createTextNode("Nudged"));
      communityCelebrate(button, 8);
      communityToast(`${tree.partner_name} got your nudge.`);
    });
    nudge.append(communityIcon(nudged ? COMMUNITY_ICONS.check : COMMUNITY_ICONS.bell), document.createTextNode(nudged ? "Nudged" : "Nudge"));
    nudge.setAttribute("aria-label", nudged ? `You nudged ${tree.partner_name} today` : `Nudge ${tree.partner_name} to check in`);
    if (nudged) nudge.disabled = true;
    partnerPill.querySelector(".shared-person-mark").replaceWith(nudge);
  }
  card.append(people);

  if (!communityBool(tree.still_friends)) {
    card.append(communityElement("p", "shared-tree-note", "Paused. Follow each other again to keep it growing."));
  } else if (!today.me) {
    const form = communityElement("form", "shared-water");
    const input = communityElement("input");
    input.type = "text";
    input.maxLength = 200;
    input.required = true;
    input.placeholder = "What did you do today?";
    input.setAttribute("aria-label", "What did you do today?");
    const water = communityElement("button", "save-button shared-water-button");
    water.type = "submit";
    water.append(communityIcon(COMMUNITY_ICONS.drop), document.createTextNode("Check in"));
    form.append(input, water);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      water.disabled = true;
      try {
        const result = await communityPost({
          action: "tree_water",
          treeId: String(tree.id),
          day: sharedTreeToday(),
          note: input.value.trim(),
        });
        await loadCommunityTrees();
        renderTrees();
        const fresh = communityList.querySelector(`[data-tree-id="${tree.id}"] .shared-tree-picture`);
        if (result.grew) {
          communityCelebrate(fresh, 26);
          communityToast("You both checked in. Your network grew!");
        } else {
          communityList.querySelector(`[data-tree-id="${tree.id}"] .shared-person.is-watered`)?.classList.add("is-splash");
          communityToast(`Checked in. It grows when ${tree.partner_name} checks in too.`);
        }
      } catch (error) {
        communityStatus.textContent = error.message;
      } finally {
        water.disabled = false;
      }
    });
    card.append(form);
  } else if (!today.partner) {
    card.append(communityElement("p", "shared-tree-note is-waiting", `Waiting for ${tree.partner_name}.`));
    card.append(sharedSideQuest(tree, today));
  } else {
    card.append(communityElement("p", "shared-tree-note is-done", "You both checked in today. It grew."));
  }
  card.append(sharedTreeWeek(tree));
  return card;
};

const renderTrees = () => {
  communityList.replaceChildren();
  const friends = communityState?.friends || [];
  const plantFriend = friends.find((friend) => String(friend.id) === String(communityPlantFor));
  if (plantFriend) communityList.append(communityPlantCard(plantFriend));

  communityTrees.forEach((tree) => communityList.append(sharedTreeCard(tree)));

  // Friends you don't have a tree with yet.
  const withTree = new Set(communityTrees.map((tree) => String(tree.partner_id)));
  const free = friends.filter((friend) => !withTree.has(String(friend.id)) && String(friend.id) !== String(communityPlantFor));
  if (!communityTrees.length && !plantFriend) {
    const empty = communityElement("div", "shared-empty");
    const seed = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    seed.classList.add("shared-tree-picture", "is-small");
    drawSharedTree(seed, { id: 7, grown: 0, status: "growing" });
    empty.append(seed, communityElement("p", "", friends.length
      ? "Pick a friend and a goal. Your network only grows on days you both check in."
      : "Follow each other to become friends. Then you can grow together."));
    communityList.append(empty);
  }
  if (free.length) {
    const section = communityElement("section", "shared-free");
    section.append(communityElement("h3", "", communityTrees.length ? "Start another" : "Pick a friend"));
    for (const friend of free) {
      const row = communityElement("div", "shared-free-row");
      row.append(communityAvatar(friend, "small"), communityElement("span", "", friend.display_name));
      const plant = communityButton("", "community-icon-button is-tree", () => openPlantForm(friend.id));
      plant.append(communityIcon(COMMUNITY_ICONS.tree), document.createTextNode("Start"));
      row.append(plant);
      section.append(row);
    }
    communityList.append(section);
  }
};

const openPlantForm = async (friendId) => {
  communityPlantFor = friendId;
  await loadCommunitySection("trees");
  communityList.querySelector(".shared-plant")?.scrollIntoView({ block: "nearest", behavior: communityReduceMotion() ? "auto" : "smooth" });
};

// ---- Loading the views ----

const COMMUNITY_VIEW_NAMES = {
  friends: "Friends",
  following: "Following",
  followers: "Followers",
  requests: "Follow requests",
  trees: "Grow together",
  feed: "Activity",
  notifications: "Inbox",
  privacy: "Privacy",
  blocked: "Blocked",
  search: "Search",
};

const loadCommunitySummary = async () => {
  const result = await communityGet("summary");
  communityState = result;
  updateCommunityBadge(Number(result.unread) || 0);
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

const selectCommunityTab = (view) => {
  for (const tab of communityDialog.querySelectorAll("nav [data-community-view]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.communityView === view));
  }
};

const loadCommunitySection = async (view) => {
  if (view !== "trees") communityPlantFor = null;
  communityView = view;
  communityProfile.hidden = true;
  communityReportForm.hidden = true;
  communityPrivacy.hidden = view !== "privacy";
  communityList.hidden = view === "privacy";
  communityViewTitle.textContent = COMMUNITY_VIEW_NAMES[view] || "Community";
  communityStatus.textContent = "";
  selectCommunityTab(view);
  renderCommunityCounts();
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
  } else if (view === "trees") {
    await loadCommunityTrees();
    renderTrees();
  } else {
    renderPeople(communityState[view] || [], view);
  }
  renderCommunityCounts();
};

const searchCommunity = async (query) => {
  if (communityView !== "search") communityViewBeforeSearch = communityView;
  communityView = "search";
  const sequence = ++communitySearchSequence;
  selectCommunityTab("search");
  communityPrivacy.hidden = true;
  communityProfile.hidden = true;
  communityList.hidden = false;
  communityViewTitle.textContent = COMMUNITY_VIEW_NAMES.search;
  try {
    const result = await communityGet("search", { q: query });
    if (sequence !== communitySearchSequence) return;
    renderPeople(result.people, "search");
    communityStatus.textContent = "";
  } catch (error) {
    if (sequence !== communitySearchSequence) return;
    communityStatus.textContent = error.message;
    communityList.replaceChildren();
  }
};

// ---- A member's profile, like a TikTok profile ----

const openCommunityProfile = async (userId) => {
  communityStatus.textContent = "";
  communityList.hidden = true;
  communityPrivacy.hidden = true;
  communityProfile.hidden = false;
  communityProfile.replaceChildren(communityElement("p", "community-muted", "Loading..."));
  communityProfile.dataset.userId = String(userId);
  try {
    const { profile } = await communityGet("profile", { userId: String(userId) });
    communityViewTitle.textContent = profile.display_name;
    communityProfile.replaceChildren();

    const back = communityElement("button", "community-back");
    back.type = "button";
    back.append(communityIcon(COMMUNITY_ICONS.back), document.createTextNode("Back"));
    back.addEventListener("click", () => {
      if (communityView === "search" && communitySearchInput.value.trim()) searchCommunity(communitySearchInput.value.trim());
      else loadCommunitySection(communityView === "search" ? communityViewBeforeSearch : communityView);
    });

    const header = communityElement("div", "community-profile-head");
    header.append(communityAvatar(profile, "large"));
    header.append(communityElement("h3", "", profile.display_name));
    header.append(communityElement("p", "community-muted", `@${profile.username}`));
    const counts = communityElement("div", "community-profile-counts");
    for (const [value, label] of [[profile.following_count, "Following"], [profile.follower_count, "Followers"], [profile.friend_count, "Friends"]]) {
      const count = communityElement("div");
      count.append(communityElement("strong", "", String(value)), communityElement("span", "", label));
      counts.append(count);
    }
    header.append(counts);

    const actions = communityElement("div", "community-profile-actions");
    const rerenderActions = (person) => {
      actions.replaceChildren(communityFollowButton(person, rerenderActions, "large"));
      if (followState(person) === "friends") {
        const tree = communityTrees.find((item) => String(item.partner_id) === String(person.id));
        const treeButton = communityButton("", "profile-secondary-button community-grow-button", async () => {
          if (tree) await loadCommunitySection("trees");
          else await openPlantForm(person.id);
        });
        treeButton.append(communityIcon(COMMUNITY_ICONS.tree), document.createTextNode(tree ? "Our network" : "Grow together"));
        actions.append(treeButton);
      }
      const followerButtons = communityBool(person.follows_me) ? [
        communityButton("Remove follower", "profile-secondary-button", async () => {
          if (!confirm(`Remove ${profile.display_name} as a follower?`)) return;
          await communityPost({ action: "remove_follower", userId: String(profile.id) });
          person.follows_me = false;
          refreshCommunityCounts();
          rerenderActions(person);
        }),
      ] : [];
      const more = communityMenu("More options", [
        ...followerButtons,
        communityButton("Block", "profile-secondary-button", async () => {
          if (!confirm(`Block ${profile.display_name}? They will no longer find or contact you here.`)) return;
          await communityPost({ action: "block", userId: String(profile.id) });
          await loadCommunitySummary();
          await loadCommunitySection(communityView === "search" ? communityViewBeforeSearch : communityView);
        }),
        communityButton("Report", "profile-secondary-button", async () => {
          communityReportUserId = profile.id;
          communityReportForm.hidden = false;
          communityReportReason.focus();
        }),
      ]);
      actions.append(more);
    };
    rerenderActions(profile);
    header.append(actions);
    communityProfile.append(back, header);

    if (profile.private) {
      const locked = communityElement("div", "community-private");
      locked.append(communityIcon(COMMUNITY_ICONS.lock));
      locked.append(communityElement("strong", "", "This account is private"));
      locked.append(communityElement("span", "community-muted", "Follow to see their progress."));
      communityProfile.append(locked);
      return;
    }
    if (profile.bio) communityProfile.append(communityElement("p", "community-profile-bio", profile.bio));
    if (profile.goal) communityProfile.append(communityElement("p", "community-muted", `Main goal: ${profile.goal}`));
    if (profile.progress?.exists) {
      const progress = communityElement("section", "community-progress");
      progress.append(communityElement("strong", "", profile.progress.goal));
      progress.append(communityElement("span", "", `${profile.progress.completed_count} of ${profile.progress.total_steps} steps (${profile.progress.progress}%)`));
      if (profile.progress.current_step) {
        progress.append(communityElement("span", "community-muted", `Now: ${profile.progress.current_step.title}`));
      }
      communityProfile.append(progress);
    }
    if (profile.network) renderFriendNetwork(communityProfile, profile.network);
  } catch (error) {
    communityStatus.textContent = error.message;
    communityProfile.hidden = true;
    communityList.hidden = false;
  }
};

const loadCommunity = async () => {
  communityStatus.textContent = "";
  try {
    await Promise.all([loadCommunitySummary(), loadCommunityTrees().catch(() => [])]);
    await loadCommunitySection(communityView === "search" ? communityViewBeforeSearch : communityView);
  } catch (error) {
    communityStatus.textContent = error.message;
  }
};

// ---- Events ----

for (const tab of communityDialog.querySelectorAll("[data-community-view]")) {
  tab.addEventListener("click", () => {
    if (communitySearchInput.value) {
      communitySearchInput.value = "";
      communitySearchSequence += 1;
    }
    loadCommunitySection(tab.dataset.communityView).catch((error) => {
      communityStatus.textContent = error.message;
    });
  });
}

communitySearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = communitySearchInput.value.trim();
  if (query.length < 2) {
    communityStatus.textContent = "Type at least two letters.";
    return;
  }
  searchCommunity(query);
});

communitySearchInput.addEventListener("input", () => {
  window.clearTimeout(communitySearchTimer);
  const query = communitySearchInput.value.trim();
  if (query.length < 2) {
    communitySearchSequence += 1;
    if (communityView === "search") loadCommunitySection(communityViewBeforeSearch);
    return;
  }
  communitySearchTimer = window.setTimeout(() => searchCommunity(query), 250);
});

document.querySelector("#community-save-privacy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  communityStatus.textContent = "Saving...";
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
    communityStatus.textContent = "Saved.";
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
    communityStatus.textContent = "Thank you. Your report was sent.";
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
