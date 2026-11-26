// Daily reminders through web push, and registering the service worker.
//
// Loaded as a plain script (see the list at the end of index.html); all
// these files share one set of top-level names, so the order matters.

// ---- Daily reminders (web push) ----
// The browser subscribes to push messages with the server's public
// key and gives us an address to send them to. The server
// (lua/osiris/push_sender.lua) sends one at your chosen hour on days you
// haven't checked in. This device's choice of hour is remembered in
// localStorage only to show it again; the server has its own copy.
const reminderRow = document.querySelector("#reminder-row");
const reminderHour = document.querySelector("#reminder-hour");
const reminderToggle = document.querySelector("#reminder-toggle");
const reminderHint = document.querySelector("#reminder-hint");
const REMINDER_HOUR_STORAGE = "osiris-reminder-hour";
let reminderKey = null;
let reminderSubscription = null;

const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// The service worker shows the reminders. Registering it also makes the
// site installable as an app.
const serviceWorkerReady = "serviceWorker" in navigator
  ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).catch((error) => {
    console.warn("Could not register the service worker:", error);
    return null;
  })
  : Promise.resolve(null);

for (let hour = 6; hour <= 23; hour += 1) {
  const option = document.createElement("option");
  option.value = String(hour);
  option.textContent = new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  reminderHour.append(option);
}
try {
  reminderHour.value = localStorage.getItem(REMINDER_HOUR_STORAGE) || "20";
} catch {
  reminderHour.value = "20";
}

// The public key arrives as base64url text; the browser wants bytes.
const base64UrlToBytes = (text) => {
  const base64 = (text + "=".repeat((4 - (text.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const postReminder = async (body) => {
  const response = await fetch("/api/progress-tree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await readApiResponse(response, "Progress tree");
  if (!response.ok) throw new Error(result.error || "Could not update your reminder.");
  return result;
};

const showReminderHint = (text) => {
  reminderHint.textContent = text;
  reminderHint.hidden = !text;
};

const updateReminderUi = () => {
  reminderToggle.textContent = reminderSubscription ? "Turn off" : "Turn on";
  showReminderHint(reminderSubscription
    ? `On for this device: a reminder at ${reminderHour.selectedOptions[0]?.textContent} on days you haven't checked in.`
    : "");
};

const setupReminders = async (key) => {
  reminderKey = key || null;
  reminderRow.hidden = true;
  showReminderHint("");
  if (!reminderKey) return;
  if (!pushSupported) {
    if (isAppleMobile && !isInstalledApp) {
      showReminderHint("Want a daily reminder? On iPhone, first add Osiris to your Home Screen: tap Share, then \"Add to Home Screen\", and open it from there.");
    }
    return;
  }
  reminderRow.hidden = false;
  const registration = await serviceWorkerReady;
  reminderSubscription = registration ? await registration.pushManager.getSubscription() : null;
  updateReminderUi();
  if (!reminderSubscription && Notification.permission === "denied") {
    showReminderHint("Notifications are blocked for Osiris. Allow them in your browser's site settings to get reminders.");
  }
};

const saveReminder = (subscription) => postReminder({
  action: "reminder_subscribe",
  subscription: subscription.toJSON(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  hour: Number(reminderHour.value),
});

reminderToggle.addEventListener("click", async () => {
  reminderToggle.disabled = true;
  try {
    if (reminderSubscription) {
      const endpoint = reminderSubscription.endpoint;
      await reminderSubscription.unsubscribe();
      reminderSubscription = null;
      await postReminder({ action: "reminder_unsubscribe", endpoint });
      updateReminderUi();
      showReminderHint("Reminders are off for this device.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showReminderHint("Osiris needs permission to show notifications. Allow it to get reminders.");
      return;
    }
    const registration = await serviceWorkerReady;
    if (!registration) throw new Error("This browser could not set up reminders.");
    const options = { userVisibleOnly: true, applicationServerKey: base64UrlToBytes(reminderKey) };
    let subscription;
    try {
      subscription = await registration.pushManager.subscribe(options);
    } catch (error) {
      // An old subscription made with a different server key blocks a
      // new one; remove it and try once more.
      const old = await registration.pushManager.getSubscription();
      if (!old) throw error;
      await old.unsubscribe();
      subscription = await registration.pushManager.subscribe(options);
    }
    await saveReminder(subscription);
    reminderSubscription = subscription;
    updateReminderUi();
  } catch (error) {
    showReminderHint(error.message || "Could not change your reminder.");
  } finally {
    reminderToggle.disabled = false;
  }
});

reminderHour.addEventListener("change", async () => {
  try {
    localStorage.setItem(REMINDER_HOUR_STORAGE, reminderHour.value);
  } catch {
    // Private windows may block storage; the server still has the hour.
  }
  if (!reminderSubscription) return;
  try {
    await saveReminder(reminderSubscription);
    updateReminderUi();
  } catch (error) {
    showReminderHint(error.message);
  }
});
