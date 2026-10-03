/**
 * IndexedDB persistence, scoped to this browser only — the replacement for
 * data/*.parquet and ah_receipts/*_overrides.csv. Nothing here ever leaves
 * the device; there is no server component.
 */
import { openDB, type IDBPDatabase } from "idb";
import defaultCategoryOverrides from "../data/categorie_overrides.json";
import defaultSubcategoryOverrides from "../data/subcategorie_overrides.json";
import type { GebruikersRegel } from "./categorize";
import type { AccountData } from "./types";

const DB_NAME = "bonnetjes";
const DB_VERSION = 2;

export interface OverrideRow {
  omschrijving: string;
  waarde: string;
}

/** AH's eigen indeling van een product, zoals opgehaald via de extensie (ruwe AH-namen). */
export interface AhProductRow {
  product_id: string;
  ahCategorie: string | null;
  ahSubcategorie: string | null;
  opgehaald: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 2) {
          db.createObjectStore("regels", { keyPath: "id" });
          db.createObjectStore("ahProducten", { keyPath: "product_id" });
        }
        if (oldVersion >= 1) return;
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

let persistRequested = false;

/**
 * Ask the browser to mark this origin's storage as persistent, so IndexedDB
 * isn't evicted under disk pressure (and is exempt from Safari's 7-day purge
 * where it honours this). Chrome/Edge decide silently, Firefox may show a
 * prompt — hence only once per page load, and only when there's data worth
 * keeping. Failure just leaves the default best-effort storage.
 */
export async function requestPersistentStorage(): Promise<void> {
  if (persistRequested || !navigator.storage?.persist) return;
  persistRequested = true;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported or refused: nothing to do.
  }
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

async function deleteOverrideValue(store: "overrides" | "subOverrides", omschrijving: string): Promise<void> {
  const db = await getDb();
  await db.delete(store, omschrijving);
}

export const deleteOverride = (omschrijving: string) => deleteOverrideValue("overrides", omschrijving);
export const deleteSubOverride = (omschrijving: string) => deleteOverrideValue("subOverrides", omschrijving);

/** Meerdere correcties in één transactie (o.a. "Te beoordelen" → alles accepteren). `null` = verwijderen. */
export async function setOverridesBatch(
  cat: { omschrijving: string; waarde: string | null }[],
  sub: { omschrijving: string; waarde: string | null }[],
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["overrides", "subOverrides"], "readwrite");
  for (const [store, rows] of [["overrides", cat], ["subOverrides", sub]] as const) {
    for (const { omschrijving, waarde } of rows) {
      void (waarde === null
        ? tx.objectStore(store).delete(omschrijving)
        : tx.objectStore(store).put({ omschrijving, waarde }));
    }
  }
  await tx.done;
}

export async function getRegels(): Promise<GebruikersRegel[]> {
  const db = await getDb();
  return db.getAll("regels");
}

export async function saveRegel(regel: GebruikersRegel): Promise<void> {
  const db = await getDb();
  await db.put("regels", regel);
}

export async function deleteRegel(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("regels", id);
}

export async function getAhProducten(): Promise<AhProductRow[]> {
  const db = await getDb();
  return db.getAll("ahProducten");
}

export async function saveAhProducten(rows: AhProductRow[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("ahProducten", "readwrite");
  for (const row of rows) void tx.store.put(row);
  await tx.done;
}

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
    db.clear("regels"),
    db.clear("ahProducten"),
  ]);
  await seedDefaultOverrides(db);
}

/** Full-state snapshot for the "export backup" button. */
export async function exportBackup(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [accounts, overrides, subOverrides, regels, ahProducten] = await Promise.all([
    db.getAll("accounts"),
    db.getAll("overrides"),
    db.getAll("subOverrides"),
    db.getAll("regels"),
    db.getAll("ahProducten"),
  ]);
  return { versie: 2, geexporteerd_op: new Date().toISOString(), accounts, overrides, subOverrides, regels, ahProducten };
}

export async function importBackup(backup: {
  accounts?: AccountData[];
  overrides?: OverrideRow[];
  subOverrides?: OverrideRow[];
  // versie 2 en later; oudere backups hebben deze velden niet.
  regels?: GebruikersRegel[];
  ahProducten?: AhProductRow[];
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["accounts", "overrides", "subOverrides", "regels", "ahProducten"], "readwrite");
  for (const account of backup.accounts ?? []) await tx.objectStore("accounts").put(account);
  for (const row of backup.overrides ?? []) await tx.objectStore("overrides").put(row);
  for (const row of backup.subOverrides ?? []) await tx.objectStore("subOverrides").put(row);
  for (const regel of backup.regels ?? []) await tx.objectStore("regels").put(regel);
  for (const row of backup.ahProducten ?? []) await tx.objectStore("ahProducten").put(row);
  await tx.done;
}
