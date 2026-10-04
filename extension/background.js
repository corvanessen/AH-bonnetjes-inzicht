// Service worker: praat namens het dashboard met de AH-API.
//
// Een gewone webpagina kan dat niet: api.ah.nl weigert elk verzoek met een
// Origin-header (dus alles vanuit een browserpagina), en de AH-login eindigt op
// appie://login-exit?code=..., wat een pagina niet kan opvangen. Een extensie
// mag beide: de declarativeNetRequest-regel hieronder haalt de Origin weg bij
// onze eigen verzoeken, en de login-scripts vangen de code op.
//
// Tokens blijven in storage.local van deze extensie; het dashboard
// krijgt alleen de bonnetjes zelf.

const API = "https://api.ah.nl";
const CLIENT_ID = "appie-ios";
const CLIENT_VERSION = "9.28";
const USER_AGENT = "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)";
const LOGIN_URL = `https://login.ah.nl/login?client_id=${CLIENT_ID}&response_type=code&redirect_uri=appie://login-exit`;
// ah-login-main.js herschrijft appie://login-exit naar dit adres, zodat de navigatie te zien is.
const CALLBACK_PREFIX = "https://login.ah.nl/__appie_ext_callback";
const PAGE_SIZE = 100;

const log = (...args) => console.log("[AH-bonnetjes]", ...args);

// Firefox (computer en Android) kent `browser` met promises; Chrome alleen `chrome`.
const ext = globalThis.browser ?? chrome;
const HOST_ORIGINS = ["https://api.ah.nl/*", "https://login.ah.nl/*"];

// --- Origin weghalen bij onze eigen API-verzoeken ------------------------------

const rulesReady = ext.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "origin", operation: "remove" },
          { header: "user-agent", operation: "set", value: USER_AGENT },
        ],
      },
      // Alleen verzoeken die niet uit een tabblad komen, dus van deze service worker.
      condition: { requestDomains: ["api.ah.nl"], tabIds: [ext.tabs.TAB_ID_NONE] },
    },
  ],
});

// Firefox: daar mag webRequest nog headers aanpassen (firefox/manifest-overrides.json vraagt
// webRequestBlocking). Dubbel op met de regel hierboven, voor het geval
// declarativeNetRequest daar de verzoeken van de extensie zelf overslaat.
if (ext.runtime.getManifest().permissions?.includes("webRequestBlocking")) {
  ext.webRequest.onBeforeSendHeaders.addListener(
    (d) => {
      if (d.tabId !== -1) return {};
      const requestHeaders = d.requestHeaders.filter((h) => !/^(origin|user-agent)$/i.test(h.name));
      requestHeaders.push({ name: "User-Agent", value: USER_AGENT });
      return { requestHeaders };
    },
    { urls: ["https://api.ah.nl/*"] },
    ["blocking", "requestHeaders"],
  );
}

/** Firefox geeft host-rechten pas na toestemming; Chrome bij installatie. */
const hasHostAccess = () => ext.permissions.contains({ origins: HOST_ORIGINS }).catch(() => true);

// --- tokens ----------------------------------------------------------------------

class NeedsLogin extends Error {}

const accountKey = (account) => (account || "").trim().toLowerCase() || "default";

async function loadTokens(account) {
  const { tokens = {} } = await ext.storage.local.get("tokens");
  return tokens[accountKey(account)] ?? null;
}

async function saveTokens(account, value) {
  const { tokens = {} } = await ext.storage.local.get("tokens");
  if (value) tokens[accountKey(account)] = value;
  else delete tokens[accountKey(account)];
  await ext.storage.local.set({ tokens });
}

function tokensFrom(tok, updatedAt) {
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
    updatedAt,
  };
}

async function apiRequest(path, body, accessToken) {
  await rulesReady;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-client-name": CLIENT_ID,
    "x-client-version": CLIENT_VERSION,
    "x-application": "AHWEBSHOP",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const resp = await fetch(API + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "omit",
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`AH gaf ${resp.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    err.status = resp.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

async function apiGet(path, accessToken) {
  await rulesReady;
  const resp = await fetch(API + path, {
    headers: {
      Accept: "application/json",
      "x-client-name": CLIENT_ID,
      "x-client-version": CLIENT_VERSION,
      "x-application": "AHWEBSHOP",
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "omit",
  });
  if (!resp.ok) {
    const err = new Error(`AH gaf ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// Productinformatie is openbaar: een anoniem token volstaat, dus geen login nodig.
let anonToken = null;
async function anonymousToken(forceNew = false) {
  if (!anonToken || forceNew || anonToken.expires_at - 60_000 < Date.now()) {
    const tok = await apiRequest("/mobile-auth/v1/auth/token/anonymous", { clientId: "appie" });
    anonToken = { value: tok.access_token, expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000 };
  }
  return anonToken.value;
}

/**
 * AH's eigen categorie voor een product van de bon. Het id op de bon is AH's
 * interne "hqId"; daar is geen directe opzoeking voor, dus zoeken we op de
 * (afgekapte) bonnaam en nemen het resultaat met precies dat hqId. Lukt bij
 * zo'n 2 op de 3 producten; uit het assortiment verdwenen producten vallen af.
 */
async function productCategory(id, name) {
  const path = `/mobile-services/product/search/v2?sortOn=RELEVANCE&size=30&query=${encodeURIComponent(name)}`;
  let data;
  try {
    data = await apiGet(path, await anonymousToken());
  } catch (err) {
    if (err.status !== 401) throw err;
    data = await apiGet(path, await anonymousToken(true));
  }
  const match = (data.products ?? []).find((p) => String(p.hqId) === String(id));
  return { id: String(id), ahCategorie: match?.mainCategory ?? null, ahSubcategorie: match?.subCategory ?? null };
}

async function freshAccessToken(account) {
  const t = await loadTokens(account);
  if (!t) throw new NeedsLogin("Nog niet ingelogd.");
  if (t.expires_at && t.expires_at - 60_000 > Date.now()) return t.access_token;
  if (!t.refresh_token) return t.access_token;
  try {
    const tok = await apiRequest("/mobile-auth/v1/auth/token/refresh", {
      clientId: CLIENT_ID,
      refreshToken: t.refresh_token,
    });
    await saveTokens(account, tokensFrom(tok, t.updatedAt));
    return tok.access_token;
  } catch (err) {
    if (err.status === 400 || err.status === 401) throw new NeedsLogin("De AH-sessie is verlopen.");
    throw err;
  }
}

async function graphql(token, query, variables) {
  let resp;
  try {
    resp = await apiRequest("/graphql", { query, variables }, token);
  } catch (err) {
    if (err.status === 401) throw new NeedsLogin("AH weigert het token.");
    throw err;
  }
  if (resp.errors?.length) throw new Error(`GraphQL-fout: ${resp.errors[0].message}`);
  return resp.data;
}

const RECEIPTS_QUERY = `
query FetchPosReceipts($offset: Int!, $limit: Int!) {
  posReceiptsPage(pagination: {offset: $offset, limit: $limit}) {
    posReceipts { id dateTime totalAmount { amount } }
  }
}`;

const RECEIPT_DETAILS_QUERY = `
query FetchReceipt($id: String!) {
  posReceiptDetails(id: $id) {
    id
    products { id quantity name price { amount } amount { amount } }
    discounts { name amount { amount } }
    payments { method amount { amount } }
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- inloggen ----------------------------------------------------------------------
// De pending login staat in storage.session: de service worker kan tijdens het
// intypen van het wachtwoord gestopt worden en daarna opnieuw opstarten.

async function getPending() {
  const { pendingLogin = null } = await ext.storage.session.get("pendingLogin");
  return pendingLogin;
}
const setPending = (pendingLogin) => ext.storage.session.set({ pendingLogin });

// Op de computer een los venster; Firefox op Android kent geen vensters, daar
// wordt het een tabblad en gaan we na het inloggen terug naar het dashboard.
async function closeLogin(pending) {
  if (pending?.windowId) await ext.windows.remove(pending.windowId).catch(() => {});
  if (pending?.tabId) await ext.tabs.remove(pending.tabId).catch(() => {});
  if (pending?.returnTabId) await ext.tabs.update(pending.returnTabId, { active: true }).catch(() => {});
}

async function startLogin(account, returnTabId) {
  const old = await getPending();
  await setPending(null); // anders telt het sluiten van het oude venster als "zelf gesloten"
  if (old) await closeLogin({ ...old, returnTabId: null });
  if (ext.windows) {
    const win = await ext.windows.create({ url: LOGIN_URL, type: "popup", width: 480, height: 760 });
    await setPending({ account, windowId: win.id, error: null });
  } else {
    const tab = await ext.tabs.create({ url: LOGIN_URL, active: true });
    await setPending({ account, tabId: tab.id, returnTabId: returnTabId ?? null, error: null });
  }
  log("login gestart voor", accountKey(account));
}

const handledCodes = new Set();

async function handleCode(code, source) {
  if (!code || handledCodes.has(code)) return;
  handledCodes.add(code);
  const pending = await getPending();
  if (!pending) {
    log("code ontvangen zonder lopende login; genegeerd", source);
    return;
  }
  log("code ontvangen via", source);
  try {
    const tok = await apiRequest("/mobile-auth/v1/auth/token", { clientId: CLIENT_ID, code });
    await saveTokens(pending.account, tokensFrom(tok, Date.now()));
    await setPending(null);
    await closeLogin(pending);
    log("ingelogd voor", accountKey(pending.account));
  } catch (err) {
    log("code omwisselen mislukt", err);
    await setPending({ ...pending, error: `Inloggen mislukt: ${err.message}` });
  }
}

const codeFromUrl = (url) => {
  try {
    return new URL(url.replace(/^appie:\/\//, "https://appie/")).searchParams.get("code");
  } catch {
    return null;
  }
};

// 1) Server-redirect naar appie://login-exit?code=...
ext.webRequest.onBeforeRedirect.addListener(
  (d) => {
    if (d.redirectUrl?.startsWith("appie://")) handleCode(codeFromUrl(d.redirectUrl), "redirect");
  },
  { urls: ["https://login.ah.nl/*"] },
);
// 2) Navigatie naar het herschreven callback-adres.
ext.webRequest.onBeforeRequest.addListener(
  (d) => handleCode(codeFromUrl(d.url), "callback"),
  { urls: [`${CALLBACK_PREFIX}*`] },
);

// Venster of tabblad zelf gesloten: login afgebroken.
ext.windows?.onRemoved.addListener(async (windowId) => {
  const pending = await getPending();
  if (pending?.windowId === windowId && !pending.error) await setPending(null);
});
ext.tabs.onRemoved.addListener(async (tabId) => {
  const pending = await getPending();
  if (pending?.tabId === tabId && !pending.error) await setPending(null);
});

// --- berichten van het dashboard (via dashboard-bridge.js) en de loginpagina --------

async function status(account) {
  const t = await loadTokens(account);
  const pending = await getPending();
  const mine = pending && accountKey(pending.account) === accountKey(account);
  return {
    loggedIn: !!t,
    updatedAt: t?.updatedAt ?? null,
    loginPending: !!mine,
    loginError: mine ? pending.error : null,
    hostAccess: await hasHostAccess(),
  };
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) =>
    p.then(
      (result) => sendResponse({ ok: true, result }),
      (err) => sendResponse({ ok: false, error: err.message }),
    );
  switch (msg?.type) {
    case "ah-code": // van ah-login-relay.js
      handleCode(msg.code, msg.via || "page");
      return false;
    case "ping":
      sendResponse({ ok: true, result: { version: ext.runtime.getManifest().version } });
      return false;
    case "status":
      reply(status(msg.account));
      return true;
    case "login":
      reply(startLogin(msg.account, sender.tab?.id));
      return true;
    case "grant": // toestemmingspagina openen; permissions.request mag alleen na een klik in de extensie zelf
      reply(ext.tabs.create({ url: ext.runtime.getURL("grant.html"), active: true }).then(() => {}));
      return true;
    case "logout":
      reply(saveTokens(msg.account, null));
      return true;
    default:
      return false;
  }
});

// AH-productcategorieën ophalen via een port, met voortgang per product.
ext.runtime.onConnect.addListener((port) => {
  if (port.name !== "products") return;
  let open = true;
  port.onDisconnect.addListener(() => (open = false));
  port.onMessage.addListener(async ({ items = [] }) => {
    const emit = (ev) => open && port.postMessage(ev);
    try {
      for (const { id, name } of items.slice(0, 2000)) {
        if (!open) return;
        if (!id || !name) continue;
        emit({ type: "product", data: await productCategory(id, String(name)) });
        await sleep(250); // rate limit
      }
      emit({ type: "done" });
    } catch (err) {
      emit({ type: "error", message: err.message });
    }
  });
});

// Bonnetjes ophalen via een port, zodat voortgang per bon doorgegeven kan worden.
ext.runtime.onConnect.addListener((port) => {
  if (port.name !== "fetch") return;
  let open = true;
  port.onDisconnect.addListener(() => (open = false));
  port.onMessage.addListener(async ({ account, knownIds = [] }) => {
    const emit = (ev) => open && port.postMessage(ev);
    try {
      const known = new Set(knownIds.map(String));
      let token = await freshAccessToken(account);
      const all = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const data = await graphql(token, RECEIPTS_QUERY, { offset, limit: PAGE_SIZE });
        const page = data.posReceiptsPage.posReceipts;
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
        await sleep(300);
      }
      const fresh = all.filter((r) => !known.has(r.id));
      emit({ type: "total", n: fresh.length, all: all.length });
      for (const r of fresh) {
        if (!open) return;
        token = await freshAccessToken(account); // lange runs: token kan tussendoor verlopen
        const d = (await graphql(token, RECEIPT_DETAILS_QUERY, { id: r.id })).posReceiptDetails;
        emit({
          type: "receipt",
          // Zelfde vorm als fetch_receipts.py / ah_bridge.py (zie web/src/lib/jsonParser.ts).
          data: {
            id: r.id,
            dateTime: r.dateTime,
            totalAmount: r.totalAmount.amount,
            products: d.products ?? [],
            discounts: d.discounts ?? [],
            payments: d.payments ?? [],
          },
        });
        await sleep(500); // rate limit, net als het Python-script
      }
      emit({ type: "done" });
    } catch (err) {
      emit({ type: "error", message: err.message, needsLogin: err instanceof NeedsLogin });
    }
  });
});
