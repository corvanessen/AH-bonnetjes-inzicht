/**
 * Port of ah_receipts/parser.py — parses AH kassabon PDFs entirely in the
 * browser using pdf.js's text-extraction API. Only the core extraction API
 * is used (getDocument().promise -> page.getTextContent()); the rendering/
 * annotation/scripting layers are never touched, so embedded PDF JavaScript
 * is never executed — do not "upgrade" this to the viewer APIs without
 * re-checking that.
 *
 * Coordinate/tokenization notes, validated against ah_receipts/parser.py's
 * actual output on real receipts (see the accounts/cor/*.pdf fixtures used
 * during development — not committed, see .gitignore):
 * - pdf.js text x-positions (item.transform[4], the horizontal translation)
 *   are in the same PDF-point units as PyMuPDF's word x0, so the original
 *   column thresholds below (QTY_MAX_X etc.) apply unchanged.
 * - pdf.js's y-axis is bottom-up (origin bottom-left); PyMuPDF's word y0 is
 *   top-down. Negating transform[5] before sorting/grouping fixes that.
 * - Unlike PyMuPDF's "words" mode, pdf.js doesn't word-tokenize — one text
 *   item can already contain more than one word (e.g. "ELMEX TP" is a
 *   single item). That's harmless for column classification, which only
 *   looks at an item's x-position (never splits words within an item),
 *   *except* for the bonus-flag suffix: PDF.js always draws the amount and
 *   trailing "B" flag as one item (e.g. "5,90 B"), spanning the bedrag and
 *   vlag columns. That one case is special-cased in splitBonusFlag below —
 *   verified against every bonus line in the 7 test receipts.
 * - For the free-text header/footer (store address, payment terminal
 *   block, etc.), PyMuPDF's plain-text mode puts each distinct text-show
 *   run on its own line, regardless of geometric position — e.g. a
 *   same-line "Datum" label and its value print as two separate lines.
 *   pdf.js text items are already at that same granularity (its own
 *   line-detection heuristics/hasEOL are geometry-based and disagree with
 *   PyMuPDF here), so building the header/footer text as one pdf.js item
 *   per line, in reading order, reproduces PyMuPDF's output closely enough
 *   for the regexes below to match unchanged (diffed line-for-line against
 *   the Python parser's output during development).
 */
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Artikel, Bon } from "./types";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Just the fields used below — avoids depending on pdfjs-dist's TextItem export
// path, which has moved between versions. TextMarkedContent items (no `.str`)
// are filtered out by the `"str" in raw` check before this type is applied.
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

// x-grenzen (PDF-punten) van de kolommen in de artikeltabel — zie ah_receipts/parser.py
const QTY_MAX_X = 70.0;
const DESC_MAX_X = 190.0;
const PRICE_MAX_X = 219.0;
const BEDRAG_MAX_X = 250.0;
// alles rechts van BEDRAG_MAX_X is de bonus-vlag ("B")

const ROW_TOLERANCE = 2.0; // punten; woorden op dezelfde gedrukte regel delen vrijwel dezelfde y

interface PositionedWord {
  x0: number;
  x1: number;
  y: number; // top-down (groter = verder naar onderen op de pagina)
  text: string;
}

type ColumnKey = "aantal" | "omschrijving" | "prijs" | "bedrag" | "vlag";
type Row = Record<ColumnKey, string>;

// Bonuskorting-vlag ("B") staat in de PDF-inhoud vastgeplakt aan het bedrag
// ervoor (bv. "5,90 B") als één tekst-run — zie het bestandscomment hierboven.
const BONUS_FLAG_SUFFIX = /^(-?[\d.,]+)\s+B$/;

function splitBonusFlag(word: PositionedWord): PositionedWord[] {
  const match = BONUS_FLAG_SUFFIX.exec(word.text);
  if (!match) return [word];
  return [
    // x1 net binnen de bedrag-kolom (> PRICE_MAX_X, <= BEDRAG_MAX_X) — x0 doet er
    // voor deze kolommen niet toe, classify() kijkt hier alleen naar x1.
    { x0: word.x0, x1: BEDRAG_MAX_X, y: word.y, text: match[1] },
    // x1 voorbij BEDRAG_MAX_X forceert de vlag-kolom.
    { x0: BEDRAG_MAX_X + 1, x1: BEDRAG_MAX_X + 1, y: word.y, text: "B" },
  ];
}

function classify(word: PositionedWord): ColumnKey {
  if (word.x0 < QTY_MAX_X) return "aantal";
  if (word.x0 < DESC_MAX_X) return "omschrijving";
  if (word.x1 <= PRICE_MAX_X) return "prijs";
  if (word.x1 <= BEDRAG_MAX_X) return "bedrag";
  return "vlag";
}

/** Groepeert woorden (al gesorteerd, binnen één pagina) tot regels per kolom — zie _group_rows in parser.py. */
function groupRows(words: PositionedWord[]): Row[] {
  const rows: Row[] = [];
  let current: PositionedWord[] = [];
  let currentY: number | null = null;

  const flush = () => {
    if (!current.length) return;
    const buckets: Record<ColumnKey, string[]> = { aantal: [], omschrijving: [], prijs: [], bedrag: [], vlag: [] };
    for (const w of current) buckets[classify(w)].push(w.text);
    rows.push({
      aantal: buckets.aantal.join(" "),
      omschrijving: buckets.omschrijving.join(" "),
      prijs: buckets.prijs.join(" "),
      bedrag: buckets.bedrag.join(" "),
      vlag: buckets.vlag.join(" "),
    });
  };

  for (const w of words) {
    const y = Math.round(w.y);
    if (currentY === null || Math.abs(y - currentY) > ROW_TOLERANCE) {
      flush();
      current = [];
      currentY = y;
    }
    current.push(w);
  }
  flush();

  return rows;
}

/** Leest alle pagina's: geeft de artikeltabel-regels (per pagina gegroepeerd) en de platte tekst voor header/footer. */
async function readDocument(doc: PDFDocumentProxy): Promise<{ rows: Row[]; volledigeTekst: string }> {
  const rows: Row[] = [];
  const textLines: string[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    const words: PositionedWord[] = [];
    for (const raw of content.items) {
      if (!("str" in raw)) continue; // TextMarkedContent — geen tekst
      const item = raw as PdfTextItem;
      const text = item.str.trim();
      if (!text) continue;
      words.push({ x0: item.transform[4], x1: item.transform[4] + item.width, y: -item.transform[5], text });
    }
    words.sort((a, b) => Math.round(a.y) - Math.round(b.y) || a.x0 - b.x0);

    for (const w of words) textLines.push(w.text);
    rows.push(...groupRows(words.flatMap(splitBonusFlag)));
  }

  // Trailing "\n" zodat regexes die op een regeleinde ná de laatste regel
  // matchen (de winkelnummer-fallback) ook aan het einde van de tekst werken.
  return { rows, volledigeTekst: textLines.join("\n") + "\n" };
}

interface ArtikelRaw {
  type: "product" | "statiegeld";
  aantal_weergave: string | null;
  aantal: number | null;
  omschrijving: string;
  stukprijs: number | null;
  bedrag: number | null;
  bonus: boolean;
}

interface Totals {
  klantenkaart: string | null;
  totaal_aantal_stuks: number | null;
  subtotaal: number | null;
  bonus_korting: number | null;
  bonus_box: number | null;
  totaal: number | null;
}

function parseBedrag(tekst: string): number | null {
  const t = tekst.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseAantal(tekst: string): [string | null, number | null] {
  const t = tekst.trim();
  if (!t) return [null, null];
  const match = /^(\d+(?:[.,]\d+)?)/.exec(t);
  if (!match) return [t, null];
  const n = Number(match[1].replace(",", "."));
  return [t, Number.isFinite(n) ? n : null];
}

/** Loopt door de gegroepeerde regels en bouwt de artikelregels + bon-totalen op — zie _parse_artikeltabel in parser.py. */
function parseArtikeltabel(rows: Row[]): { items: ArtikelRaw[]; totals: Totals } {
  const items: ArtikelRaw[] = [];
  const totals: Totals = {
    klantenkaart: null,
    totaal_aantal_stuks: null,
    subtotaal: null,
    bonus_korting: null,
    bonus_box: null,
    totaal: null,
  };

  let state: "voor_tabel" | "na_header" | "artikelen" | "na_artikelen" = "voor_tabel";

  for (const row of rows) {
    const { aantal, omschrijving, prijs, bedrag, vlag } = row;

    if (state === "voor_tabel") {
      if (omschrijving === "OMSCHRIJVING") state = "na_header";
      continue;
    }

    if (state === "na_header") {
      if (omschrijving.startsWith("BONUSKAART")) {
        totals.klantenkaart = bedrag.trim() || null;
        continue;
      }
      state = "artikelen";
      // valt door naar het artikelen-blok hieronder, deze regel is al een item
    }

    if (state === "artikelen") {
      if (omschrijving === "SUBTOTAAL") {
        totals.totaal_aantal_stuks = parseAantal(aantal)[1];
        totals.subtotaal = parseBedrag(bedrag);
        state = "na_artikelen";
        continue;
      }
      if (omschrijving.startsWith("+STATIEGELD")) {
        items.push({
          type: "statiegeld",
          aantal_weergave: null,
          aantal: null,
          omschrijving: "STATIEGELD",
          stukprijs: null,
          bedrag: parseBedrag(bedrag),
          bonus: false,
        });
        continue;
      }
      if (!omschrijving) continue; // lege/overslaande regel (bv. pagina-einde), niets aan de hand
      const [aantalWeergave, aantalNum] = parseAantal(aantal);
      const stukprijs = prijs.trim() ? parseBedrag(prijs) : parseBedrag(bedrag);
      items.push({
        type: "product",
        aantal_weergave: aantalWeergave,
        aantal: aantalNum,
        omschrijving: omschrijving.trim(),
        stukprijs,
        bedrag: parseBedrag(bedrag),
        bonus: vlag.trim() === "B",
      });
      continue;
    }

    if (state === "na_artikelen") {
      if (aantal.trim() === "TOTAAL") {
        totals.totaal = parseBedrag(bedrag);
        break;
      }
      if (aantal.trim() === "BONUS") continue;
      if (aantal.trim() === "UW VOORDEEL") {
        totals.bonus_korting = parseBedrag(bedrag);
        continue;
      }
      if (omschrijving.trim() === "BONUS BOX") {
        totals.bonus_box = parseBedrag(bedrag);
        continue;
      }
      continue; // bv. "Waarvan"
    }
  }

  return { items, totals };
}

interface HeaderFooter {
  winkel_adres: string | null;
  telefoon: string | null;
  email: string | null;
  winkel_nummer: string | null;
  datum: string | null;
  betaalmethode: string | null;
  betaald_bedrag: number | null;
  spaarzegels: number | null;
}

/** Haalt adres, datum/tijd, betaalmethode en spaarzegels uit de platte tekst — zie _parse_header_en_footer in parser.py. */
function parseHeaderEnFooter(volledigeTekst: string): HeaderFooter {
  const info: HeaderFooter = {
    winkel_adres: null,
    telefoon: null,
    email: null,
    winkel_nummer: null,
    datum: null,
    betaalmethode: null,
    betaald_bedrag: null,
    spaarzegels: null,
  };

  const kopRegels: string[] = [];
  for (const regel of volledigeTekst.split("\n")) {
    if (regel.trim() === "AANTAL") break;
    kopRegels.push(regel.trim());
  }

  for (const regel of kopRegels) {
    if (!regel) continue;
    if (/^\d{3,5}$/.test(regel)) {
      info.winkel_nummer = regel;
    } else if (regel.toLowerCase().startsWith("tel:")) {
      info.telefoon = regel.slice(regel.indexOf(":") + 1).trim();
    } else if (regel.toLowerCase().startsWith("email:")) {
      info.email = regel.slice(regel.indexOf(":") + 1).trim();
    } else {
      info.winkel_adres = info.winkel_adres ? `${info.winkel_adres} ${regel}` : regel;
    }
  }

  let match = /\bDatum\n(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/.exec(volledigeTekst);
  if (match) {
    const [, dag, maand, jaar, tijd] = match;
    info.datum = `${jaar}-${maand}-${dag}T${tijd}:00`;
  }

  match = /BETAALD MET:\n([A-Za-z .]+)\n([\d,]+)/.exec(volledigeTekst);
  if (match) {
    info.betaalmethode = match[1].trim();
    info.betaald_bedrag = parseBedrag(match[2]);
  }

  match = /SPAARACTIES:\n(\d+)\ne?SPAARZEGELS?/.exec(volledigeTekst);
  if (match) {
    info.spaarzegels = Number(match[1]);
  }

  if (info.winkel_nummer === null) {
    // sommige bonnen tonen het winkelnummer niet in de kop maar alleen in de
    // voettekst, vlak voor de sluittijd/-datum, bv. "1557\n36\n131\n17:10\n27-11-2025"
    match = /\n(\d{3,5})\n\d+\n\d+\n\d{1,2}:\d{2}\n\d{1,2}-\d{1,2}-\d{4}\n/.exec(volledigeTekst);
    if (match) info.winkel_nummer = match[1];
  }

  return info;
}

export async function parsePdfReceipt(data: ArrayBuffer | Uint8Array, filename: string): Promise<{ bon: Bon; artikelen: Artikel[] }> {
  const loadingTask = getDocument({ data });
  let rows: Row[];
  let volledigeTekst: string;
  try {
    const doc = await loadingTask.promise;
    ({ rows, volledigeTekst } = await readDocument(doc));
  } finally {
    await loadingTask.destroy();
  }

  const { items, totals } = parseArtikeltabel(rows);
  const headerFooter = parseHeaderEnFooter(volledigeTekst);

  const bonId = filename.replace(/\.pdf$/i, "");
  if (!headerFooter.datum) {
    throw new Error("geen datum gevonden — mogelijk geen (herkenbare) AH-kassabon");
  }

  const bon: Bon = {
    bon_id: bonId,
    account: "",
    bestand: filename,
    bron: "pdf",
    winkel_adres: headerFooter.winkel_adres,
    winkel_nummer: headerFooter.winkel_nummer,
    telefoon: headerFooter.telefoon,
    email: headerFooter.email,
    datum: headerFooter.datum,
    totaal_aantal_stuks: totals.totaal_aantal_stuks ?? 0,
    subtotaal: totals.subtotaal,
    bonus_korting: totals.bonus_korting ?? 0,
    bonus_box: totals.bonus_box,
    totaal: totals.totaal,
    klantenkaart: totals.klantenkaart,
    betaalmethode: headerFooter.betaalmethode,
    betaald_bedrag: headerFooter.betaald_bedrag,
    spaarzegels: headerFooter.spaarzegels,
  };

  const artikelen: Artikel[] = items.map((item) => ({
    bon_id: bonId,
    account: "",
    datum: bon.datum,
    type: item.type,
    omschrijving: item.omschrijving,
    categorie: null,
    subcategorie: null,
    product_id: null,
    aantal_weergave: item.aantal_weergave,
    aantal: item.aantal,
    stukprijs: item.stukprijs,
    bedrag: item.bedrag,
    bonus: item.bonus,
  }));

  return { bon, artikelen };
}

/** Parseert meerdere PDF-bestanden; een kapotte/onverwachte PDF mag de rest van de batch niet blokkeren. */
export async function parsePdfReceipts(
  files: { name: string; data: ArrayBuffer }[],
): Promise<{ bonnen: Bon[]; artikelen: Artikel[]; warnings: string[] }> {
  const bonnen: Bon[] = [];
  const artikelen: Artikel[] = [];
  const warnings: string[] = [];

  for (const { name, data } of files) {
    try {
      const { bon, artikelen: items } = await parsePdfReceipt(data, name);
      bonnen.push(bon);
      artikelen.push(...items);
    } catch (err) {
      warnings.push(`kon ${name} niet verwerken: ${(err as Error).message}`);
    }
  }

  return { bonnen, artikelen, warnings };
}
