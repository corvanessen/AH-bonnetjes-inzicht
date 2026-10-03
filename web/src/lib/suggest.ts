/**
 * Voorstellen voor producten die nog als "overig" ingedeeld zijn, op basis van
 * gelijkende producten die wél een categorie hebben (je eigen bonnetjes plus
 * correcties). Bonomschrijvingen zijn afgekapt (13 tekens), dus naast hele
 * woorden tellen ook woordbegins mee: "KIPSPIESJES" lijkt op "KIPSPIES".
 * Zeldzame woorden wegen zwaarder dan veelvoorkomende ("AH", "BIO").
 */
import { ONBEKEND, type AhCategorie } from "./categorize";

export interface Gelabeld {
  omschrijving: string;
  categorie: string;
  subcategorie: string | null;
}

export interface Voorstel {
  categorie: string;
  subcategorie: string | null;
  /** 0..1 — aandeel van de stemmen voor de winnende categorie, gedempt bij weinig bewijs. */
  zekerheid: number;
  reden: string;
}

const STOPWOORDEN = new Set(["AH", "BIO", "DE", "HET", "EN", "MET", "VAN", "FL", "XL", "NED", "LOS"]);

function woorden(omschrijving: string): string[] {
  return omschrijving
    .toUpperCase()
    .split(/[^A-Z0-9ÀÁÂÄÈÉÊËÏÖÜ&']+/)
    .filter((w) => w.length >= 2 && !STOPWOORDEN.has(w) && !/^\d+$/.test(w));
}

function kenmerken(omschrijving: string): Set<string> {
  const k = new Set<string>();
  for (const w of woorden(omschrijving)) {
    k.add(`w:${w}`);
    // Woordbegins vanaf 4 tekens: vangen afkapping en samenstellingen op.
    for (let n = 4; n < Math.min(w.length, 9); n++) k.add(`p:${w.slice(0, n)}`);
  }
  return k;
}

export class Voorsteller {
  private items: { label: Gelabeld; kenmerken: Set<string> }[] = [];
  private df = new Map<string, number>();
  private perKenmerk = new Map<string, number[]>();

  constructor(gelabeld: Gelabeld[]) {
    const gezien = new Set<string>();
    for (const label of gelabeld) {
      if (label.categorie === ONBEKEND || gezien.has(label.omschrijving)) continue;
      gezien.add(label.omschrijving);
      const k = kenmerken(label.omschrijving);
      const index = this.items.push({ label, kenmerken: k }) - 1;
      for (const f of k) {
        this.df.set(f, (this.df.get(f) ?? 0) + 1);
        const lijst = this.perKenmerk.get(f) ?? [];
        lijst.push(index);
        this.perKenmerk.set(f, lijst);
      }
    }
  }

  private gewicht(kenmerk: string): number {
    const df = this.df.get(kenmerk) ?? 0;
    // Hele woorden tellen zwaarder dan losse woordbegins.
    const basis = kenmerk.startsWith("w:") ? 1.5 : 1;
    return basis * Math.log(1 + this.items.length / (1 + df));
  }

  stelVoor(omschrijving: string, ah: AhCategorie | null = null): Voorstel | null {
    const eigen = kenmerken(omschrijving);
    const gelijkenis = new Map<number, number>();
    for (const f of eigen) {
      const w = this.gewicht(f);
      for (const i of this.perKenmerk.get(f) ?? []) gelijkenis.set(i, (gelijkenis.get(i) ?? 0) + w);
    }

    const buren = [...gelijkenis]
      .filter(([i]) => this.items[i].label.omschrijving !== omschrijving)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7);

    const stemmen = new Map<string, number>();
    for (const [i, sim] of buren) {
      const cat = this.items[i].label.categorie;
      stemmen.set(cat, (stemmen.get(cat) ?? 0) + sim);
    }
    // AH's eigen indeling weegt zwaar: die kijkt naar het echte product, niet naar de afgekapte naam.
    const ahGewicht = ah ? Math.max(4, (buren[0]?.[1] ?? 0) * 2) : 0;
    if (ah) stemmen.set(ah.categorie, (stemmen.get(ah.categorie) ?? 0) + ahGewicht);
    if (stemmen.size === 0) return null;

    const totaal = [...stemmen.values()].reduce((s, v) => s + v, 0);
    const [categorie, score] = [...stemmen].sort((a, b) => b[1] - a[1])[0];
    // Weinig bewijs (alleen een zwakke overeenkomst) -> lagere zekerheid.
    const bewijs = Math.min(1, score / 4);
    const zekerheid = (score / totaal) * bewijs;

    const subStemmen = new Map<string, number>();
    for (const [i, sim] of buren) {
      const { categorie: c, subcategorie: s } = this.items[i].label;
      if (c === categorie && s && s !== ONBEKEND) subStemmen.set(s, (subStemmen.get(s) ?? 0) + sim);
    }
    if (ah?.categorie === categorie && ah.subcategorie) {
      subStemmen.set(ah.subcategorie, (subStemmen.get(ah.subcategorie) ?? 0) + ahGewicht);
    }
    const subcategorie = [...subStemmen].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const voorbeelden = buren
      .filter(([i]) => this.items[i].label.categorie === categorie)
      .slice(0, 3)
      .map(([i]) => this.items[i].label.omschrijving);
    const delen: string[] = [];
    if (ah?.categorie === categorie) delen.push("AH-indeling");
    if (voorbeelden.length) delen.push(`lijkt op ${voorbeelden.join(", ")}`);

    return { categorie, subcategorie, zekerheid, reden: delen.join("; ") };
  }

  /**
   * Een goed trefwoord voor een nieuwe regel op basis van deze omschrijving:
   * het woord dat in de meeste andere omschrijvingen terugkomt (zodat de regel
   * ook iets oplevert), anders het langste woord.
   */
  stelTrefwoordVoor(omschrijving: string, alleOmschrijvingen: string[]): string {
    const kandidaten = woorden(omschrijving).filter((w) => w.length >= 3);
    if (!kandidaten.length) return omschrijving.trim();
    const telling = (w: string) => alleOmschrijvingen.filter((o) => o !== omschrijving && o.includes(w)).length;
    return [...kandidaten].sort((a, b) => telling(b) - telling(a) || b.length - a.length)[0];
  }
}
