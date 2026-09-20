/**
 * Port of ah_receipts/json_parser.py — parses one AH digital-receipt export
 * file (the format fetch_receipts.py / the future connector tool writes,
 * one JSON object per receipt) into a Bon + Artikel[] pair.
 *
 * The PDF-based parser (ah_receipts/parser.py) is not ported: it depends on
 * PyMuPDF, which has no practical in-browser equivalent. See the plan doc
 * for why that's an acceptable v1 scope cut.
 */
import type { Artikel, Bon } from "./types";

const AMSTERDAM_TZ = "Europe/Amsterdam";

/** UTC ISO timestamp -> local (Europe/Amsterdam) wall-clock ISO string, no offset. */
export function toAmsterdamLocalIso(utcIso: string): string {
  const date = new Date(utcIso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AMSTERDAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}

interface RawMoney {
  amount: number;
}
interface RawProduct {
  id?: string;
  quantity?: number;
  name?: string;
  price?: RawMoney;
  amount?: RawMoney;
}
interface RawDiscount {
  amount: RawMoney;
}
interface RawPayment {
  method?: string;
  amount: RawMoney;
}
export interface RawReceipt {
  id: string;
  dateTime?: string;
  totalAmount?: number;
  products?: RawProduct[];
  discounts?: RawDiscount[];
  payments?: RawPayment[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseJsonReceipt(ruw: RawReceipt, bestand: string): { bon: Bon; artikelen: Artikel[] } {
  const lokaleDatum = ruw.dateTime ? toAmsterdamLocalIso(ruw.dateTime) : "";
  const totaal = ruw.totalAmount ?? null;
  const kortingen = ruw.discounts ?? [];
  const bonusKorting = kortingen.length ? round2(-kortingen.reduce((s, k) => s + k.amount.amount, 0)) : 0.0;
  const subtotaal = totaal !== null ? round2(totaal + bonusKorting) : null;

  const betalingen = ruw.payments ?? [];
  const methodes = [...new Set(betalingen.map((p) => p.method).filter((m): m is string => !!m))].sort();
  const betaalmethode = methodes.length ? methodes.join(", ") : null;
  const betaaldBedrag = betalingen.length ? round2(betalingen.reduce((s, p) => s + p.amount.amount, 0)) : null;

  const producten = ruw.products ?? [];
  const bon: Bon = {
    bon_id: ruw.id,
    account: "",
    bestand,
    bron: "json",
    winkel_adres: null,
    winkel_nummer: null,
    telefoon: null,
    email: null,
    datum: lokaleDatum,
    totaal_aantal_stuks: producten.reduce((s, p) => s + (p.quantity ?? 1), 0),
    subtotaal,
    bonus_korting: bonusKorting,
    bonus_box: null,
    totaal,
    klantenkaart: null,
    betaalmethode,
    betaald_bedrag: betaaldBedrag,
    spaarzegels: null,
  };

  const artikelen: Artikel[] = producten.map((product) => {
    const aantal = product.quantity ?? 1;
    const bedrag = product.amount?.amount ?? null;
    const stukprijs = product.price ? product.price.amount : bedrag;
    return {
      bon_id: ruw.id,
      account: "",
      datum: lokaleDatum,
      type: "product",
      omschrijving: (product.name ?? "").trim(),
      categorie: null,
      subcategorie: null,
      product_id: product.id ?? null,
      aantal_weergave: String(aantal),
      aantal: aantal,
      stukprijs,
      bedrag,
      bonus: null,
    };
  });

  return { bon, artikelen };
}

/** Parses many receipt files (as already-decoded JSON) into flat bonnen/artikelen arrays. */
export function parseJsonReceipts(
  files: { name: string; data: unknown }[],
): { bonnen: Bon[]; artikelen: Artikel[]; warnings: string[] } {
  const bonnen: Bon[] = [];
  const artikelen: Artikel[] = [];
  const warnings: string[] = [];

  for (const { name, data } of files) {
    try {
      const ruw = data as RawReceipt;
      if (!ruw || typeof ruw.id !== "string") {
        throw new Error("ontbrekend of ongeldig veld 'id'");
      }
      const { bon, artikelen: items } = parseJsonReceipt(ruw, name);
      bonnen.push(bon);
      artikelen.push(...items);
    } catch (err) {
      warnings.push(`kon ${name} niet verwerken: ${(err as Error).message}`);
    }
  }

  return { bonnen, artikelen, warnings };
}
