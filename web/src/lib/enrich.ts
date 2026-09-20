/**
 * Port of the account-level parts of main.py's verwerk_account() and
 * ah_receipts/samenvoegen.py's naverwerken(): assign account/bon_id,
 * categorize each product, and sort.
 *
 * The PDF+JSON dedup step in samenvoegen.dedupliceer() and the
 * store-address backfill in naverwerken() are both PDF-only concerns (JSON
 * receipts never carry winkel_adres/winkel_nummer), so neither is ported —
 * see jsonParser.ts's file comment for why PDF input isn't supported here.
 * Only a plain dedup-by-bon_id is kept, in case the same file is uploaded
 * twice in one batch.
 */
import { categoriseer, categoriseerSub } from "./categorize";
import type { Artikel, Bon } from "./types";

export function enrichAccount(
  account: string,
  bonnenIn: Bon[],
  artikelenIn: Artikel[],
  overrides: Record<string, string>,
  subOverrides: Record<string, string>,
): { bonnen: Bon[]; artikelen: Artikel[] } {
  const keptIds = new Set<string>();
  const bonnen: Bon[] = [];
  for (const bon of bonnenIn) {
    if (keptIds.has(bon.bon_id)) continue;
    keptIds.add(bon.bon_id);
    bonnen.push({ ...bon, account, bon_id: `${account}__${bon.bon_id}` });
  }

  const artikelen: Artikel[] = artikelenIn
    .filter((a) => keptIds.has(a.bon_id))
    .map((a) => {
      const categorie = categoriseer(a.omschrijving, a.bedrag, overrides);
      const subcategorie = categoriseerSub(a.omschrijving, categorie, a.bedrag, subOverrides);
      return { ...a, account, bon_id: `${account}__${a.bon_id}`, categorie, subcategorie };
    });

  bonnen.sort((a, b) => a.datum.localeCompare(b.datum));
  artikelen.sort((a, b) => a.datum.localeCompare(b.datum) || a.bon_id.localeCompare(b.bon_id));

  return { bonnen, artikelen };
}

/** Re-applies categorize() to already-imported artikelen after an override changes — mirrors serve_dashboard.py's _herbereken_categorieen(). */
export function recategorize(
  artikelen: Artikel[],
  overrides: Record<string, string>,
  subOverrides: Record<string, string>,
): Artikel[] {
  return artikelen.map((a) => {
    if (a.type !== "product") return a;
    const categorie = categoriseer(a.omschrijving, a.bedrag, overrides);
    const subcategorie = categoriseerSub(a.omschrijving, categorie, a.bedrag, subOverrides);
    return { ...a, categorie, subcategorie };
  });
}
