// Osiris service worker.
//
// It only does two things: show the daily reminder that the server pushes,
// and open Osiris when the reminder is clicked. It does not cache pages, so
// the site always loads fresh from the server.

self.addEventListener("install", () => {
  // Use a new version of this file right away instead of waiting for every
  // open Osiris tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Osiris", {
    body: data.body || "Time for today's check-in.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // A newer reminder replaces an older one instead of piling up.
    tag: "osiris-daily-reminder",
    renotify: true,
    data: { url: "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return;
    }
    await self.clients.openWindow(url);
  })());
});
