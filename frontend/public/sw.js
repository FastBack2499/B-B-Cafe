const CACHE = "bread-and-butter-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE, "/icon-192.png", "/icon-512.png"])));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("bread-and-butter-") && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (url.pathname === "/api/menu") {
    event.respondWith(fetch(event.request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put(event.request, response.clone());
      return response;
    }).catch(async () => (await caches.match(event.request)) ||
      new Response(JSON.stringify({ error: "اتصال اینترنت برقرار نیست." }), { status: 503 })));
  }
});
