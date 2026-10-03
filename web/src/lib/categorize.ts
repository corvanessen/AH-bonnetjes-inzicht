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
  // Eigen categorieën (tot nu toe alleen via overrides gevuld) — vóór de
  // brede categorieën hieronder, anders wint bv. "KIDNEYBONEN" (groente) van
  // een bonenschotel of "KAAS" (zuivel) van pindakaas.
  ["kant en klaar", [
    "PIZZA", "PICCOLINI", "SOEP ", "SOEP IN", "ERWTENSOEP", "SCHOTEL", "SIN CARNE",
    "CHILI CON", "VERSPAKKET", "VP ", "KAISERSCHMARRN", "MAALTIJD", "GYOZA", "LOEMPIA",
    "YOPOKKI", "MAALTJD", "GRATIN", "SOUP",
  ]],
  ["huisdieren", [
    "FELIX", "WHISKAS", "KATTENBAK", "KATTENVOER", "HONDENVOER", "SHEBA", "GOURMET",
    "GOURM BL", "GOUR GOLD", "KATBAK", "ALU PATE", "PATE RUND", "ONE KAT", "ONE JUNIOR",
    "LILY KITCHEN", "CATISFACTION", "EDGARDCOOPER",
  ]],
  // Vóór zuivel/vlees: anders wint bv. "HAM" (vlees) van "CARE SHAMPOO".
  ["persoonlijke verzorging", [
    "TANDPASTA", "TANDP", "SHAMPOO", "ELMEX", "DEO", "ZEEP", "NIVEA", "PARODONTAX",
    "ORAL B", "ANDRELON", "LIBRESSE", "MAANDVERB", "GILL VENUS", "HANSAPL", "TIGER BALM",
    "NATRUE", "CARE ", "TAMPON", "SEEPJE", "SOAP", "STREPSILS", "DAKTARIN", "PARACETAMOL",
    "TANDENBORST", "BORSTEL", "REX MAX", "GOODROLL", "A VOGEL",
  ]],
  ["broodbeleg", [
    "PINDAKAAS", "HAGELSLAG", "HUMMUS", "HONING", "STROOP ", "NUTELLA", "CHOCOPASTA",
    "NOCCIOLA", "BONNE MAMAN", "BONNEMAMAN", "LEVERWORST", "GRILLWORST", "THEEWORST",
    "BRAADWORST", "SCHOUDERHAM", "SALAMI", "SPECULOOS", "GOUDKUIPJE", "FLOWER FARM",
    "ZUIVELSPR", "ROOKVLEES", "ROOKV", "CERVELAAT",
    "FILET AM",
    "KIPS ",
  ]],
  ["zuivel", [
    "MELK", "YOGH", "KWARK", "KAAS", "ROOM", "CREME FR", "BOTER", "MRG", "MARGARINE",
    "HALVARINE", "EIEREN", "OATLY", "SOJADRINK", "SOJA GURT", "SKYR", "OPTIMEL", "ALPRO",
    "BARISTA OAT", "HAVERDR", "MOZZA", "BURRATA", "PADANO", "PARMIGGIANO", "PARMESAN",
    "CAMEMBERT", "GOUDSE", "DZH ", "BELEGEN", "PHILADELPHIA", "VIOLIFE", "GRIEKS", "VIFIT",
    "FETA", "BEEMSTER", "RUSTIQUE", "TULIPE", "RASP", "SMEERBAAR", "VLA", "MOZ",
    "ZAANLANDER", "YOG", "KARNEMELK", "CAMPINA", "MU BREAKER", "MU SPECIALS", "MU SHAKE",
    "HOEVE", "MILNER", "KEFIR", "COTTAGE", "COTT CHEESE", "QUARK", "DANIO", "PATURAIN",
    "MONCHOU", "PRESIDENT", "BECEL", "SCHARRELEI", "CHEESTRING",
    "BLUE B",
    "GURT ",
    "BRIE ",
    "SOJA ",
  ]],
  ["groente", [
    "SPINAZIE", "KOMKOM", "COURGETT", "KNOFLOOK", "CHAMPIGN", "ARTISJOK", "PETERSEL",
    "TOMAAT", "TOMATEN", "SNOEPGR", "TUINERWT", "RUCO", "ZUURKOOL", "AVOC", "PEEN",
    "BASILICU", "SUGAR SNAPS", "DILLE", "AARDAPPEL", "AARDAPPE", "ANDIJVIE", "ASPERGE",
    "AUBERGINE", "AUGURK", "BROCCOLI", "BROC", "BLOEMKOO", "RODE KOOL", "SPITSKOOL",
    "CHINESE KOOL", "KOOLRABI", "KOOL", "SPRUITJES", "PAKSOI", "PREI", "GELE UI", "RODE UI",
    "SJALOT", "ZILVERUI", "IJSBERGSLA", "BIO SLA", "BLEEKSELDER", "SELDERIJ",
    "GRIL PAPRIKA", "BIO PAPRIKA", "PAPRIKA", "KORIAND", "GEMBER", "KRIEL", "KIDNEYBONEN",
    "WITTE BONEN", "WIT BONEN", "CHILIBONEN", "HAK BONEN", "HAK LINZEN", "LINZEN",
    "KIKKERERWT", "SHIITAKE", "BIO OESTER", "WITLOF", "ZWAMMEN", "MAISKORREL", "BOND MAIS",
    "BONDUELLE", "SPERZIEBOON", "SPERZIEBONEN", "FRIET", "FRITES", "RODE PEP", "BIO CHERRY",
    "RÖSTI", "ROSTI", "CHAMP", "IJSB SLA", "KROPSLA", "SLA MELANGE", "BLAD ", "SALADE",
    "RAUWKOST", "SOEPGR", "SPERZIE", "ROERBAK", "EDAMAME", "BOWL", "POKE", "TOMATOBEAN",
    "HARICOT", "TAUGE", "BOND ", "AH BONEN", "BR BONEN", "AARDAP",
    "VELDSLA ",
    "AMAI ",
  ]],
  ["fruit", [
    "BANAAN", "BANANEN", "SINAASAPPEL", "GRANAATAPPEL", "BESSE", "BIO BES", "BLAUWEBES",
    "CRANBERR", "WATERMELOEN", "AARDBEI", "NECTARINE", "ELSTAR", "BRAMEN", "FRAMBOOS",
    "FRAMBOZEN", "DRUIF", "DRUIVEN", "LIMOEN", "MANGO", "PLUOT", "CITR", "CITROEN",
    "PERZIK", "ZOMERFR", "PINK LADY", "PINK MUSCAT", "BLAUWE BES", "AH BIO APPEL",
    "APPELS ", "BOSVRUCHT", "KERSEN", " KERS ", "KIWI", "APPELTJ", "ANANAS", "AH PEREN",
    "TAARTVUL", "PURE FRUIT", "CHIQUITA", "ROZIJNEN",
  ]],
  ["vlees & vleesvervangers", [
    "GEHAKT", "SALAMI", "FUET", "SCHNITZ", "BOCKWORST", "SPEKC", "KIPFI", "VIVERA",
    "BEYOND", "VEGETARISCHE", "VEGGIE", "KIPSTU", "KALKOEN", "KIPSATE", "CHORIZO", "WORS",
    "FRIKANDEL", "KROKET", "STOOFSTUK", "VS BEEF", "FILET AMERIC", "FILETSTUK", "GER HAM",
    "GER ZALM", "HAM", "SPEK", "IBERICO", "DRUMSTICK", "HAMBURGER", "GARDEN GOURM",
    "VEG SLAGER", "VEGA SLAGER", "PLANT HAM", "VEG REEP", "TEMPEH", "TOFU", "BAPAO",
    "TONIJN", "SCHELPEN", "SHOARMA", "BALLETJES", "FRANKFURT", "JACKFRUIT", "CORDON BL",
    "MAKREEL", "KASMI", "MORA ", "KWEKKEB", "LECK BURGER", "STEGEMAN", "AH BIO KIP",
    "SALAM", "VEGA ", "KIPREEP", "BURGER", "NUGGET", "KIPSPIES", "KIPBLOK", "HOT DOG",
    "HOTDOG", "SPARERIB", "TARTAAR", "PEPPERONI", "VARKENSHAAS", "TENDER", "VALESS", "ZALM",
    "GARNALEN", "PANGASIUS", "VISSTICK", "RUNDERBUR",
  ]],
  ["brood & bakkerij", [
    "STOKBROOD", "WASA", "TORT WRAP", "WRAP", "VOLK PANN", "RUIJTER", "L&P", "L P B", "LP ",
    "SPELT", "VOLK BOL", "VOLK STOKBR", "VOLKOR", "TIJGER WIT", "TIJGER VOLK",
    "TIJGER MAIS", "WITTE BOL", "WITTE PITA", "SPELT PITA", "DESEM", "OERD ", "VLOER",
    "WALDK", "BAKKERSBROOD", "BAKKERSBOL", "HEEL BAKKERS", "PAN DE CRIST", "KAISERBR",
    "HAMB BR GR", "LIBANEES BR", "BROODMAND", "SUIKERBROOD", "CROISSANT", "STROOPWAFEL",
    "ONTBIJTKOEK", "PEIJNENBURG", "KANDIJKOEK", "GEVULDE KOEK", "DONUT", "APPELFLAP",
    "ROZE KOEKEN", "BESCHUIT", "BOLLETJE", "MATZES", "COCO POPS", "FLATBREAD", "HAGEL",
    "NAAN", "KNACKEBROD", "BOERENBRUIN", "BAGUETTE", "BERLINER", "PISTOLET", "PIST ",
    "KAISER", "CEREAL", "PETIT ST", "ZAANS WIT", "ZAANS VOLK", "STOLLETJE", "KANEELBR",
    "KANEEL BR", "KANEELVL", "CINNAMON", "BROODJE", "BAO BUNS", "SCHNITT", "CASINO",
    "ABDIJBROOD", "VLBR", "BOL ", "APPEL FL",
    "STOKBR ",
  ]],
  ["ontbijt", [
    "MUESLI", "CRUESLI", "HAVERMOUT", "VLOKKEN", "GRANOLA", "BRINTA", "FLAKES",
    "KELLOGG", "GRANEN", "HOLIE",
    "ONTBI",
  ]],
  ["snoep & snacks", [
    "CHIPS", "CHOC", "SNICKERS", "TWIX", "BOUNTY", "NOOT", "NOTEN", "PINDA", "RICOLA",
    "SKUUMKOPPE", "BLACK JACK", "TORTILLA", "RIJSTWAF", "MUFFIN", "DORITOS", "CHEETOS",
    "PRINGLES", "BUGLES", "PROPERCORN", "POPCORN", "TUC ", "CRACKERS", "SCROCCHI", "KATJA",
    "HARIBO", "RED BAND", "TROLLI", "CHUPA CHUPS", "MENTOS", "KITKAT", "M&M ", "MALTESERS",
    "MILKA", "PENOTTI", "LOOK O LOOK", "KLENE DROP", "LOTUS", "PINBALLS", "DEXTRO",
    "LION SNACK", "FUN GUM", "COTE D'OR", "KRUIDNOTEN", "PAASHAAS", "DIGESTIVE", "FOURRE",
    "NAT VALLEY", "THIN CRISP", "BORRELNOTEN", "LAY'S", "BISCUIT", "BOOMSTAM", "MAGNUM IJS",
    "SCHEPIJS", "BIO IJS", "REEP", "SPECULAAS", "TABLET", "KROEPOEK", "MAISWAF", "PECAN",
    "DANISH CHEF", "JORDAN", "MIKADO", "MANNER", "NEAPOLITANER", "KATJANG", " DROP",
    "KRUIDNT", "POFFERT", "TAART", "TOMPOUCE", "EIERKOEK", "STROOPWFL", "MARSEPEIN",
    "BITES", "HAUST", "STENGELS", "SNACK", "BROWNIE MIX", "SPORTLIFE", "STIMOROL",
    "KAUWGOM", "WINEGUMS", "WERTHER", "TOFFIFEE", "ROCHER", "MAGNUM", "SORBETIJS",
    "OLDTIMERS", "LU ", "B'TWEEN", "GEPOFTE WAF", "TOKIO MIX", "YAMATO", "TUM TUM",
    "DRAGEE", "NIBB", "LAYS", "SLOFJ", "RED VELVET", "WAFEL", "KOEK", "CHIO", "POMBAR",
    "ZOUTE STICKS", "BAREBELLS", "PROT BAR", "EATWOW", "NAKD", "FLIPS", "VAN MELLE",
    "PETIT BEURRE", "LANGE VINGER", "MADELEINE", "ARTIACH", " IJS",
  ]],
  ["dranken", [
    "AFFLIG", "DRUIF FL", "HERTOG JAN", "LEFFE", "GRIMBERGEN", "WESTMALLE", "LA CHOUFFE",
    "LA TRAPPE", "TRAPPE", "ST BERNARDUS", "GULPENER", "BRUGSE ZOT", "OMER BLOND",
    "BIO BLOND", "TEXELS", "DUVEL", "LEFORT", "OLD AMSTERDM", "ZUNDERT", "FAT BASTARD",
    "MEDOC", "CONO SUR", "ADOBE CHARD", "BAGLIO AVOL", "T IJ ", "AMSTERDAM RE",
    "STR HENDRIK", "SPA INTENSE", "COCA-COLA", "DR PEPPER", "FUZE TEA", "CLIPPER", "LIPTON",
    "ICE TEA", "DE KOFFIE", "CAFE INTEN", "STARB COFFEE", "SIROOP", "WIJN", "ST. PAULI",
    "KARVAN", "BIONADE", "BLOOKER", "DRINK FL", "WATER", "PERLA", "THEE", "SIMON LEVELT",
    "AH SAP", "AH BIO SAP", "COCACOLA", "COCA COLA", "SCHWEPPES", "APPELSAP",
    "SINAASAPPELSAP", "COLA", "CASSIS", "SINAS", "FANTA", "SMOOTHIE", "EARL GR", "STARB",
    "VITA DRIN", "SPA ", "NESCAFE", "PICKWICK", "INNOCENT", "AMSTEL", "LANDERBRAU", "SAP ",
    "SAPGILDE ",
    "FRITZ ",
  ]],
  ["huishouden & schoonmaak", [
    "WASMIDDEL", "SCHOONMAAK", "AFWAS", "VAATWAS", "TOILETPAPIER", "WC EEND", "FINISH VAAT",
    "VAAT TAB", "ECOVER", "REINIGER", "VUILNISZAK", "KEUKENPAPIER", "AH FOLIE", "AH PAPIER",
    "BAKVELLEN", "HOUTSKOOL", "BOLSIUS", "VARTA", "PHILIPS LED", "BOODSCH TAS", "FILTERZAK",
    "TISSUE", "KOFFIEFIL", "MELITTA", "SPONS", "SANITAIRZAK", "TREKBANDZAK", "PEDAALZAK",
    "BRABANTIA", "VOORRAADBAK", "WASVERZ", "BLEEK", "KALKREIN", "ONTKALK", "HANDSCHOE",
    "DOEKJE", "DOEK WAS", "WC BLOK", "WITTE REUS", "EVERDROP", "STICKEROPLOS", "KEUKENSET",
    "BAKPAPIER", "DREFT", "DRAAGTAS", "BLOND GLAS", "BLOND KOM", "HOLLAND HUIS", "POT RIAN",
    "VERSZAKJE", "IJSBLOKZAK", "AH ZAKJES",
    "ZAKKEN ",
  ]],
  // Eigen categorieën zonder conflict met de brede categorieën: achteraan, zodat
  // bv. "RIJSTWAF" (snoep) en "TOMATENSAUS" (groente) blijven wat ze waren.
  ["sauzen", [
    "KETCH", "MAYO", "MOSTERD ", "GROV MOSTERD", "DIJON", "SAUS", "HELLMANNS", "REMIA",
    "SALSA", "SAUCE", "FRITO", " DIP",
  ]],
  ["kruiden, olie en condimenten", [
    "AZIJN", "BOUILLON", "OLIE", "PESTO", "PASSATA", "TOM PUREE", "KETJAP", "SAMBAL",
    "BOEMBOE", "TIJM", "OREGANO", "CURRY", "KERRIE", "KAPPERTJES", "MAIZENA", "KEUKENZOUT",
    "ZWART PEP", "HARISSA", "MOSTERDZAAD", "HONIG", "KNORR", "SEASON", "AROMAT", "EUROMA",
    "KANEEL", "GOULASH",
    "MUTTI ",
    "BAMI ",
  ]],
  ["pasta en rijst", [
    "PASTA", "LASAGNE", "FARFA", "FSLLI", "MACARONI", "PENNE", "SPAGHETT", "FUSILLI",
    "GNOCCHI", "TAGLIATEL", "COUSC", "RIJST", "BASMATI", "BULGUR", "ORZO", "QUINOA",
    "NOEDEL", "NOODL", "MIENESTJE", "VERMIC", "MIHOEN", "RAMEN", "SAMYANG", "SAMY ",
    "NONGSHIM", "CHOW MEIN", "RAVIOLI",
  ]],
  ["bakwaren", [
    "SUIKER", "BLOEM", "MEEL", "BACKIN", "BLADERDEEG", "APPELM", "MAPLE", "BAKPOEDER",
    "VANILL", "PANNENK", "DEEG", "KLOP-FIX", "PUDD", "CAKE",
  ]],
];

export const SUB_REGELS: Record<string, [string, string[]][]> = {
  "snoep & snacks": [
    ["chocolade", [
      "CHOC", "SNICKERS", "TWIX", "BOUNTY", "KITKAT", "M&M ", "MALTESERS", "MILKA",
      "COTE D'OR", "PENOTTI", "TABLET", "REEP", "PAASHAAS", "PAASEI", "LION", "ROCHER",
      "TOFFIFEE", "DRAGEE",
    ]],
    ["chips", [
      "CHIPS", "DORITOS", "CHEETOS", "PRINGLES", "BUGLES", "PROPERCORN", "POPCORN",
      "TORTILL", "LAY'S", "KROE", "MAISWAF", "BORRELNOTEN", "CHIO", "PRETZEL",
      "SOEPSTENGEL", "TUC", "THIN CRISP", "TYRRELLS", "HAUST", "STENGELS", "NIBB", "SNACK",
      "TOKIO", "YAMATO", "TUM TUM", "MAIS", "LAYS", "POMBAR", "ZOUTE STICKS", "FLIPS",
    ]],
    ["snoep", [
      "HARIBO", "RED BAND", "REDBAND", "TROLLI", "CHUPA CHUPS", "MENTOS", "KLENE DROP",
      "LOOK O LOOK", "PINBALLS", "DEXTRO", "FUN GUM", "KATJA ", "BLACK JACK", "SKUUMKOPPE",
      "KRUIDNOTEN", "LOTUS", "DIGESTIVE", "FOURRE", "RICOLA", "MAOAM", "WILHELMINA",
      " DROP", "MARSEPEIN", "SPORTLIFE", "STIMOROL", "KAUWGOM", "WINEGUMS", "WERTHER",
      "VAN MELLE",
    ]],
    ["koekjes", [
      "COOKIE", "KOEKJES", "GEVULDE KOEK", "ROZE KOEK", "MIKADO", "PRINCE", "SULTANA",
      "MUFFIN", "DANISH CHEF", "RIJSTWAF", "SCROCCHI", "DONUT", "BISCUIT", "SPECULAAS",
      "ZAANS HUISJE", "WAFEL", "KOKOSBROOD", "VERKADE", "MANNER", "NEAPOLITANER", "KRUIDN",
      "STROOPWFL", "EIERKOEK", "KOEK", "BITES", "BASTOGNE", "LU ", "OLDTIMERS", "B'TWEEN",
      "PETIT BEURRE", "LANGE VINGER", "MADELEINE", "GEPOFTE", "ARTIACH",
    ]],
    ["noten", ["NOTEN", "NOOT", "PINDA", "PECAN", "STUDENTHVR", "AMAND", "CASHEW", "WALNOT", "KATJANG"]],
    ["ijs", [
      "IJS", "MAGNUM", "CORNETTO", "RUIMTEIJSJES", "JERRYS", "SORBET",
    ]],
    ["gebak", ["TAART", "TOMPOUCE", "POFFERT", "BROWNIE", "RED VELVET", "SLOFJ", "CAKE"]],
    ["repen", ["BAREBELLS", "PROT BAR", "EATWOW", "NAKD"]],
  ],
  "dranken": [
    ["bier", [
      "AFFLIG", "HERTOG JAN", "LEFFE", "GRIMBERGEN", "WESTMALLE", "LA CHOUFFE", "LA TRAPPE",
      "TRAPPE", "ST BERNARDUS", "GULPENER", "BRUGSE ZOT", "OMER", "BIO BLOND", "TEXELS",
      "DUVEL", "LEFORT", "OLD AMSTERDM", "ZUNDERT", "T IJ ", "AMSTERDAM RE", "STR HENDRIK",
      "SKUUMKOPPE", "TRIPEL KARME", "ST. PAULI", "AMSTEL", "LANDERBRAU",
    ]],
    ["wijn", ["WIJN", "CHARD", "CONO SUR", "BAGLIO", "FAT BASTARD", "MEDOC"]],
    ["thee", [
      "THEE", "TEA", "CLIPPER", "LIPTON", "SIMON LEVELT", "KAMILLE", "EARL GR", "PICKWICK",
    ]],
    ["koffie", [
      "KOFFIE", "COFFEE", "CAFE INTEN", "BLOOKER", "PERLA", "BONEN", "STARB", "NESCAFE",
    ]],
    ["fris", [
      "COCA-COLA", "DR PEPPER", "FRIS FABRIEK", "BIONADE", "SIROOP", "KARVAN", "SPRINGTIJ",
      "BIO SIR", "KOLA", "FRITZ", "COCACOLA", "COCA COLA", "SCHWEPPES", "COLA", "FANTA",
      "SINAS", "CASSIS", "VITA DRIN",
    ]],
    ["water", [
      "WATER", "SPA INTENSE", "SPA ",
    ]],
    ["sap", [
      "SAP", "APPELSIEN", "SMOOTHIE", "INNOCENT",
    ]],
  ],
  "brood & bakkerij": [
    ["stokbrood", [
      "STOK", "BAGUETTE", "PETIT ST",
    ]],
    ["broodjes", [
      "CROISSANT", "BOL", "KAISER", "TURKS BROODJ", "BRIOCHE", "HAMB BR", "ROND VOLKOR",
      "ROND WIT", "PUNTJE", "TRIANGEL", "SAUCIJZEN", "CEREAL", "PISTOLET", "PIST ",
      "BERLINER", "KANEEL", "CINNAMON", "BAO", "BROODJE", "APPEL FL", "STOLLETJE", "DONUT",
      "BROWNIE",
    ]],
    ["pita", ["PITA"]],
    ["wraps", ["WRAP"]],
    ["knackebrot", ["WASA", "KNACKEBROD", "CRACKRS"]],
    ["ontbijtkoek", ["ONTBIJTKOEK", "PEIJNENBURG", "KANDIJKOEK", "STROOPWAFEL"]],
    ["brood", [
      "VLOER", "OERD", "DESEM", "TIJGER", "BAKKERS", "SPELT", "L&P", "LP ", "LIBANEES",
      "FLATBR", "BROOD", "PANN", "NAAN", "WALDK", "BOERENBRUIN", "ZAANS", "ABDIJ",
      "SCHNITT", "CASINO", "VLBR",
    ]],
  ],
  "fruit": [
    ["bananen", ["BANA"]],
    ["aardbeien", ["AARDBEI"]],
    ["appels", ["ELSTAR", "JONAGOLD", "APPELTJ", "APPELS "]],
    ["citrusvruchten", ["CITR", "SINAASAPPEL", "LIMOE", "GRAPEFRUIT", "MANDARYN", "MANDARIJN"]],
    ["bessen", ["BES", "BOSVRUCHT", "FRAMBO", "BRAMEN", "CRANBERR", "ZOMERFR", "ROOD FRUIT"]],
    ["druiven", ["DRUI"]],
    ["watermeloen", ["WATERMELOEN"]],
    ["kersen", [
      "KERSEN", " KERS ",
    ]],
    ["perziken", ["PERZIK", "NECTARINE"]],
    ["mango", ["MANGO"]],
    ["peren", [
      "PEER", "CONFERENCE", "PEREN",
    ]],
    ["ananas", ["ANANAS"]],
    ["dadels", ["DADEL"]],
    ["kiwi", ["KIWI"]],
  ],
  "groente": [
    ["aardappelen", [
      "AARDAPPEL", "AARDAPPE", "KRIEL", "FRIET", "FRITES", "FRIES", "SCHIJFJES",
      "AVIKO", "CRISPS", "POMMES", "RÖSTI", "ROSTI",
    ]],
    ["tomaten", ["TOMA", "CHERRY", "MUTTI", "GEZEEF", "ROMA", "TROSTOM"]],
    ["komkommer", ["KOMKOM", "AUGURK"]],
    ["verse kruiden", ["GEMBER", "DILLE", "BASILICU", "KORIAND", "PETERSEL", "BIESLOOK"]],
    ["ui-achtigen", ["UIEN", "SJALOT", "BOSUI", "ZILVERUI", "RODE UI", "GELE UI", "KNOFLOOK", "PREI"]],
    ["peulvruchten", [
      "SPERZIEBOON", "SPERZIEBONEN", "TUINERWT", "ERWT", "PEULEN", "SNIJBONEN", "BOONTJES",
      "SUGAR SNAP", "SPERZIE", "EDAMAME", "HARICOT", "TAUGE",
    ]],
    ["gedroogde bonen en linzen", [
      "LINZEN", "LNZ", "KIKKERERWT", "KIDNEYBONEN", "WIT BONEN", "WITTE BONEN",
      "CHILIBONEN", "HAK BONEN", "LIMA BONEN", "BOON", "BONEN",
    ]],
    ["wortels", ["PEEN", "WORTEL", "RADIJS", "KNOLSELDERIJ", "BIETJES", "BIET"]],
    ["vruchtgroenten", [
      "PAPRIKA", "COURGET", "AUBERGINE", "POMPOEN", "AVOC", "MAIS", "BONDUELLE",
      "RODE PEP", "JALAPENO", "FLESPOM",
    ]],
    ["bladgroenten", [
      "SLA", "RUCO", "ANDIJVIE", "WITLOF", "SPINAZIE", "BOERENKOOL", "SALADE", "BLAD ",
    ]],
    ["koolsoorten", ["KOOL", "BLOEMKOO", "BROC", "SPRUITJES", "PAKSOI"]],
    ["stengelgroenten", ["ASPERGE", "BLEEKSELDER", "SELDERIJ", "RABARBER", "VENKEL", "ARTISJOK"]],
    ["paddenstoelen", [
      "CHAMPIGN", "SHIITAKE", "ZWAMMEN", "OESTER", "CHAMP",
    ]],
    ["snoepgroente", ["SNOEPGR"]],
    ["groentemix", ["SOEPGR", "ROERBAK", "RAUWKOST", "BOWL", "POKE"]],
  ],
  "zuivel": [
    ["kaas", [
      "KAAS", "MOZ", "CAMEMBERT", "GOUDSE", "PADANO", "BRIE", "BEEMSTER", "BOERENKAAS",
      "BURRATA", "DZH", "GALB", "RASP", "TULIPE", "RUSTIQUE", "VIOLIFE", "ZAANLANDER",
      "PHILADELPHIA", "MILNER", "PRESIDENT", "CHEESTRING",
    ]],
    ["boter", [
      "MARGARINE", "BLUE BAND", "BLUE B", "HALVARINE", "MRG", "SMEERBAAR", "BECEL", "BOTER",
    ]],
    ["yoghurt", [
      "GURT", "YOG", "KWARK", "KWARQ", "SKYR", "VIFIT", "OPTIMEL", "TERRA YOGH", "MU ",
      "KEFIR", "QUARK", "DANIO", "COTT", "PATURAIN", "MONCHOU", "HOEVE",
    ]],
    ["niet-melk", ["HAVERDR", "OAT", "HAVER", "SOJADRINK", "SOJA", "KOKOSMELK", "KOKOS", "COCONUT", "ALPRO", "RIJSTDRINK"]],
    ["eieren", [
      "EIEREN", "SCHARRELEI",
    ]],
    ["room", [
      "CREME FR", "SLAGROOM", "SOUR CR", "KOOKROOM",
    ]],
    ["ijs", ["ROOMIJS"]],
    ["vla", ["VLA"]],
    ["melk", ["MELK"]],
  ],
  "persoonlijke verzorging": [
    ["maandverband", [
      "MAANDVERB", "MAANVERB", "MAANDVB", "ALWAYS", "LIBRESSE", "TAMPON",
    ]],
    ["tandpasta", [
      "TANDP", "ELMEX", "DONTAX", "ORAL B", "BORSTEL", "TANDENBORST",
    ]],
    ["douche en shampoo", [
      "ANDRELON", "NIVEA DOUCHE", "SHAMPOO", "DOUCHE", "SOAP", "SEEPJE", "ZEEP",
    ]],
    ["zonnebrand", ["ZONNEBRAND", "NIVEA SUN"]],
    ["scheren", ["VENUS", "GILLETTE"]],
    ["pleisters", ["HANSAPL"]],
    ["vitamines", ["DAVITAMON"]],
    ["medicijnen", ["STREPSILS", "DAKTARIN", "PARACETAMOL", "A VOGEL"]],
  ],
  "vlees & vleesvervangers": [
    ["niet vlees", [
      "PLANT ", "SEIT", "TEMPEH", "TOFU", "VEG", "BEYOND", "GARDEN GOURM", "JACKFRUIT",
      "KASMI", "VS ", "VIV", "KAASSCHNITZ", "KROK SCHNITZ", "VALESS",
      "KIPSTU",
    ]],
    ["vis", [
      "ZALM", "TONIJN", "MAKREEL", "GARNALEN", "PANGASIUS", "VISSTICK", "VISBURGER",
    ]],
    ["tussendoor", [
      "BAPAO", "CHORIZO", "FUET", "IBERICO", "TAPAS", "KWEKKEB",
    ]],
    ["vlees", [
      "FRANKFURT", "FRIKANDEL", "HAMBURGER", "KALKOEN", "RULGEHAKT", "SHOARMA", "SPEK",
      "WORST", "KALFSKROKET", "KIPGEHAKT", "KIPSCHNITZEL", "DRUMSTICK", "ONTBIJTSPEK",
      "ROOKWORST", "SCHNITZEL", "SALAM", "KIP", "BURGER", "NUGGET", "SPARERIB", "TARTAAR",
      "PEPPERONI", "HOT DOG", "HOTDOG", "VARKENSHAAS", "TENDER", "HAM", "KROKET",
      "RUNDERBUR",
      "MORA ",
    ]],
  ],
  "kant en klaar": [
    ["pizza", ["PIZZA", "PICCOLINI"]],
    ["soep", [
      "SOEP", "SOUP",
    ]],
    ["maaltijden", [
      "SCHOTEL", "SIN CARNE", "CHILI CON", "VERSPAKKET", "VP ", "MAALTIJD", "GYOZA",
      "LOEMPIA", "YOPOKKI", "MAALTJD", "GRATIN",
    ]],
  ],
  "broodbeleg": [
    ["hagelslag", ["HAGEL", "RUIJTER", "VLOKKEN"]],
    ["honing en stroop", ["HONING", "STROOP"]],
    ["jam", [
      "JAM", "BONNE MAMAN", "BONNEMAMAN", "FLOWER FARM",
    ]],
    ["pindakaas", ["PINDAKAAS"]],
    ["chocopasta", ["NOCCIOLA", "CHOCOPASTA", "NUTELLA"]],
    ["smeermeuk", [
      "HUMMUS", "BABA GAN", "ZUIVELSPR", "PHILADELPHIA", "JOHMA", "SPREAD", "GOUDKUIPJE",
      "SPECULOOS",
    ]],
    ["vleesbeleg", [
      "HAM", "SALAMI", "LEVERWORST", "GRILLWORST", "BRAADWORST", "THEEWORST", "SCHOUDERHAM",
      "KIPFILET", "KIPBRAADW", "STEGEMAN", "WORST", "ROOKV", "CERVELAAT",
      "FILET ",
    ]],
  ],
  "pasta en rijst": [
    ["pasta", [
      "PASTA", "LASAGNE", "FARFA", "FSLLI", "MACAR", "PENNE", "SPAGHETT", "CANNELINI",
      "FUSILLI", "GNOCCHI", "TAGLIATEL", "COUSC", "RAVIOLI",
    ]],
    ["rijst", ["RIJST", "BASMATI", "RICE", "BULGUR", "ORZO", "QUINOA"]],
    ["noodles", [
      "NOEDEL", "NOODL", "MIENESTJE", "VERMIC", "MIHOEN", "RAMEN", "SAMY", "NONGSHIM",
      "CHOW MEIN",
    ]],
  ],
  "sauzen": [
    ["ketchup", ["KETCH"]],
    ["mayonaisse", ["MAYO", "HELLMANNS", "REMIA"]],
    ["mosterd", ["MOSTERD", "DIJON"]],
    ["saus", [
      "SAUS", "DIP", "SAUCE", "FRITO",
    ]],
  ],
  "bakwaren": [
    ["suiker", ["SUIKER"]],
    ["bloem", ["BLOEM", "MEEL", "STEENGEMALEN"]],
    ["siroop", ["MAPLE"]],
    ["appelmoes", ["APPELM"]],
    ["vanille", [
      "VANILL",
    ]],
    ["bakmiddelen", [
      "BACKIN", "BLADERDEEG", "PANNENK", "DEEG", "KLOP-FIX", "PUDD", "CAKE",
    ]],
  ],
  "kruiden, olie en condimenten": [
    ["azijn", ["AZIJN"]],
    ["bouillon", ["BOUILLON"]],
    ["olie", ["OLIE", "BERTOLLI"]],
    ["pesto", ["PESTO"]],
    ["tomatenmeuk", ["PASSATA", "TOM PUREE", "MUTTI"]],
    ["aziatische sauzen", ["BAMI", "BOEMBOE", "KETJAP", "SAMBAL", "PATAK"]],
    ["kruiden", [
      "TIJM", "MUNT", "HARISSA", "ITALIAANSE", "MOSTERDZAAD", "VERSTEGEN", "OREGANO",
      "STERANIJS", "ZWART PEP", "KEUKENZOUT", "CURRY", "KAPPERTJES", "MAIZENA", "KNORR",
      "SEASON", "AROMAT", "EUROMA", "KANEEL", "HONIG", "GOULASH",
    ]],
  ],
  "huishouden & schoonmaak": [
    ["elektra", ["PHILIPS", "VARTA", "LED"]],
    ["koffiefilters", ["KOFFIEFIL", "FILTERZAK", "MELITTA"]],
    ["schoonmaakspullen", [
      "AFVALZAK", "PAPIER", "REINIGER", "TISSUE", "VAAT", "ECOVER", "FINISH", "PANNENSPONS",
      "SCHIMMELREIN", "SERVET", "VUILNISZAK", "FOLIE", "BAKVELLEN", "BOODSCH TAS", "SPONS",
      "SANITAIRZAK", "TREKBANDZAK", "PEDAALZAK", "AFWAS", "WASMIDDEL", "WASVERZ", "BLEEK",
      "KALKREIN", "ONTKALK", "WC BLOK", "DOEK", "HANDSCHOE", "EVERDROP", "WITTE REUS",
      "DREFT", "STICKEROPLOS", "HOLLAND HUIS",
    ]],
    ["keukenspullen", ["VOORRAADBAK", "BRABANTIA", "KEUKENSET", "BLOND GLAS", "BLOND KOM", "POT RIAN", "BAKPAPIER", "DRAAGTAS", "ZAKJE"]],
  ],
  "huisdieren": [
    ["eten", [
      "FELIX", "WHISKAS", "ZALM", "GELEI", "GOURM", "GOUR ", "ALU PATE", "PATE RUND",
      "ONE KAT", "ONE JUNIOR", "LILY", "SHEBA", "CATISF", "EDGARD",
    ]],
    ["kattenbak", [
      "KATTENBAK", "KATBAK",
    ]],
  ],
};

/** description -> [threshold price, category/subcategory below it, category/subcategory at/above it] */
export const PRIJS_AMBIGU: Record<string, [number, string, string]> = {
  "AH BIO PASTA": [2.5, "pasta en rijst", "broodbeleg"],
};
export const PRIJS_AMBIGU_SUB: Record<string, [number, string, string]> = {
  "AH BIO PASTA": [2.5, "pasta", "chocopasta"],
};

/**
 * Een trefwoord met een spatie aan het eind ("APPELS ", "STROOP ") betekent
 * "woord eindigt hier" — ook als het woord het laatste van de omschrijving
 * is. Zo matcht "BIO APPELS" wel en "APPELSAP" niet.
 */
function metWoordeinde(omschrijving: string): string {
  return `${omschrijving} `;
}

/**
 * Een trefwoordregel die de gebruiker zelf in de app heeft gemaakt. Gaat vóór
 * de ingebouwde REGELS, maar na exacte correcties (overrides). Bestaat alleen
 * in de webapp (IndexedDB), niet in de Python-pipeline.
 */
export interface GebruikersRegel {
  id: string;
  /** In hoofdletters. Spatie vooraan/achteraan = woordgrens (zie matchtGebruikersRegel). */
  trefwoord: string;
  categorie: string;
  subcategorie: string | null;
}

/** De categorie die AH zelf aan een product geeft, al vertaald naar onze indeling (stap "AH-taxonomie"). */
export interface AhCategorie {
  categorie: string;
  subcategorie: string | null;
}

export interface CategorieOpties {
  regels?: GebruikersRegel[];
  ah?: AhCategorie | null;
}

export type Bron = "prijs" | "correctie" | "eigen regel" | "ah" | "regel" | "onbekend";

export interface Uitleg {
  waarde: string;
  bron: Bron;
  trefwoord?: string;
}

/**
 * Voor eigen regels staat er ook een spatie vóór de omschrijving, zodat
 * " KIP " als los woord matcht — ook als het eerste woord is.
 */
export function matchtGebruikersRegel(omschrijving: string, trefwoord: string): boolean {
  return trefwoord.trim() !== "" && ` ${omschrijving} `.includes(trefwoord);
}

/** Langste (meest specifieke) trefwoord eerst, zodat "KIPBURGER" wint van "KIP". */
function gesorteerd(regels: GebruikersRegel[]): GebruikersRegel[] {
  return [...regels].sort((a, b) => b.trefwoord.trim().length - a.trefwoord.trim().length);
}

export function verklaarCategorie(
  omschrijving: string,
  bedrag: number | null | undefined,
  overrides: Record<string, string>,
  opties: CategorieOpties = {},
): Uitleg {
  const ambigu = PRIJS_AMBIGU[omschrijving];
  if (ambigu && bedrag != null) {
    const [drempel, laag, hoog] = ambigu;
    return { waarde: bedrag >= drempel ? hoog : laag, bron: "prijs" };
  }
  if (omschrijving in overrides) return { waarde: overrides[omschrijving], bron: "correctie" };
  for (const regel of gesorteerd(opties.regels ?? [])) {
    if (matchtGebruikersRegel(omschrijving, regel.trefwoord)) {
      return { waarde: regel.categorie, bron: "eigen regel", trefwoord: regel.trefwoord };
    }
  }
  const tekst = metWoordeinde(omschrijving);
  for (const [categorie, trefwoorden] of REGELS) {
    const trefwoord = trefwoorden.find((t) => tekst.includes(t));
    if (trefwoord) return { waarde: categorie, bron: "regel", trefwoord };
  }
  // AH's eigen indeling alleen als vangnet: onze trefwoorden zijn fijner afgestemd.
  if (opties.ah) return { waarde: opties.ah.categorie, bron: "ah" };
  return { waarde: ONBEKEND, bron: "onbekend" };
}

export function verklaarSubcategorie(
  omschrijving: string,
  categorie: string,
  bedrag: number | null | undefined,
  subOverrides: Record<string, string>,
  opties: CategorieOpties = {},
): Uitleg {
  const ambigu = PRIJS_AMBIGU_SUB[omschrijving];
  if (ambigu && bedrag != null) {
    const [drempel, laag, hoog] = ambigu;
    return { waarde: bedrag >= drempel ? hoog : laag, bron: "prijs" };
  }
  if (omschrijving in subOverrides) return { waarde: subOverrides[omschrijving], bron: "correctie" };
  for (const regel of gesorteerd(opties.regels ?? [])) {
    if (regel.subcategorie && regel.categorie === categorie && matchtGebruikersRegel(omschrijving, regel.trefwoord)) {
      return { waarde: regel.subcategorie, bron: "eigen regel", trefwoord: regel.trefwoord };
    }
  }
  const tekst = metWoordeinde(omschrijving);
  for (const [subcategorie, trefwoorden] of SUB_REGELS[categorie] ?? []) {
    const trefwoord = trefwoorden.find((t) => tekst.includes(t));
    if (trefwoord) return { waarde: subcategorie, bron: "regel", trefwoord };
  }
  if (opties.ah?.subcategorie && opties.ah.categorie === categorie) return { waarde: opties.ah.subcategorie, bron: "ah" };
  return { waarde: ONBEKEND, bron: "onbekend" };
}

export function categoriseer(
  omschrijving: string,
  bedrag: number | null | undefined,
  overrides: Record<string, string>,
  opties: CategorieOpties = {},
): string {
  return verklaarCategorie(omschrijving, bedrag, overrides, opties).waarde;
}

export function categoriseerSub(
  omschrijving: string,
  categorie: string,
  bedrag: number | null | undefined,
  subOverrides: Record<string, string>,
  opties: CategorieOpties = {},
): string {
  return verklaarSubcategorie(omschrijving, categorie, bedrag, subOverrides, opties).waarde;
}

/** Leesbare uitleg voor in een tooltip, bv. "via trefwoord ‘KIP’". */
export function uitlegTekst(uitleg: Uitleg): string {
  switch (uitleg.bron) {
    case "prijs": return "op basis van de prijs";
    case "correctie": return "handmatige correctie";
    case "eigen regel": return `via je eigen regel ‘${uitleg.trefwoord?.trim()}’`;
    case "regel": return `via trefwoord ‘${uitleg.trefwoord?.trim()}’`;
    case "ah": return "volgens AH's eigen productindeling";
    default: return "niet herkend";
  }
}
