/**
 * Port of export_dashboard_data.py's bouw_dashboard_data(): turns the raw
 * bonnen/artikelen tables (across all accounts) into the compact, already-
 * aggregated shape dashboard.js renders. Keep this in lockstep with the
 * Python version's field list/rounding if that ever changes.
 */
import type { AccountData, Artikel, Bon, DashboardData } from "./types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildDashboardData(accounts: AccountData[]): DashboardData {
  const bonnen: Bon[] = accounts.flatMap((a) => a.bonnen);
  const artikelen: Artikel[] = accounts.flatMap((a) => a.artikelen);
  const producten = artikelen.filter((a) => a.type === "product");

  const totalen = bonnen.map((b) => b.totaal).filter((t): t is number => t != null);
  const datums = bonnen.map((b) => b.datum).filter(Boolean).sort();

  const kpi = {
    totaal_uitgegeven: round2(totalen.reduce((s, t) => s + t, 0)),
    aantal_bonnen: bonnen.length,
    gemiddelde_bonwaarde: totalen.length ? round2(totalen.reduce((s, t) => s + t, 0) / totalen.length) : 0.0,
    totale_bonus_korting: round2(bonnen.reduce((s, b) => s + (b.bonus_korting ?? 0), 0)),
    periode_van: datums.length ? datums[0].slice(0, 10) : null,
    periode_tot: datums.length ? datums[datums.length - 1].slice(0, 10) : null,
  };

  const accountNames = [...new Set(bonnen.map((b) => b.account).filter(Boolean))].sort();

  const bonnenRecords = bonnen.map((b) => ({
    bon_id: b.bon_id,
    account: b.account,
    datum: b.datum.slice(0, 10),
    winkel_adres: b.winkel_adres,
    subtotaal: b.subtotaal != null ? round2(b.subtotaal) : null,
    bonus_korting: b.bonus_korting != null ? round2(b.bonus_korting) : 0.0,
    totaal: b.totaal != null ? round2(b.totaal) : null,
  }));

  const artikelenRecords = producten.map((a) => ({
    bon_id: a.bon_id,
    account: a.account,
    datum: a.datum.slice(0, 10),
    omschrijving: a.omschrijving,
    categorie: a.categorie,
    subcategorie: a.subcategorie ?? "overig",
    bedrag: a.bedrag != null ? round2(a.bedrag) : 0.0,
    bonus: !!a.bonus,
  }));

  return {
    gegenereerd_op: new Date().toISOString(),
    accounts: accountNames,
    kpi,
    bonnen: bonnenRecords,
    artikelen: artikelenRecords,
  };
}
