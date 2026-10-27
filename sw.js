// Service worker: permite instalar la app y abrirla rápido. Los datos siempre vienen de Supabase.
const CACHE = "qtmc-v5";
const SHELL = ["./", "index.html", "config.js", "assets/styles.css", "assets/app.js", "assets/catalog.js", "icons/icon-192.png", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase y CDNs van directo a la red
  // Primero la red (para recibir siempre la última versión); si no hay conexión, lo guardado.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
