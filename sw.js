// Service Worker – bei JEDER Änderung an einer Datei VERSION erhöhen!
const VERSION = "1.0.0";
const CACHE = "kassenbuch-" + VERSION;
const FILES = ["./", "./index.html", "./manifest.json", "./sw.js"];

// Installieren: alle Dateien frisch vom Server holen (HTTP-Cache umgehen) und sofort aktiv werden
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

// Aktivieren: alte Caches löschen und offene Seiten sofort übernehmen
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: online immer die neueste Version, offline aus dem Cache
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});

// Die App fragt per MessageChannel nach der Versionsnummer
self.addEventListener("message", (e) => {
  if (e.data === "version" && e.ports[0]) e.ports[0].postMessage(VERSION);
});
