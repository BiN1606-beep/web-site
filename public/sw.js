// Osiris service worker.
//
// It does three things:
//   1. Shows the daily reminder that the server pushes, and opens Osiris when
//      the reminder is clicked.
//   2. When the phone has no internet, shows a friendly "you're offline"
//      screen (offline.html) instead of the browser's error page. That is
//      what makes Osiris feel like an app when it is installed.
//   3. Nothing else: pages, scripts and data always load fresh from the
//      server. The cache only holds the small offline screen, so a deploy
//      never leaves anyone with old files.
//
// When you change the offline screen, bump CACHE_VERSION so phones fetch
// the new copy.

const CACHE_VERSION = "osiris-offline-v1";
const OFFLINE_FILES = ["/offline.html", "/js/offline.js", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // "reload" skips the browser's own HTTP cache so we store today's copy.
    await cache.addAll(OFFLINE_FILES.map((url) => new Request(url, { cache: "reload" })));
    // Use a new version of this file right away instead of waiting for every
    // open Osiris tab to close.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Remove offline screens from older versions of this file.
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Opening a page: try the internet first, show the offline screen if
  // there is none. A server error (for example a 502) still goes through,
  // so problems on the server are not hidden behind "you're offline".
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_VERSION);
      return (await cache.match("/offline.html")) || Response.error();
    }));
    return;
  }

  // The few files the offline screen itself needs.
  if (OFFLINE_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_VERSION);
      return (await cache.match(url.pathname)) || Response.error();
    }));
  }
  // Everything else (the API, scripts, styles) is left to the browser.
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
