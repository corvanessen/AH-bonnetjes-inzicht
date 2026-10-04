/**
 * Papieren AH-kassabonnen, gefotografeerd en via OCR gelezen (zie ocr.ts).
 * Zelfde opmaak als de AH-PDF (pdfParser.ts), maar zonder tekstlaag en
 * kolomposities: alleen de herkende tekst, met OCR-fouten erin.
 *
 * Artikelregels zijn "aantal  omschrijving  [stukprijs]  bedrag [B]". Met
 * preserve_interword_spaces houdt tesseract de brede kolomgaten als 2+
 * spaties, terwijl woorden binnen een omschrijving één spatie krijgen —
 * daarop wordt gesplitst.
 *
 * Net als bij de Lidl-bonnen wordt een bon alleen geaccepteerd als de
 * artikelregels exact optellen tot het gedrukte SUBTOTAAL; anders wordt hij
 * overgeslagen met een melding.
 */
import type { Artikel, Bon } from "./types";
import type { OcrBon } from "./lidlOcrParser";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "2,27" / "2.27" / "2. 27" / "O,OO" (OCR leest 0 soms als O) -> getal, anders NaN. */
function parseBedrag(s: string): number {
  const match = /^(-?)([\dOo]+)\s?[.,]\s?([\dOo]{2})$/.exec(s.trim());
  if (!match) return Number.NaN;
  const cijfers = (t: string) => t.replace(/[Oo]/g, "0");
  return (match[1] ? -1 : 1) * Number(`${cijfers(match[2])}.${cijfers(match[3])}`);
}

const BEDRAG = String.raw`-?[\dOo]+\s?[.,]\s?[\dOo]{2}`;
// "[aantal] omschrijving [stukprijs] bedrag". Niet op de kolomgaten (2+ spaties) splitsen: OCR
// laat die soms weg. Aantal is een getal, een gewicht ("0,456KG") of een als t/l/I/| gelezen 1.
const ARTIKEL_REGEL = new RegExp(
  String.raw`^(?:(\d+(?:[.,]\d+)?\s?(?:KG)?|[tlI|!])\s+)?(.*?\S)\s+(?:(${BEDRAG})\s+)?(${BEDRAG})$`,
  "i",
);

/** Eerste bedrag na het label; niet per se aan het regeleinde, OCR leest de schaduw van de bonrand soms als teken. */
function bedragNa(regel: string, label: RegExp): number {
  const match = new RegExp(String.raw`${label.source}.*?(${BEDRAG})(?!\d)`, "i").exec(regel);
  return match ? parseBedrag(match[match.length - 1]) : Number.NaN;
}

/** Losse tekens die OCR rond de bon oppikt ("|", ".", "»") van het regeleinde halen. */
function zonderRuis(regel: string): string {
  return regel.replace(/(\s+[^\p{L}\p{N}]{1,2})+$/u, "").trim();
}

/** OCR leest de "1" in de aantal-kolom soms als t, l, I of |. */
function parseAantal(t: string): { weergave: string; aantal: number | null } {
  if (/^[tlI|!]$/.test(t)) return { weergave: "1", aantal: 1 };
  const match = /^(\d+(?:[.,]\d+)?)/.exec(t);
  return { weergave: t, aantal: match ? Number(match[1].replace(",", ".")) : null };
}

export function isAhTekst(tekst: string): boolean {
  return /albert\s*he[il1]jn/i.test(tekst) || /BONUS\s*BOX/.test(tekst);
}

export function parseAhText(tekst: string, bestand: string): OcrBon {
  const regels = tekst
    .split("\n")
    .map(zonderRuis)
    .filter(Boolean);
  const volledig = regels.join("\n");

  if (!isAhTekst(volledig)) throw new Error("geen herkenbare AH-kassabon");

  const kop = regels.findIndex((r) => /OMSCHRIJVING|AANT\s?AL\s+OMS/i.test(r));
  const sub = regels.findIndex((r) => /SUBTOTAAL/.test(r));
  if (kop < 0 || sub < 0 || sub <= kop) {
    throw new Error("artikeltabel niet gevonden — mogelijk geen (volledige) AH-kassabon");
  }

  const subtotaal = bedragNa(regels[sub], /SUBTOTAAL/);
  if (Number.isNaN(subtotaal)) throw new Error("subtotaal niet gevonden");
  const gedruktAantal = Number(/^(\d+)\s/.exec(regels[sub])?.[1]);

  // Het eerste TOTAAL na het subtotaal; de btw-tabel verderop heeft ook een (ander) TOTAAL.
  const totaalIdx = regels.findIndex((r, i) => i > sub && /^TOTAAL\b/.test(r));
  const totaal = totaalIdx >= 0 ? bedragNa(regels[totaalIdx], /TOTAAL/) : Number.NaN;
  if (Number.isNaN(totaal)) throw new Error("totaalbedrag niet gevonden");
  const naSub = regels.slice(sub + 1, totaalIdx);
  const voordeelRegel = naSub.find((r) => /VOORDEEL/.test(r));
  const voordeel = voordeelRegel ? bedragNa(voordeelRegel, /VOORDEEL/) : 0;
  const bonusBoxRegel = naSub.find((r) => /BONUS\s*BOX/.test(r));
  const bonusBox = bonusBoxRegel ? bedragNa(bonusBoxRegel, /BONUS\s*BOX/) : Number.NaN;

  // Datum/tijd uit het pinblok ("Datum 28/09/2026 08:45" — het label leest OCR niet altijd goed);
  // anders de voetregel ("08:44" en "28-09-2026", vaak op verschillende regels).
  const pinDatum = /(\d\d)\/(\d\d)\/(\d{4})\s+(\d{1,2}):(\d\d)/.exec(volledig);
  const voetDatum = /(\d\d)-(\d\d)-(\d{4})/.exec(regels.slice(totaalIdx).join("\n"));
  const voetTijd = /^(?:\S+\s+)?(\d\d):(\d\d)$/m.exec(regels.slice(totaalIdx).join("\n"));
  let datum: string;
  if (pinDatum) {
    datum = `${pinDatum[3]}-${pinDatum[2]}-${pinDatum[1]}T${pinDatum[4].padStart(2, "0")}:${pinDatum[5]}:00`;
  } else if (voetDatum) {
    const tijd = voetTijd ? `${voetTijd[1]}:${voetTijd[2]}` : "00:00";
    datum = `${voetDatum[3]}-${voetDatum[2]}-${voetDatum[1]}T${tijd}:00`;
  } else {
    throw new Error("geen datum gevonden");
  }

  // Kop: "Albert Heijn 2308", straat, postcode + plaats.
  const kopRegels = regels.slice(Math.max(0, regels.findIndex((r) => /albert\s*he[il1]jn/i.test(r))), kop);
  const winkelNummer = /albert\s*he[il1]jn\W*\s*(\d{3,5})\b/i.exec(volledig)?.[1] ?? null;
  const winkelAdres = kopRegels.length
    ? kopRegels
        .map((r) => r.replace(/^albert\s*he[il1]jn\W*(\s*\d{3,5}\b)?/i, "Albert Heijn"))
        .filter((r) => !/^(tel|email)\b/i.test(r))
        .join(" ")
        .replace(/\s+/g, " ")
    : null;

  // Zonder bonnummer op papier: kassatijd + totaal, zodat dezelfde bon onder een andere bestandsnaam dezelfde bon blijft.
  // Niet het winkelnummer: dat leest OCR in de grote koptekst niet altijd goed.
  const bonId = `ah-foto-${datum.replace(/\D/g, "").slice(0, 12)}-${Math.round(totaal * 100)}`;

  const meldingen: string[] = [];
  const artikelen: Artikel[] = [];
  let klantenkaart: string | null = null;
  let somRegels = 0;

  for (const regel of regels.slice(kop + 1, sub)) {
    if (/^BONUSKAART/i.test(regel)) {
      klantenkaart = regel.replace(/^BONUSKAART\s*/i, "").trim() || null;
      continue;
    }
    // bonus-vlag "B" achter het bedrag, door OCR soms eraan vastgeplakt
    const vlag = /(\d)\s*B$/.exec(regel);
    const zonderVlag = vlag ? regel.replace(/\s*B$/, "") : regel;
    const regelMatch = ARTIKEL_REGEL.exec(zonderVlag);
    if (!regelMatch) {
      meldingen.push(`regel niet herkend: "${regel}"`);
      continue;
    }
    const [, aantalTekst = "", omschrijvingTekst, prijsTekst, bedragTekst] = regelMatch;
    const bedrag = parseBedrag(bedragTekst);
    // stukprijs staat er alleen bij meer dan één stuk of per kilo
    const prijsKolom = prijsTekst ? parseBedrag(prijsTekst) : Number.NaN;
    const omschrijving = omschrijvingTekst.trim().toUpperCase();
    const { weergave, aantal } = parseAantal(aantalTekst.trim());
    const statiegeld = /STATIEGELD|EMBALLAGE/.test(omschrijving);

    somRegels += bedrag;
    artikelen.push({
      bon_id: bonId,
      account: "",
      datum,
      type: statiegeld ? "statiegeld" : "product",
      omschrijving: statiegeld ? "STATIEGELD" : omschrijving.replace(/^\+/, ""),
      categorie: null,
      subcategorie: null,
      product_id: null,
      aantal_weergave: statiegeld || !aantalTekst ? null : weergave,
      aantal: statiegeld ? null : aantal,
      stukprijs: statiegeld ? null : Number.isNaN(prijsKolom) ? bedrag : prijsKolom,
      bedrag,
      bonus: Boolean(vlag),
    });
  }

  if (Math.abs(somRegels - subtotaal) > 0.005) {
    throw new Error(
      `regels tellen op tot ${round2(somRegels).toFixed(2)}, subtotaal op de bon is ${subtotaal.toFixed(2)} — OCR heeft waarschijnlijk iets verkeerd gelezen` +
        (meldingen.length ? ` (${meldingen.join("; ")})` : ""),
    );
  }

  // een gewogen artikel ("0,456KG") telt op de bon als één stuk
  const aantalStuks = artikelen
    .filter((a) => a.type === "product")
    .reduce((s, a) => s + (a.aantal !== null && Number.isInteger(a.aantal) ? a.aantal : 1), 0);
  if (Number.isFinite(gedruktAantal) && aantalStuks !== gedruktAantal) {
    meldingen.push(`${aantalStuks} artikelen gelezen, bon zegt ${gedruktAantal}`);
  }
  const bonusKorting = Number.isNaN(voordeel) ? 0 : voordeel;
  // Koopzegels e.d. komen ná het subtotaal bij het totaal; dan klopt dit niet, maar is de bon wel goed.
  if (Math.abs(subtotaal - bonusKorting - totaal) > 0.005) {
    meldingen.push(`subtotaal ${subtotaal.toFixed(2)} min voordeel ${bonusKorting.toFixed(2)} is niet het totaal ${totaal.toFixed(2)}`);
  }

  const betaling = /BETAALD MET:?\n(.+?)\s+(\d+[.,]\d\d)$/m.exec(volledig);
  const zegels = /SPAARACTIES:?\n(\d+)\s/.exec(volledig);

  const bon: Bon = {
    bon_id: bonId,
    account: "",
    bestand,
    bron: "ocr",
    winkel_adres: winkelAdres,
    winkel_nummer: winkelNummer,
    telefoon: null,
    email: null,
    datum,
    totaal_aantal_stuks: Number.isFinite(gedruktAantal) ? gedruktAantal : aantalStuks,
    subtotaal,
    bonus_korting: round2(bonusKorting),
    bonus_box: Number.isNaN(bonusBox) ? null : bonusBox,
    totaal,
    klantenkaart,
    betaalmethode: betaling ? betaling[1].trim() : null,
    betaald_bedrag: betaling ? parseBedrag(betaling[2]) : null,
    spaarzegels: zegels ? Number(zegels[1]) : null,
  };

  return { bon, artikelen, meldingen };
}
