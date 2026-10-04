/**
 * Lidl kassabonnen uit screenshots van de Lidl Plus-app ("Kopie kassabon"),
 * via OCR (tesseract.js, zie ocr.ts) in de browser. Anders dan de AH-PDF's
 * bevatten deze plaatjes geen tekstlaag, dus moet de tekst eerst herkend
 * worden; dit bestand parseert alleen de herkende tekst, zodat het zonder
 * OCR te testen is.
 *
 * - parseLidlText(): regex-parser op de herkende tekst. Monospace-bon, dus
 *   elke regel is "omschrijving [n x stukprijs] bedrag btw-letter", een
 *   kortingsregel ("Lidl Plus korting -0,36", hoort bij het artikel erboven)
 *   of een gewichtsregel ("0,800 kg x 2,19 EUR/kg").
 *
 * OCR maakt fouten, dus een bon wordt alleen geaccepteerd als de som van de
 * artikel- en kortingsregels exact het gedrukte totaal is. Een bon die daar
 * niet uitkomt wordt overgeslagen met een melding — nooit stilletjes half
 * goed opgeslagen.
 */
import type { Artikel, Bon } from "./types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "2,39" / "2.39" -> 2.39; een door OCR ingelezen extra cijfer ("2,657") wordt afgekapt op centen. */
function parseBedrag(s: string): number {
  const match = /^(-?)(\d+)[.,](\d\d)\d?$/.exec(s);
  if (!match) return Number.NaN;
  return (match[1] ? -1 : 1) * Number(`${match[2]}.${match[3]}`);
}

const BEDRAG = String.raw`-?\d+[.,]\d{2,3}`;
// omschrijving, optioneel "n x stukprijs", bedrag, btw-letter (OCR plakt die soms aan het bedrag)
const ARTIKEL_REGEL = new RegExp(String.raw`^(.+?)\s+(?:(\d+)\s*[xX]\s*(\d+[.,]\d\d)\s+)?(${BEDRAG})\s*([ABC])$`);
const KORTING_REGEL = new RegExp(String.raw`^(.*(?:korting|actie|verlaagd|prijs).*?)\s+(-?\d+[.,]\d\d)$`, "i");
const GEWICHT_REGEL = /^(\d+[.,]\d{3})\s*kg\s*x\s*(\d+[.,]\d\d)/i;
const STATIEGELD = /statiegeld|st\.?\s?geld|losse fles|leeg ?goed/i;

export interface OcrBon {
  bon: Bon;
  artikelen: Artikel[];
  /** Controles die niet klopten maar de bon niet ongeldig maken (bv. aantal artikelen). */
  meldingen: string[];
}

export function isLidlTekst(tekst: string): boolean {
  return /lidl/i.test(tekst);
}

export function parseLidlText(tekst: string, bestand: string): OcrBon {
  const regels = tekst
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  const volledig = regels.join("\n");

  if (!isLidlTekst(volledig)) throw new Error("geen herkenbare Lidl-kassabon");

  const start = regels.findIndex((r) => /OMSCHRIJVING/i.test(r));
  const eind = regels.findIndex((r) => /^Aantal\s+\d+\s*art/i.test(r));
  // Kop zonder "OMSCHRIJVING" (door OCR gemist): artikelen beginnen direct na de postcoderegel.
  const postcodeIdx = regels.findIndex((r) => /^\d{4}\s?[A-Z]{2}\s+\S/.test(r));
  const artikelStart = start >= 0 ? start + 1 : postcodeIdx + 1;
  if (artikelStart <= 0 || eind < 0 || eind <= artikelStart) {
    throw new Error("artikeltabel niet gevonden — mogelijk geen (volledige) Lidl-kassabon");
  }

  const totaalMatch = /^Totaal\s+(\d+[.,]\d\d)$/m.exec(volledig);
  if (!totaalMatch) throw new Error("totaalbedrag niet gevonden");
  const totaal = parseBedrag(totaalMatch[1]);

  // Datum/tijd uit het pinblok ("12-09-2026 14:56"); anders de voetregel ("0659 289384/84 12.09.26") zonder tijd.
  const bonnummer = /^(\d{4})\s*[_ ]?\s*(\d+)\/(\d+)\s+(\d\d)\.(\d\d)\.(\d\d)$/m.exec(volledig);
  const pinDatum = /(\d\d)-(\d\d)-(\d{4})[\s_]+(\d{1,2}):(\d\d)/.exec(volledig);
  let datum: string;
  if (pinDatum) {
    datum = `${pinDatum[3]}-${pinDatum[2]}-${pinDatum[1]}T${pinDatum[4].padStart(2, "0")}:${pinDatum[5]}:00`;
  } else if (bonnummer) {
    datum = `20${bonnummer[6]}-${bonnummer[5]}-${bonnummer[4]}T00:00:00`;
  } else {
    throw new Error("geen datum gevonden");
  }

  const meldingen: string[] = [];
  const artikelen: Artikel[] = [];
  let bonusKorting = 0;
  let somRegels = 0;
  // Een bonnummer (filiaal + transactie) blijft gelijk als dezelfde bon opnieuw wordt geüpload onder een andere bestandsnaam.
  const bonId = bonnummer ? `lidl-${bonnummer[1]}-${bonnummer[2]}-${bonnummer[3]}` : bestand.replace(/\.[^.]+$/, "");

  for (const regel of regels.slice(artikelStart, eind)) {
    const vorige = artikelen[artikelen.length - 1];

    const gewicht = GEWICHT_REGEL.exec(regel);
    if (gewicht) {
      if (vorige) vorige.aantal_weergave = `${gewicht[1]} kg`;
      continue;
    }

    const artikel = ARTIKEL_REGEL.exec(regel);
    if (artikel && !KORTING_REGEL.test(regel)) {
      const [, omschrijving, aantalTekst, stukprijsTekst, bedragTekst, btw] = artikel;
      let bedrag = parseBedrag(bedragTekst);
      const aantal = aantalTekst ? Number(aantalTekst) : 1;
      const stukprijs = stukprijsTekst ? parseBedrag(stukprijsTekst) : bedrag;
      // "n x stukprijs" is een tweede, onafhankelijke lezing van hetzelfde bedrag
      if (aantalTekst && Math.abs(aantal * stukprijs - bedrag) > 0.005) bedrag = round2(aantal * stukprijs);
      somRegels += bedrag;
      artikelen.push({
        bon_id: bonId,
        account: "",
        datum,
        // btw 0% (A) is op een Lidl-bon alleen statiegeld
        type: btw === "A" || STATIEGELD.test(omschrijving) ? "statiegeld" : "product",
        // hoofdletters, net als op de AH-bon, zodat categorize.ts' trefwoorden ook hier werken
        omschrijving: omschrijving.trim().toUpperCase(),
        categorie: null,
        subcategorie: null,
        product_id: null,
        aantal_weergave: String(aantal),
        aantal,
        stukprijs,
        bedrag,
        bonus: false,
      });
      continue;
    }

    const korting = KORTING_REGEL.exec(regel);
    if (korting) {
      // OCR laat het minteken soms weg; een kortingsregel is altijd negatief
      const bedrag = -Math.abs(parseBedrag(korting[2]));
      somRegels += bedrag;
      bonusKorting += -bedrag;
      if (vorige) vorige.bonus = true;
      continue;
    }

    meldingen.push(`regel niet herkend: "${regel}"`);
  }

  if (Math.abs(somRegels - totaal) > 0.005) {
    throw new Error(
      `regels tellen op tot ${round2(somRegels).toFixed(2)}, bon zegt ${totaal.toFixed(2)} — OCR heeft waarschijnlijk iets verkeerd gelezen` +
        (meldingen.length ? ` (${meldingen.join("; ")})` : ""),
    );
  }

  // Lidl telt statiegeld niet mee in "Aantal … art."
  const aantalStuks = artikelen.filter((a) => a.type === "product").reduce((s, a) => s + (a.aantal ?? 1), 0);
  const gedruktAantal = Number(/^Aantal\s+(\d+)/m.exec(volledig)?.[1]);
  if (aantalStuks !== gedruktAantal) {
    meldingen.push(`${aantalStuks} artikelen gelezen, bon zegt ${gedruktAantal}`);
  }

  const btwRegels = [...volledig.matchAll(/^[ABC]\s*\S*\s+\d+[.,]\d\d\s+\d+[.,]\d\d\s+(\d+[.,]\d\d)$/gm)];
  const btwTotaal = btwRegels.reduce((s, m) => s + parseBedrag(m[1]), 0);
  if (btwRegels.length && Math.abs(btwTotaal - totaal) > 0.005) {
    meldingen.push(`btw-tabel telt op tot ${round2(btwTotaal).toFixed(2)}, bon zegt ${totaal.toFixed(2)}`);
  }

  // Winkeladres: "Lidl <plaats>", straat, postcode+plaats vlak voor de artikeltabel.
  const winkelAdres =
    postcodeIdx >= 1 ? `Lidl ${regels[postcodeIdx - 1]} ${regels[postcodeIdx].replace(/\s+/g, " ")}` : "Lidl";

  const betaling = /^Totaal\s+\d+[.,]\d\d\n([A-Za-z][A-Za-z ]*?)\s+(\d+[.,]\d\d)$/m.exec(volledig);
  const zegels = /ontvang je gratis:\n(\d+)\s+zegel/i.exec(volledig);

  const bon: Bon = {
    bon_id: bonId,
    account: "",
    bestand,
    bron: "ocr",
    winkel_adres: winkelAdres,
    winkel_nummer: bonnummer ? `lidl-${bonnummer[1]}` : null,
    telefoon: null,
    email: null,
    datum,
    totaal_aantal_stuks: aantalStuks,
    subtotaal: round2(totaal + bonusKorting),
    bonus_korting: round2(bonusKorting),
    bonus_box: null,
    totaal,
    klantenkaart: null,
    betaalmethode: betaling ? betaling[1].trim() : null,
    betaald_bedrag: betaling ? parseBedrag(betaling[2]) : null,
    spaarzegels: zegels ? Number(zegels[1]) : null,
  };

  return { bon, artikelen, meldingen };
}
