import { buildDashboardData } from "./lib/buildDashboardData";
import * as db from "./lib/db";
import { enrichAccount, recategorize, type CategorieContext } from "./lib/enrich";
import { vertaalAh } from "./lib/ahTaxonomie";
import type { GebruikersRegel } from "./lib/categorize";
import { parseJsonReceipts } from "./lib/jsonParser";
import { parseReceiptImages } from "./lib/ocr";
import { parsePdfReceipts } from "./lib/pdfParser";
import type { AccountData, Artikel, Bon, DashboardData } from "./lib/types";
import { showSnackbar } from "./lib/snackbar";
import { sanitizeAccountData } from "./lib/validate";
// dashboard.js is the ported dashboard.html rendering code — see that file's
// top comment. It only knows how to render a DashboardData object and ask a
// "store" to persist category edits; loading data and wiring the upload UI
// is this module's job.
import { initDashboard, setStore } from "./dashboard.js";
import { initFetchModal } from "./fetchModal";
import { initCategoriePanels } from "./categoriePanels";

const uploadPanel = document.getElementById("uploadPanel") as HTMLElement;
const dashboardContent = document.getElementById("dashboardContent") as HTMLElement;
const renderErrorPanel = document.getElementById("renderErrorPanel") as HTMLElement;
const renderErrorDetail = document.getElementById("renderErrorDetail") as HTMLElement;
const dataToolbar = document.getElementById("dataToolbar") as HTMLElement;
const accountTagsHost = document.getElementById("accountTags") as HTMLElement;
const uploadForm = document.getElementById("uploadForm") as HTMLFormElement;
const uploadAccountName = document.getElementById("uploadAccountName") as HTMLInputElement;
const uploadFiles = document.getElementById("uploadFiles") as HTMLInputElement;
const uploadStatus = document.getElementById("uploadStatus") as HTMLElement;
const cancelUploadBtn = document.getElementById("cancelUploadBtn") as HTMLButtonElement;
const uploadTitle = document.getElementById("uploadTitle") as HTMLElement;
const uploadMergeHint = document.getElementById("uploadMergeHint") as HTMLElement;
const accountNameList = document.getElementById("accountNameList") as HTMLDataListElement;
const menuBtn = document.getElementById("menuBtn") as HTMLButtonElement;
const actionMenu = document.getElementById("actionMenu") as HTMLElement;
const fetchStoreBtn = document.getElementById("fetchStoreBtn") as HTMLButtonElement;
const uploadFetchLink = document.getElementById("uploadFetchLink") as HTMLButtonElement;
const addReceiptsBtn =document.getElementById("addReceiptsBtn") as HTMLButtonElement;
const addAccountBtn = document.getElementById("addAccountBtn") as HTMLButtonElement;
const recategorizeBtn = document.getElementById("recategorizeBtn") as HTMLButtonElement;
const exportBackupBtn = document.getElementById("exportBackupBtn") as HTMLButtonElement;
const importBackupBtn = document.getElementById("importBackupBtn") as HTMLButtonElement;
const importBackupInput = document.getElementById("importBackupInput") as HTMLInputElement;
const clearAllBtn = document.getElementById("clearAllBtn") as HTMLButtonElement;
const reviewBtn = document.getElementById("reviewBtn") as HTMLButtonElement;
const rulesBtn = document.getElementById("rulesBtn") as HTMLButtonElement;
const helpBtn = document.getElementById("helpBtn") as HTMLButtonElement;
const helpOverlay = document.getElementById("helpOverlay") as HTMLElement;
const helpCloseBtn = document.getElementById("helpCloseBtn") as HTMLButtonElement;

// Cheap insurance against a mis-selected folder hanging the tab on hundreds
// of files, or one huge (accidentally wrong) file.
const MAX_UPLOAD_FILES = 300;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

let accounts: AccountData[] = [];

async function refresh(): Promise<void> {
  accounts = await db.getAllAccounts();

  const hasData = accounts.length > 0;
  if (hasData) void db.requestPersistentStorage();
  actionMenu.querySelectorAll<HTMLElement>("[data-needs-data]").forEach((el) => {
    el.hidden = !hasData;
  });
  accountNameList.innerHTML = "";
  accounts.forEach((a) => {
    const option = document.createElement("option");
    option.value = a.account;
    accountNameList.appendChild(option);
  });
  uploadMergeHint.hidden = !hasData;

  if (!hasData) {
    dashboardContent.hidden = true;
    renderErrorPanel.hidden = true;
    dataToolbar.hidden = true;
    uploadPanel.hidden = false;
    uploadTitle.textContent = "Bonnetjes importeren";
    cancelUploadBtn.hidden = true;
    return;
  }

  dataToolbar.hidden = false;
  accountTagsHost.innerHTML = "";
  accounts.forEach((a) => {
    const tag = document.createElement("span");
    tag.className = "account-tag";
    const label = document.createElement("span");
    label.textContent = a.account;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.title = `${a.account} verwijderen`;
    removeBtn.addEventListener("click", async () => {
      if (!window.confirm(`Data van '${a.account}' verwijderen?`)) return;
      await db.deleteAccount(a.account);
      await refresh();
      showSnackbar(`Account '${a.account}' verwijderd.`);
    });
    tag.appendChild(label);
    tag.appendChild(removeBtn);
    accountTagsHost.appendChild(tag);
  });

  // Data that reached IndexedDB should already be sanitized (see validate.ts),
  // but this is the last line of defense against a bad row crashing the page
  // outright — show a recoverable error state instead of a blank screen.
  try {
    panels.verversCache(await laadContext());
    const data = await buildData();
    dashboardContent.hidden = false;
    renderErrorPanel.hidden = true;
    uploadPanel.hidden = true;
    initDashboard(data);
  } catch (err) {
    console.error("Kon het dashboard niet opbouwen:", err);
    dashboardContent.hidden = true;
    uploadPanel.hidden = true;
    renderErrorPanel.hidden = false;
    renderErrorDetail.textContent = `Foutmelding: ${(err as Error).message}`;
  }
}

async function buildData(): Promise<DashboardData> {
  return buildDashboardData(accounts);
}

/** Alles wat de indeling bepaalt: correcties, eigen regels en (vertaalde) AH-categorieën. */
async function laadContext(): Promise<CategorieContext> {
  const [overrides, subOverrides, regels, ahRijen] = await Promise.all([
    db.getOverrides(),
    db.getSubOverrides(),
    db.getRegels(),
    db.getAhProducten(),
  ]);
  const ahProducten: CategorieContext["ahProducten"] = {};
  for (const rij of ahRijen) {
    const vertaald = vertaalAh(rij.ahCategorie, rij.ahSubcategorie);
    if (vertaald) ahProducten[rij.product_id] = vertaald;
  }
  return { overrides, subOverrides, regels, ahProducten };
}

const panels = initCategoriePanels({
  getAccounts: () => accounts,
  laadContext,
  async naWijziging() {
    await recategorizeAllAndRebuild();
    await refresh();
  },
});

setStore({
  async saveCategoryOverride(omschrijving: string, categorie: string): Promise<DashboardData> {
    await db.setOverride(omschrijving, categorie);
    return recategorizeAllAndRebuild();
  },
  async saveSubcategoryOverride(omschrijving: string, subcategorie: string): Promise<DashboardData> {
    await db.setSubOverride(omschrijving, subcategorie);
    return recategorizeAllAndRebuild();
  },
  // Voor de tooltip "waarom staat dit hier?" en de snelactie "regel maken" in dashboard.js.
  uitleg: (omschrijving: string, bedrag: number | null) => panels.uitleg(omschrijving, bedrag),
  maakRegel: (omschrijving: string, categorie: string) => panels.openRegelFormulier(omschrijving, categorie),
});

async function recategorizeAllAndRebuild(): Promise<DashboardData> {
  const ctx = await laadContext();
  for (const account of accounts) {
    account.artikelen = recategorize(account.artikelen, ctx);
    await db.saveAccount(account);
  }
  panels.verversCache(ctx);
  return buildData();
}

/** Extension-based routing (local files rarely carry a reliable MIME type), with a cheap magic-byte sanity check. */
async function classifyFile(file: File): Promise<"json" | "pdf" | "image" | null> {
  const name = file.name.toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(name)) {
    const h = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const png = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
    const jpeg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
    const webp = String.fromCharCode(...h.slice(0, 4)) === "RIFF" && String.fromCharCode(...h.slice(8, 12)) === "WEBP";
    return png || jpeg || webp ? "image" : null;
  }
  if (name.endsWith(".pdf")) {
    const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const magic = String.fromCharCode(...header);
    return magic === "%PDF-" ? "pdf" : null;
  }
  if (name.endsWith(".json")) {
    const head = (await file.slice(0, 256).text()).trim();
    return head.startsWith("{") || head.startsWith("[") ? "json" : null;
  }
  return null;
}

/**
 * Strips the `${account}__` prefix enrichAccount() adds, so stored rows can be
 * fed back into enrichAccount() alongside a new upload — that way new PDFs
 * still replace an earlier JSON copy of the same receipt (and vice versa),
 * exactly as within a single upload.
 */
function unprefixed<T extends { bon_id: string }>(rows: T[], account: string): T[] {
  const prefix = `${account}__`;
  return rows.map((r) => (r.bon_id.startsWith(prefix) ? { ...r, bon_id: r.bon_id.slice(prefix.length) } : r));
}

uploadForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const typedName = uploadAccountName.value.trim();
  const fileList = uploadFiles.files;
  if (!typedName || !fileList || fileList.length === 0) return;

  if (fileList.length > MAX_UPLOAD_FILES) {
    uploadStatus.textContent = `Te veel bestanden in één keer (${fileList.length}, max ${MAX_UPLOAD_FILES}). Importeer in kleinere groepen.`;
    return;
  }
  const totalBytes = Array.from(fileList).reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    uploadStatus.textContent = `Bestanden samen te groot (${(totalBytes / 1024 / 1024).toFixed(1)} MB, max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB). Importeer in kleinere groepen.`;
    return;
  }

  uploadStatus.textContent = `${fileList.length} bestand(en) inlezen…`;
  const warnings: string[] = [];

  try {
    const jsonFiles: { name: string; data: unknown }[] = [];
    const pdfFiles: { name: string; data: ArrayBuffer }[] = [];
    const imageFiles: { name: string; data: Blob }[] = [];

    for (const file of Array.from(fileList)) {
      const kind = await classifyFile(file);
      if (kind === "json") {
        try {
          jsonFiles.push({ name: file.name, data: JSON.parse(await file.text()) });
        } catch {
          warnings.push(`kon ${file.name} niet verwerken: ongeldige JSON`);
        }
      } else if (kind === "pdf") {
        pdfFiles.push({ name: file.name, data: await file.arrayBuffer() });
      } else if (kind === "image") {
        imageFiles.push({ name: file.name, data: file });
      } else {
        warnings.push(`${file.name} overgeslagen: geen herkenbaar .json-, .pdf- of afbeeldingsbestand`);
      }
    }

    const jsonResult = parseJsonReceipts(jsonFiles);
    const pdfOnly = await parsePdfReceipts(pdfFiles);
    const ocrResult = await parseReceiptImages(imageFiles, (klaar, totaal) => {
      uploadStatus.textContent = `Bonnetjes uit afbeeldingen lezen (OCR)… ${klaar}/${totaal}`;
    });
    // OCR-bonnen lopen verder mee als "pdf-kant". Lidl heeft geen JSON-tegenhanger;
    // een gefotografeerde AH-bon wordt net als een PDF op (datum, totaal) tegen
    // de JSON-versie ontdubbeld.
    const pdfResult = {
      bonnen: [...pdfOnly.bonnen, ...ocrResult.bonnen],
      artikelen: [...pdfOnly.artikelen, ...ocrResult.artikelen],
    };
    warnings.push(...jsonResult.warnings, ...pdfOnly.warnings, ...ocrResult.warnings);

    const fullMessage = await importIntoAccount(typedName, jsonResult, pdfResult, warnings);
    uploadStatus.textContent = fullMessage;
    uploadForm.reset();
    await refresh();
    // The upload panel is hidden again once there is data, so repeat the
    // result where it's still seen.
    showSnackbar(fullMessage);
  } catch (err) {
    uploadStatus.textContent = `Importeren mislukt: ${(err as Error).message}`;
  }
});

type ParsedReceipts = { bonnen: Bon[]; artikelen: Artikel[] };

/**
 * Merges freshly parsed receipts into an account (creating it if needed) and
 * saves it. Shared by the file upload and the AH-API fetch. Returns the
 * user-facing result message; the caller refreshes the dashboard.
 */
async function importIntoAccount(
  typedName: string,
  jsonResult: ParsedReceipts,
  pdfResult: ParsedReceipts,
  warnings: string[],
): Promise<string> {
  // Adding to an existing account merges into it instead of replacing it
  // (saveAccount() overwrites by name). Match case-insensitively so "cor"
  // doesn't silently create a second account next to "Cor".
  const existing = accounts.find((a) => a.account.toLowerCase() === typedName.toLowerCase());
  const account = existing?.account ?? typedName;

  // Receipts already in the account are skipped up front: enrichAccount's
  // own bon_id dedup keeps the first bon but not only its artikelen, so a
  // re-uploaded receipt would otherwise get its lines counted twice.
  const oldBonnen = existing ? unprefixed(existing.bonnen, account) : [];
  const oldArtikelen = existing ? unprefixed(existing.artikelen, account) : [];
  // A PDF's bon_id is its filename, so the same receipt downloaded again as
  // "bon (1).pdf" is also caught by its exact timestamp + total.
  const oldBron = new Map(oldBonnen.map((b) => [b.bon_id, b.bron]));
  const oldMoments = new Set(oldBonnen.map((b) => `${b.datum}|${b.totaal}`));
  const newPdfBonnen = pdfResult.bonnen.filter((b) => !oldBron.has(b.bon_id) && !oldMoments.has(`${b.datum}|${b.totaal}`));
  const newJsonBonnen = jsonResult.bonnen.filter((b) => !oldBron.has(b.bon_id) && !oldMoments.has(`${b.datum}|${b.totaal}`));
  const keptNewIds = new Set([...newPdfBonnen, ...newJsonBonnen].map((b) => b.bon_id));
  const isNew = (r: { bon_id: string }) => keptNewIds.has(r.bon_id);
  const skipped = pdfResult.bonnen.length + jsonResult.bonnen.length - newPdfBonnen.length - newJsonBonnen.length;

  const ctx = await laadContext();
  const enriched = enrichAccount(
    account,
    // Old rows go first so they win enrichAccount's bon_id dedup.
    [...oldBonnen.filter((b) => b.bron !== "json"), ...newPdfBonnen],
    [...oldArtikelen.filter((a) => oldBron.get(a.bon_id) !== "json"), ...pdfResult.artikelen.filter(isNew)],
    [...oldBonnen.filter((b) => b.bron === "json"), ...newJsonBonnen],
    [...oldArtikelen.filter((a) => oldBron.get(a.bon_id) === "json"), ...jsonResult.artikelen.filter(isNew)],
    ctx,
  );
  warnings.push(...enriched.warnings);

  const sanitized = sanitizeAccountData({
    account,
    bonnen: enriched.bonnen,
    artikelen: enriched.artikelen,
    importedAt: new Date().toISOString(),
  });
  warnings.push(...sanitized.warnings);

  await db.saveAccount(sanitized.data);

  const message = existing
    ? `${Math.max(0, sanitized.data.bonnen.length - existing.bonnen.length)} bonnetje(s) toegevoegd aan '${account}'` +
      (skipped ? `, ${skipped} overgeslagen (zat er al in)` : "") +
      `. Totaal nu ${sanitized.data.bonnen.length}.`
    : `${sanitized.data.bonnen.length} bonnetjes geimporteerd voor '${account}'.`;
  if (warnings.length) console.warn(warnings.join("\n"));
  return message + (warnings.length ? ` (${warnings.length} melding(en), zie console.)` : "");
}

function openUpload(mode: "receipts" | "account"): void {
  uploadForm.reset();
  uploadStatus.textContent = "";
  uploadTitle.textContent = mode === "receipts" ? "Bonnetjes toevoegen" : "Account toevoegen";
  // With a single account there's only one sensible target, so skip the typing.
  if (mode === "receipts" && accounts.length === 1) uploadAccountName.value = accounts[0].account;
  uploadPanel.hidden = false;
  cancelUploadBtn.hidden = false;
  uploadPanel.scrollIntoView({ behavior: "smooth" });
  (uploadAccountName.value ? uploadFiles : uploadAccountName).focus({ preventScroll: true });
}

function openMenu(): void {
  actionMenu.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
  actionMenu.querySelector<HTMLButtonElement>("button:not([hidden])")?.focus();
}
function closeMenu(): void {
  actionMenu.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
}
menuBtn.addEventListener("click", () => (actionMenu.hidden ? openMenu() : closeMenu()));
// Every menu item closes the menu after running its own handler.
actionMenu.addEventListener("click", (ev) => {
  if ((ev.target as HTMLElement).closest("button")) closeMenu();
});
document.addEventListener("click", (ev) => {
  if (!actionMenu.hidden && !(ev.target as HTMLElement).closest(".menu-wrap")) closeMenu();
});
actionMenu.addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
  ev.preventDefault();
  const items = Array.from(actionMenu.querySelectorAll<HTMLButtonElement>("button:not([hidden])"));
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = ev.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[next]?.focus();
});

const fetchModal = initFetchModal({
  getAccounts: () => accounts,
  async importJson(account, parsed) {
    const message = await importIntoAccount(account, parsed, { bonnen: [], artikelen: [] }, [...parsed.warnings]);
    await refresh();
    return message;
  },
});
fetchStoreBtn.addEventListener("click", () => fetchModal.open());
uploadFetchLink.addEventListener("click", () => fetchModal.open());

addReceiptsBtn.addEventListener("click", () => openUpload("receipts"));
addAccountBtn.addEventListener("click", () => openUpload("account"));

cancelUploadBtn.addEventListener("click", () => {
  uploadPanel.hidden = true;
});

// Categorieën worden bij het importeren vastgelegd; nieuwe trefwoordregels
// (na een update van de app) gelden dus pas na deze bewuste herberekening.
// Eigen aanpassingen (overrides) gaan altijd voor, maar producten die op een
// trefwoordregel leunen kunnen verschuiven — daarom eerst tonen wat er verandert.
recategorizeBtn.addEventListener("click", async () => {
  const ctx = await laadContext();
  const herberekend = accounts.map((a) => recategorize(a.artikelen, ctx));

  const voorbeelden = new Map<string, string>();
  let aantal = 0;
  accounts.forEach((account, i) => {
    account.artikelen.forEach((oud, j) => {
      const nieuw = herberekend[i][j];
      if (oud.categorie === nieuw.categorie && oud.subcategorie === nieuw.subcategorie) return;
      aantal++;
      voorbeelden.set(oud.omschrijving, `${oud.categorie ?? "?"} → ${nieuw.categorie}${nieuw.subcategorie ? ` / ${nieuw.subcategorie}` : ""}`);
    });
  });

  if (aantal === 0) {
    showSnackbar("Alle categorieën zijn al up-to-date.");
    return;
  }

  const lijst = [...voorbeelden].slice(0, 8).map(([omschrijving, wijziging]) => `• ${omschrijving}: ${wijziging}`);
  if (voorbeelden.size > lijst.length) lijst.push(`• … en ${voorbeelden.size - lijst.length} andere product(en)`);
  const ok = window.confirm(
    `${aantal} artikelregel(s) (${voorbeelden.size} verschillende producten) krijgen een andere categorie:\n\n` +
      `${lijst.join("\n")}\n\n` +
      "Categorieën die je zelf hebt aangepast blijven behouden. Wil je terug kunnen, exporteer dan eerst een backup.\n\nDoorgaan?",
  );
  if (!ok) return;

  for (const [i, account] of accounts.entries()) {
    account.artikelen = herberekend[i];
    await db.saveAccount(account);
  }
  await refresh();
  showSnackbar(`${voorbeelden.size} product(en) opnieuw ingedeeld.`);
});

exportBackupBtn.addEventListener("click", async () => {
  const backup = await db.exportBackup();
  const naam = `boodschappenledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });

  // Op een telefoon is delen (naar Drive, mail, chat…) handiger dan een download
  // die ergens in een map verdwijnt; zo zet je ook een backup van je computer
  // over naar je telefoon of andersom.
  const bestand = new File([blob], naam, { type: "application/json" });
  const kanDelen = matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [bestand] });
  if (kanDelen) {
    try {
      await navigator.share({ files: [bestand], title: "Boodschappenledger-backup" });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // Delen mislukt om een andere reden: val terug op downloaden.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = naam;
  a.click();
  URL.revokeObjectURL(url);
  showSnackbar(`Backup gedownload als ${naam}.`);
});

importBackupBtn.addEventListener("click", () => importBackupInput.click());

importBackupInput.addEventListener("change", async () => {
  const file = importBackupInput.files?.[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text()) as {
      accounts?: AccountData[];
      overrides?: { omschrijving: string; waarde: string }[];
      subOverrides?: { omschrijving: string; waarde: string }[];
      regels?: unknown[];
      ahProducten?: unknown[];
    };

    const warnings: string[] = [];
    const sanitizedAccounts = (Array.isArray(backup.accounts) ? backup.accounts : []).map((account) => {
      const sanitized = sanitizeAccountData(account);
      warnings.push(...sanitized.warnings.map((w) => `${account?.account ?? "?"}: ${w}`));
      return sanitized.data;
    });

    await db.importBackup({
      accounts: sanitizedAccounts,
      overrides: schoneOverrides(backup.overrides),
      subOverrides: schoneOverrides(backup.subOverrides),
      regels: schoneRegels(backup.regels),
      ahProducten: schoneAhProducten(backup.ahProducten),
    });
    if (warnings.length) console.warn(warnings.join("\n"));
    accounts = await db.getAllAccounts();
    // Opnieuw indelen met de zojuist geïmporteerde correcties en regels; anders
    // blijven de categorieën staan zoals ze in de backup zaten.
    await recategorizeAllAndRebuild();
    await refresh();
    showSnackbar(
      `Backup geimporteerd (${sanitizedAccounts.length} account(s))` +
        (warnings.length ? `, met ${warnings.length} melding(en) — zie console.` : "."),
    );
  } catch (err) {
    showSnackbar(`Backup importeren mislukt: ${(err as Error).message}`, { error: true });
  } finally {
    importBackupInput.value = "";
  }
});

const isTekst = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

function schoneOverrides(rows: unknown): { omschrijving: string; waarde: string }[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => isTekst(r?.omschrijving) && isTekst(r?.waarde)).map((r) => ({ omschrijving: r.omschrijving, waarde: r.waarde }));
}

function schoneRegels(rows: unknown): GebruikersRegel[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => isTekst(r?.id) && isTekst(r?.trefwoord, 40) && isTekst(r?.categorie))
    .map((r) => ({
      id: r.id,
      trefwoord: String(r.trefwoord).toUpperCase(),
      categorie: r.categorie,
      subcategorie: isTekst(r.subcategorie) ? r.subcategorie : null,
    }));
}

function schoneAhProducten(rows: unknown): db.AhProductRow[] {
  if (!Array.isArray(rows)) return [];
  const ofNull = (v: unknown) => (isTekst(v) ? v : null);
  return rows
    .filter((r) => isTekst(r?.product_id, 32))
    .map((r) => ({ product_id: r.product_id, ahCategorie: ofNull(r.ahCategorie), ahSubcategorie: ofNull(r.ahSubcategorie), opgehaald: String(r.opgehaald ?? "") }));
}

reviewBtn.addEventListener("click", () => panels.openBeoordelen());
rulesBtn.addEventListener("click", () => panels.openRegels());

clearAllBtn.addEventListener("click", async () => {
  if (!window.confirm("Alle geimporteerde bonnetjes en categorie-aanpassingen in deze browser wissen? Dit kan niet ongedaan worden gemaakt (tenzij je eerst een backup exporteert).")) return;
  await db.clearAll();
  await refresh();
  showSnackbar("Alle data gewist.");
});

function openHelp(): void {
  helpOverlay.hidden = false;
}
function closeHelp(): void {
  helpOverlay.hidden = true;
}
helpBtn.addEventListener("click", openHelp);
helpCloseBtn.addEventListener("click", closeHelp);
helpOverlay.addEventListener("click", (ev) => {
  if (ev.target === helpOverlay) closeHelp();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (!helpOverlay.hidden) closeHelp();
  if (fetchModal.isOpen()) fetchModal.close();
  panels.sluitAlles();
  if (!actionMenu.hidden) {
    closeMenu();
    menuBtn.focus();
  }
});

refresh();

// Installeerbaar + offline bruikbaar (zie public/sw.js). Niet in de dev-server,
// anders serveert de cache oude modules tijdens het ontwikkelen.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker niet geregistreerd:", err));
}
