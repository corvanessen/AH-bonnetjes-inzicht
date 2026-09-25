// Draait in de pagina zelf (world: MAIN) op login.ah.nl, vóór de scripts van AH.
//
// Na het inloggen stuurt AH door naar appie://login-exit?code=..., een adres
// voor de iPhone-app dat een browser niet kan openen. Net als appie-go (dat de
// loginpagina via een proxy herschrijft) vervangen we dat adres in de
// paginadata en in fetch-antwoorden door een https-adres dat de extensie wél
// ziet. Daarnaast melden we elke code die we langs zien komen direct.
// Voor andere logins (bv. gewoon op ah.nl) komt dit adres niet voor en doet dit niets.
(() => {
  const FROM = "appie://login-exit";
  const TO = "https://login.ah.nl/__appie_ext_callback";
  const CODE_RE = /(?:appie:\/\/login-exit|__appie_ext_callback)\?[^"'\s<>]*?\bcode=([^&"'\s<>\\]+)/;

  const report = (code, via) => window.postMessage({ source: "ah-bonnetjes-login", code, via }, location.origin);
  const scan = (text, via) => {
    const m = typeof text === "string" && text.match(CODE_RE);
    if (m) report(decodeURIComponent(m[1]), via);
  };
  const rewrite = (s) => (typeof s === "string" && s.includes(FROM) ? s.split(FROM).join(TO) : s);
  const deep = (v) => {
    if (typeof v === "string") return rewrite(v);
    if (v && typeof v === "object") for (const k of Object.keys(v)) v[k] = deep(v[k]);
    return v;
  };

  // 1) Next.js-paginadata: zowel het <script id="__NEXT_DATA__"> als window.__NEXT_DATA__.
  new MutationObserver((mutations, obs) => {
    for (const m of mutations)
      for (const node of m.addedNodes) {
        if (node.id === "__NEXT_DATA__" && node.textContent.includes(FROM)) {
          node.textContent = rewrite(node.textContent);
          obs.disconnect();
        }
      }
  }).observe(document, { childList: true, subtree: true });

  let nextData;
  try {
    Object.defineProperty(window, "__NEXT_DATA__", {
      configurable: true,
      get: () => nextData,
      set: (v) => (nextData = deep(v)),
    });
  } catch {
    /* al gedefinieerd */
  }

  // 2) fetch-antwoorden (bv. een login-API die de doorverwijzing teruggeeft).
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const type = resp.headers.get("content-type") || "";
      if (!/json|text|javascript/.test(type)) return resp;
      const text = await resp.clone().text();
      scan(text, "fetch");
      if (!text.includes(FROM)) return resp;
      return new Response(rewrite(text), { status: resp.status, statusText: resp.statusText, headers: resp.headers });
    } catch {
      return resp;
    }
  };

  // 3) Navigaties vanuit de pagina (location.href = ..., links, formulieren).
  window.navigation?.addEventListener("navigate", (e) => {
    const url = e.destination?.url || "";
    if (url.startsWith(FROM) || url.startsWith(TO)) scan(url, "navigate");
  });
})();
