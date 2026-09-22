import { buildDashboardData } from "./lib/buildDashboardData";
import * as db from "./lib/db";
import { enrichAccount, recategorize } from "./lib/enrich";
import { parseJsonReceipts } from "./lib/jsonParser";
import { parsePdfReceipts } from "./lib/pdfParser";
import type { AccountData, DashboardData } from "./lib/types";
import { sanitizeAccountData } from "./lib/validate";
// dashboard.js is the ported dashboard.html rendering code — see that file's
// top comment. It only knows how to render a DashboardData object and ask a
// "store" to persist category edits; loading data and wiring the upload UI
// is this module's job.
import { initDashboard, setStore } from "./dashboard.js";

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
const addAccountBtn = document.getElementById("addAccountBtn") as HTMLButtonElement;
const exportBackupBtn = document.getElementById("exportBackupBtn") as HTMLButtonElement;
const importBackupBtn = document.getElementById("importBackupBtn") as HTMLButtonElement;
const importBackupInput = document.getElementById("importBackupInput") as HTMLInputElement;
const clearAllBtn = document.getElementById("clearAllBtn") as HTMLButtonElement;
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

  if (accounts.length === 0) {
    dashboardContent.hidden = true;
    renderErrorPanel.hidden = true;
    dataToolbar.hidden = true;
    uploadPanel.hidden = false;
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
    });
    tag.appendChild(label);
    tag.appendChild(removeBtn);
    accountTagsHost.appendChild(tag);
  });

  // Data that reached IndexedDB should already be sanitized (see validate.ts),
  // but this is the last line of defense against a bad row crashing the page
  // outright — show a recoverable error state instead of a blank screen.
  try {
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

setStore({
  async saveCategoryOverride(omschrijving: string, categorie: string): Promise<DashboardData> {
    await db.setOverride(omschrijving, categorie);
    return recategorizeAllAndRebuild();
  },
  async saveSubcategoryOverride(omschrijving: string, subcategorie: string): Promise<DashboardData> {
    await db.setSubOverride(omschrijving, subcategorie);
    return recategorizeAllAndRebuild();
  },
});

async function recategorizeAllAndRebuild(): Promise<DashboardData> {
  const [overrides, subOverrides] = await Promise.all([db.getOverrides(), db.getSubOverrides()]);
  for (const account of accounts) {
    account.artikelen = recategorize(account.artikelen, overrides, subOverrides);
    await db.saveAccount(account);
  }
  return buildData();
}

/** Extension-based routing (local files rarely carry a reliable MIME type), with a cheap magic-byte sanity check. */
async function classifyFile(file: File): Promise<"json" | "pdf" | null> {
  const name = file.name.toLowerCase();
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

uploadForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const account = uploadAccountName.value.trim();
  const fileList = uploadFiles.files;
  if (!account || !fileList || fileList.length === 0) return;

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
      } else {
        warnings.push(`${file.name} overgeslagen: geen herkenbaar .json- of .pdf-kassabonbestand`);
      }
    }

    const jsonResult = parseJsonReceipts(jsonFiles);
    const pdfResult = await parsePdfReceipts(pdfFiles);
    warnings.push(...jsonResult.warnings, ...pdfResult.warnings);

    const [overrides, subOverrides] = await Promise.all([db.getOverrides(), db.getSubOverrides()]);
    const enriched = enrichAccount(
      account,
      pdfResult.bonnen,
      pdfResult.artikelen,
      jsonResult.bonnen,
      jsonResult.artikelen,
      overrides,
      subOverrides,
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

    uploadStatus.textContent =
      `${sanitized.data.bonnen.length} bonnetjes geimporteerd voor '${account}'.` +
      (warnings.length ? ` (${warnings.length} melding(en), zie console.)` : "");
    if (warnings.length) console.warn(warnings.join("\n"));

    uploadForm.reset();
    await refresh();
  } catch (err) {
    uploadStatus.textContent = `Importeren mislukt: ${(err as Error).message}`;
  }
});

addAccountBtn.addEventListener("click", () => {
  uploadPanel.hidden = false;
  cancelUploadBtn.hidden = false;
  uploadPanel.scrollIntoView({ behavior: "smooth" });
});

cancelUploadBtn.addEventListener("click", () => {
  uploadPanel.hidden = true;
});

exportBackupBtn.addEventListener("click", async () => {
  const backup = await db.exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `boodschappenledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
    };

    const warnings: string[] = [];
    const sanitizedAccounts = (Array.isArray(backup.accounts) ? backup.accounts : []).map((account) => {
      const sanitized = sanitizeAccountData(account);
      warnings.push(...sanitized.warnings.map((w) => `${account?.account ?? "?"}: ${w}`));
      return sanitized.data;
    });

    await db.importBackup({ ...backup, accounts: sanitizedAccounts });
    if (warnings.length) {
      console.warn(warnings.join("\n"));
      window.alert(`Backup geimporteerd, met ${warnings.length} melding(en) — zie console.`);
    }
    await refresh();
  } catch (err) {
    window.alert(`Backup importeren mislukt: ${(err as Error).message}`);
  } finally {
    importBackupInput.value = "";
  }
});

clearAllBtn.addEventListener("click", async () => {
  if (!window.confirm("Alle geimporteerde bonnetjes en categorie-aanpassingen in deze browser wissen? Dit kan niet ongedaan worden gemaakt (tenzij je eerst een backup exporteert).")) return;
  await db.clearAll();
  await refresh();
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
  if (ev.key === "Escape" && !helpOverlay.hidden) closeHelp();
});

refresh();
