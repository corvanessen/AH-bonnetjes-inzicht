/**
 * Vertaalt AH's eigen productindeling (mainCategory / subCategory uit de
 * AH-zoek-API, opgehaald via de extensie) naar onze categorieën.
 *
 * Per AH-hoofdcategorie een standaardcategorie; voor gemengde hoofdcategorieën
 * (Diepvries, "Borrel, chips, snacks", ...) eerst een paar trefwoorden op de
 * AH-subcategorie. De subcategorie leiden we af met onze eigen SUB_REGELS op
 * de (onafgekapte) AH-subcategorienaam, bv. "Halfvolle melk" -> melk.
 */
import { categoriseerSub, ONBEKEND, type AhCategorie } from "./categorize";

type Uitzondering = [trefwoorden: string[], categorie: string, subcategorie?: string];

interface Hoofdcategorie {
  categorie: string | null;
  uitzonderingen?: Uitzondering[];
}

const HOOFDCATEGORIEEN: Record<string, Hoofdcategorie> = {
  "Aardappel, groente, fruit": { categorie: "groente", uitzonderingen: [[["fruit", "appel", "banaan", "bessen", "druif", "meloen"], "fruit"]] },
  "Groente, aardappelen": { categorie: "groente" },
  "Fruit, verse sappen": {
    categorie: "fruit",
    uitzonderingen: [[["sap", "smoothie"], "dranken", "sap"], [["appelmoes", "compote"], "bakwaren", "appelmoes"]],
  },
  "Zuivel, eieren": { categorie: "zuivel" },
  "Kaas": { categorie: "zuivel", uitzonderingen: [[["spread", "smeerkaas"], "broodbeleg", "smeermeuk"]] },
  "Vlees": { categorie: "vlees & vleesvervangers", uitzonderingen: [[["vega", "vegetarisch"], "vlees & vleesvervangers", "niet vlees"]] },
  "Vis": { categorie: "vlees & vleesvervangers", uitzonderingen: [[["salade"], "broodbeleg", "smeermeuk"]] },
  "Vleeswaren": { categorie: "broodbeleg", uitzonderingen: [[["gehakt", "filet americain"], "broodbeleg", "vleesbeleg"]] },
  "Vegetarisch, vegan en plantaardig": {
    categorie: "vlees & vleesvervangers",
    uitzonderingen: [
      [["hummus"], "broodbeleg", "smeermeuk"],
      [["drink", "melk", "kwark", "yoghurt", "romige", "kookalternatief"], "zuivel", "niet-melk"],
    ],
  },
  "Bakkerij": {
    categorie: "brood & bakkerij",
    uitzonderingen: [[["meel", "bloem", "mix", "garnering"], "bakwaren"], [["donut", "muffin", "eierkoek", "cake", "gebak", "taart"], "snoep & snacks"]],
  },
  "Ontbijtgranen, beleg": {
    categorie: "broodbeleg",
    uitzonderingen: [[["muesli", "granola", "cruesli", "havermout", "cornflakes", "ontbijtgranen"], "ontbijt"]],
  },
  "Koek, snoep, chocolade": { categorie: "snoep & snacks" },
  "Borrel, chips, snacks": {
    categorie: "snoep & snacks",
    uitzonderingen: [
      [["salade", "tapenade"], "broodbeleg", "smeermeuk"],
      [["worst", "salami", "fuet", "tapas"], "vlees & vleesvervangers", "tussendoor"],
      [["aioli", "dipsaus"], "sauzen", "saus"],
    ],
  },
  "Tussendoortjes": { categorie: "snoep & snacks" },
  "Frisdrank, sappen, water": { categorie: "dranken" },
  "Koffie, thee": { categorie: "dranken", uitzonderingen: [[["koffieroom", "koffiemelk", "creamer"], "zuivel"]] },
  "Bier, wijn, aperitieven": { categorie: "dranken" },
  "Pasta, rijst, wereldkeuken": {
    categorie: "pasta en rijst",
    uitzonderingen: [
      [["tomaten", "passata", "frito"], "groente", "tomaten"],
      [["saus", "ketjap", "sambal"], "sauzen", "saus"],
      [["kruiden", "mix"], "kruiden, olie en condimenten", "kruiden"],
      [["tortilla", "wrap", "taco", "naan"], "brood & bakkerij", "wraps"],
      [["kroepoek"], "snoep & snacks", "chips"],
      [["conserven"], "groente"],
    ],
  },
  "Soepen, sauzen, kruiden, olie": {
    categorie: "kruiden, olie en condimenten",
    uitzonderingen: [
      [["soep"], "kant en klaar", "soep"],
      [["mayonaise", "ketchup", "mosterd", "saus", "jus"], "sauzen"],
    ],
  },
  "Maaltijden, salades": {
    categorie: "kant en klaar",
    uitzonderingen: [
      [["pasta"], "pasta en rijst", "pasta"],
      [["aardappelsalade"], "groente", "aardappelen"],
      [["pannenkoek", "poffertjes"], "snoep & snacks"],
      [["suiker"], "bakwaren", "suiker"],
      [["pizzabodem mix"], "bakwaren"],
    ],
  },
  "Diepvries": {
    categorie: "kant en klaar",
    uitzonderingen: [
      [["ijs", "ijsjes"], "snoep & snacks", "ijs"],
      [["aardappel", "rosti", "friet", "frites"], "groente", "aardappelen"],
      [["groente", "spinazie", "broccoli", "bonen"], "groente"],
      [["fruit", "bessen", "aardbei"], "fruit"],
      [["kip", "kroket", "frikandel", "vlees", "vis"], "vlees & vleesvervangers"],
      [["croissant", "brood"], "brood & bakkerij"],
    ],
  },
  "Glutenvrij": { categorie: null },
  "Drogisterij": { categorie: "persoonlijke verzorging" },
  "Gezondheid en sport": { categorie: "persoonlijke verzorging", uitzonderingen: [[["vitamine", "magnesium", "calcium", "ijzer"], "persoonlijke verzorging", "vitamines"]] },
  "Baby en kind": { categorie: "persoonlijke verzorging" },
  "Huishouden": { categorie: "huishouden & schoonmaak" },
  "Koken, tafelen, vrije tijd": { categorie: "huishouden & schoonmaak" },
  "Huisdier": { categorie: "huisdieren" },
  "AH Bloemenshop": { categorie: "overig" },
};

/** `null` als AH de categorie niet kent of we er niets zinnigs mee kunnen. */
export function vertaalAh(ahCategorie: string | null, ahSubcategorie: string | null): AhCategorie | null {
  if (!ahCategorie) return null;
  const hoofd = HOOFDCATEGORIEEN[ahCategorie];
  if (!hoofd) return null;
  const sub = (ahSubcategorie ?? "").toLowerCase();

  let categorie = hoofd.categorie;
  let subcategorie: string | null = null;
  for (const [trefwoorden, cat, subcat] of hoofd.uitzonderingen ?? []) {
    if (trefwoorden.some((t) => sub.includes(t))) {
      categorie = cat;
      subcategorie = subcat ?? null;
      break;
    }
  }
  if (!categorie) return null;

  if (!subcategorie && ahSubcategorie) {
    const afgeleid = categoriseerSub(ahSubcategorie.toUpperCase(), categorie, null, {});
    subcategorie = afgeleid === ONBEKEND ? null : afgeleid;
  }
  return { categorie, subcategorie };
}
