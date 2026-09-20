import { buildDashboardData } from "./lib/buildDashboardData";
import * as db from "./lib/db";
import { enrichAccount, recategorize } from "./lib/enrich";
import { parseJsonReceipts } from "./lib/jsonParser";
import type { AccountData, DashboardData } from "./lib/types";
// dashboard.js is the ported dashboard.html rendering code — see that file's
// top comment. It only knows how to render a DashboardData object and ask a
// "store" to persist category edits; loading data and wiring the upload UI
// is this module's job.
import { initDashboard, setStore } from "./dashboard.js";

const uploadPanel = document.getElementById("uploadPanel") as HTMLElement;
const dashboardContent = document.getElementById("dashboardContent") as HTMLElement;
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

let accounts: AccountData[] = [];

async function refresh(): Promise<void> {
  accounts = await db.getAllAccounts();

  if (accounts.length === 0) {
    dashboardContent.hidden = true;
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

  const data = await buildData();
  dashboardContent.hidden = false;
  uploadPanel.hidden = true;
  initDashboard(data);
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

uploadForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const account = uploadAccountName.value.trim();
  const fileList = uploadFiles.files;
  if (!account || !fileList || fileList.length === 0) return;

  uploadStatus.textContent = `${fileList.length} bestand(en) inlezen…`;
  try {
    const files = await Promise.all(
      Array.from(fileList).map(async (f) => ({ name: f.name, data: JSON.parse(await f.text()) })),
    );
    const { bonnen, artikelen, warnings } = parseJsonReceipts(files);
    const [overrides, subOverrides] = await Promise.all([db.getOverrides(), db.getSubOverrides()]);
    const enriched = enrichAccount(account, bonnen, artikelen, overrides, subOverrides);

    await db.saveAccount({
      account,
      bonnen: enriched.bonnen,
      artikelen: enriched.artikelen,
      importedAt: new Date().toISOString(),
    });

    uploadStatus.textContent =
      `${enriched.bonnen.length} bonnetjes geimporteerd voor '${account}'.` +
      (warnings.length ? ` (${warnings.length} bestand(en) overgeslagen, zie console.)` : "");
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
    const backup = JSON.parse(await file.text());
    await db.importBackup(backup);
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

refresh();
