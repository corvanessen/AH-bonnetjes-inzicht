// Client voor ah_bridge.py: de lokale ontwikkelhelper die namens het dashboard
// met de AH-API praat (voor gewone gebruikers doet de browser-extensie dit, zie
// ahExtension.ts). Direct vanuit de browser kan niet — api.ah.nl weigert
// cross-origin verzoeken en de login eindigt op een appie://-adres. De helper
// bewaart de tokens zelf; hier komen alleen bonnetjes (als JSON) langs.

export const BRIDGE_ORIGIN = "http://127.0.0.1:8765";
const BASE = `${BRIDGE_ORIGIN}/__bridge`;

export interface BridgeStatus {
  loggedIn: boolean;
  /** Wijzigt bij elke nieuwe login; zo herkennen we een geslaagde login ook als postMessage niet aankomt. */
  updatedAt: number | null;
}

export class BridgeUnavailableError extends Error {}
export class NeedsLoginError extends Error {}

export async function getStatus(account: string): Promise<BridgeStatus> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}/status?account=${encodeURIComponent(account)}`, { cache: "no-store" });
  } catch {
    throw new BridgeUnavailableError("De AH-helper (ah_bridge.py) is niet bereikbaar.");
  }
  if (!resp.ok) throw new Error(`AH-helper gaf status ${resp.status}`);
  return resp.json();
}

export async function logout(account: string): Promise<void> {
  await fetch(`${BASE}/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account }),
  });
}

/**
 * Opent de AH-login (via de helper-proxy) in een pop-up en resolvet zodra de
 * helper tokens heeft. Primair via postMessage van de callbackpagina; als
 * vangnet wordt /status gepold, want sommige pagina's verbreken window.opener.
 */
export function openLogin(account: string): Promise<void> {
  const params = new URLSearchParams({ account, origin: window.location.origin });
  const url = `${BASE}/login?${params}`;
  const popup = window.open(url, "ah-login", "popup,width=480,height=760");
  if (!popup) return Promise.reject(new Error("De pop-up werd geblokkeerd. Sta pop-ups toe voor deze site."));

  return new Promise((resolve, reject) => {
    let before: number | null | undefined;
    let closedChecks = 0;
    const finish = (err?: Error) => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      if (err) reject(err);
      else resolve();
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== BRIDGE_ORIGIN || ev.data?.type !== "ah-login") return;
      finish(ev.data.ok ? undefined : new Error("Inloggen mislukt."));
    };
    window.addEventListener("message", onMessage);
    getStatus(account).then((s) => (before = s.updatedAt), () => (before = null));

    const timer = window.setInterval(async () => {
      try {
        const s = await getStatus(account);
        if (before !== undefined && s.loggedIn && s.updatedAt !== before) return finish();
      } catch {
        /* helper even weg; blijf proberen */
      }
      // popup.closed kan door COOP onterecht true zijn, dus een paar rondes marge.
      if (popup.closed && ++closedChecks > 3) finish(new Error("Inlogvenster gesloten."));
    }, 1500);
  });
}

export type FetchEvent =
  | { type: "total"; n: number; all: number }
  | { type: "receipt"; data: unknown }
  | { type: "done" }
  | { type: "error"; message: string; needsLogin?: boolean };

/**
 * Haalt alle bonnetjes op die nog niet in knownIds zitten. De helper streamt
 * NDJSON, zodat we voortgang kunnen tonen. Bij een fout halverwege worden de
 * al ontvangen bonnetjes toch teruggegeven (error staat dan in het resultaat).
 */
export async function fetchReceipts(
  account: string,
  knownIds: string[],
  onProgress: (done: number, total: number) => void,
): Promise<{ receipts: unknown[]; error?: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, knownIds }),
    });
  } catch {
    throw new BridgeUnavailableError("De AH-helper (ah_bridge.py) is niet bereikbaar.");
  }
  if (!resp.ok || !resp.body) throw new Error(`AH-helper gaf status ${resp.status}`);

  const receipts: unknown[] = [];
  let total = 0;
  let error: string | undefined;
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  const handle = (line: string) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line) as FetchEvent;
    if (ev.type === "total") {
      total = ev.n;
      onProgress(0, total);
    } else if (ev.type === "receipt") {
      receipts.push(ev.data);
      onProgress(receipts.length, total);
    } else if (ev.type === "error") {
      if (ev.needsLogin) throw new NeedsLoginError(ev.message);
      error = ev.message;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);
  return { receipts, error };
}
