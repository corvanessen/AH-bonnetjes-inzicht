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

  // Number.isFinite (not `t != null`) so a single malformed numeric field
  // can't NaN-poison a sum for the whole dashboard — `NaN != null` is true,
  // so that check alone doesn't exclude it.
  const totalen = bonnen.map((b) => b.totaal).filter((t): t is number => Number.isFinite(t));
  const datums = bonnen.map((b) => b.datum).filter(Boolean).sort();

  const kpi = {
    totaal_uitgegeven: round2(totalen.reduce((s, t) => s + t, 0)),
    aantal_bonnen: bonnen.length,
    gemiddelde_bonwaarde: totalen.length ? round2(totalen.reduce((s, t) => s + t, 0) / totalen.length) : 0.0,
    totale_bonus_korting: round2(bonnen.reduce((s, b) => s + (Number.isFinite(b.bonus_korting) ? b.bonus_korting : 0), 0)),
    periode_van: datums.length ? datums[0].slice(0, 10) : null,
    periode_tot: datums.length ? datums[datums.length - 1].slice(0, 10) : null,
  };

  const accountNames = [...new Set(bonnen.map((b) => b.account).filter(Boolean))].sort();

  const bonnenRecords = bonnen.map((b) => ({
    bon_id: b.bon_id,
    account: b.account,
    datum: b.datum.slice(0, 10),
    winkel_adres: b.winkel_adres,
    subtotaal: Number.isFinite(b.subtotaal) ? round2(b.subtotaal as number) : null,
    bonus_korting: Number.isFinite(b.bonus_korting) ? round2(b.bonus_korting) : 0.0,
    totaal: Number.isFinite(b.totaal) ? round2(b.totaal as number) : null,
  }));

  const artikelenRecords = producten.map((a) => ({
    bon_id: a.bon_id,
    account: a.account,
    datum: a.datum.slice(0, 10),
    omschrijving: a.omschrijving,
    categorie: a.categorie,
    subcategorie: a.subcategorie ?? "overig",
    bedrag: Number.isFinite(a.bedrag) ? round2(a.bedrag as number) : 0.0,
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
