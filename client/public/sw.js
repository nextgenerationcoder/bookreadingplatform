// Minimal service worker - no offline caching yet, it exists purely
// because Chrome/Android requires an active service worker for a site to
// be "installable" (not just bookmarkable) and to register as a Web Share
// Target (see manifest.json's share_target - sharing a webpage into this
// app only shows up in the Android share sheet for an actually-installed
// PWA, and installability requires this).
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Passthrough - every request just goes to the network as normal. Adding
// real caching (for offline reading) is a separate feature to opt into
// later, not a side effect of making the app installable.
self.addEventListener('fetch', () => {});
