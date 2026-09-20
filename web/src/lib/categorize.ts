/**
 * Port of ah_receipts/categorisatie.py.
 *
 * Same substring-matching approach as the Python original (AH receipt
 * descriptions are hard-truncated at 13 characters, so keywords must match
 * anywhere in the word, not just as whole words). Keep REGELS/SUB_REGELS in
 * sync with the Python source if that ever changes.
 *
 * Unlike the Python version (which keeps a module-level override cache
 * backed by CSV files on disk), overrides are passed in explicitly and
 * persisted by the caller (see db.ts) — there is no shared filesystem here,
 * only this browser's IndexedDB.
 */

export const ONBEKEND = "overig";

export const REGELS: [string, string[]][] = [
  ["zuivel", [
    "MELK", "YOGH", "KWARK", "KAAS", "ROOM", "CREME FR", "BOTER", "MRG",
    "MARGARINE", "HALVARINE", "EIEREN", "OATLY", "SOJADRINK", "SOJA GURT",
    "SKYR", "OPTIMEL", "ALPRO", "BARISTA OAT", "HAVERDR", "MOZZA", "BURRATA",
    "PADANO", "PARMIGGIANO", "PARMESAN", "CAMEMBERT", "GOUDSE", "DZH ",
    "BELEGEN", "PHILADELPHIA", "VIOLIFE", "GRIEKS", "VIFIT", "FETA",
    "BEEMSTER", "RUSTIQUE", "TULIPE", "RASP", "SMEERBAAR", "VLA", "MOZ", "ZAANLANDER",
  ]],
  ["groente", [
    "SPINAZIE", "KOMKOM", "COURGETT", "KNOFLOOK", "CHAMPIGN", "ARTISJOK",
    "PETERSEL", "TOMAAT", "TOMATEN", "SNOEPGR", "TUINERWT", "RUCO", "ZUURKOOL",
    "AVOC", "PEEN", "BASILICU", "SUGAR SNAPS", "DILLE",
    "AARDAPPEL", "AARDAPPE", "ANDIJVIE", "ASPERGE", "AUBERGINE", "AUGURK",
    "BROCCOLI", "BROC", "BLOEMKOO", "RODE KOOL", "SPITSKOOL", "CHINESE KOOL",
    "KOOLRABI", "KOOL", "SPRUITJES", "PAKSOI", "PREI", "GELE UI", "RODE UI",
    "SJALOT", "ZILVERUI", "IJSBERGSLA", "BIO SLA", "BLEEKSELDER", "SELDERIJ",
    "GRIL PAPRIKA", "BIO PAPRIKA", "PAPRIKA", "KORIAND", "GEMBER", "KRIEL",
    "KIDNEYBONEN", "WITTE BONEN", "WIT BONEN", "CHILIBONEN", "HAK BONEN",
    "HAK LINZEN", "LINZEN", "KIKKERERWT", "SHIITAKE", "BIO OESTER", "WITLOF",
    "ZWAMMEN", "MAISKORREL", "BOND MAIS", "BONDUELLE", "SPERZIEBOON",
    "SPERZIEBONEN", "FRIET", "FRITES", "RODE PEP", "BIO CHERRY",
  ]],
  ["fruit", [
    "BANAAN", "BANANEN", "SINAASAPPEL", "GRANAATAPPEL", "BESSE", "BIO BES",
    "BLAUWEBES", "CRANBERR", "WATERMELOEN", "AARDBEI", "NECTARINE", "ELSTAR",
    "BRAMEN", "FRAMBOOS", "FRAMBOZEN", "DRUIF", "DRUIVEN", "LIMOEN", "MANGO",
    "PLUOT", "CITR", "CITROEN", "KERS", "PERZIK", "ZOMERFR", "PINK LADY",
    "PINK MUSCAT", "BLAUWE BES", "AH BIO APPEL",
  ]],
  ["vlees & vleesvervangers", [
    "GEHAKT", "SALAMI", "FUET", "SCHNITZ", "BOCKWORST", "SPEKC", "KIPFI",
    "VIVERA", "BEYOND", "VEGETARISCHE", "VEGGIE", "KIPSTU", "KALKOEN",
    "KIPSATE", "CHORIZO", "WORS", "FRIKANDEL", "KROKET", "STOOFSTUK",
    "VS BEEF", "FILET AMERIC", "FILETSTUK", "GER HAM", "GER ZALM", "HAM",
    "SPEK", "IBERICO", "DRUMSTICK", "HAMBURGER", "GARDEN GOURM", "VEG SLAGER",
    "VEGA SLAGER", "PLANT HAM", "VEG REEP", "TEMPEH", "TOFU", "BAPAO", "TONIJN",
    "SCHELPEN", "SHOARMA", "BALLETJES", "FRANKFURT", "JACKFRUIT", "CORDON BL",
    "MAKREEL", "KASMI", "MORA ", "KWEKKEB", "LECK BURGER", "STEGEMAN",
    "AH BIO KIP", "SALAM",
  ]],
  ["brood & bakkerij", [
    "STOKBROOD", "WASA", "TORT WRAP", "WRAP",
    "VOLK PANN", "RUIJTER", "L&P", "L P B", "LP ", "SPELT",
    "VOLK BOL", "VOLK STOKBR", "VOLKOR", "TIJGER WIT", "TIJGER VOLK",
    "TIJGER MAIS", "WITTE BOL", "WITTE PITA", "SPELT PITA", "DESEM", "OERD ",
    "VLOER", "WALDK", "BAKKERSBROOD", "BAKKERSBOL", "HEEL BAKKERS",
    "PAN DE CRIST", "KAISERBR", "HAMB BR GR", "LIBANEES BR", "BROODMAND",
    "SUIKERBROOD", "CROISSANT", "STROOPWAFEL", "ONTBIJTKOEK", "PEIJNENBURG",
    "KANDIJKOEK", "GEVULDE KOEK", "DONUT", "APPELFLAP", "ROZE KOEKEN",
    "BESCHUIT", "BOLLETJE", "MATZES", "COCO POPS", "FLATBREAD", "HAGEL", "NAAN",
    "KNACKEBROD",
  ]],
  ["ontbijt", [
    "MUESLI", "CRUESLI", "HAVERMOUT", "VLOKKEN", "GRANOLA", "BRINTA", "FLAKES",
    "KELLOGG", "GRANEN",
  ]],
  ["snoep & snacks", [
    "CHIPS", "CHOC", "SNICKERS", "TWIX", "BOUNTY", "NOOT", "NOTEN", "PINDA",
    "RICOLA", "SKUUMKOPPE", "BLACK JACK", "TORTILLA", "RIJSTWAF", "MUFFIN",
    "DORITOS", "CHEETOS", "PRINGLES", "BUGLES", "PROPERCORN", "POPCORN",
    "TUC ", "CRACKERS", "SCROCCHI", "KATJA", "HARIBO", "RED BAND", "TROLLI",
    "CHUPA CHUPS", "MENTOS", "KITKAT", "M&M ", "MALTESERS", "MILKA", "PENOTTI",
    "LOOK O LOOK", "KLENE DROP", "LOTUS", "PINBALLS", "DEXTRO", "LION SNACK",
    "FUN GUM", "COTE D'OR", "KRUIDNOTEN", "PAASHAAS", "DIGESTIVE", "FOURRE",
    "NAT VALLEY", "THIN CRISP", "BORRELNOTEN", "LAY'S", "BISCUIT", "BOOMSTAM",
    "MAGNUM IJS", "SCHEPIJS", "BIO IJS", "REEP", "SPECULAAS", "TABLET",
    "KROEPOEK", "MAISWAF", "PECAN", "DANISH CHEF", "JORDAN", "MIKADO",
  ]],
  ["dranken", [
    "AFFLIG", "DRUIF FL", "HERTOG JAN", "LEFFE", "GRIMBERGEN", "WESTMALLE",
    "LA CHOUFFE", "LA TRAPPE", "TRAPPE", "ST BERNARDUS", "GULPENER", "BRUGSE ZOT",
    "OMER BLOND", "BIO BLOND", "TEXELS", "DUVEL", "LEFORT", "OLD AMSTERDM",
    "ZUNDERT", "FAT BASTARD", "MEDOC", "CONO SUR", "ADOBE CHARD", "BAGLIO AVOL",
    "T IJ ", "AMSTERDAM RE", "STR HENDRIK", "SPA INTENSE", "COCA-COLA",
    "DR PEPPER", "FUZE TEA", "CLIPPER", "LIPTON", "ICE TEA", "DE KOFFIE",
    "CAFE INTEN", "STARB COFFEE", "SIROOP", "WIJN", "ST. PAULI",
    "KARVAN", "BIONADE", "BLOOKER", "DRINK FL", "WATER", "PERLA", "THEE",
    "SIMON LEVELT", "AH SAP", "AH BIO SAP",
  ]],
  ["huishouden & schoonmaak", [
    "WASMIDDEL", "SCHOONMAAK", "AFWAS", "VAATWAS", "TOILETPAPIER", "WC EEND",
    "FINISH VAAT", "VAAT TAB", "ECOVER", "REINIGER", "VUILNISZAK", "KEUKENPAPIER",
    "AH FOLIE", "AH PAPIER", "BAKVELLEN", "HOUTSKOOL", "BOLSIUS", "VARTA",
    "PHILIPS LED", "BOODSCH TAS", "FILTERZAK", "TISSUE", "KOFFIEFIL", "MELITTA",
  ]],
  ["persoonlijke verzorging", [
    "TANDPASTA", "TANDP", "SHAMPOO", "ELMEX", "DEO", "ZEEP", "NIVEA",
    "PARODONTAX", "ORAL B", "ANDRELON", "LIBRESSE", "MAANDVERB", "GILL VENUS",
    "HANSAPL", "TIGER BALM", "NATRUE",
  ]],
];

export const SUB_REGELS: Record<string, [string, string[]][]> = {
  "snoep & snacks": [
    ["chocolade", [
      "CHOC", "SNICKERS", "TWIX", "BOUNTY", "KITKAT", "M&M ", "MALTESERS",
      "MILKA", "COTE D'OR", "PENOTTI", "TABLET", "REEP", "PAASHAAS", "PAASEI", "LION",
    ]],
    ["chips", [
      "CHIPS", "DORITOS", "CHEETOS", "PRINGLES", "BUGLES", "PROPERCORN",
      "POPCORN", "TORTILL", "LAY'S", "KROE", "MAISWAF", "BORRELNOTEN",
      "CHIO", "PRETZEL", "SOEPSTENGEL", "TUC", "THIN CRISP", "TYRRELLS",
    ]],
    ["snoep", [
      "HARIBO", "RED BAND", "REDBAND", "TROLLI", "CHUPA CHUPS", "MENTOS",
      "KLENE DROP", "LOOK O LOOK", "PINBALLS", "DEXTRO", "FUN GUM", "KATJA",
      "BLACK JACK", "SKUUMKOPPE", "KRUIDNOTEN", "LOTUS", "DIGESTIVE", "FOURRE",
      "RICOLA", "MAOAM", "WILHELMINA",
    ]],
    ["koekjes", [
      "COOKIE", "KOEKJES", "GEVULDE KOEK", "ROZE KOEK", "MIKADO", "PRINCE",
      "SULTANA", "MUFFIN", "DANISH CHEF", "RIJSTWAF", "SCROCCHI", "DONUT",
      "BISCUIT", "SPECULAAS", "ZAANS HUISJE", "WAFEL", "KOKOSBROOD", "VERKADE",
    ]],
    ["noten", ["NOTEN", "NOOT", "PINDA", "PECAN", "STUDENTHVR", "AMAND", "CASHEW", "WALNOT"]],
    ["ijs", ["IJS", "MAGNUM", "CORNETTO", "RUIMTEIJSJES", "JERRYS"]],
  ],
  "dranken": [
    ["bier", [
      "AFFLIG", "HERTOG JAN", "LEFFE", "GRIMBERGEN", "WESTMALLE", "LA CHOUFFE",
      "LA TRAPPE", "TRAPPE", "ST BERNARDUS", "GULPENER", "BRUGSE ZOT", "OMER",
      "BIO BLOND", "TEXELS", "DUVEL", "LEFORT", "OLD AMSTERDM", "ZUNDERT",
      "T IJ ", "AMSTERDAM RE", "STR HENDRIK", "SKUUMKOPPE", "TRIPEL KARME",
      "ST. PAULI",
    ]],
    ["wijn", ["WIJN", "CHARD", "CONO SUR", "BAGLIO", "FAT BASTARD", "MEDOC"]],
    ["thee", ["THEE", "TEA", "CLIPPER", "LIPTON", "SIMON LEVELT", "KAMILLE"]],
    ["koffie", ["KOFFIE", "COFFEE", "CAFE INTEN", "BLOOKER", "PERLA", "BONEN"]],
    ["fris", [
      "COCA-COLA", "DR PEPPER", "FRIS FABRIEK", "BIONADE", "SIROOP", "KARVAN",
      "SPRINGTIJ", "BIO SIR", "KOLA", "FRITZ",
    ]],
    ["water", ["WATER", "SPA INTENSE"]],
    ["sap", ["SAP", "APPELSIEN"]],
  ],
  "brood & bakkerij": [
    ["stokbrood", ["STOK", "BAGUETTE"]],
    ["broodjes", [
      "CROISSANT", "BOL", "KAISER", "TURKS BROODJ", "BRIOCHE", "HAMB BR",
      "ROND VOLKOR", "ROND WIT", "PUNTJE", "TRIANGEL", "SAUCIJZEN",
    ]],
    ["pita", ["PITA"]],
    ["wraps", ["WRAP"]],
    ["knackebrot", ["WASA", "KNACKEBROD", "CRACKRS"]],
    ["ontbijtkoek", ["ONTBIJTKOEK", "PEIJNENBURG", "KANDIJKOEK", "STROOPWAFEL"]],
    ["brood", [
      "VLOER", "OERD", "DESEM", "TIJGER", "BAKKERS", "SPELT", "L&P", "LP ",
      "LIBANEES", "FLATBR", "BROOD", "PANN", "NAAN", "WALDK",
    ]],
  ],
  "fruit": [
    ["bananen", ["BANA"]],
    ["aardbeien", ["AARDBEI"]],
    ["appels", ["ELSTAR", "JONAGOLD", "APPELTJ"]],
    ["citrusvruchten", ["CITR", "SINAASAPPEL", "LIMOE", "GRAPEFRUIT", "MANDARYN", "MANDARIJN"]],
    ["bessen", ["BES", "FRAMBO", "BRAMEN", "CRANBERR", "ZOMERFR", "ROOD FRUIT"]],
    ["druiven", ["DRUI"]],
    ["watermeloen", ["WATERMELOEN"]],
    ["kersen", [" KERS"]],
    ["perziken", ["PERZIK", "NECTARINE"]],
    ["mango", ["MANGO"]],
    ["peren", ["PEER", "CONFERENCE"]],
    ["ananas", ["ANANAS"]],
    ["dadels", ["DADEL"]],
  ],
  "groente": [
    ["aardappelen", [
      "AARDAPPEL", "AARDAPPE", "KRIEL", "FRIET", "FRITES", "FRIES", "SCHIJFJES",
      "AVIKO", "CRISPS", "POMMES",
    ]],
    ["tomaten", ["TOMA", "CHERRY", "MUTTI", "GEZEEF", "ROMA", "TROSTOM"]],
    ["komkommer", ["KOMKOM", "AUGURK"]],
    ["verse kruiden", ["GEMBER", "DILLE", "BASILICU", "KORIAND", "PETERSEL", "BIESLOOK"]],
    ["ui-achtigen", ["UIEN", "SJALOT", "BOSUI", "ZILVERUI", "RODE UI", "GELE UI", "KNOFLOOK", "PREI"]],
    ["peulvruchten", ["SPERZIEBOON", "SPERZIEBONEN", "TUINERWT", "ERWT", "PEULEN", "SNIJBONEN", "BOONTJES", "SUGAR SNAP"]],
    ["gedroogde bonen en linzen", [
      "LINZEN", "LNZ", "KIKKERERWT", "KIDNEYBONEN", "WIT BONEN", "WITTE BONEN",
      "CHILIBONEN", "HAK BONEN", "LIMA BONEN", "BOON", "BONEN",
    ]],
    ["wortels", ["PEEN", "WORTEL", "RADIJS", "KNOLSELDERIJ", "BIETJES", "BIET"]],
    ["vruchtgroenten", [
      "PAPRIKA", "COURGET", "AUBERGINE", "POMPOEN", "AVOC", "MAIS", "BONDUELLE",
      "RODE PEP", "JALAPENO", "FLESPOM",
    ]],
    ["bladgroenten", ["SLA", "RUCO", "ANDIJVIE", "WITLOF", "SPINAZIE", "BOERENKOOL", "SALADE"]],
    ["koolsoorten", ["KOOL", "BLOEMKOO", "BROC", "SPRUITJES", "PAKSOI"]],
    ["stengelgroenten", ["ASPERGE", "BLEEKSELDER", "SELDERIJ", "RABARBER", "VENKEL", "ARTISJOK"]],
    ["paddenstoelen", ["CHAMPIGN", "SHIITAKE", "ZWAMMEN", "OESTER"]],
    ["snoepgroente", ["SNOEPGR"]],
  ],
  "zuivel": [
    ["kaas", [
      "KAAS", "MOZ", "CAMEMBERT", "GOUDSE", "PADANO", "BRIE", "BEEMSTER",
      "BOERENKAAS", "BURRATA", "DZH", "GALB", "RASP", "TULIPE", "RUSTIQUE",
      "VIOLIFE", "ZAANLANDER", "PHILADELPHIA",
    ]],
    ["boter", ["MARGARINE", "BLUE BAND", "BLUE B", "HALVARINE", "MRG", "SMEERBAAR"]],
    ["yoghurt", ["GURT", "YOGH", "KWARQ", "SKYR", "VIFIT", "OPTIMEL", "TERRA YOGH"]],
    ["niet-melk", ["HAVERDR", "OAT", "HAVER", "SOJADRINK", "SOJA", "KOKOSMELK", "KOKOS", "COCONUT", "ALPRO", "RIJSTDRINK"]],
    ["eieren", ["EIEREN"]],
    ["room", ["CREME FR", "SLAGROOM", "SOUR CR"]],
    ["ijs", ["ROOMIJS"]],
    ["vla", ["VLA"]],
    ["melk", ["MELK"]],
  ],
  "persoonlijke verzorging": [
    ["maandverband", ["MAANDVERB", "MAANVERB", "MAANDVB", "ALWAYS", "LIBRESSE"]],
    ["tandpasta", ["TANDP", "ELMEX", "DONTAX", "ORAL B"]],
    ["douche en shampoo", ["ANDRELON", "NIVEA DOUCHE", "SHAMPOO", "DOUCHE"]],
    ["zonnebrand", ["ZONNEBRAND", "NIVEA SUN"]],
    ["scheren", ["VENUS", "GILLETTE"]],
    ["pleisters", ["HANSAPL"]],
    ["vitamines", ["DAVITAMON"]],
  ],
  "vlees & vleesvervangers": [
    ["niet vlees", [
      "PLANT ", "SEIT", "TEMPEH", "TOFU", "VEG", "BEYOND", "GARDEN GOURM",
      "JACKFRUIT", "KASMI", "VS ", "VIV", "KAASSCHNITZ", "KROK SCHNITZ",
    ]],
    ["vis", ["ZALM", "TONIJN", "MAKREEL"]],
    ["tussendoor", ["BAPAO", "CHORIZO", "FUET", "IBERICO", "TAPAS"]],
    ["vlees", [
      "FRANKFURT", "FRIKANDEL", "HAMBURGER", "KALKOEN", "RULGEHAKT", "SHOARMA",
      "SPEK", "WORST", "KALFSKROKET", "KIPGEHAKT", "KIPSCHNITZEL", "DRUMSTICK",
      "ONTBIJTSPEK", "ROOKWORST", "SCHNITZEL", "SALAM", "KIP",
    ]],
  ],
  "broodbeleg": [
    ["hagelslag", ["HAGEL", "RUIJTER", "VLOKKEN"]],
    ["honing en stroop", ["HONING", "STROOP"]],
    ["jam", ["JAM", "BONNE MAMAN", "BONNEMAMAN"]],
    ["pindakaas", ["PINDAKAAS"]],
    ["chocopasta", ["NOCCIOLA", "CHOCOPASTA", "NUTELLA"]],
    ["smeermeuk", ["HUMMUS", "BABA GAN", "ZUIVELSPR", "PHILADELPHIA", "JOHMA", "SPREAD"]],
    ["vleesbeleg", [
      "HAM", "SALAMI", "LEVERWORST", "GRILLWORST", "BRAADWORST", "THEEWORST",
      "SCHOUDERHAM", "KIPFILET", "KIPBRAADW", "STEGEMAN", "WORST",
    ]],
  ],
  "pasta en rijst": [
    ["pasta", [
      "PASTA", "LASAGNE", "FARFA", "FSLLI", "MACAR", "PENNE", "SPAGHETT",
      "CANNELINI", "FUSILLI", "GNOCCHI", "TAGLIATEL", "COUSC",
    ]],
    ["rijst", ["RIJST", "BASMATI", "RICE", "BULGUR", "ORZO", "QUINOA"]],
    ["noodles", ["NOEDEL", "NOODL", "MIENESTJE"]],
  ],
  "sauzen": [
    ["ketchup", ["KETCH"]],
    ["mayonaisse", ["MAYO", "HELLMANNS", "REMIA"]],
    ["mosterd", ["MOSTERD", "DIJON"]],
    ["saus", ["SAUS", "DIP"]],
  ],
  "bakwaren": [
    ["suiker", ["SUIKER"]],
    ["bloem", ["BLOEM", "MEEL", "STEENGEMALEN"]],
    ["siroop", ["MAPLE"]],
    ["appelmoes", ["APPELM"]],
    ["vanille", ["VANILLA"]],
    ["bakmiddelen", ["BACKIN", "BLADERDEEG"]],
  ],
  "kruiden, olie en condimenten": [
    ["azijn", ["AZIJN"]],
    ["bouillon", ["BOUILLON"]],
    ["olie", ["OLIE", "BERTOLLI"]],
    ["pesto", ["PESTO"]],
    ["tomatenmeuk", ["PASSATA", "TOM PUREE", "MUTTI"]],
    ["aziatische sauzen", ["BAMI", "BOEMBOE", "KETJAP", "SAMBAL", "PATAK"]],
    ["kruiden", [
      "TIJM", "MUNT", "HARISSA", "ITALIAANSE", "MOSTERDZAAD", "VERSTEGEN",
      "OREGANO", "STERANIJS", "ZWART PEP", "KEUKENZOUT", "CURRY", "KAPPERTJES", "MAIZENA",
    ]],
  ],
  "huishouden & schoonmaak": [
    ["elektra", ["PHILIPS", "VARTA", "LED"]],
    ["koffiefilters", ["KOFFIEFIL", "FILTERZAK", "MELITTA"]],
    ["schoonmaakspullen", [
      "AFVALZAK", "PAPIER", "REINIGER", "TISSUE", "VAAT", "ECOVER", "FINISH",
      "PANNENSPONS", "SCHIMMELREIN", "SERVET", "VUILNISZAK", "FOLIE",
      "BAKVELLEN", "BOODSCH TAS",
    ]],
  ],
  "huisdieren": [
    ["eten", ["FELIX", "WHISKAS", "ZALM", "GELEI"]],
    ["kattenbak", ["KATTENBAK"]],
  ],
};

/** description -> [threshold price, category/subcategory below it, category/subcategory at/above it] */
export const PRIJS_AMBIGU: Record<string, [number, string, string]> = {
  "AH BIO PASTA": [2.5, "pasta en rijst", "broodbeleg"],
};
export const PRIJS_AMBIGU_SUB: Record<string, [number, string, string]> = {
  "AH BIO PASTA": [2.5, "pasta", "chocopasta"],
};

export function categoriseer(
  omschrijving: string,
  bedrag: number | null | undefined,
  overrides: Record<string, string>,
): string {
  const ambigu = PRIJS_AMBIGU[omschrijving];
  if (ambigu && bedrag != null) {
    const [drempel, laag, hoog] = ambigu;
    return bedrag >= drempel ? hoog : laag;
  }
  if (omschrijving in overrides) return overrides[omschrijving];
  for (const [categorie, trefwoorden] of REGELS) {
    if (trefwoorden.some((t) => omschrijving.includes(t))) return categorie;
  }
  return ONBEKEND;
}

export function categoriseerSub(
  omschrijving: string,
  categorie: string,
  bedrag: number | null | undefined,
  subOverrides: Record<string, string>,
): string {
  const ambigu = PRIJS_AMBIGU_SUB[omschrijving];
  if (ambigu && bedrag != null) {
    const [drempel, laag, hoog] = ambigu;
    return bedrag >= drempel ? hoog : laag;
  }
  if (omschrijving in subOverrides) return subOverrides[omschrijving];
  for (const [subcategorie, trefwoorden] of SUB_REGELS[categorie] ?? []) {
    if (trefwoorden.some((t) => omschrijving.includes(t))) return subcategorie;
  }
  return ONBEKEND;
}
