// Geeft codes die ah-login-main.js (in de pagina) vindt door aan de service worker.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "ah-bonnetjes-login" || !e.data.code) return;
  chrome.runtime.sendMessage({ type: "ah-code", code: String(e.data.code), via: e.data.via });
});
