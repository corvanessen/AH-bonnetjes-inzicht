import { describe, expect, it } from "vitest";
import { parseAhText } from "./ahOcrParser";

// Echte tesseract-uitvoer van één gefotografeerde bon, op twee resoluties —
// met de OCR-fouten erin ("t" voor 1, "O,00", "2. 27", rommel in de voetregels).
const FOTO_900 = `Albert Heijn 2308
Stationsplein 45
3013AK, Rotterdam
AANTAL  OMSCHRIJVING PRIJS BEDRAG
1       CHOCOLADE BR          0,59
t       TRIANGEL          0,69
1       TURKS BROODJ          0,99
3     SUBTOTAAL     2,27
JOUW VOORDEEL O,00
waarvan
BONUS BOX             0,00
TOTAAL                  2,27
BETAALD MET:
PINNEN               2,27
Kopie                     Kaarthouder
Terminal       1851572      Merchant     3603010105
Datum 28/09/2026 08:45      Auth. code       O5HL0Q
Totaal                           2,27 EUR
AKKOORD
OVER          EUR
BTW             2,08         0,19
TOTAAL 2.080,19
2308 © 98-09-2028
08:44
`;

const FOTO_1800 = `Albert Heijn 2308
Stationsplein 45
3013AK, Rotterdam          .
AANTAL  OMSCHRIJVING PRIJS BEDRAG
1       CHOCOLADE BR          0,59
1       TRIANGEL              0,69
1       TURKS BRO0DJ          0,99
3       SUBTOTAAL             2,27       |
JOUW VOORDEEL    O, OO
waarvan
BONUS BOX             0,00
TOTAAL                  2. 27
BETAALD MET:
PINNEN                2,27
Det  28/09/2026 08:45      Muth, Oo     05HL0Q
TOTAAL           2,08         0,19
84          ee   28-09-2026
`;

describe("parseAhText", () => {
  it("leest een gefotografeerde bon ondanks OCR-fouten", () => {
    for (const tekst of [FOTO_900, FOTO_1800]) {
      const { bon, artikelen } = parseAhText(tekst, "PXL_20260928_064637837.jpg");
      expect(bon).toMatchObject({
        bon_id: "ah-foto-202609280845-227",
        bron: "ocr",
        datum: "2026-09-28T08:45:00",
        winkel_nummer: "2308",
        winkel_adres: "Albert Heijn Stationsplein 45 3013AK, Rotterdam",
        subtotaal: 2.27,
        bonus_korting: 0,
        bonus_box: 0,
        totaal: 2.27,
        totaal_aantal_stuks: 3,
        betaalmethode: "PINNEN",
        betaald_bedrag: 2.27,
      });
      expect(artikelen.map((a) => [a.aantal, a.omschrijving.slice(0, 9), a.bedrag])).toEqual([
        [1, "CHOCOLADE", 0.59],
        [1, "TRIANGEL", 0.69],
        [1, "TURKS BRO", 0.99],
      ]);
    }
  });

  it("verwerkt stukprijs, bonus-vlag, statiegeld en bonuskaart", () => {
    const tekst = `Albert Heijn 1557
Dorpsstraat 1
1234AB  Ergens
AANTAL  OMSCHRIJVING  PRIJS BEDRAG
BONUSKAART        xx1234
2       AH CROISSANT    0,69    1,38 B
0,456KG  KIPFILET        9,99    4,56
1       COLA ZERO               1,89
        +STATIEGELD             0,15
4       SUBTOTAAL               7,98
BONUS AHCROISSANT              -0,50
JOUW VOORDEEL                   0,50
waarvan
BONUS BOX                       0,00
TOTAAL                          7,48
BETAALD MET:
PINNEN                          7,48
Datum 01/10/2026 17:10
`;
    const { bon, artikelen, meldingen } = parseAhText(tekst, "bon.jpg");
    expect(meldingen).toEqual([]);
    expect(bon).toMatchObject({ klantenkaart: "xx1234", subtotaal: 7.98, bonus_korting: 0.5, totaal: 7.48, totaal_aantal_stuks: 4 });
    expect(artikelen.map((a) => [a.type, a.aantal_weergave, a.omschrijving, a.stukprijs, a.bedrag, a.bonus])).toEqual([
      ["product", "2", "AH CROISSANT", 0.69, 1.38, true],
      ["product", "0,456KG", "KIPFILET", 9.99, 4.56, false],
      ["product", "1", "COLA ZERO", 1.89, 1.89, false],
      ["statiegeld", null, "STATIEGELD", null, 0.15, false],
    ]);
  });

  it("leest een regel waarin OCR het kolomgat heeft weggelaten", () => {
    const { artikelen } = parseAhText(FOTO_900.replace("1       CHOCOLADE BR          0,59", "1 CHOCOLADE BR 0,59"), "x.jpg");
    expect(artikelen[0]).toMatchObject({ aantal: 1, omschrijving: "CHOCOLADE BR", bedrag: 0.59 });
  });

  it("weigert een bon waarvan de regels niet optellen tot het subtotaal", () => {
    const fout = FOTO_900.replace("0,59", "0,89");
    expect(() => parseAhText(fout, "x.jpg")).toThrow(/tellen op tot 2,57|tellen op tot 2.57/);
  });

  it("weigert tekst die geen AH-bon is", () => {
    expect(() => parseAhText("Lidl\nTotaal 3,00", "x.jpg")).toThrow(/geen herkenbare AH-kassabon/);
  });
});
