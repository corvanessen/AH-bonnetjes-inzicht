/**
 * Regel-miner: haalt nieuwe trefwoordregels uit handmatige correcties.
 *
 *   npx tsx scripts/mine-rules.mts --backup <pad.json> [--backup ...] [--out rapport.md] [--apply] [--min 2]
 *   npx tsx scripts/mine-rules.mts --check-sync [--backup ...]
 *
 * Werkwijze: correcties (meegeleverde defaults + overrides uit de backups) zijn
 * de waarheid. Voor elke correctie die de huidige trefwoorden fout doen, maken
 * we kandidaattrefwoorden (hele woorden, woordbegins, woordparen) en simuleren
 * we wat er gebeurt als we zo'n trefwoord aan de juiste categorie toevoegen.
 * Een kandidaat telt alleen als hij minstens --min correcties repareert, geen
 * enkele andere correctie breekt en geen al ingedeeld product verschuift.
 * Gretig: steeds de kandidaat die het meest repareert, tot er niets meer is.
 * Daarna hetzelfde per categorie voor subcategorieën.
 *
 * --apply schrijft de gekozen trefwoorden in web/src/lib/categorize.ts én
 * ah_receipts/categorisatie.py; --check-sync controleert dat die twee daarna
 * exact hetzelfde indelen.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { categoriseer, categoriseerSub, ONBEKEND, REGELS, SUB_REGELS } from "../src/lib/categorize.ts";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const TS_PAD = resolve(WEB, "src/lib/categorize.ts");
const PY_PAD = resolve(ROOT, "ah_receipts/categorisatie.py");

// ---------- argumenten ----------

const args = process.argv.slice(2);
const backups: string[] = [];
let uit: string | null = null;
let toepassen = false;
let checkSync = false;
let minSupport = 2;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--backup") backups.push(args[++i]);
  else if (args[i] === "--out") uit = args[++i];
  else if (args[i] === "--apply") toepassen = true;
  else if (args[i] === "--check-sync") checkSync = true;
  else if (args[i] === "--min") minSupport = Number(args[++i]);
  else throw new Error(`Onbekend argument: ${args[i]}`);
}

// ---------- data ----------

interface Backup {
  accounts?: { artikelen?: { omschrijving: string; type?: string }[] }[];
  overrides?: { omschrijving: string; waarde: string }[];
  subOverrides?: { omschrijving: string; waarde: string }[];
}

const leesJson = <T,>(pad: string): T => JSON.parse(readFileSync(pad, "utf8"));
const catLabels: Record<string, string> = { ...leesJson<Record<string, string>>(resolve(WEB, "src/data/categorie_overrides.json")) };
const subLabels: Record<string, string> = { ...leesJson<Record<string, string>>(resolve(WEB, "src/data/subcategorie_overrides.json")) };
const omschrijvingen = new Set<string>([...Object.keys(catLabels), ...Object.keys(subLabels)]);
for (const pad of backups) {
  const b = leesJson<Backup>(pad);
  for (const o of b.overrides ?? []) catLabels[o.omschrijving] = o.waarde;
  for (const o of b.subOverrides ?? []) subLabels[o.omschrijving] = o.waarde;
  for (const a of b.accounts ?? []) for (const x of a.artikelen ?? []) if (x.type !== "statiegeld") omschrijvingen.add(x.omschrijving);
  for (const o of [...(b.overrides ?? []), ...(b.subOverrides ?? [])]) omschrijvingen.add(o.omschrijving);
}
const alle = [...omschrijvingen].sort();

if (checkSync) {
  process.exit(controleerSync(alle) ? 0 : 1);
}

const standaardCategorieen = new Set(REGELS.map(([c]) => c));
// Zelfgemaakte categorieën (bv. "vis") kunnen geen ingebouwde regel krijgen.
const eigenCategorieLabels = Object.entries(catLabels).filter(([, c]) => c !== ONBEKEND && !standaardCategorieen.has(c));
const catWaarheid = new Map(Object.entries(catLabels).filter(([, c]) => standaardCategorieen.has(c)));

// ---------- kandidaten ----------

const STOP = new Set(["AH", "BIO", "DE", "EN", "MET", "VAN", "FL", "NED", "LOS"]);

function kandidaten(omschrijving: string): string[] {
  const woorden = omschrijving.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  const k = new Set<string>();
  for (const w of woorden) {
    // Korte woorden alleen als los woord: "KROE" zonder woordgrens vangt ook "KROEPOEK" en meer.
    if (w.length >= 5) k.add(w);
    k.add(`${w} `);
    // Woordbegins pas vanaf 5 tekens: korter ("MAAN", "KROE") vangt later te veel mee.
    for (let n = 5; n < w.length; n++) k.add(w.slice(0, n));
  }
  const delen = omschrijving.split(/\s+/);
  for (let i = 0; i + 1 < delen.length; i++) if (!STOP.has(delen[i])) k.add(`${delen[i]} ${delen[i + 1]}`);
  return [...k].filter((t) => t.trim().length >= 4);
}

const bevat = (omschrijving: string, t: string) => `${omschrijving} `.includes(t);

// ---------- categorie-mining ----------

interface Voorstel {
  niveau: "categorie" | "subcategorie";
  categorie: string;
  subcategorie?: string;
  trefwoord: string;
  repareert: string[];
  bijvangst: string[];
}

function mineCategorieen(): Voorstel[] {
  const gekozen: Voorstel[] = [];
  const regelsVan = (cat: string) => REGELS.find(([c]) => c === cat)![1];
  for (;;) {
    const fout = [...catWaarheid].filter(([o, c]) => categoriseer(o, null, {}) !== c);
    let beste: Voorstel | null = null;
    const geprobeerd = new Set<string>();
    for (const [o, doel] of fout) {
      for (const t of kandidaten(o)) {
        const sleutel = `${doel}|${t}`;
        if (geprobeerd.has(sleutel)) continue;
        geprobeerd.add(sleutel);
        const geraakt = alle.filter((x) => bevat(x, t));
        const voor = new Map(geraakt.map((x) => [x, categoriseer(x, null, {})]));
        const lijst = regelsVan(doel);
        lijst.push(t);
        const na = new Map(geraakt.map((x) => [x, categoriseer(x, null, {})]));
        lijst.pop();
        const repareert: string[] = [];
        const bijvangst: string[] = [];
        let afgekeurd = false;
        for (const x of geraakt) {
          const v = voor.get(x)!, n = na.get(x)!;
          if (v === n) continue;
          const waar = catWaarheid.get(x);
          if (waar !== undefined) {
            if (n === waar) repareert.push(x);
            else { afgekeurd = true; break; }
          } else if (v !== ONBEKEND || catLabels[x]) {
            afgekeurd = true; // verschuift een al ingedeeld product, of één met een eigen categorie
            break;
          } else {
            bijvangst.push(x);
          }
        }
        if (afgekeurd || repareert.length < minSupport) continue;
        if (!beste || repareert.length > beste.repareert.length || (repareert.length === beste.repareert.length && t.length > beste.trefwoord.length)) {
          beste = { niveau: "categorie", categorie: doel, trefwoord: t, repareert, bijvangst };
        }
      }
    }
    if (!beste) return gekozen;
    regelsVan(beste.categorie).push(beste.trefwoord);
    gekozen.push(beste);
  }
}

function mineSubcategorieen(): Voorstel[] {
  const gekozen: Voorstel[] = [];
  const waarheid = [...Object.entries(subLabels)]
    .map(([o, s]) => ({ o, s, c: catLabels[o] ?? categoriseer(o, null, {}) }))
    .filter(({ c, s }) => standaardCategorieen.has(c) && s !== ONBEKEND);
  const subWaarheid = new Map(waarheid.map((w) => [w.o, w]));
  for (;;) {
    let beste: Voorstel | null = null;
    const fout = waarheid.filter(({ o, c, s }) => categoriseerSub(o, c, null, {}) !== s);
    const geprobeerd = new Set<string>();
    for (const { o, c, s } of fout) {
      const lijst = SUB_REGELS[c]?.find(([naam]) => naam === s)?.[1];
      if (!lijst) continue; // nieuwe subcategorie: handmatig toevoegen (staat in het rapport)
      for (const t of kandidaten(o)) {
        const sleutel = `${c}|${s}|${t}`;
        if (geprobeerd.has(sleutel)) continue;
        geprobeerd.add(sleutel);
        const geraakt = alle.filter((x) => bevat(x, t)).map((x) => ({ x, c: catLabels[x] ?? categoriseer(x, null, {}) })).filter((r) => r.c === c);
        const voor = new Map(geraakt.map((r) => [r.x, categoriseerSub(r.x, c, null, {})]));
        lijst.push(t);
        const na = new Map(geraakt.map((r) => [r.x, categoriseerSub(r.x, c, null, {})]));
        lijst.pop();
        const repareert: string[] = [];
        const bijvangst: string[] = [];
        let afgekeurd = false;
        for (const { x } of geraakt) {
          const v = voor.get(x)!, n = na.get(x)!;
          if (v === n) continue;
          const waar = subWaarheid.get(x);
          if (waar) {
            if (n === waar.s) repareert.push(x);
            else { afgekeurd = true; break; }
          } else if (v !== ONBEKEND) { afgekeurd = true; break; }
          else bijvangst.push(x);
        }
        if (afgekeurd || repareert.length < minSupport) continue;
        if (!beste || repareert.length > beste.repareert.length || (repareert.length === beste.repareert.length && t.length > beste.trefwoord.length)) {
          beste = { niveau: "subcategorie", categorie: c, subcategorie: s, trefwoord: t, repareert, bijvangst };
        }
      }
    }
    if (!beste) return gekozen;
    SUB_REGELS[beste.categorie].find(([naam]) => naam === beste!.subcategorie)![1].push(beste.trefwoord);
    gekozen.push(beste);
  }
}

// ---------- verdachte correcties ----------

/** Correcties die ingaan tegen een trefwoord dat bij ≥3 andere correcties altijd klopt. */
function verdachteCorrecties(): string[] {
  const uitkomst: string[] = [];
  for (const [o, label] of Object.entries(catLabels)) {
    const regel = categoriseer(o, null, {});
    if (regel === label || regel === ONBEKEND) continue;
    const trefwoord = REGELS.find(([c]) => c === regel)![1].find((t) => bevat(o, t))!;
    const anderen = Object.entries(catLabels).filter(([x]) => x !== o && bevat(x, trefwoord));
    if (anderen.length >= 3 && anderen.every(([, c]) => c === regel)) {
      uitkomst.push(`\`${o}\` staat als **${label}**, maar ‘${trefwoord.trim()}’ is bij ${anderen.length} andere correcties altijd **${regel}**`);
    }
  }
  return uitkomst;
}

// ---------- uitvoeren ----------

const voorIndeling = new Map(alle.map((o) => [o, categoriseer(o, null, {})]));
const overigVoor = alle.filter((o) => voorIndeling.get(o) === ONBEKEND).length;
const foutVoor = [...catWaarheid].filter(([o, c]) => categoriseer(o, null, {}) !== c).length;
const verdacht = verdachteCorrecties();
const catVoorstellen = mineCategorieen();
const subVoorstellen = mineSubcategorieen();
const overigNa = alle.filter((o) => categoriseer(o, null, {}) === ONBEKEND).length;
const foutNa = [...catWaarheid].filter(([o, c]) => categoriseer(o, null, {}) !== c).length;

const regels: string[] = [];
regels.push("# Regel-miner rapport", "");
regels.push(`- Bekende omschrijvingen: ${alle.length}; correcties (categorie): ${Object.keys(catLabels).length}, (sub): ${Object.keys(subLabels).length}`);
regels.push(`- Correcties die de trefwoorden fout doen: ${foutVoor} → **${foutNa}**`);
regels.push(`- Omschrijvingen die "overig" worden (zonder correcties): ${overigVoor} → **${overigNa}**`, "");
regels.push("## Voorgestelde trefwoorden (categorie)", "");
if (!catVoorstellen.length) regels.push("_geen_");
for (const v of catVoorstellen) {
  regels.push(`- **‘${v.trefwoord}’ → ${v.categorie}** — repareert ${v.repareert.length}: ${v.repareert.join(", ")}` + (v.bijvangst.length ? `; nu ook ingedeeld: ${v.bijvangst.join(", ")}` : ""));
}
regels.push("", "## Voorgestelde trefwoorden (subcategorie)", "");
if (!subVoorstellen.length) regels.push("_geen_");
for (const v of subVoorstellen) {
  regels.push(`- **‘${v.trefwoord}’ → ${v.categorie} › ${v.subcategorie}** — repareert ${v.repareert.length}: ${v.repareert.join(", ")}` + (v.bijvangst.length ? `; nu ook: ${v.bijvangst.join(", ")}` : ""));
}
regels.push("", "## Verdachte correcties", "");
regels.push(...(verdacht.length ? verdacht.map((v) => `- ${v}`) : ["_geen_"]));
regels.push("", "## Correcties met een eigen (niet-standaard) categorie", "");
const perEigen = new Map<string, string[]>();
for (const [o, c] of eigenCategorieLabels) perEigen.set(c, [...(perEigen.get(c) ?? []), o]);
regels.push(...(perEigen.size ? [...perEigen].map(([c, os]) => `- **${c}** (${os.length}): ${os.join(", ")}`) : ["_geen_"]));
regels.push("", "## Nog fout na deze voorstellen (top 40)", "");
regels.push(...[...catWaarheid].filter(([o, c]) => categoriseer(o, null, {}) !== c).slice(0, 40).map(([o, c]) => `- \`${o}\`: regels → ${categoriseer(o, null, {})}, correctie → ${c}`));

const rapport = regels.join("\n") + "\n";
if (uit) writeFileSync(uit, rapport);
else process.stdout.write(rapport);

if (toepassen && (catVoorstellen.length || subVoorstellen.length)) {
  for (const [pad, ts] of [[TS_PAD, true], [PY_PAD, false]] as const) {
    let tekst = readFileSync(pad, "utf8");
    for (const v of catVoorstellen) tekst = voegToe(tekst, ts, null, v.categorie, v.trefwoord);
    for (const v of subVoorstellen) tekst = voegToe(tekst, ts, v.categorie, v.subcategorie!, v.trefwoord);
    writeFileSync(pad, tekst);
  }
  console.error(`\n${catVoorstellen.length + subVoorstellen.length} trefwoord(en) toegevoegd aan categorize.ts en categorisatie.py.`);
  console.error("Controleer met: npx tsx scripts/mine-rules.mts --check-sync" + backups.map((b) => ` --backup "${b}"`).join(""));
}

// ---------- bestanden bijwerken ----------

function sluitendHaakje(tekst: string, open: number): number {
  let diepte = 0;
  for (let i = open; i < tekst.length; i++) {
    const ch = tekst[i];
    if (ch === '"') i = tekst.indexOf('"', i + 1);
    else if (ch === "[") diepte++;
    else if (ch === "]" && --diepte === 0) return i;
  }
  throw new Error("Geen sluitend haakje gevonden");
}

/** Voegt `trefwoord` achteraan in de lijst van (sub)categorie `naam` toe. `ouder` = categorie bij een subcategorie. */
function voegToe(tekst: string, ts: boolean, ouder: string | null, naam: string, trefwoord: string): string {
  const opener = ts ? `["${naam}", [` : `("${naam}", [`;
  let start = tekst.indexOf(ts ? "export const REGELS" : "REGELS: list");
  let eind = tekst.indexOf(ts ? "export const SUB_REGELS" : "SUB_REGELS:");
  if (ouder) {
    const p = tekst.indexOf(`"${ouder}": [`, eind);
    start = p;
    eind = sluitendHaakje(tekst, tekst.indexOf("[", p));
  }
  const idx = tekst.indexOf(opener, start);
  if (idx === -1 || idx > eind) throw new Error(`Lijst voor ${ouder ? `${ouder} › ` : ""}${naam} niet gevonden in ${ts ? "TS" : "Python"}`);
  const lb = tekst.indexOf("[", idx + opener.length - 1);
  const rb = sluitendHaakje(tekst, lb);
  const item = JSON.stringify(trefwoord);
  const ervoor = tekst.slice(lb + 1, rb);
  if (ervoor.trimEnd().endsWith(",")) {
    // Lijst over meerdere regels: nieuwe regel met dezelfde inspringing als de laatste.
    const laatsteRegel = ervoor.slice(0, ervoor.trimEnd().length).split("\n").pop()!;
    const inspring = laatsteRegel.match(/^\s*/)![0];
    const kern = ervoor.trimEnd();
    return tekst.slice(0, lb + 1) + `${kern}\n${inspring}${item},` + ervoor.slice(kern.length) + tekst.slice(rb);
  }
  return tekst.slice(0, rb) + `, ${item}` + tekst.slice(rb);
}

// ---------- TS en Python vergelijken ----------

function controleerSync(omschr: string[]): boolean {
  const py = `
import json, sys
import ah_receipts.categorisatie as c
c._OVERRIDES = {}
c._SUB_OVERRIDES = {}
uit = {}
for o in json.load(sys.stdin):
    cat = c.categoriseer(o)
    uit[o] = [cat, c.categoriseer_sub(o, cat)]
json.dump(uit, sys.stdout)
`;
  const resultaat = JSON.parse(
    execFileSync("uv", ["run", "python", "-c", py], { cwd: ROOT, input: JSON.stringify(omschr), encoding: "utf8", maxBuffer: 50e6 }),
  ) as Record<string, [string, string]>;
  let verschillen = 0;
  for (const o of omschr) {
    const cat = categoriseer(o, null, {});
    const sub = categoriseerSub(o, cat, null, {});
    const [pc, ps] = resultaat[o];
    if (cat !== pc || sub !== ps) {
      verschillen++;
      if (verschillen <= 30) console.log(`VERSCHIL ${o}: TS ${cat} › ${sub} | Python ${pc} › ${ps}`);
    }
  }
  console.log(`${omschr.length} omschrijvingen vergeleken, ${verschillen} verschil(len).`);
  return verschillen === 0;
}
