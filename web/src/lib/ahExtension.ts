// Client voor de browser-extensie "AH Bonnetjes ophalen" (map extension/).
// De extensie praat namens het dashboard met de AH-API — iets wat een gewone
// pagina niet mag — en bewaart de AH-tokens zelf. Het dashboard praat ermee via
// window.postMessage; het content script van de extensie (dashboard-bridge.js)
// geeft dat door.

import { NeedsLoginError, type BridgeStatus, type FetchEvent } from "./ahBridge";

interface ExtStatus extends BridgeStatus {
  loginPending: boolean;
  loginError: string | null;
}

let seq = 0;
const handlers = new Map<number, (msg: { ok?: boolean; result?: unknown; error?: string; event?: FetchEvent | { type: "closed" } }) => void>();

window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const msg = e.data;
  if (msg?.source !== "ah-bonnetjes-ext" || typeof msg.id !== "number") return;
  handlers.get(msg.id)?.(msg);
});

function post(type: string, extra: Record<string, unknown> = {}): number {
  const id = ++seq;
  window.postMessage({ source: "ah-bonnetjes-page", id, type, ...extra }, window.location.origin);
  return id;
}

function call<T>(type: string, account = "", timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = post(type, { account });
    const timer = window.setTimeout(() => {
      handlers.delete(id);
      reject(new Error("De extensie reageert niet."));
    }, timeoutMs);
    handlers.set(id, (msg) => {
      window.clearTimeout(timer);
      handlers.delete(id);
      if (msg.ok) resolve(msg.result as T);
      else reject(new Error(msg.error || "Onbekende fout in de extensie."));
    });
  });
}

/** Is de extensie geïnstalleerd (en actief op deze pagina)? */
export async function isInstalled(): Promise<boolean> {
  try {
    await call("ping", "", 500);
    return true;
  } catch {
    return false;
  }
}

export const getStatus = (account: string) => call<ExtStatus>("status", account);

export const logout = (account: string) => call<void>("logout", account);

/** Opent het AH-loginvenster (beheerd door de extensie) en wacht tot het inloggen gelukt is. */
export async function openLogin(account: string): Promise<void> {
  const before = (await getStatus(account)).updatedAt;
  await call("login", account);
  const until = Date.now() + 10 * 60 * 1000;
  // Pollen i.p.v. op één antwoord wachten: de service worker van de extensie kan
  // tijdens het intypen van het wachtwoord herstarten.
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1200));
    const s = await getStatus(account);
    if (s.loggedIn && s.updatedAt !== before) return;
    if (s.loginError) throw new Error(s.loginError);
    if (!s.loginPending) throw new Error("Inlogvenster gesloten.");
  }
  throw new Error("Inloggen duurde te lang.");
}

export function fetchReceipts(
  account: string,
  knownIds: string[],
  onProgress: (done: number, total: number) => void,
): Promise<{ receipts: unknown[]; error?: string }> {
  return new Promise((resolve, reject) => {
    const receipts: unknown[] = [];
    let total = 0;
    const id = post("fetch", { account, knownIds });
    handlers.set(id, ({ event }) => {
      if (!event) return;
      if (event.type === "total") {
        total = event.n;
        onProgress(0, total);
      } else if (event.type === "receipt") {
        receipts.push(event.data);
        onProgress(receipts.length, total);
      } else {
        handlers.delete(id);
        if (event.type === "error" && event.needsLogin) reject(new NeedsLoginError(event.message));
        else if (event.type === "error") resolve({ receipts, error: event.message });
        else if (event.type === "closed" && total > receipts.length) resolve({ receipts, error: "verbinding met de extensie verbroken" });
        else resolve({ receipts });
      }
    });
  });
}

export interface AhProductInfo {
  id: string;
  ahCategorie: string | null;
  ahSubcategorie: string | null;
}

/**
 * Vraagt via de extensie AH's eigen categorie op voor producten van de bon
 * (id = hqId op de bon, naam = bonomschrijving). Geen AH-login nodig.
 */
export function fetchProductCategories(
  items: { id: string; name: string }[],
  onProduct: (info: AhProductInfo, done: number) => void,
): Promise<{ error?: string }> {
  return new Promise((resolve) => {
    let done = 0;
    const id = post("products", { items });
    // Een oudere extensie (< 0.2.0) kent dit bericht niet en antwoordt nooit.
    let timer = 0;
    const wacht = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        handlers.delete(id);
        resolve({ error: "geen antwoord van de extensie — werk de extensie bij naar versie 0.2.0 of nieuwer" });
      }, 20000);
    };
    wacht();
    handlers.set(id, ({ event }) => {
      if (!event) return;
      wacht();
      const ev = event as { type: string; data?: AhProductInfo; message?: string };
      if (ev.type === "product" && ev.data) {
        onProduct(ev.data, ++done);
      } else if (ev.type !== "product") {
        window.clearTimeout(timer);
        handlers.delete(id);
        if (ev.type === "error") resolve({ error: ev.message });
        else if (ev.type === "closed" && done < items.length) resolve({ error: "verbinding met de extensie verbroken" });
        else resolve({});
      }
    });
  });
}
