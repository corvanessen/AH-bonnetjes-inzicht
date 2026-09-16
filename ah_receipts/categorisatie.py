"""Ken een boodschappen-categorie toe aan een productomschrijving.

De omschrijving op een AH-kassabon is hard afgekapt (13 tekens), dus
Nederlandse samenstellingen worden soms midden in het woord doorgesneden
(bv. "CHERRYTOMAAT", "AH BABY AVOC"). Daarom wordt hier op *substring*
gezocht in plaats van hele woorden — een trefwoord als "TOMAAT" of "AVOC"
moet ook matchen als het middenin of aan het eind van een aaneengeschreven
woord staat.

Twee lagen, eerste match wint:
1. `categorie_overrides.csv` — exacte omschrijving -> categorie. Bedoeld
   voor uitzonderingen en producten die de trefwoord-regels niet (goed)
   herkennen. Vul deze gerust zelf aan zodra er een nieuw, onherkend
   product opduikt.
2. `REGELS` hieronder — trefwoorden per categorie.

Alles wat door geen van beide wordt herkend, krijgt de categorie "overig".
"""

from __future__ import annotations

import csv
from pathlib import Path

OVERRIDES_PAD = Path(__file__).parent / "categorie_overrides.csv"
SUB_OVERRIDES_PAD = Path(__file__).parent / "subcategorie_overrides.csv"

STANDAARD_CATEGORIEEN = [
    "zuivel",
    "groente",
    "fruit",
    "vlees & vleesvervangers",
    "brood & bakkerij",
    "snoep & snacks",
    "dranken",
    "huishouden & schoonmaak",
    "persoonlijke verzorging",
    "overig",
]

# Trefwoord -> categorie, in volgorde van controleren (eerste match wint).
# Let op: substring-match, geen losse woorden (zie module-docstring). Sommige
# trefwoorden zijn bewust een kale stam (bv. "WORS" ipv "WORST") omdat het
# Nederlands bij meervoud of afkapping de klinkers verandert (banaan/bananen,
# noot/noten, worst/(afgekapt)wors) - een volledig woord mist dan de helft
# van de varianten.
#
# Grote pantry-categorieen als pasta/rijst/peulvruchten, kruiden, sauzen en
# kant-en-klaarmaaltijden vallen bewust op "overig": daar is geen eigen
# categorie voor in de gekozen indeling.
REGELS: list[tuple[str, list[str]]] = [
    ("zuivel", [
        "MELK", "YOGH", "KWARK", "KAAS", "ROOM", "CREME FR", "BOTER", "MRG",
        "MARGARINE", "HALVARINE", "EIEREN", "OATLY", "SOJADRINK", "SOJA GURT",
        "SKYR", "OPTIMEL", "ALPRO", "BARISTA OAT", "HAVERDR", "MOZZA", "BURRATA",
        "PADANO", "PARMIGGIANO", "PARMESAN", "CAMEMBERT", "GOUDSE", "DZH ",
        "BELEGEN", "PHILADELPHIA", "VIOLIFE", "GRIEKS", "VIFIT", "FETA",
        "BEEMSTER", "RUSTIQUE", "TULIPE", "RASP", "SMEERBAAR", "VLA", "MOZ", "ZAANLANDER",
    ]),
    ("groente", [
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
    ]),
    ("fruit", [
        "BANAAN", "BANANEN", "SINAASAPPEL", "GRANAATAPPEL", "BESSE", "BIO BES",
        "BLAUWEBES", "CRANBERR", "WATERMELOEN", "AARDBEI", "NECTARINE", "ELSTAR",
        "BRAMEN", "FRAMBOOS", "FRAMBOZEN", "DRUIF", "DRUIVEN", "LIMOEN", "MANGO",
        "PLUOT", "CITR", "CITROEN", "KERS", "PERZIK", "ZOMERFR", "PINK LADY",
        "PINK MUSCAT", "BLAUWE BES", "AH BIO APPEL",
    ]),
    ("vlees & vleesvervangers", [
        "GEHAKT", "SALAMI", "FUET", "SCHNITZ", "BOCKWORST", "SPEKC", "KIPFI",
        "VIVERA", "BEYOND", "VEGETARISCHE", "VEGGIE", "KIPSTU", "KALKOEN",
        "KIPSATE", "CHORIZO", "WORS", "FRIKANDEL", "KROKET", "STOOFSTUK",
        "VS BEEF", "FILET AMERIC", "FILETSTUK", "GER HAM", "GER ZALM", "HAM",
        "SPEK", "IBERICO", "DRUMSTICK", "HAMBURGER", "GARDEN GOURM", "VEG SLAGER",
        "VEGA SLAGER", "PLANT HAM", "VEG REEP", "TEMPEH", "TOFU", "BAPAO", "TONIJN",
        "SCHELPEN", "SHOARMA", "BALLETJES", "FRANKFURT", "JACKFRUIT", "CORDON BL",
        "MAKREEL", "KASMI", "MORA ", "KWEKKEB", "LECK BURGER", "STEGEMAN",
        "AH BIO KIP", "SALAM",
    ]),
    ("brood & bakkerij", [
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
    ]),
    ("ontbijt", [
        "MUESLI", "CRUESLI", "HAVERMOUT", "VLOKKEN", "GRANOLA", "BRINTA", "FLAKES",
          "KELLOGG", "GRANEN",
        ]),
    ("snoep & snacks", [
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
    ]),
    ("dranken", [
        "AFFLIG", "DRUIF FL", "HERTOG JAN", "LEFFE", "GRIMBERGEN", "WESTMALLE",
        "LA CHOUFFE", "LA TRAPPE", "TRAPPE", "ST BERNARDUS", "GULPENER", "BRUGSE ZOT",
        "OMER BLOND", "BIO BLOND", "TEXELS", "DUVEL", "LEFORT", "OLD AMSTERDM",
        "ZUNDERT", "FAT BASTARD", "MEDOC", "CONO SUR", "ADOBE CHARD", "BAGLIO AVOL",
        "T IJ ", "AMSTERDAM RE", "STR HENDRIK", "SPA INTENSE", "COCA-COLA",
        "DR PEPPER", "FUZE TEA", "CLIPPER", "LIPTON", "ICE TEA", "DE KOFFIE",
        "CAFE INTEN", "STARB COFFEE", "SIROOP",  "WIJN", "ST. PAULI",
        "KARVAN", "BIONADE", "BLOOKER", "DRINK FL", "WATER", "PERLA", "THEE",
        "SIMON LEVELT", "AH SAP", "AH BIO SAP",
    ]),
    ("huishouden & schoonmaak", [
        "WASMIDDEL", "SCHOONMAAK", "AFWAS", "VAATWAS", "TOILETPAPIER", "WC EEND",
        "FINISH VAAT", "VAAT TAB", "ECOVER", "REINIGER", "VUILNISZAK", "KEUKENPAPIER",
        "AH FOLIE", "AH PAPIER", "BAKVELLEN", "HOUTSKOOL", "BOLSIUS", "VARTA",
        "PHILIPS LED", "BOODSCH TAS", "FILTERZAK", "TISSUE", "KOFFIEFIL", "MELITTA",
    ]),
    ("persoonlijke verzorging", [
        "TANDPASTA", "TANDP", "SHAMPOO", "ELMEX", "DEO", "ZEEP", "NIVEA",
        "PARODONTAX", "ORAL B", "ANDRELON", "LIBRESSE", "MAANDVERB", "GILL VENUS",
        "HANSAPL", "TIGER BALM", "NATRUE",
    ]),
]

# Trefwoorden voor de onderverdeling *binnen* een categorie (drill-down in
# het dashboard). Alleen ingevuld voor categorieën waar dat waarde toevoegt;
# een categorie zonder eigen regels hier krijgt gewoon één "overig"-groep.
# Zelfde substring-matching en "eerste match wint" als REGELS hierboven.
SUB_REGELS: dict[str, list[tuple[str, list[str]]]] = {
    "snoep & snacks": [
        ("chocolade", [
            "CHOC", "SNICKERS", "TWIX", "BOUNTY", "KITKAT", "M&M ", "MALTESERS",
            "MILKA", "COTE D'OR", "PENOTTI", "TABLET", "REEP", "PAASHAAS", "PAASEI", "LION",
        ]),
        ("chips", [
            "CHIPS", "DORITOS", "CHEETOS", "PRINGLES", "BUGLES", "PROPERCORN",
            "POPCORN", "TORTILL", "LAY'S", "KROE", "MAISWAF", "BORRELNOTEN",
            "CHIO", "PRETZEL", "SOEPSTENGEL", "TUC", "THIN CRISP", "TYRRELLS",
        ]),
        ("snoep", [
            "HARIBO", "RED BAND", "REDBAND", "TROLLI", "CHUPA CHUPS", "MENTOS",
            "KLENE DROP", "LOOK O LOOK", "PINBALLS", "DEXTRO", "FUN GUM", "KATJA",
            "BLACK JACK", "SKUUMKOPPE", "KRUIDNOTEN", "LOTUS", "DIGESTIVE", "FOURRE",
            "RICOLA", "MAOAM", "WILHELMINA",
        ]),
        ("koekjes", [
            "COOKIE", "KOEKJES", "GEVULDE KOEK", "ROZE KOEK", "MIKADO", "PRINCE",
            "SULTANA", "MUFFIN", "DANISH CHEF", "RIJSTWAF", "SCROCCHI", "DONUT",
            "BISCUIT", "SPECULAAS", "ZAANS HUISJE", "WAFEL", "KOKOSBROOD", "VERKADE",
        ]),
        ("noten", ["NOTEN", "NOOT", "PINDA", "PECAN", "STUDENTHVR", "AMAND", "CASHEW", "WALNOT"]),
        ("ijs", ["IJS", "MAGNUM", "CORNETTO", "RUIMTEIJSJES", "JERRYS"]),
    ],
    "dranken": [
        # bier eerst, want een aantal bierklinkende merken ("T IJ", "TRAPPE")
        # zouden anders per ongeluk niets of iets anders kunnen matchen.
        ("bier", [
            "AFFLIG", "HERTOG JAN", "LEFFE", "GRIMBERGEN", "WESTMALLE", "LA CHOUFFE",
            "LA TRAPPE", "TRAPPE", "ST BERNARDUS", "GULPENER", "BRUGSE ZOT", "OMER",
            "BIO BLOND", "TEXELS", "DUVEL", "LEFORT", "OLD AMSTERDM", "ZUNDERT",
            "T IJ ", "AMSTERDAM RE", "STR HENDRIK", "SKUUMKOPPE", "TRIPEL KARME",
            "ST. PAULI",
        ]),
        ("wijn", [
            "WIJN", "CHARD", "CONO SUR", "BAGLIO", "FAT BASTARD", "MEDOC",
        ]),
        ("thee", [
            "THEE", "TEA", "CLIPPER", "LIPTON", "SIMON LEVELT", "KAMILLE",
        ]),
        ("koffie", [
            "KOFFIE", "COFFEE", "CAFE INTEN", "BLOOKER", "PERLA", "BONEN",
        ]),
        ("fris", [
            "COCA-COLA", "DR PEPPER", "FRIS FABRIEK", "BIONADE", "SIROOP", "KARVAN",
            "SPRINGTIJ", "BIO SIR", "KOLA", "FRITZ",
        ]),
        ("water", [
            "WATER", "SPA INTENSE",
        ]),
        ("sap", [
            "SAP", "APPELSIEN",
        ]),
    ],
    "brood & bakkerij": [
        # "stok" eerst, anders vangt de algemene "brood"-vangnet-regel onderaan
        # ook stokbrood-achtige producten af.
        ("stokbrood", ["STOK", "BAGUETTE"]),
        ("broodjes", [
            "CROISSANT", "BOL", "KAISER", "TURKS BROODJ", "BRIOCHE", "HAMB BR",
            "ROND VOLKOR", "ROND WIT", "PUNTJE", "TRIANGEL", "SAUCIJZEN",
        ]),
        ("pita", ["PITA"]),
        ("wraps", ["WRAP"]),
        ("knackebrot", ["WASA", "KNACKEBROD", "CRACKRS"]),
        ("ontbijtkoek", ["ONTBIJTKOEK", "PEIJNENBURG", "KANDIJKOEK", "STROOPWAFEL"]),
        # vangnet: alles met "brood" erin dat niet al hierboven matchte.
        ("brood", [
            "VLOER", "OERD", "DESEM", "TIJGER", "BAKKERS", "SPELT", "L&P", "LP ",
            "LIBANEES", "FLATBR", "BROOD", "PANN", "NAAN", "WALDK",
        ]),
    ],
    "fruit": [
        # kale stam: "banaan" (enkelvoud) en "bananen" (meervoud) delen alleen
        # de eerste 4 letters (klinkerwisseling AA -> A).
        ("bananen", ["BANA"]),
        ("aardbeien", ["AARDBEI"]),
        ("appels", ["ELSTAR", "JONAGOLD", "APPELTJ"]),
        ("citrusvruchten", [
            "CITR", "SINAASAPPEL", "LIMOE", "GRAPEFRUIT", "MANDARYN", "MANDARIJN",
        ]),
        ("bessen", ["BES", "FRAMBO", "BRAMEN", "CRANBERR", "ZOMERFR", "ROOD FRUIT"]),
        ("druiven", ["DRUI"]),
        ("watermeloen", ["WATERMELOEN"]),
        # spatie voor "KERS" voorkomt dat "(CR)ACKERS" meteen als kersen matcht.
        ("kersen", [" KERS"]),
        ("perziken", ["PERZIK", "NECTARINE"]),
        ("mango", ["MANGO"]),
        ("peren", ["PEER", "CONFERENCE"]),
        ("ananas", ["ANANAS"]),
        ("dadels", ["DADEL"]),
    ],
    # Indeling volgens de botanische/Schijf-van-Vijf-groepen die je zelf
    # aangaf; "tomaten"/"komkommer"/"verse kruiden"/"peulvruchten"/"wortels"
    # behouden hun bestaande naam (die had je al zelf gebruikt), de rest is
    # nieuw. Gedroogde bonen/linzen krijgen een eigen groep, los van verse
    # peulvruchten, zoals je aangaf.
    "groente": [
        # Aardappelproducten horen bij de Schijf van Vijf niet bij groente,
        # maar we zetten ze er hier (op verzoek) toch onder, als eigen
        # subcategorie - eerst gecontroleerd, want "KRIEL"/"FRIET" komen
        # verder nergens anders in deze categorie voor.
        ("aardappelen", [
            "AARDAPPEL", "AARDAPPE", "KRIEL", "FRIET", "FRITES", "FRIES", "SCHIJFJES",
            "AVIKO", "CRISPS", "POMMES",
        ]),
        # "TOMA" (niet "TOMAT") omdat "tomaat" (enkelvoud) een dubbele A heeft
        # en dus geen "TOMAT" bevat - alleen "tomaten" (meervoud) wel.
        ("tomaten", ["TOMA", "CHERRY", "MUTTI", "GEZEEF", "ROMA", "TROSTOM"]),
        ("komkommer", ["KOMKOM", "AUGURK"]),
        ("verse kruiden", ["GEMBER", "DILLE", "BASILICU", "KORIAND", "PETERSEL", "BIESLOOK"]),
        ("ui-achtigen", [
            "UIEN", "SJALOT", "BOSUI", "ZILVERUI", "RODE UI", "GELE UI", "KNOFLOOK", "PREI",
        ]),
        ("peulvruchten", [
            "SPERZIEBOON", "SPERZIEBONEN", "TUINERWT", "ERWT", "PEULEN", "SNIJBONEN",
            "BOONTJES", "SUGAR SNAP",
        ]),
        ("gedroogde bonen en linzen", [
            "LINZEN", "LNZ", "KIKKERERWT", "KIDNEYBONEN", "WIT BONEN", "WITTE BONEN",
            "CHILIBONEN", "HAK BONEN", "LIMA BONEN", "BOON", "BONEN",
        ]),
        ("wortels", ["PEEN", "WORTEL", "RADIJS", "KNOLSELDERIJ", "BIETJES", "BIET"]),
        ("vruchtgroenten", [
            "PAPRIKA", "COURGET", "AUBERGINE", "POMPOEN", "AVOC", "MAIS", "BONDUELLE",
            "RODE PEP", "JALAPENO", "FLESPOM",
        ]),
        ("bladgroenten", [
            "SLA", "RUCO", "ANDIJVIE", "WITLOF", "SPINAZIE", "BOERENKOOL", "SALADE",
        ]),
        ("koolsoorten", ["KOOL", "BLOEMKOO", "BROC", "SPRUITJES", "PAKSOI"]),
        ("stengelgroenten", ["ASPERGE", "BLEEKSELDER", "SELDERIJ", "RABARBER", "VENKEL", "ARTISJOK"]),
        ("paddenstoelen", ["CHAMPIGN", "SHIITAKE", "ZWAMMEN", "OESTER"]),
        ("snoepgroente", ["SNOEPGR"]),
    ],
    "zuivel": [
        ("kaas", [
            "KAAS", "MOZ", "CAMEMBERT", "GOUDSE", "PADANO", "BRIE", "BEEMSTER",
            "BOERENKAAS", "BURRATA", "DZH", "GALB", "RASP", "TULIPE", "RUSTIQUE",
            "VIOLIFE", "ZAANLANDER", "PHILADELPHIA",
        ]),
        ("boter", ["MARGARINE", "BLUE BAND", "BLUE B", "HALVARINE", "MRG", "SMEERBAAR"]),
        ("yoghurt", ["GURT", "YOGH", "KWARQ", "SKYR", "VIFIT", "OPTIMEL", "TERRA YOGH"]),
        ("niet-melk", [
            "HAVERDR", "OAT", "HAVER", "SOJADRINK", "SOJA", "KOKOSMELK", "KOKOS",
            "COCONUT", "ALPRO", "RIJSTDRINK",
        ]),
        ("eieren", ["EIEREN"]),
        ("room", ["CREME FR", "SLAGROOM", "SOUR CR"]),
        ("ijs", ["ROOMIJS"]),
        ("vla", ["VLA"]),
        # vangnet: alles met "melk" erin dat niet al bij niet-melk zat.
        ("melk", ["MELK"]),
    ],
    "persoonlijke verzorging": [
        ("maandverband", ["MAANDVERB", "MAANVERB", "MAANDVB", "ALWAYS", "LIBRESSE"]),
        ("tandpasta", ["TANDP", "ELMEX", "DONTAX", "ORAL B"]),
        ("douche en shampoo", ["ANDRELON", "NIVEA DOUCHE", "SHAMPOO", "DOUCHE"]),
        ("zonnebrand", ["ZONNEBRAND", "NIVEA SUN"]),
        ("scheren", ["VENUS", "GILLETTE"]),
        ("pleisters", ["HANSAPL"]),
        ("vitamines", ["DAVITAMON"]),
    ],
    "vlees & vleesvervangers": [
        # eerst de vleesvervangers-merken/markeringen controleren: dezelfde
        # woorden ("worst", "gehakt", "schnitzel", "hamburger") komen ook voor
        # in echte vleesproducten, dus zonder deze volgorde zou bv. "VS WORST"
        # (Vegetarische Slager) bij "vlees" terechtkomen.
        ("niet vlees", [
            "PLANT ", "SEIT", "TEMPEH", "TOFU", "VEG", "BEYOND", "GARDEN GOURM",
            "JACKFRUIT", "KASMI", "VS ", "VIV", "KAASSCHNITZ", "KROK SCHNITZ",
        ]),
        ("vis", ["ZALM", "TONIJN", "MAKREEL"]),
        ("tussendoor", ["BAPAO", "CHORIZO", "FUET", "IBERICO", "TAPAS"]),
        ("vlees", [
            "FRANKFURT", "FRIKANDEL", "HAMBURGER", "KALKOEN", "RULGEHAKT", "SHOARMA",
            "SPEK", "WORST", "KALFSKROKET", "KIPGEHAKT", "KIPSCHNITZEL", "DRUMSTICK",
            "ONTBIJTSPEK", "ROOKWORST", "SCHNITZEL", "SALAM", "KIP",
        ]),
    ],
    "broodbeleg": [
        ("hagelslag", ["HAGEL", "RUIJTER", "VLOKKEN"]),
        ("honing en stroop", ["HONING", "STROOP"]),
        ("jam", ["JAM", "BONNE MAMAN", "BONNEMAMAN"]),
        ("pindakaas", ["PINDAKAAS"]),
        ("chocopasta", ["NOCCIOLA", "CHOCOPASTA", "NUTELLA"]),
        ("smeermeuk", ["HUMMUS", "BABA GAN", "ZUIVELSPR", "PHILADELPHIA", "JOHMA", "SPREAD"]),
        # breedste categorie laatst: "worst"/"ham" zijn de vangnet-trefwoorden.
        ("vleesbeleg", [
            "HAM", "SALAMI", "LEVERWORST", "GRILLWORST", "BRAADWORST", "THEEWORST",
            "SCHOUDERHAM", "KIPFILET", "KIPBRAADW", "STEGEMAN", "WORST",
        ]),
    ],
    "pasta en rijst": [
        ("pasta", [
            "PASTA", "LASAGNE", "FARFA", "FSLLI", "MACAR", "PENNE", "SPAGHETT",
            "CANNELINI", "FUSILLI", "GNOCCHI", "TAGLIATEL", "COUSC",
        ]),
        ("rijst", ["RIJST", "BASMATI", "RICE", "BULGUR", "ORZO", "QUINOA"]),
        ("noodles", ["NOEDEL", "NOODL", "MIENESTJE"]),
    ],
    "sauzen": [
        # "KETCH" (niet "KETCHUP") vangt ook de afgekapte "HEINZ KETCH".
        ("ketchup", ["KETCH"]),
        ("mayonaisse", ["MAYO", "HELLMANNS", "REMIA"]),
        ("mosterd", ["MOSTERD", "DIJON"]),
        ("saus", ["SAUS", "DIP"]),
    ],
    "bakwaren": [
        ("suiker", ["SUIKER"]),
        ("bloem", ["BLOEM", "MEEL", "STEENGEMALEN"]),
        ("siroop", ["MAPLE"]),
        ("appelmoes", ["APPELM"]),
        ("vanille", ["VANILLA"]),
        ("bakmiddelen", ["BACKIN", "BLADERDEEG"]),
    ],
    "kruiden, olie en condimenten": [
        ("azijn", ["AZIJN"]),
        ("bouillon", ["BOUILLON"]),
        ("olie", ["OLIE", "BERTOLLI"]),
        ("pesto", ["PESTO"]),
        ("tomatenmeuk", ["PASSATA", "TOM PUREE", "MUTTI"]),
        ("aziatische sauzen", ["BAMI", "BOEMBOE", "KETJAP", "SAMBAL", "PATAK"]),
        ("kruiden", [
            "TIJM", "MUNT", "HARISSA", "ITALIAANSE", "MOSTERDZAAD", "VERSTEGEN",
            "OREGANO", "STERANIJS", "ZWART PEP", "KEUKENZOUT", "CURRY", "KAPPERTJES", "MAIZENA",
        ]),
    ],
    "huishouden & schoonmaak": [
        ("elektra", ["PHILIPS", "VARTA", "LED"]),
        ("koffiefilters", ["KOFFIEFIL", "FILTERZAK", "MELITTA"]),
        ("schoonmaakspullen", [
            "AFVALZAK", "PAPIER", "REINIGER", "TISSUE", "VAAT", "ECOVER", "FINISH",
            "PANNENSPONS", "SCHIMMELREIN", "SERVET", "VUILNISZAK", "FOLIE",
            "BAKVELLEN", "BOODSCH TAS",
        ]),
    ],
    "huisdieren": [
        ("eten", ["FELIX", "WHISKAS", "ZALM", "GELEI"]),
        ("kattenbak", ["KATTENBAK"]),
    ],
}

ONBEKEND = "overig"

# Sommige afgekapte omschrijvingen dekken op de bon twee heel verschillende
# producten - bv. "AH BIO PASTA" is zowel de gewone bio-pasta (~1 euro) als de
# bio-hazelnootpasta/chocopasta (~3,45 euro), allebei afgekapt tot exact
# dezelfde 13 tekens. Omschrijving alleen is dan niet genoeg; hier splitsen we
# zo'n geval op prijs, vóór de exacte-omschrijving-override en de trefwoorden.
# (drempelprijs, categorie/subcategorie ONDER de drempel, categorie/subcategorie VANAF de drempel)
PRIJS_AMBIGU: dict[str, tuple[float, str, str]] = {
    "AH BIO PASTA": (2.50, "pasta en rijst", "broodbeleg"),
}
PRIJS_AMBIGU_SUB: dict[str, tuple[float, str, str]] = {
    "AH BIO PASTA": (2.50, "pasta", "chocopasta"),
}


def _laad_overrides() -> dict[str, str]:
    if not OVERRIDES_PAD.exists():
        return {}
    with OVERRIDES_PAD.open(encoding="utf-8", newline="") as f:
        return {rij["omschrijving"]: rij["categorie"] for rij in csv.DictReader(f)}


_OVERRIDES = _laad_overrides()


def stel_override_in(omschrijving: str, categorie: str) -> None:
    """Zet (of overschrijf) de categorie-override voor een productomschrijving.

    Schrijft direct naar categorie_overrides.csv en ververst de in-memory
    cache, zodat een volgende `categoriseer()`-aanroep de nieuwe waarde
    gebruikt. Bedoeld voor het dashboard, waar je een fout ingedeeld product
    met één klik kan corrigeren; elke omschrijving mag maar één keer
    voorkomen, dus een tweede aanroep voor dezelfde omschrijving overschrijft
    de eerste.
    """
    global _OVERRIDES
    overrides = dict(_OVERRIDES)
    overrides[omschrijving] = categorie
    with OVERRIDES_PAD.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["omschrijving", "categorie"])
        for omschr, cat in sorted(overrides.items()):
            writer.writerow([omschr, cat])
    _OVERRIDES = overrides


def categoriseer(omschrijving: str, bedrag: float | None = None) -> str:
    """Geef de categorie voor een productomschrijving, of "overig" als niets matcht.

    `bedrag` is optioneel en wordt alleen gebruikt voor de handjevol
    omschrijvingen in PRIJS_AMBIGU die twee heel verschillende producten
    kunnen zijn (zie aldaar). Zonder bedrag valt zo'n omschrijving terug op
    de lage-prijs-kant, en kan een exacte override 'm alsnog overschrijven.
    """
    if omschrijving in PRIJS_AMBIGU and bedrag is not None:
        drempel, laag, hoog = PRIJS_AMBIGU[omschrijving]
        return hoog if bedrag >= drempel else laag
    if omschrijving in _OVERRIDES:
        return _OVERRIDES[omschrijving]
    for categorie, trefwoorden in REGELS:
        if any(trefwoord in omschrijving for trefwoord in trefwoorden):
            return categorie
    return ONBEKEND


def _laad_sub_overrides() -> dict[str, str]:
    if not SUB_OVERRIDES_PAD.exists():
        return {}
    with SUB_OVERRIDES_PAD.open(encoding="utf-8", newline="") as f:
        return {rij["omschrijving"]: rij["subcategorie"] for rij in csv.DictReader(f)}


_SUB_OVERRIDES = _laad_sub_overrides()


def stel_sub_override_in(omschrijving: str, subcategorie: str) -> None:
    """Zet (of overschrijf) de subcategorie-override voor een productomschrijving.

    Zelfde opzet als stel_override_in, maar voor de fijnere onderverdeling
    binnen een categorie (bv. "snoep & snacks" -> "chips"), bedoeld voor het
    drill-down-paneel in het dashboard.
    """
    global _SUB_OVERRIDES
    overrides = dict(_SUB_OVERRIDES)
    overrides[omschrijving] = subcategorie
    with SUB_OVERRIDES_PAD.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["omschrijving", "subcategorie"])
        for omschr, sub in sorted(overrides.items()):
            writer.writerow([omschr, sub])
    _SUB_OVERRIDES = overrides


def categoriseer_sub(omschrijving: str, categorie: str, bedrag: float | None = None) -> str:
    """Geef de subcategorie binnen `categorie` voor een productomschrijving.

    Zelfde lagen als categoriseer(): eerst PRIJS_AMBIGU_SUB (indien bedrag
    meegegeven), dan een exacte override, dan trefwoorden uit SUB_REGELS.
    Categorieën zonder eigen subregels (of producten die niets matchen)
    krijgen "overig".
    """
    if omschrijving in PRIJS_AMBIGU_SUB and bedrag is not None:
        drempel, laag, hoog = PRIJS_AMBIGU_SUB[omschrijving]
        return hoog if bedrag >= drempel else laag
    if omschrijving in _SUB_OVERRIDES:
        return _SUB_OVERRIDES[omschrijving]
    for subcategorie, trefwoorden in SUB_REGELS.get(categorie, []):
        if any(trefwoord in omschrijving for trefwoord in trefwoorden):
            return subcategorie
    return ONBEKEND
