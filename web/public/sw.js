// Service worker: maakt het dashboard installeerbaar (Chrome/Android) en
// bruikbaar zonder verbinding. Er gaat geen data naar een server; dit cachet
// alleen de app-bestanden zelf, van de eigen origin.
//
// - Pagina (navigatie): eerst netwerk, zodat een nieuwe versie direct
//   binnenkomt; offline de laatst bewaarde versie.
// - Overige bestanden (JS/CSS met hash in de naam, iconen, OCR-taaldata):
//   uit de cache als ze er zijn, op de achtergrond ververst.
const CACHE = "boodschappenledger-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const kopie = res.clone();
            caches.open(CACHE).then((c) => c.put(req, kopie));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./"))),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const vers = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        if (hit) {
          event.waitUntil(vers);
          return hit;
        }
        return vers;
      }),
    ),
  );
});
