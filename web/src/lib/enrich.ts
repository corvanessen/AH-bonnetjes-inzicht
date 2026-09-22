/**
 * Port of the account-level parts of main.py's verwerk_account() and
 * ah_receipts/samenvoegen.py (dedupliceer + naverwerken): merge the PDF and
 * JSON sources for one account, dedup, assign account/bon_id, categorize,
 * backfill store addresses, and sort.
 *
 * Mirrors verwerk_account()'s exact order: dedupliceer() runs on the raw
 * per-source bon_ids *before* account-prefixing (a PDF/JSON pair for the
 * same receipt never shares a bon_id, so prefixing first would break the
 * (datum, totaal) match). The plain bon_id dedup below (guarding against the
 * same file being uploaded twice in one batch) runs after, like main.py's
 * account-prefixing step implicitly does by keeping bon_id as the row key.
 */
import { categoriseer, categoriseerSub } from "./categorize";
import type { Artikel, Bon } from "./types";

// Kassa-klok en digitale registratie lopen vaak een paar minuten uiteen — zie
// ah_receipts/samenvoegen.py.
const MAX_TIJDSVERSCHIL_MS = 30 * 60 * 1000;

function sleutel(datum: string, totaal: number | null): string | null {
  if (!datum || totaal == null || !Number.isFinite(totaal)) return null;
  return `${datum.slice(0, 10)}|${Math.round(totaal * 100) / 100}`;
}

/**
 * Ontdubbelt op (lokale datum, totaalbedrag) — bij een match wint de PDF-versie
 * (rijker: adres, bonus-vlag per artikel, statiegeldregels). Zie
 * ah_receipts/samenvoegen.py's dedupliceer() voor de volledige uitleg.
 */
function mergeSources(
  pdfBonnen: Bon[],
  pdfArtikelen: Artikel[],
  jsonBonnen: Bon[],
  jsonArtikelen: Artikel[],
): { bonnen: Bon[]; artikelen: Artikel[] } {
  const pdfPerSleutel = new Map<string, string[]>();
  for (const bon of pdfBonnen) {
    const key = sleutel(bon.datum, bon.totaal);
    if (key === null) continue;
    const datums = pdfPerSleutel.get(key) ?? [];
    datums.push(bon.datum);
    pdfPerSleutel.set(key, datums);
  }

  const dubbeleBonIds = new Set<string>();
  for (const bon of jsonBonnen) {
    const key = sleutel(bon.datum, bon.totaal);
    const kandidaten = key !== null ? pdfPerSleutel.get(key) : undefined;
    if (!kandidaten) continue;
    const bonTijd = new Date(bon.datum).getTime();
    if (kandidaten.some((pdfDatum) => Math.abs(new Date(pdfDatum).getTime() - bonTijd) <= MAX_TIJDSVERSCHIL_MS)) {
      dubbeleBonIds.add(bon.bon_id);
    }
  }

  return {
    bonnen: [...pdfBonnen, ...jsonBonnen.filter((b) => !dubbeleBonIds.has(b.bon_id))],
    artikelen: [...pdfArtikelen, ...jsonArtikelen.filter((a) => !dubbeleBonIds.has(a.bon_id))],
  };
}

/**
 * Vult ontbrekend winkeladres aan: eerst via andere bonnen met hetzelfde
 * winkelnummer, anders — als er in dit account maar één adres bekend is —
 * met dat ene adres. Bij meerdere bekende adressen en nog missende bonnen
 * wordt niets geraden; dat wordt als waarschuwing teruggegeven. Zie
 * ah_receipts/samenvoegen.py's naverwerken().
 */
function backfillAddresses(bonnen: Bon[]): { bonnen: Bon[]; warning: string | null } {
  const adresPerWinkel = new Map<string, string>();
  for (const bon of bonnen) {
    if (bon.winkel_nummer && bon.winkel_adres && !adresPerWinkel.has(bon.winkel_nummer)) {
      adresPerWinkel.set(bon.winkel_nummer, bon.winkel_adres);
    }
  }

  let result = bonnen.map((bon) => {
    if (bon.winkel_adres || !bon.winkel_nummer) return bon;
    const adres = adresPerWinkel.get(bon.winkel_nummer);
    return adres ? { ...bon, winkel_adres: adres } : bon;
  });

  const bekendeAdressen = [...new Set(result.map((b) => b.winkel_adres).filter((a): a is string => !!a))];
  const ontbreektAantal = result.filter((b) => !b.winkel_adres).length;

  let warning: string | null = null;
  if (bekendeAdressen.length === 1 && ontbreektAantal > 0) {
    const enigeAdres = bekendeAdressen[0];
    result = result.map((bon) => (bon.winkel_adres ? bon : { ...bon, winkel_adres: enigeAdres }));
  } else if (bekendeAdressen.length > 1 && ontbreektAantal > 0) {
    warning =
      `${ontbreektAantal} bon(nen) hebben geen bekend adres en er zijn meerdere winkeladressen ` +
      `in de data (${bekendeAdressen.join(", ")}) — niet automatisch aangevuld.`;
  }

  return { bonnen: result, warning };
}

export function enrichAccount(
  account: string,
  pdfBonnen: Bon[],
  pdfArtikelen: Artikel[],
  jsonBonnen: Bon[],
  jsonArtikelen: Artikel[],
  overrides: Record<string, string>,
  subOverrides: Record<string, string>,
): { bonnen: Bon[]; artikelen: Artikel[]; warnings: string[] } {
  const merged = mergeSources(pdfBonnen, pdfArtikelen, jsonBonnen, jsonArtikelen);

  const keptIds = new Set<string>();
  let bonnen: Bon[] = [];
  for (const bon of merged.bonnen) {
    if (keptIds.has(bon.bon_id)) continue;
    keptIds.add(bon.bon_id);
    bonnen.push({ ...bon, account, bon_id: `${account}__${bon.bon_id}` });
  }

  const artikelen: Artikel[] = merged.artikelen
    .filter((a) => keptIds.has(a.bon_id))
    .map((a) => {
      // statiegeld is geen aankoop, dus geen categorie (blijft buiten de geld-analyse)
      if (a.type !== "product") {
        return { ...a, account, bon_id: `${account}__${a.bon_id}`, categorie: null, subcategorie: null };
      }
      const categorie = categoriseer(a.omschrijving, a.bedrag, overrides);
      const subcategorie = categoriseerSub(a.omschrijving, categorie, a.bedrag, subOverrides);
      return { ...a, account, bon_id: `${account}__${a.bon_id}`, categorie, subcategorie };
    });

  const { bonnen: bonnenMetAdres, warning } = backfillAddresses(bonnen);
  bonnen = bonnenMetAdres;

  bonnen.sort((a, b) => a.datum.localeCompare(b.datum));
  artikelen.sort((a, b) => a.datum.localeCompare(b.datum) || a.bon_id.localeCompare(b.bon_id));

  return { bonnen, artikelen, warnings: warning ? [warning] : [] };
}

/** Re-applies categorize() to already-imported artikelen after an override changes — mirrors serve_dashboard.py's _herbereken_categorieen(). */
export function recategorize(
  artikelen: Artikel[],
  overrides: Record<string, string>,
  subOverrides: Record<string, string>,
): Artikel[] {
  return artikelen.map((a) => {
    if (a.type !== "product") return a;
    const categorie = categoriseer(a.omschrijving, a.bedrag, overrides);
    const subcategorie = categoriseerSub(a.omschrijving, categorie, a.bedrag, subOverrides);
    return { ...a, categorie, subcategorie };
  });
}
