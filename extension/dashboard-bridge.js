// Brug tussen het dashboard (window.postMessage) en de service worker.
// Alleen actief op het dashboard zelf; andere pagina's op deze hosts krijgen niets.
(() => {
  const ALLOWED = [
    (l) => l.origin === "https://corvanessen.github.io" && l.pathname.startsWith("/AH-bonnetjes-inzicht/"),
    (l) => /^http:\/\/(localhost|127\.0\.0\.1):(5173|4173)$/.test(l.origin),
  ];
  if (!ALLOWED.some((ok) => ok(location))) return;

  const send = (msg) => window.postMessage({ source: "ah-bonnetjes-ext", ...msg }, location.origin);

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const req = e.data;
    if (req?.source !== "ah-bonnetjes-page" || typeof req.id !== "number") return;

    if (req.type === "fetch") {
      const port = chrome.runtime.connect({ name: "fetch" });
      port.onMessage.addListener((ev) => {
        send({ id: req.id, event: ev });
        if (ev.type === "done" || ev.type === "error") port.disconnect();
      });
      port.onDisconnect.addListener(() => send({ id: req.id, event: { type: "closed" } }));
      port.postMessage({ account: String(req.account ?? ""), knownIds: Array.isArray(req.knownIds) ? req.knownIds : [] });
      return;
    }

    if (!["ping", "status", "login", "logout"].includes(req.type)) return;
    chrome.runtime.sendMessage({ type: req.type, account: String(req.account ?? "") }, (resp) => {
      const err = chrome.runtime.lastError;
      send({ id: req.id, ok: !err && resp?.ok, result: resp?.result, error: err?.message ?? resp?.error });
    });
  });
})();
