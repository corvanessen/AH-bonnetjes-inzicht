/** Mirrors the column set of ah_receipts' bonnen/artikelen tables (JSON-source only; see README). */

export interface Bon {
  bon_id: string;
  account: string;
  bestand: string;
  bron: "json";
  winkel_adres: string | null;
  winkel_nummer: string | null;
  telefoon: string | null;
  email: string | null;
  datum: string; // local (Europe/Amsterdam) ISO datetime, e.g. "2025-12-20T16:53:00"
  totaal_aantal_stuks: number;
  subtotaal: number | null;
  bonus_korting: number;
  bonus_box: string | null;
  totaal: number | null;
  klantenkaart: string | null;
  betaalmethode: string | null;
  betaald_bedrag: number | null;
  spaarzegels: string | null;
}

export interface Artikel {
  bon_id: string;
  account: string;
  datum: string;
  type: "product";
  omschrijving: string;
  categorie: string | null;
  subcategorie: string | null;
  product_id: string | null;
  aantal_weergave: string;
  aantal: number | null;
  stukprijs: number | null;
  bedrag: number | null;
  bonus: boolean | null;
}

/** One account's imported+enriched data, as stored in IndexedDB. */
export interface AccountData {
  account: string;
  bonnen: Bon[];
  artikelen: Artikel[];
  importedAt: string;
}

/** The shape dashboard.js expects — matches export_dashboard_data.py's bouw_dashboard_data() output exactly. */
export interface DashboardData {
  gegenereerd_op: string;
  accounts: string[];
  kpi: {
    totaal_uitgegeven: number;
    aantal_bonnen: number;
    gemiddelde_bonwaarde: number;
    totale_bonus_korting: number;
    periode_van: string | null;
    periode_tot: string | null;
  };
  bonnen: {
    bon_id: string;
    account: string;
    datum: string;
    winkel_adres: string | null;
    subtotaal: number | null;
    bonus_korting: number;
    totaal: number | null;
  }[];
  artikelen: {
    bon_id: string;
    account: string;
    datum: string;
    omschrijving: string;
    categorie: string | null;
    subcategorie: string;
    bedrag: number;
    bonus: boolean;
  }[];
}
