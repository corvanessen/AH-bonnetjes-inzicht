/**
 * Enforces the invariants the renderer (dashboard.js / buildDashboardData.ts)
 * assumes but never checks itself — e.g. `b.datum.slice(0, 10)` assumes
 * `datum` is always a string, `t != null` sums assume numeric fields are
 * never `NaN`. This is the one place that matters: data that reaches
 * IndexedDB unchecked can crash the render on *every future page load*, not
 * just at import time, and is much harder to recover from (no error at
 * upload time to point at — "Alles wissen" becomes the only fix). Rows that
 * fail are dropped, never silently stored broken; callers surface the
 * returned warnings to the user instead.
 */
import type { AccountData, Artikel, Bon } from "./types";

function finiteOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function isValidDatum(datum: unknown): datum is string {
  return typeof datum === "string" && /^\d{4}-\d{2}-\d{2}/.test(datum);
}

function sanitizeBon(bon: Bon): Bon | null {
  if (!bon || typeof bon !== "object") return null;
  if (typeof bon.bon_id !== "string" || !bon.bon_id) return null;
  if (typeof bon.account !== "string" || !bon.account) return null;
  if (!isValidDatum(bon.datum)) return null;

  return {
    ...bon,
    bestand: typeof bon.bestand === "string" ? bon.bestand : "",
    bron: bon.bron === "pdf" || bon.bron === "ocr" ? bon.bron : "json",
    winkel_adres: typeof bon.winkel_adres === "string" ? bon.winkel_adres : null,
    winkel_nummer: typeof bon.winkel_nummer === "string" ? bon.winkel_nummer : null,
    telefoon: typeof bon.telefoon === "string" ? bon.telefoon : null,
    email: typeof bon.email === "string" ? bon.email : null,
    totaal_aantal_stuks: Number.isFinite(bon.totaal_aantal_stuks) ? bon.totaal_aantal_stuks : 0,
    subtotaal: finiteOrNull(bon.subtotaal),
    bonus_korting: Number.isFinite(bon.bonus_korting) ? bon.bonus_korting : 0,
    bonus_box: finiteOrNull(bon.bonus_box),
    totaal: finiteOrNull(bon.totaal),
    klantenkaart: typeof bon.klantenkaart === "string" ? bon.klantenkaart : null,
    betaalmethode: typeof bon.betaalmethode === "string" ? bon.betaalmethode : null,
    betaald_bedrag: finiteOrNull(bon.betaald_bedrag),
    spaarzegels: finiteOrNull(bon.spaarzegels),
  };
}

function sanitizeArtikel(artikel: Artikel): Artikel | null {
  if (!artikel || typeof artikel !== "object") return null;
  if (typeof artikel.bon_id !== "string" || !artikel.bon_id) return null;
  if (typeof artikel.account !== "string" || !artikel.account) return null;
  if (!isValidDatum(artikel.datum)) return null;
  if (typeof artikel.omschrijving !== "string") return null;

  return {
    ...artikel,
    type: artikel.type === "statiegeld" ? "statiegeld" : "product",
    categorie: typeof artikel.categorie === "string" ? artikel.categorie : null,
    subcategorie: typeof artikel.subcategorie === "string" ? artikel.subcategorie : null,
    product_id: typeof artikel.product_id === "string" ? artikel.product_id : null,
    aantal_weergave: typeof artikel.aantal_weergave === "string" ? artikel.aantal_weergave : null,
    aantal: finiteOrNull(artikel.aantal),
    stukprijs: finiteOrNull(artikel.stukprijs),
    bedrag: finiteOrNull(artikel.bedrag),
    bonus: typeof artikel.bonus === "boolean" ? artikel.bonus : null,
  };
}

/** Sanitizes one account's data (upload batch, or one entry from an imported backup) before it's persisted. */
export function sanitizeAccountData(data: AccountData): { data: AccountData; warnings: string[] } {
  const warnings: string[] = [];

  if (!data || typeof data.account !== "string" || !data.account) {
    return {
      data: { account: "", bonnen: [], artikelen: [], importedAt: new Date().toISOString() },
      warnings: ["account zonder geldige naam overgeslagen."],
    };
  }

  const bonnenSanitized = (Array.isArray(data.bonnen) ? data.bonnen : []).map(sanitizeBon);
  const bonnen = bonnenSanitized.filter((b): b is Bon => b !== null);
  const droppedBonnen = bonnenSanitized.length - bonnen.length;

  const geldigeBonIds = new Set(bonnen.map((b) => b.bon_id));
  const artikelenSanitized = (Array.isArray(data.artikelen) ? data.artikelen : []).map(sanitizeArtikel);
  const artikelen = artikelenSanitized.filter((a): a is Artikel => a !== null && geldigeBonIds.has(a.bon_id));
  const droppedArtikelen = artikelenSanitized.length - artikelen.length;

  if (droppedBonnen > 0) warnings.push(`${droppedBonnen} bon(nen) met onherkenbare data overgeslagen.`);
  if (droppedArtikelen > 0) warnings.push(`${droppedArtikelen} artikelregel(s) met onherkenbare data overgeslagen.`);

  return {
    data: {
      account: data.account,
      bonnen,
      artikelen,
      importedAt: typeof data.importedAt === "string" ? data.importedAt : new Date().toISOString(),
    },
    warnings,
  };
}
