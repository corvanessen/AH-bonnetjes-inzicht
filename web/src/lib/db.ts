/**
 * IndexedDB persistence, scoped to this browser only — the replacement for
 * data/*.parquet and ah_receipts/*_overrides.csv. Nothing here ever leaves
 * the device; there is no server component.
 */
import { openDB, type IDBPDatabase } from "idb";
import defaultCategoryOverrides from "../data/categorie_overrides.json";
import defaultSubcategoryOverrides from "../data/subcategorie_overrides.json";
import type { AccountData } from "./types";

const DB_NAME = "bonnetjes";
const DB_VERSION = 1;

interface OverrideRow {
  omschrijving: string;
  waarde: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("accounts", { keyPath: "account" });
        const overrideStore = db.createObjectStore("overrides", { keyPath: "omschrijving" });
        const subOverrideStore = db.createObjectStore("subOverrides", { keyPath: "omschrijving" });

        // Seed with the (sub)category corrections manually built up in the
        // local dashboard over time (ah_receipts/*_overrides.csv), so the
        // web version starts from the same baseline instead of only the
        // REGELS/SUB_REGELS keyword rules. This only runs once, when the
        // database is first created — later edits are the user's own and
        // are never overwritten by this seed.
        for (const [omschrijving, categorie] of Object.entries(defaultCategoryOverrides)) {
          overrideStore.put({ omschrijving, waarde: categorie });
        }
        for (const [omschrijving, subcategorie] of Object.entries(defaultSubcategoryOverrides)) {
          subOverrideStore.put({ omschrijving, waarde: subcategorie });
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllAccounts(): Promise<AccountData[]> {
  const db = await getDb();
  return db.getAll("accounts");
}

export async function saveAccount(data: AccountData): Promise<void> {
  const db = await getDb();
  await db.put("accounts", data);
}

export async function deleteAccount(account: string): Promise<void> {
  const db = await getDb();
  await db.delete("accounts", account);
}

async function getOverrideMap(store: "overrides" | "subOverrides"): Promise<Record<string, string>> {
  const db = await getDb();
  const rows: OverrideRow[] = await db.getAll(store);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.omschrijving] = row.waarde;
  return map;
}

export const getOverrides = () => getOverrideMap("overrides");
export const getSubOverrides = () => getOverrideMap("subOverrides");

async function setOverrideValue(
  store: "overrides" | "subOverrides",
  omschrijving: string,
  waarde: string,
): Promise<void> {
  const db = await getDb();
  await db.put(store, { omschrijving, waarde });
}

export const setOverride = (omschrijving: string, categorie: string) =>
  setOverrideValue("overrides", omschrijving, categorie);
export const setSubOverride = (omschrijving: string, subcategorie: string) =>
  setOverrideValue("subOverrides", omschrijving, subcategorie);

/** Re-applies the shipped-in (sub)category corrections — see the `upgrade()` comment above. */
async function seedDefaultOverrides(db: IDBPDatabase): Promise<void> {
  const tx = db.transaction(["overrides", "subOverrides"], "readwrite");
  for (const [omschrijving, categorie] of Object.entries(defaultCategoryOverrides)) {
    void tx.objectStore("overrides").put({ omschrijving, waarde: categorie });
  }
  for (const [omschrijving, subcategorie] of Object.entries(defaultSubcategoryOverrides)) {
    void tx.objectStore("subOverrides").put({ omschrijving, waarde: subcategorie });
  }
  await tx.done;
}

/**
 * "Reset" means back to a fresh install, not to a blank slate: wipes all
 * imported accounts and any of your own category corrections, then restores
 * the shipped-in defaults (the same ones a first-time visitor gets). Without
 * this, a plain db.clear("overrides") would leave categorization far worse
 * than day one, since those defaults only get seeded once, when the
 * database is first created.
 */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.clear("accounts"),
    db.clear("overrides"),
    db.clear("subOverrides"),
  ]);
  await seedDefaultOverrides(db);
}

/** Full-state snapshot for the "export backup" button. */
export async function exportBackup(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [accounts, overrides, subOverrides] = await Promise.all([
    db.getAll("accounts"),
    db.getAll("overrides"),
    db.getAll("subOverrides"),
  ]);
  return { versie: 1, geexporteerd_op: new Date().toISOString(), accounts, overrides, subOverrides };
}

export async function importBackup(backup: {
  accounts?: AccountData[];
  overrides?: OverrideRow[];
  subOverrides?: OverrideRow[];
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["accounts", "overrides", "subOverrides"], "readwrite");
  for (const account of backup.accounts ?? []) await tx.objectStore("accounts").put(account);
  for (const row of backup.overrides ?? []) await tx.objectStore("overrides").put(row);
  for (const row of backup.subOverrides ?? []) await tx.objectStore("subOverrides").put(row);
  await tx.done;
}
