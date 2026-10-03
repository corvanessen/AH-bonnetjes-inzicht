import { describe, expect, it } from "vitest";
import {
  categoriseer,
  categoriseerSub,
  matchtGebruikersRegel,
  verklaarCategorie,
  type GebruikersRegel,
} from "./categorize";
import { vertaalAh } from "./ahTaxonomie";
import { Voorsteller } from "./suggest";

const regel = (trefwoord: string, categorie: string, subcategorie: string | null = null): GebruikersRegel => ({
  id: trefwoord,
  trefwoord,
  categorie,
  subcategorie,
});

describe("ingebouwde regels", () => {
  it.each([
    ["SNICKERS", "snoep & snacks"],
    ["AH CRACKERS", "snoep & snacks"],
    ["BAKKERSBROOD", "brood & bakkerij"],
    ["AH NED KERS", "fruit"],
    ["CARE SHAMPOO", "persoonlijke verzorging"],
    ["AH GSN CHAMP", "groente"],
    ["BROWNIE MIX", "snoep & snacks"],
    ["AH COLA", "dranken"],
    ["SCHARRELEI", "zuivel"],
  ])("%s -> %s", (omschrijving, verwacht) => {
    expect(categoriseer(omschrijving, null, {})).toBe(verwacht);
  });

  it("woordeinde-spatie: APPELS wel, APPELSAP niet als fruit", () => {
    expect(categoriseer("BIO APPELS", null, {})).toBe("fruit");
    expect(categoriseer("APPELSAP", null, {})).toBe("dranken");
  });

  it("prijs gaat voor alles, ook voor een correctie", () => {
    expect(categoriseer("AH BIO PASTA", 3.45, { "AH BIO PASTA": "overig" })).toBe("broodbeleg");
    expect(categoriseer("AH BIO PASTA", 1.1, {})).toBe("pasta en rijst");
  });
});

describe("eigen regels", () => {
  it("gaan voor de ingebouwde trefwoorden, maar na een correctie", () => {
    const regels = [regel("COLA", "snoep & snacks")];
    expect(categoriseer("AH COLA", null, {}, { regels })).toBe("snoep & snacks");
    expect(categoriseer("AH COLA", null, { "AH COLA": "dranken" }, { regels })).toBe("dranken");
  });

  it("langste trefwoord wint", () => {
    const regels = [regel("KIP", "vlees & vleesvervangers"), regel("KIPPBOUILLON", "kruiden, olie en condimenten")];
    expect(categoriseer("KIPPBOUILLON", null, {}, { regels })).toBe("kruiden, olie en condimenten");
  });

  it("los woord met spaties matcht ook aan het begin/eind, maar niet midden in een woord", () => {
    expect(matchtGebruikersRegel("KIP SATE", " KIP ")).toBe(true);
    expect(matchtGebruikersRegel("AH KIP", " KIP ")).toBe(true);
    expect(matchtGebruikersRegel("KIPSATE", " KIP ")).toBe(false);
  });

  it("subcategorie alleen binnen de eigen categorie", () => {
    const regels = [regel("TOFU", "vlees & vleesvervangers", "tofu")];
    expect(categoriseerSub("AH TOFU", "vlees & vleesvervangers", null, {}, { regels })).toBe("tofu");
    expect(categoriseerSub("AH TOFU", "zuivel", null, {}, { regels })).not.toBe("tofu");
  });

  it("verklaar geeft de bron en het trefwoord", () => {
    expect(verklaarCategorie("AH COLA", null, {})).toMatchObject({ bron: "regel", trefwoord: "COLA" });
    expect(verklaarCategorie("ONBEKEND XYZ", null, {})).toMatchObject({ bron: "onbekend", waarde: "overig" });
  });
});

describe("AH-indeling", () => {
  it("is alleen een vangnet na de trefwoorden", () => {
    const ah = { categorie: "zuivel", subcategorie: "melk" };
    expect(categoriseer("ONBEKEND XYZ", null, {}, { ah })).toBe("zuivel");
    expect(categoriseer("AH COLA", null, {}, { ah })).toBe("dranken");
  });

  it.each([
    ["Zuivel, eieren", "Halfvolle melk", "zuivel", "melk"],
    ["Diepvries", "Waterijs", "snoep & snacks", "ijs"],
    ["Diepvries", "Pizza (dunne bodem)", "kant en klaar", "pizza"],
    ["Borrel, chips, snacks", "Kipsalades (beleg)", "broodbeleg", "smeermeuk"],
    ["Pasta, rijst, wereldkeuken", "Tomatenpulp", "groente", "tomaten"],
    ["Koffie, thee", "Perla koffiebonen", "dranken", "koffie"],
  ])("%s / %s -> %s / %s", (hoofd, sub, cat, subcat) => {
    expect(vertaalAh(hoofd, sub)).toEqual({ categorie: cat, subcategorie: subcat });
  });

  it("onbekende AH-categorie geeft null", () => {
    expect(vertaalAh("Iets nieuws", "x")).toBeNull();
    expect(vertaalAh(null, null)).toBeNull();
  });
});

describe("voorstellen", () => {
  const voorsteller = new Voorsteller([
    { omschrijving: "KIPGEHAKT", categorie: "vlees & vleesvervangers", subcategorie: "vlees" },
    { omschrijving: "AH KIPFILET", categorie: "vlees & vleesvervangers", subcategorie: "vlees" },
    { omschrijving: "KIPSPIESJES", categorie: "vlees & vleesvervangers", subcategorie: "vlees" },
    { omschrijving: "AH COLA", categorie: "dranken", subcategorie: "fris" },
    { omschrijving: "COLA ZERO FL", categorie: "dranken", subcategorie: "fris" },
  ]);

  it("herkent een afgekapte variant via woordbegins", () => {
    const v = voorsteller.stelVoor("KIPSPIES MIX");
    expect(v?.categorie).toBe("vlees & vleesvervangers");
    expect(v?.subcategorie).toBe("vlees");
    expect(v?.reden).toContain("KIPSPIESJES");
  });

  it("AH-indeling weegt zwaar mee", () => {
    const v = voorsteller.stelVoor("RAAR PRODUCT", { categorie: "huisdieren", subcategorie: null });
    expect(v?.categorie).toBe("huisdieren");
    expect(v?.reden).toContain("AH-indeling");
  });

  it("geen overeenkomst -> geen voorstel", () => {
    expect(voorsteller.stelVoor("QQQQ")).toBeNull();
  });

  it("stelt het trefwoord voor dat het vaakst terugkomt", () => {
    expect(voorsteller.stelTrefwoordVoor("AH COLA", ["AH COLA", "COLA ZERO FL", "AH KIPFILET"])).toBe("COLA");
  });
});
