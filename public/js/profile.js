// Your profile: loading the account, the profile editor and pictures.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

const showPicture = (image, placeholder, picture) => {
  image.hidden = !picture;
  placeholder.hidden = Boolean(picture);
  if (picture) image.src = picture;
  else image.removeAttribute("src");
};

const updateProfileDisplay = (profile) => {
  accountEmail.textContent = profile.email;
  settingsEditProfileButton.disabled = !profileLoaded;
  profileViewEditButton.disabled = !profileLoaded;
  profileViewDisplayName.textContent = profile.display_name || profile.email;
  profileViewEmail.textContent = profile.email;
  profileViewGender.textContent = profile.gender || "Gender not set";
  profileViewBio.textContent = profile.bio || "No bio yet.";
  profileViewGoals.textContent = profile.goals || "No goals set yet.";
  showPicture(profileViewPicture, profileViewPlaceholder, profile.profile_picture);
};

const updateBioCount = () => {
  profileBioCount.textContent = `${Array.from(profileBioInput.value).length} / 250`;
};

const prepareProfileEditor = (onboarding) => {
  isOnboarding = onboarding;
  profileEditorTitle.textContent = onboarding ? "Customize Your Profile" : "Edit Your Profile";
  profileEditorSubtitle.textContent = onboarding
    ? "Let's get to know you! Set up your profile so we can personalize your experience."
    : "Update your profile details whenever you like.";
  profileEditorClose.hidden = onboarding;
  profileSkipButton.hidden = !onboarding;
  profileDisplayNameInput.value = accountProfile.display_name || "";
  profileGenderInput.value = accountProfile.gender || "";
  profileBioInput.value = accountProfile.bio || "";
  profileGoalsInput.value = accountProfile.goals || "";
  profilePictureValue = accountProfile.profile_picture || "";
  showPicture(profilePicturePreview, profilePicturePlaceholder, profilePictureValue);
  profilePictureInput.value = "";
  profileStatus.textContent = "";
  updateBioCount();
};

const loadAccount = () => {
  if (profileLoadRequest) return profileLoadRequest;
  profileViewStatus.textContent = "Loading your profile...";
  profileViewRetryButton.hidden = true;
  profileLoadRequest = (async () => {
    try {
      const response = await fetch("/api/auth/profile", { cache: "no-store" });
      const result = await readApiResponse(response, "Profile");
      if (!response.ok) throw new Error(result.error || "Could not load your profile.");
      accountProfile = result.profile;
      profileLoaded = true;
      updateProfileDisplay(accountProfile);
      profileViewStatus.textContent = "";
      if (!accountProfile.onboarding_seen) {
        document.documentElement.classList.remove("show-startup");
        startupScreen.remove();
        prepareProfileEditor(true);
        openPanel(profileEditorDialog, null);
      }
    } catch (error) {
      profileLoaded = false;
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const result = await readApiResponse(response, "Account");
        if (!response.ok) throw new Error(result.error || "Could not load your account.");
        accountProfile = {
          email: result.user.email,
          display_name: result.user.email,
          gender: "",
          bio: "",
          goals: "",
          profile_picture: null,
          onboarding_seen: true,
        };
        updateProfileDisplay(accountProfile);
        profileViewStatus.textContent = `Profile details couldn't be loaded: ${error.message}`;
        profileViewRetryButton.hidden = false;
        accountStatus.textContent = error.message;
      } catch (accountError) {
        profileViewDisplayName.textContent = "Profile unavailable";
        profileViewEmail.textContent = "";
        profileViewStatus.textContent = `${error.message} ${accountError.message}`;
        profileViewRetryButton.hidden = false;
        accountEmail.textContent = "Account unavailable.";
        accountStatus.textContent = accountError.message;
      }
    } finally {
      mainPage.inert = false;
      profileLoadRequest = null;
    }
  })();
  return profileLoadRequest;
};

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  accountStatus.textContent = "Signing out...";
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign out.");
    window.location.replace("/login");
  } catch (error) {
    accountStatus.textContent = error.message;
    signOutButton.disabled = false;
  }
});

if (document.documentElement.classList.contains("show-startup")) {
  const page = document.querySelector("main");
  page.inert = true;

  const finishStartup = () => {
    if (startupScreen.classList.contains("is-leaving")) return;
    const restoreFocus = startupSkip.matches(":focus");
    startupScreen.classList.add("is-leaving");
    window.setTimeout(() => {
      startupScreen.remove();
      page.inert = false;
      launcherActions.classList.add("is-appearing");
      if (restoreFocus) launcher.focus();
    }, 600);
  };

  startupSkip.addEventListener("click", finishStartup);
  window.setTimeout(finishStartup, 2500);
}

loadCommunitySummary().catch((error) => {
  console.error("Could not load the unread Community notification count:", error);
});

const loadImage = (file) => new Promise((resolve, reject) => {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("That image could not be opened."));
  };
  image.src = objectUrl;
});

profilePictureInput.addEventListener("change", async () => {
  const [file] = profilePictureInput.files;
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    profileStatus.textContent = "Choose an image smaller than 10 MB.";
    profilePictureInput.value = "";
    return;
  }
  profileSaveButton.disabled = true;
  profileStatus.textContent = "Preparing your picture...";
  try {
    const image = await loadImage(file);
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare that image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const picture = canvas.toDataURL("image/jpeg", 0.78);
    if (picture.length > 160000) throw new Error("Choose a simpler or smaller image.");
    profilePictureValue = picture;
    showPicture(profilePicturePreview, profilePicturePlaceholder, picture);
    profileStatus.textContent = "Picture ready to save.";
  } catch (error) {
    profileStatus.textContent = error.message;
  } finally {
    profileSaveButton.disabled = false;
  }
});

removeProfilePictureButton.addEventListener("click", () => {
  profilePictureValue = "";
  profilePictureInput.value = "";
  showPicture(profilePicturePreview, profilePicturePlaceholder, "");
  profileStatus.textContent = "Picture removed. Save your profile to apply the change.";
});

profileBioInput.addEventListener("input", updateBioCount);

document.querySelectorAll(".goal-suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    const goal = button.dataset.goal;
    const nextValue = profileGoalsInput.value
      ? `${profileGoalsInput.value.trimEnd()}\n${goal}`
      : goal;
    if (Array.from(nextValue).length > profileGoalsInput.maxLength) {
      profileStatus.textContent = "There is not enough room for that suggested goal.";
      return;
    }
    profileGoalsInput.value = nextValue;
    profileStatus.textContent = "";
  });
});

profileEditorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileSaveButton.disabled = true;
  profileStatus.textContent = "Saving your profile...";
  try {
    const response = await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profilePicture: profilePictureValue,
        displayName: profileDisplayNameInput.value,
        gender: profileGenderInput.value,
        bio: profileBioInput.value,
        goals: profileGoalsInput.value,
      }),
    });
    const result = await readApiResponse(response, "Profile");
    if (!response.ok) throw new Error(result.error || "Could not save your profile.");
    accountProfile = result.profile;
    updateProfileDisplay(accountProfile);
    closePanel(profileEditorDialog);
  } catch (error) {
    profileStatus.textContent = error.message;
  } finally {
    profileSaveButton.disabled = false;
  }
});

profileSkipButton.addEventListener("click", async () => {
  profileSkipButton.disabled = true;
  profileStatus.textContent = "Saving your choice...";
  try {
    const response = await fetch("/api/auth/profile/skip", { method: "POST" });
    const result = await readApiResponse(response, "Profile");
    if (!response.ok) throw new Error(result.error || "Could not skip profile setup.");
    accountProfile.onboarding_seen = true;
    closePanel(profileEditorDialog);
  } catch (error) {
    profileStatus.textContent = error.message;
  } finally {
    profileSkipButton.disabled = false;
  }
});

const openProfileEditor = (trigger) => {
  prepareProfileEditor(false);
  openPanel(profileEditorDialog, trigger);
};

settingsEditProfileButton.addEventListener("click", () => openProfileEditor(settingsEditProfileButton));
profileViewEditButton.addEventListener("click", () => openProfileEditor(profileViewEditButton));
profileViewRetryButton.addEventListener("click", loadAccount);
