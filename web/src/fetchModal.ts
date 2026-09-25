// "Ophalen bij supermarkt": pop-up die via de browser-extensie (of, voor
// ontwikkelaars, de lokale ah_bridge.py) inlogt bij AH, nieuwe bonnetjes
// downloadt en ze via dezelfde importroute als een JSON-upload inleest.
// Voorlopig alleen AH; Lidl blijft via screenshots.

import { NeedsLoginError } from "./lib/ahBridge";
import { detectConnector, type Connector } from "./lib/connectors";
import { parseJsonReceipts } from "./lib/jsonParser";
import type { AccountData } from "./lib/types";
import { showSnackbar } from "./lib/snackbar";

interface FetchModalDeps {
  getAccounts(): AccountData[];
  /** Imports parsed JSON receipts into the named account and returns the result message. */
  importJson(account: string, parsed: ReturnType<typeof parseJsonReceipts>): Promise<string>;
}

const EXTENSION_HELP_URL = "https://github.com/corvanessen/AH-bonnetjes-inzicht#browser-extensie-installeren";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type ConnState = "checking" | "noaccount" | "noconnector" | "loggedout" | "loggedin";

export function initFetchModal(deps: FetchModalDeps): { open(): void; close(): void; isOpen(): boolean } {
  const overlay = el<HTMLElement>("fetchOverlay");
  const closeBtn = el<HTMLButtonElement>("fetchCloseBtn");
  const accountInput = el<HTMLInputElement>("fetchAccountName");
  const connStatus = el<HTMLElement>("fetchConnStatus");
  const retryBtn = el<HTMLButtonElement>("fetchRetryBtn");
  const loginBtn = el<HTMLButtonElement>("fetchLoginBtn");
  const logoutBtn = el<HTMLButtonElement>("fetchLogoutBtn");
  const startBtn = el<HTMLButtonElement>("fetchStartBtn");
  const progress = el<HTMLProgressElement>("fetchProgress");
  const progressText = el<HTMLElement>("fetchProgressText");

  let connector: Connector | null = null;
  let busy = false;
  let loggedIn = false;
  let statusSeq = 0;

  /** The name as stored in the dashboard (existing accounts matched case-insensitively). */
  function accountName(): string {
    const typed = accountInput.value.trim();
    const existing = deps.getAccounts().find((a) => a.account.toLowerCase() === typed.toLowerCase());
    return existing?.account ?? typed;
  }

  function setConn(state: ConnState, message?: string): void {
    loggedIn = state === "loggedin";
    connStatus.textContent = "";
    if (state === "noconnector") {
      connStatus.append(
        "Om bonnetjes direct bij AH op te halen heb je de browser-extensie “AH Bonnetjes ophalen” nodig. ",
        Object.assign(document.createElement("a"), {
          href: EXTENSION_HELP_URL,
          target: "_blank",
          rel: "noopener",
          textContent: "Zo installeer je hem",
        }),
        ". Herlaad daarna deze pagina.",
      );
    } else {
      connStatus.textContent = {
        checking: "Verbinding controleren…",
        noaccount: "Vul eerst een accountnaam in.",
        loggedout: "Nog niet ingelogd bij AH voor dit account.",
        loggedin: "Ingelogd bij AH ✓",
      }[state];
    }
    if (message) connStatus.append(" ", message);
    retryBtn.hidden = state !== "noconnector";
    loginBtn.hidden = state !== "loggedout";
    logoutBtn.hidden = state !== "loggedin";
    startBtn.disabled = busy || !loggedIn;
  }

  async function checkStatus(): Promise<void> {
    const seq = ++statusSeq;
    setConn("checking");
    connector ??= await detectConnector();
    if (seq !== statusSeq) return;
    if (!connector) return setConn("noconnector");
    const account = accountName();
    if (!account) return setConn("noaccount");
    try {
      const status = await connector.getStatus(account);
      if (seq !== statusSeq) return; // account changed meanwhile
      setConn(status.loggedIn ? "loggedin" : "loggedout");
    } catch (err) {
      if (seq !== statusSeq) return;
      connector = null; // extensie/helper weg: bij de volgende controle opnieuw zoeken
      setConn("noconnector", (err as Error).message);
    }
  }

  async function login(): Promise<void> {
    if (!connector) return;
    loginBtn.disabled = true;
    connStatus.textContent = "Log in bij AH in het geopende venster…";
    try {
      await connector.openLogin(accountName());
      setConn("loggedin");
    } catch (err) {
      setConn("loggedout", (err as Error).message);
    } finally {
      loginBtn.disabled = false;
    }
  }

  async function start(): Promise<void> {
    const account = accountName();
    if (!account || busy || !connector) return;
    busy = true;
    startBtn.disabled = true;
    accountInput.disabled = true;
    progress.hidden = false;
    progress.removeAttribute("value"); // indeterminate while the list is fetched
    progressText.textContent = "Bonnetjeslijst ophalen bij AH…";

    const existing = deps.getAccounts().find((a) => a.account === account);
    const prefix = `${account}__`;
    const knownIds = (existing?.bonnen ?? []).map((b) => (b.bon_id.startsWith(prefix) ? b.bon_id.slice(prefix.length) : b.bon_id));

    try {
      const { receipts, error } = await connector.fetchReceipts(account, knownIds, (done, total) => {
        progress.max = Math.max(total, 1);
        progress.value = done;
        progressText.textContent = total ? `Bonnetjes downloaden… ${done} / ${total}` : "Geen nieuwe bonnetjes gevonden.";
      });

      if (receipts.length === 0) {
        progressText.textContent = error ? `Ophalen mislukt: ${error}` : "Geen nieuwe bonnetjes: alles staat er al in.";
        if (!error) showSnackbar(`Geen nieuwe AH-bonnetjes voor '${account}'.`);
        return;
      }

      progressText.textContent = `${receipts.length} bonnetjes inlezen…`;
      const parsed = parseJsonReceipts(receipts.map((data, i) => ({ name: `ah-api-${i + 1}.json`, data })));
      const message = await deps.importJson(account, parsed);
      const full = error ? `${message} Ophalen stopte halverwege: ${error}` : message;
      showSnackbar(full, { error: !!error });
      if (error) {
        progressText.textContent = full;
      } else {
        busy = false;
        close();
      }
    } catch (err) {
      if (err instanceof NeedsLoginError) {
        progressText.textContent = "";
        setConn("loggedout", "De AH-sessie is verlopen; log opnieuw in.");
      } else {
        progressText.textContent = `Ophalen mislukt: ${(err as Error).message}`;
      }
    } finally {
      busy = false;
      accountInput.disabled = false;
      progress.hidden = true;
      startBtn.disabled = !loggedIn;
    }
  }

  function open(): void {
    const accounts = deps.getAccounts();
    if (!accountInput.value && accounts.length === 1) accountInput.value = accounts[0].account;
    progress.hidden = true;
    progressText.textContent = "";
    overlay.hidden = false;
    (accountInput.value ? closeBtn : accountInput).focus();
    void checkStatus();
  }

  function close(): void {
    if (busy) return; // don't lose track of a running download
    overlay.hidden = true;
  }

  let debounce: number | undefined;
  accountInput.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(checkStatus, 350);
  });
  retryBtn.addEventListener("click", () => void checkStatus());
  loginBtn.addEventListener("click", () => void login());
  logoutBtn.addEventListener("click", async () => {
    await connector?.logout(accountName()).catch(() => {});
    void checkStatus();
  });
  startBtn.addEventListener("click", () => void start());
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });

  return { open, close, isOpen: () => !overlay.hidden };
}
