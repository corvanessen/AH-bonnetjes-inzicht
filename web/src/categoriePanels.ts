/**
 * Twee schermen om de indeling snel bij te sturen:
 *  - "Te beoordelen": alle producten die nog (deels) als "overig" staan, met
 *    een voorstel per product en acties om één, meerdere of alle voorstellen
 *    in één keer over te nemen.
 *  - "Regels & correcties": eigen trefwoordregels maken (met live voorbeeld
 *    van wat er verandert) en handmatige correcties bekijken/opruimen.
 * Alle wijzigingen lopen via db.ts en daarna één herberekening (deps.naWijziging).
 */
import * as db from "./lib/db";
import {
  ONBEKEND,
  REGELS,
  SUB_REGELS,
  matchtGebruikersRegel,
  uitlegTekst,
  verklaarCategorie,
  verklaarSubcategorie,
  type CategorieOpties,
  type GebruikersRegel,
} from "./lib/categorize";
import type { CategorieContext } from "./lib/enrich";
import { Voorsteller, type Voorstel } from "./lib/suggest";
import { fetchProductCategories, isInstalled } from "./lib/ahExtension";
import { showSnackbar } from "./lib/snackbar";
import type { AccountData } from "./lib/types";

interface Deps {
  getAccounts(): AccountData[];
  laadContext(): Promise<CategorieContext>;
  /** Herberekent alle artikelen en tekent het dashboard opnieuw. */
  naWijziging(): Promise<void>;
}

interface Product {
  omschrijving: string;
  keer: number;
  totaal: number;
  bedrag: number;
  product_id: string | null;
  categorie: string;
  subcategorie: string;
}

const NIEUW = "__nieuw__";
const HOGE_ZEKERHEID = 0.6;
const fmtEUR = (n: number) => n.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...kinderen: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const k of kinderen) if (k !== null) node.append(k);
  return node;
}

export function initCategoriePanels(deps: Deps) {
  const reviewOverlay = document.getElementById("reviewOverlay") as HTMLElement;
  const reviewBody = document.getElementById("reviewBody") as HTMLElement;
  const rulesOverlay = document.getElementById("rulesOverlay") as HTMLElement;
  const rulesBody = document.getElementById("rulesBody") as HTMLElement;
  const reviewBtn = document.getElementById("reviewBtn") as HTMLButtonElement;

  let ctx: CategorieContext = { overrides: {}, subOverrides: {}, regels: [], ahProducten: {} };
  let rulesTab: "regels" | "correcties" = "regels";

  // ---------- gedeelde hulpfuncties ----------

  // Onthouden tot de volgende herberekening: de tooltip vraagt dit per productrij op.
  let productenCache: Product[] | null = null;
  let productIndex: Map<string, Product> | null = null;
  function producten(): Product[] {
    if (!productenCache) {
      productenCache = verzamelProducten();
      productIndex = null;
    }
    return productenCache;
  }

  function verzamelProducten(): Product[] {
    const map = new Map<string, Product>();
    for (const account of deps.getAccounts()) {
      for (const a of account.artikelen) {
        if (a.type !== "product" || !a.categorie) continue;
        let p = map.get(a.omschrijving);
        if (!p) {
          p = { omschrijving: a.omschrijving, keer: 0, totaal: 0, bedrag: a.bedrag ?? 0, product_id: null, categorie: a.categorie, subcategorie: a.subcategorie ?? ONBEKEND };
          map.set(a.omschrijving, p);
        }
        p.keer++;
        p.totaal += a.bedrag ?? 0;
        p.product_id ??= a.product_id;
      }
    }
    return [...map.values()];
  }

  function opties(p: { product_id: string | null }, regels = ctx.regels): CategorieOpties {
    return { regels, ah: p.product_id ? ctx.ahProducten[p.product_id] ?? null : null };
  }

  function categorieOpties(): string[] {
    const set = new Set<string>(REGELS.map(([c]) => c));
    for (const p of producten()) set.add(p.categorie);
    for (const r of ctx.regels) set.add(r.categorie);
    for (const v of Object.values(ctx.overrides)) set.add(v);
    set.add(ONBEKEND);
    return [...set].sort((a, b) => (a === ONBEKEND ? 1 : b === ONBEKEND ? -1 : a.localeCompare(b)));
  }

  function subcategorieOpties(categorie: string): string[] {
    const set = new Set<string>((SUB_REGELS[categorie] ?? []).map(([s]) => s));
    for (const p of producten()) if (p.categorie === categorie) set.add(p.subcategorie);
    for (const r of ctx.regels) if (r.categorie === categorie && r.subcategorie) set.add(r.subcategorie);
    set.add(ONBEKEND);
    return [...set].sort((a, b) => (a === ONBEKEND ? 1 : b === ONBEKEND ? -1 : a.localeCompare(b)));
  }

  /** Dropdown met "+ nieuwe…"; `onKies` krijgt de gekozen (of nieuw getypte) waarde. */
  function keuzelijst(waarden: string[], huidig: string | null, nieuwLabel: string, onKies: (v: string) => void, leegLabel?: string): HTMLSelectElement {
    const select = el("select", { className: "cat-edit" });
    if (leegLabel) select.append(el("option", { value: "", textContent: leegLabel }));
    for (const w of waarden) select.append(el("option", { value: w, textContent: w, selected: w === huidig }));
    if (huidig && !waarden.includes(huidig)) select.append(el("option", { value: huidig, textContent: huidig, selected: true }));
    select.append(el("option", { value: NIEUW, textContent: nieuwLabel }));
    let vorige = select.value;
    select.addEventListener("change", () => {
      if (select.value === NIEUW) {
        const naam = (window.prompt("Naam:") || "").trim().toLowerCase();
        if (!naam) {
          select.value = vorige;
          return;
        }
        select.insertBefore(el("option", { value: naam, textContent: naam }), select.lastChild);
        select.value = naam;
      }
      vorige = select.value;
      onKies(select.value);
    });
    return select;
  }

  async function opslaan(werk: () => Promise<void>, melding: string): Promise<void> {
    try {
      await werk();
      await deps.naWijziging();
      showSnackbar(melding);
    } catch (err) {
      showSnackbar(`Opslaan mislukt: ${(err as Error).message}`, { error: true });
    }
  }

  function werkTellerBij(): void {
    const n = producten().filter((p) => p.categorie === ONBEKEND || p.subcategorie === ONBEKEND).length;
    reviewBtn.textContent = n ? `Te beoordelen (${n})` : "Te beoordelen";
  }

  // ---------- Te beoordelen ----------

  let reviewFilter: "alles" | "categorie" | "subcategorie" = "categorie";
  const geselecteerd = new Set<string>();
  let ahVoortgang = "";

  function renderBeoordelen(): void {
    const alle = producten();
    const voorsteller = new Voorsteller(alle.map((p) => ({ omschrijving: p.omschrijving, categorie: p.categorie, subcategorie: p.subcategorie })));
    const teDoen = alle
      .filter((p) =>
        reviewFilter === "categorie" ? p.categorie === ONBEKEND
        : reviewFilter === "subcategorie" ? p.categorie !== ONBEKEND && p.subcategorie === ONBEKEND
        : p.categorie === ONBEKEND || p.subcategorie === ONBEKEND,
      )
      .sort((a, b) => b.totaal - a.totaal);

    const voorstellen = new Map<string, Voorstel | null>();
    for (const p of teDoen) {
      const ah = opties(p).ah ?? null;
      if (p.categorie === ONBEKEND) {
        voorstellen.set(p.omschrijving, voorsteller.stelVoor(p.omschrijving, ah));
      } else {
        // Alleen de subcategorie ontbreekt: stel een sub voor binnen de huidige categorie.
        const v = voorsteller.stelVoor(p.omschrijving, ah);
        voorstellen.set(p.omschrijving, v && v.categorie === p.categorie ? v : v && { ...v, categorie: p.categorie, subcategorie: null, zekerheid: 0 });
      }
    }
    const zeker = teDoen.filter((p) => {
      const v = voorstellen.get(p.omschrijving);
      return v && v.zekerheid >= HOGE_ZEKERHEID && (p.categorie === ONBEKEND || v.subcategorie);
    });

    reviewBody.innerHTML = "";
    const totaalBedrag = teDoen.reduce((s, p) => s + p.totaal, 0);
    reviewBody.append(
      el("p", {}, `${teDoen.length} product(en), samen ${fmtEUR(totaalBedrag)}. Gesorteerd op uitgaven, zodat het meeste geld eerst goed staat. Je keuze wordt als correctie bewaard en geldt voor al je bonnetjes.`),
    );

    const filter = el("div", { className: "segmented review-filter" });
    for (const [waarde, label] of [["categorie", "Categorie onbekend"], ["subcategorie", "Subcategorie onbekend"], ["alles", "Allebei"]] as const) {
      const btn = el("button", { type: "button", textContent: label, className: reviewFilter === waarde ? "active" : "" });
      btn.addEventListener("click", () => {
        reviewFilter = waarde;
        geselecteerd.clear();
        renderBeoordelen();
      });
      filter.append(btn);
    }

    const acties = el("div", { className: "fetch-actions" });
    const accepteerAlles = el("button", { type: "button", className: "toggle-btn primary", textContent: `Neem ${zeker.length} zekere voorstellen over`, disabled: zeker.length === 0 });
    accepteerAlles.addEventListener("click", () => {
      if (!window.confirm(`${zeker.length} voorstel(len) overnemen als correctie?`)) return;
      const cat: { omschrijving: string; waarde: string }[] = [];
      const sub: { omschrijving: string; waarde: string }[] = [];
      for (const p of zeker) {
        const v = voorstellen.get(p.omschrijving)!;
        if (p.categorie === ONBEKEND) cat.push({ omschrijving: p.omschrijving, waarde: v.categorie });
        if (v.subcategorie) sub.push({ omschrijving: p.omschrijving, waarde: v.subcategorie });
      }
      void opslaan(() => db.setOverridesBatch(cat, sub), `${zeker.length} product(en) ingedeeld.`).then(renderBeoordelen);
    });
    acties.append(accepteerAlles);

    const zonderAh = alle.filter((p) => p.product_id && (p.categorie === ONBEKEND || p.subcategorie === ONBEKEND));
    const ahBtn = el("button", { type: "button", className: "toggle-btn", textContent: "AH-categorieën ophalen", hidden: true });
    ahBtn.title = "Vraagt via de extensie bij AH op in welke categorie AH zelf deze producten indeelt (geen login nodig).";
    void db.getAhProducten().then(async (rijen) => {
      const bekend = new Set(rijen.map((r) => r.product_id));
      const open = zonderAh.filter((p) => !bekend.has(p.product_id!));
      if (!open.length || !(await isInstalled())) return;
      ahBtn.hidden = false;
      ahBtn.textContent = `AH-categorieën ophalen (${open.length})`;
      ahBtn.onclick = () => haalAhOp(open, ahBtn);
    });
    acties.append(ahBtn, el("span", { className: "fetch-progress-text", textContent: ahVoortgang }));

    reviewBody.append(filter, acties);

    if (geselecteerd.size) reviewBody.append(bulkBalk(teDoen));

    if (!teDoen.length) {
      reviewBody.append(el("p", { className: "empty-note" }, "Niets te beoordelen — alles is ingedeeld. 🎉"));
      return;
    }

    const lijst = el("div", { className: "review-list" });
    for (const p of teDoen.slice(0, 300)) lijst.append(beoordeelRij(p, voorstellen.get(p.omschrijving) ?? null, voorsteller));
    if (teDoen.length > 300) lijst.append(el("p", { className: "empty-note" }, `… en nog ${teDoen.length - 300}. Werk eerst deze af.`));
    reviewBody.append(lijst);
  }

  function beoordeelRij(p: Product, v: Voorstel | null, voorsteller: Voorsteller): HTMLElement {
    let categorie = p.categorie !== ONBEKEND ? p.categorie : v?.categorie ?? ONBEKEND;
    let subcategorie: string | null = p.subcategorie !== ONBEKEND ? p.subcategorie : v?.subcategorie ?? null;

    const rij = el("div", { className: "review-row" });
    const vink = el("input", { type: "checkbox", checked: geselecteerd.has(p.omschrijving) });
    vink.setAttribute("aria-label", `${p.omschrijving} selecteren`);
    vink.addEventListener("change", () => {
      if (vink.checked) geselecteerd.add(p.omschrijving);
      else geselecteerd.delete(p.omschrijving);
      renderBeoordelen();
    });

    const naam = el("div", { className: "review-name" },
      el("strong", { textContent: p.omschrijving }),
      el("span", { className: "review-meta", textContent: `${p.keer}× · ${fmtEUR(p.totaal)}` }),
    );
    const voorstelTekst = v
      ? el("div", { className: "review-hint" + (v.zekerheid >= HOGE_ZEKERHEID ? " zeker" : "") },
          `${v.categorie}${v.subcategorie ? ` › ${v.subcategorie}` : ""}`,
          v.reden ? el("small", { textContent: ` — ${v.reden}` }) : null)
      : el("div", { className: "review-hint" }, "geen voorstel");

    const subHost = el("span");
    const tekenSub = () => {
      subHost.innerHTML = "";
      subHost.append(keuzelijst(subcategorieOpties(categorie), subcategorie ?? ONBEKEND, "+ nieuwe subcategorie…", (s) => (subcategorie = s)));
    };
    const catSelect = keuzelijst(categorieOpties(), categorie, "+ nieuwe categorie…", (c) => {
      categorie = c;
      subcategorie = null;
      tekenSub();
    });
    tekenSub();

    const ok = el("button", { type: "button", className: "toggle-btn", textContent: "✓" });
    ok.title = "Opslaan";
    ok.addEventListener("click", () => {
      const cat = categorie !== p.categorie ? [{ omschrijving: p.omschrijving, waarde: categorie }] : [];
      const sub = subcategorie && subcategorie !== ONBEKEND ? [{ omschrijving: p.omschrijving, waarde: subcategorie }] : [];
      if (!cat.length && !sub.length) return;
      void opslaan(() => db.setOverridesBatch(cat, sub), `${p.omschrijving} ingedeeld als ${categorie}${sub.length ? ` › ${subcategorie}` : ""}.`).then(renderBeoordelen);
    });
    const regel = el("button", { type: "button", className: "link-btn", textContent: "regel…" });
    regel.title = "Maak een trefwoordregel die ook vergelijkbare producten indeelt";
    regel.addEventListener("click", () => {
      const alle = producten().map((x) => x.omschrijving);
      openRegelFormulierMet({ trefwoord: voorsteller.stelTrefwoordVoor(p.omschrijving, alle), categorie, subcategorie });
    });

    rij.append(vink, naam, voorstelTekst, el("div", { className: "review-edit" }, catSelect, subHost, ok, regel));
    return rij;
  }

  function bulkBalk(teDoen: Product[]): HTMLElement {
    let categorie = categorieOpties()[0];
    let subcategorie: string | null = null;
    const subHost = el("span");
    const tekenSub = () => {
      subHost.innerHTML = "";
      subHost.append(keuzelijst(subcategorieOpties(categorie), null, "+ nieuwe subcategorie…", (s) => (subcategorie = s || null), "(subcategorie laten)"));
    };
    const catSelect = keuzelijst(categorieOpties(), categorie, "+ nieuwe categorie…", (c) => {
      categorie = c;
      subcategorie = null;
      tekenSub();
    });
    tekenSub();
    const toepassen = el("button", { type: "button", className: "toggle-btn primary", textContent: `Toewijzen aan ${geselecteerd.size} geselecteerde` });
    toepassen.addEventListener("click", () => {
      const gekozen = teDoen.filter((p) => geselecteerd.has(p.omschrijving));
      const cat = gekozen.filter((p) => p.categorie !== categorie).map((p) => ({ omschrijving: p.omschrijving, waarde: categorie }));
      const sub = subcategorie && subcategorie !== ONBEKEND ? gekozen.map((p) => ({ omschrijving: p.omschrijving, waarde: subcategorie! })) : [];
      void opslaan(() => db.setOverridesBatch(cat, sub), `${gekozen.length} product(en) ingedeeld.`).then(() => {
        geselecteerd.clear();
        renderBeoordelen();
      });
    });
    const wis = el("button", { type: "button", className: "link-btn", textContent: "selectie wissen" });
    wis.addEventListener("click", () => {
      geselecteerd.clear();
      renderBeoordelen();
    });
    return el("div", { className: "review-bulk" }, catSelect, subHost, toepassen, wis);
  }

  async function haalAhOp(open: Product[], knop: HTMLButtonElement): Promise<void> {
    knop.disabled = true;
    const buffer: db.AhProductRow[] = [];
    let gevonden = 0;
    const result = await fetchProductCategories(
      open.map((p) => ({ id: p.product_id!, name: p.omschrijving })),
      (info, klaar) => {
        buffer.push({ product_id: info.id, ahCategorie: info.ahCategorie, ahSubcategorie: info.ahSubcategorie, opgehaald: new Date().toISOString() });
        if (info.ahCategorie) gevonden++;
        ahVoortgang = `AH-categorieën ophalen… ${klaar}/${open.length}`;
        const tekst = reviewBody.querySelector(".fetch-progress-text");
        if (tekst) tekst.textContent = ahVoortgang;
      },
    );
    ahVoortgang = "";
    await db.saveAhProducten(buffer);
    await deps.naWijziging();
    renderBeoordelen();
    showSnackbar(
      result.error
        ? `AH-categorieën deels opgehaald (${gevonden} gevonden): ${result.error}`
        : `AH kende ${gevonden} van de ${open.length} producten; die zijn nu (voor)ingedeeld.`,
      { error: !!result.error },
    );
  }

  // ---------- Regels & correcties ----------

  /** `autoCategorie`: zolang je zelf niets kiest, volgt de categorie wat het trefwoord het vaakst raakt. */
  let formulier: { id: string | null; trefwoord: string; heelWoord: boolean; categorie: string; subcategorie: string | null; autoCategorie: boolean } | null = null;

  function openRegelFormulierMet(start: { trefwoord: string; categorie: string; subcategorie: string | null; id?: string }): void {
    const t = start.trefwoord.toUpperCase();
    const heelWoord = t.startsWith(" ") && t.endsWith(" ");
    formulier = { id: start.id ?? null, trefwoord: t.trim(), heelWoord, categorie: start.categorie, subcategorie: start.subcategorie, autoCategorie: !start.categorie };
    rulesTab = "regels";
    reviewOverlay.hidden = true;
    rulesOverlay.hidden = false;
    renderRegels();
    rulesBody.querySelector<HTMLInputElement>("#regelTrefwoord")?.focus();
  }

  function regelVanFormulier(): GebruikersRegel | null {
    if (!formulier || !formulier.trefwoord.trim() || !formulier.categorie) return null;
    const kern = formulier.trefwoord.trim().toUpperCase();
    return {
      id: formulier.id ?? crypto.randomUUID(),
      trefwoord: formulier.heelWoord ? ` ${kern} ` : kern,
      categorie: formulier.categorie,
      subcategorie: formulier.subcategorie && formulier.subcategorie !== ONBEKEND ? formulier.subcategorie : null,
    };
  }

  /** De categorie die het vaakst voorkomt bij de producten die `trefwoord` raakt. */
  function gangbareCategorie(trefwoord: string): string {
    const telling = new Map<string, number>();
    for (const p of producten()) {
      if (p.categorie === ONBEKEND || !matchtGebruikersRegel(p.omschrijving, trefwoord)) continue;
      telling.set(p.categorie, (telling.get(p.categorie) ?? 0) + 1);
    }
    return [...telling].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }

  /** Wat er verandert als `regel` (nieuw of bewerkt) erbij komt. */
  function voorbeeld(regel: GebruikersRegel) {
    const nieuweRegels = [...ctx.regels.filter((r) => r.id !== regel.id), regel];
    const wijzigt: { p: Product; van: string; naar: string }[] = [];
    const gelijk: Product[] = [];
    const correctieWint: Product[] = [];
    for (const p of producten()) {
      if (!matchtGebruikersRegel(p.omschrijving, regel.trefwoord)) continue;
      const cat = verklaarCategorie(p.omschrijving, p.bedrag, ctx.overrides, opties(p, nieuweRegels));
      const sub = verklaarSubcategorie(p.omschrijving, cat.waarde, p.bedrag, ctx.subOverrides, opties(p, nieuweRegels));
      if (cat.bron === "correctie" && cat.waarde !== regel.categorie) correctieWint.push(p);
      const van = `${p.categorie} › ${p.subcategorie}`;
      const naar = `${cat.waarde} › ${sub.waarde}`;
      if (van === naar) gelijk.push(p);
      else wijzigt.push({ p, van, naar });
    }
    return { wijzigt, gelijk, correctieWint };
  }

  function renderRegels(): void {
    rulesBody.innerHTML = "";
    const tabs = el("div", { className: "segmented review-filter" });
    for (const [waarde, label] of [["regels", `Eigen regels (${ctx.regels.length})`], ["correcties", `Correcties (${Object.keys(ctx.overrides).length + Object.keys(ctx.subOverrides).length})`]] as const) {
      const btn = el("button", { type: "button", textContent: label, className: rulesTab === waarde ? "active" : "" });
      btn.addEventListener("click", () => {
        rulesTab = waarde;
        renderRegels();
      });
      tabs.append(btn);
    }
    rulesBody.append(tabs);
    if (rulesTab === "regels") renderEigenRegels();
    else renderCorrecties();
  }

  function renderEigenRegels(): void {
    rulesBody.append(
      el("p", {}, "Een eigen regel deelt elk product in waarvan de omschrijving het trefwoord bevat, ook toekomstige bonnetjes. Handmatige correcties per product gaan altijd voor. Bij meerdere passende regels wint het langste trefwoord."),
    );

    if (!formulier) {
      const nieuw = el("button", { type: "button", className: "toggle-btn primary", textContent: "+ Nieuwe regel" });
      nieuw.addEventListener("click", () => openRegelFormulierMet({ trefwoord: "", categorie: "", subcategorie: null }));
      rulesBody.append(el("div", { className: "fetch-actions" }, nieuw));
    } else {
      rulesBody.append(regelFormulier());
    }

    if (!ctx.regels.length) {
      rulesBody.append(el("p", { className: "empty-note" }, "Nog geen eigen regels."));
      return;
    }
    const lijst = el("div", { className: "review-list" });
    for (const regel of [...ctx.regels].sort((a, b) => a.trefwoord.localeCompare(b.trefwoord))) {
      const treffers = producten().filter((p) => matchtGebruikersRegel(p.omschrijving, regel.trefwoord)).length;
      const bewerk = el("button", { type: "button", className: "link-btn", textContent: "bewerken" });
      bewerk.addEventListener("click", () => openRegelFormulierMet({ ...regel }));
      const weg = el("button", { type: "button", className: "link-btn danger", textContent: "verwijderen" });
      weg.addEventListener("click", () => {
        if (!window.confirm(`Regel ‘${regel.trefwoord.trim()}’ verwijderen?`)) return;
        void opslaan(() => db.deleteRegel(regel.id), "Regel verwijderd.").then(renderRegels);
      });
      lijst.append(
        el("div", { className: "review-row rule-row" },
          el("strong", { textContent: regel.trefwoord.trim() + (regel.trefwoord.startsWith(" ") ? " (los woord)" : "") }),
          el("span", { textContent: `${regel.categorie}${regel.subcategorie ? ` › ${regel.subcategorie}` : ""}` }),
          el("span", { className: "review-meta", textContent: `${treffers} product(en)` }),
          el("div", { className: "review-edit" }, bewerk, weg),
        ),
      );
    }
    rulesBody.append(lijst);
  }

  function regelFormulier(): HTMLElement {
    const f = formulier!;
    const box = el("div", { className: "rule-form" });
    const trefwoord = el("input", { type: "text", id: "regelTrefwoord", value: f.trefwoord, placeholder: "bijv. KIPSPIES", maxLength: 30 });
    trefwoord.autocomplete = "off";
    const heelWoord = el("input", { type: "checkbox", checked: f.heelWoord });
    const catHost = el("span");
    const subHost = el("span");
    const voorbeeldHost = el("div", { className: "rule-preview" });

    const tekenVoorbeeld = () => {
      voorbeeldHost.innerHTML = "";
      const regel = regelVanFormulier();
      if (!regel) {
        const tekst = f.trefwoord.trim() ? "Kies een categorie; het trefwoord raakt nog geen ingedeelde producten." : "Typ een trefwoord om te zien welke producten het raakt.";
        voorbeeldHost.append(el("p", { className: "empty-note" }, tekst));
        return;
      }
      const { wijzigt, gelijk, correctieWint } = voorbeeld(regel);
      voorbeeldHost.append(
        el("p", {}, `Raakt ${wijzigt.length + gelijk.length} product(en): ${wijzigt.length} krijgen een andere indeling, ${gelijk.length} staan al goed.` +
          (correctieWint.length ? ` Bij ${correctieWint.length} gaat je handmatige correctie voor.` : "")),
      );
      const ul = el("ul");
      for (const w of wijzigt.slice(0, 12)) ul.append(el("li", {}, el("strong", { textContent: w.p.omschrijving }), ` ${w.van} → ${w.naar}`));
      if (wijzigt.length > 12) ul.append(el("li", { textContent: `… en ${wijzigt.length - 12} meer` }));
      for (const p of correctieWint.slice(0, 5)) ul.append(el("li", { className: "muted", textContent: `${p.omschrijving} blijft ${p.categorie} (correctie)` }));
      voorbeeldHost.append(ul);
    };
    const tekenSub = () => {
      subHost.innerHTML = "";
      subHost.append(keuzelijst(subcategorieOpties(f.categorie), f.subcategorie, "+ nieuwe subcategorie…", (s) => {
        f.subcategorie = s || null;
        tekenVoorbeeld();
      }, "(geen subcategorie)"));
    };
    const tekenCat = () => {
      catHost.innerHTML = "";
      catHost.append(keuzelijst(categorieOpties().filter((c) => c !== ONBEKEND), f.categorie || null, "+ nieuwe categorie…", (c) => {
        f.categorie = c;
        f.subcategorie = null;
        f.autoCategorie = !c;
        tekenSub();
        tekenVoorbeeld();
      }, f.categorie ? undefined : "(kies)"));
    };
    const volgTrefwoord = () => {
      if (!f.autoCategorie) return;
      const kern = f.trefwoord.trim().toUpperCase();
      const cat = kern ? gangbareCategorie(f.heelWoord ? ` ${kern} ` : kern) : "";
      if (cat === f.categorie) return;
      f.categorie = cat;
      f.subcategorie = null;
      tekenCat();
      tekenSub();
    };
    trefwoord.addEventListener("input", () => {
      f.trefwoord = trefwoord.value;
      volgTrefwoord();
      tekenVoorbeeld();
    });
    heelWoord.addEventListener("change", () => {
      f.heelWoord = heelWoord.checked;
      volgTrefwoord();
      tekenVoorbeeld();
    });
    tekenCat();
    tekenSub();
    tekenVoorbeeld();

    const bewaar = el("button", { type: "button", className: "toggle-btn primary", textContent: f.id ? "Regel bijwerken" : "Regel opslaan" });
    bewaar.addEventListener("click", () => {
      const regel = regelVanFormulier();
      if (!regel) return;
      const aantal = voorbeeld(regel).wijzigt.length;
      formulier = null;
      void opslaan(() => db.saveRegel(regel), `Regel ‘${regel.trefwoord.trim()}’ opgeslagen; ${aantal} product(en) opnieuw ingedeeld.`).then(renderRegels);
    });
    const annuleer = el("button", { type: "button", className: "link-btn", textContent: "annuleren" });
    annuleer.addEventListener("click", () => {
      formulier = null;
      renderRegels();
    });

    box.append(
      el("div", { className: "rule-fields" },
        el("label", {}, "Trefwoord ", trefwoord),
        el("label", { className: "inline" }, heelWoord, " alleen als los woord"),
        el("label", {}, "Categorie ", catHost),
        el("label", {}, "Subcategorie ", subHost),
      ),
      voorbeeldHost,
      el("div", { className: "fetch-actions" }, bewaar, annuleer),
    );
    return box;
  }

  let zoekterm = "";
  let alleenOverbodig = false;

  function renderCorrecties(): void {
    const perOmschrijving = new Map(producten().map((p) => [p.omschrijving, p]));
    type Rij = { omschrijving: string; soort: "categorie" | "subcategorie"; waarde: string; zonder: string; overbodig: boolean };
    const rijen: Rij[] = [];
    for (const [omschrijving, waarde] of Object.entries(ctx.overrides)) {
      const p = perOmschrijving.get(omschrijving) ?? { product_id: null, bedrag: null };
      const zonder = verklaarCategorie(omschrijving, p.bedrag, {}, opties(p)).waarde;
      rijen.push({ omschrijving, soort: "categorie", waarde, zonder, overbodig: zonder === waarde });
    }
    for (const [omschrijving, waarde] of Object.entries(ctx.subOverrides)) {
      const p = perOmschrijving.get(omschrijving) ?? { product_id: null, bedrag: null };
      const cat = verklaarCategorie(omschrijving, p.bedrag, ctx.overrides, opties(p)).waarde;
      const zonder = verklaarSubcategorie(omschrijving, cat, p.bedrag, {}, opties(p)).waarde;
      rijen.push({ omschrijving, soort: "subcategorie", waarde, zonder, overbodig: zonder === waarde });
    }
    const overbodig = rijen.filter((r) => r.overbodig);

    rulesBody.append(
      el("p", {}, "Correcties zijn vaste indelingen per productomschrijving — van jezelf of meegeleverd. ‘Overbodig’ betekent dat de regels zonder correctie al hetzelfde zouden kiezen; die kun je veilig opruimen."),
    );
    const zoek = el("input", { type: "search", value: zoekterm, placeholder: "Zoek op omschrijving…" });
    zoek.addEventListener("input", () => {
      zoekterm = zoek.value;
      tekenLijst();
    });
    const alleenBox = el("input", { type: "checkbox", checked: alleenOverbodig });
    alleenBox.addEventListener("change", () => {
      alleenOverbodig = alleenBox.checked;
      tekenLijst();
    });
    const opruimen = el("button", { type: "button", className: "toggle-btn", textContent: `Verwijder ${overbodig.length} overbodige`, disabled: !overbodig.length });
    opruimen.addEventListener("click", () => {
      if (!window.confirm(`${overbodig.length} overbodige correctie(s) verwijderen? De indeling verandert daardoor niet.`)) return;
      void opslaan(
        () => db.setOverridesBatch(
          overbodig.filter((r) => r.soort === "categorie").map((r) => ({ omschrijving: r.omschrijving, waarde: null })),
          overbodig.filter((r) => r.soort === "subcategorie").map((r) => ({ omschrijving: r.omschrijving, waarde: null })),
        ),
        `${overbodig.length} correctie(s) opgeruimd.`,
      ).then(renderRegels);
    });
    rulesBody.append(el("div", { className: "fetch-actions" }, zoek, el("label", { className: "inline" }, alleenBox, " alleen overbodige"), opruimen));

    const lijstHost = el("div", { className: "review-list" });
    rulesBody.append(lijstHost);
    const tekenLijst = () => {
      lijstHost.innerHTML = "";
      const term = zoekterm.trim().toUpperCase();
      const zichtbaar = rijen
        .filter((r) => (!term || r.omschrijving.includes(term)) && (!alleenOverbodig || r.overbodig))
        .sort((a, b) => a.omschrijving.localeCompare(b.omschrijving) || a.soort.localeCompare(b.soort));
      for (const r of zichtbaar.slice(0, 400)) {
        const weg = el("button", { type: "button", className: "link-btn danger", textContent: "verwijderen" });
        weg.title = `Daarna: ${r.zonder}`;
        weg.addEventListener("click", () => {
          const actie = r.soort === "categorie" ? db.deleteOverride(r.omschrijving) : db.deleteSubOverride(r.omschrijving);
          void opslaan(() => actie, `Correctie voor ${r.omschrijving} verwijderd (wordt nu: ${r.zonder}).`).then(renderRegels);
        });
        lijstHost.append(
          el("div", { className: "review-row rule-row" },
            el("strong", { textContent: r.omschrijving }),
            el("span", { textContent: `${r.soort}: ${r.waarde}` }),
            el("span", { className: "review-meta" + (r.overbodig ? " badge" : ""), textContent: r.overbodig ? "overbodig" : `zonder: ${r.zonder}` }),
            el("div", { className: "review-edit" }, weg),
          ),
        );
      }
      if (!zichtbaar.length) lijstHost.append(el("p", { className: "empty-note" }, "Geen correcties gevonden."));
      if (zichtbaar.length > 400) lijstHost.append(el("p", { className: "empty-note" }, `… en nog ${zichtbaar.length - 400}; verfijn je zoekopdracht.`));
    };
    tekenLijst();
  }

  // ---------- openen/sluiten ----------

  for (const [overlay, sluitId] of [[reviewOverlay, "reviewCloseBtn"], [rulesOverlay, "rulesCloseBtn"]] as const) {
    document.getElementById(sluitId)?.addEventListener("click", () => (overlay.hidden = true));
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) overlay.hidden = true;
    });
  }

  return {
    async openBeoordelen() {
      ctx = await deps.laadContext();
      productenCache = null;
      reviewOverlay.hidden = false;
      renderBeoordelen();
    },
    async openRegels() {
      ctx = await deps.laadContext();
      productenCache = null;
      formulier = null;
      rulesOverlay.hidden = false;
      renderRegels();
    },
    /** Snelactie vanuit het dashboard na het corrigeren van één product. */
    async openRegelFormulier(omschrijving: string, categorie: string) {
      ctx = await deps.laadContext();
      const alle = producten();
      const voorsteller = new Voorsteller(alle.map((p) => ({ omschrijving: p.omschrijving, categorie: p.categorie, subcategorie: p.subcategorie })));
      openRegelFormulierMet({ trefwoord: voorsteller.stelTrefwoordVoor(omschrijving, alle.map((p) => p.omschrijving)), categorie, subcategorie: null });
    },
    /** Tooltip-tekst: waarom staat dit product in deze (sub)categorie? */
    uitleg(omschrijving: string, bedrag: number | null): string {
      productIndex ??= new Map(producten().map((x) => [x.omschrijving, x]));
      const p = productIndex.get(omschrijving) ?? { product_id: null };
      const cat = verklaarCategorie(omschrijving, bedrag, ctx.overrides, opties(p));
      const sub = verklaarSubcategorie(omschrijving, cat.waarde, bedrag, ctx.subOverrides, opties(p));
      return `Categorie: ${uitlegTekst(cat)} · subcategorie ‘${sub.waarde}’: ${uitlegTekst(sub)}`;
    },
    verversCache(nieuw: CategorieContext) {
      ctx = nieuw;
      productenCache = null;
      werkTellerBij();
    },
    sluitAlles() {
      reviewOverlay.hidden = true;
      rulesOverlay.hidden = true;
    },
  };
}
