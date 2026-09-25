// Ported from dashboard.html's inline <script> almost verbatim. The only
// changes: no more fetch()/POST to serve_dashboard.py — main.ts loads data
// from IndexedDB (see ./lib/db.ts) and passes it in via initDashboard(),
// and category edits go through the `store` set by setStore() instead of
// a network call, since there is no server here.
"use strict";
import { showSnackbar } from "./lib/snackbar";

  var CAT_COLOR_VARS = ["--cat-1","--cat-2","--cat-3","--cat-4","--cat-5","--cat-6","--cat-7"];
  var OVERIG_LABEL = "overig (+ klein)";

  var state = { dateFrom: null, dateTo: null, account: "alle", tableCategory: null, tableSubcategory: null, topSort: "keer", timeMode: "7dgem", trendMode: "maand" };
  var OVERIG_SUB = "overig";
  var DATA = null;
  var store = null;
  var BIO_KEYWORD = "BIO";
  var categoryColorMap = null;
  var monthLabels = { "01":"jan","02":"feb","03":"mrt","04":"apr","05":"mei","06":"jun",
                      "07":"jul","08":"aug","09":"sep","10":"okt","11":"nov","12":"dec" };

  function cssVar(name){
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function fmtEUR(n){
    if (n === null || n === undefined || isNaN(n)) return "—";
    return "€" + n.toLocaleString("nl-NL", {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  // Alle datums zijn kalenderdatums zonder tijdcomponent (bv. "2025-12-20").
  // We rekenen er uitsluitend in UTC mee (parseISODate/toISODateString) en
  // mixen dat nooit met lokale Date-methodes (getDate/getDay/toISOString) -
  // anders schuift de week- of dagberekening een dag op zodra de kijker in
  // een andere tijdzone dan UTC zit (in Nederland dus vrijwel altijd).
  function parseISODate(iso){
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }
  function toISODateString(d){
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function fmtDateShort(iso){
    var d = parseISODate(iso);
    return d.getUTCDate() + " " + monthLabels[iso.slice(5,7)];
  }
  function monthKey(iso){ return iso.slice(0,7); }
  function monthLabel(key){
    var parts = key.split("-");
    return monthLabels[parts[1]] + " " + parts[0];
  }

  function isoWeekKey(iso){
    var d = parseISODate(iso);
    var day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    var firstThursday = new Date(Date.UTC(d.getUTCFullYear(),0,4));
    var week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay()+6)%7)) / 7);
    return d.getUTCFullYear() + "-W" + String(week).padStart(2,"0");
  }
  function weekStartDate(iso){
    var d = parseISODate(iso);
    var day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d;
  }

  // Vaste maandag-ankerdatum voor de 2-wekelijkse bins in de categorietrend,
  // zodat de bingrenzen (in tegenstelling tot ISO-weeknummers) niet verspringen
  // bij een jaarwisseling.
  var BIWEEK_EPOCH = Date.UTC(2020, 0, 6);
  function biweekStartDate(iso){
    var weekStart = weekStartDate(iso);
    var weekIdx = Math.round((weekStart.getTime() - BIWEEK_EPOCH) / (7 * 86400000));
    var biweekIdx = Math.floor(weekIdx / 2);
    return new Date(BIWEEK_EPOCH + biweekIdx * 14 * 86400000);
  }
  function biweekKey(iso){
    return toISODateString(biweekStartDate(iso));
  }

  // ---------- data filtering & aggregation ----------

  // ISO-datums ("YYYY-MM-DD") vergelijken kan gewoon lexicografisch/met
  // stringvergelijking - geen Date-parsing nodig voor de periodefilter.
  function inPeriode(iso){
    return (!state.dateFrom || iso >= state.dateFrom) && (!state.dateTo || iso <= state.dateTo);
  }
  function filteredBonnen(){
    return DATA.bonnen.filter(function(b){
      return inPeriode(b.datum) && (state.account === "alle" || b.account === state.account);
    });
  }
  function filteredArtikelen(){
    return DATA.artikelen.filter(function(a){
      return inPeriode(a.datum) && (state.account === "alle" || a.account === state.account);
    });
  }

  function computeKPI(bonnen){
    var totaal = 0, bonus = 0;
    bonnen.forEach(function(b){ totaal += (b.totaal||0); bonus += (b.bonus_korting||0); });
    var gemiddelde = bonnen.length ? totaal / bonnen.length : 0;
    return { totaal: totaal, aantal: bonnen.length, gemiddelde: gemiddelde, bonus: bonus };
  }

  function categoryTotals(artikelen){
    var map = {};
    artikelen.forEach(function(a){
      var cat = a.categorie || "overig";
      map[cat] = (map[cat] || 0) + a.bedrag;
    });
    return Object.keys(map).map(function(k){ return {categorie:k, bedrag:map[k]}; })
      .sort(function(a,b){ return b.bedrag - a.bedrag; });
  }

  function subcategoryTotals(artikelen, categorie){
    var map = {};
    artikelen.forEach(function(a){
      if ((a.categorie || "overig") !== categorie) return;
      var sub = a.subcategorie || OVERIG_SUB;
      map[sub] = (map[sub] || 0) + a.bedrag;
    });
    return Object.keys(map).map(function(k){ return {subcategorie:k, bedrag:map[k]}; })
      .sort(function(a,b){ return b.bedrag - a.bedrag; });
  }

  // Subcategorietotalen over ALLE categorieën heen (i.p.v. binnen één
  // geselecteerde categorie) - voor de "welke subcategorieën kosten het
  // meest"-vraag, los van of er al een categorie is aangeklikt.
  function allSubcategoryTotals(artikelen){
    var map = {};
    artikelen.forEach(function(a){
      var cat = a.categorie || "overig";
      var sub = a.subcategorie || OVERIG_SUB;
      var key = cat + "" + sub;
      if (!map[key]) map[key] = { categorie: cat, subcategorie: sub, bedrag: 0 };
      map[key].bedrag += a.bedrag;
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return b.bedrag - a.bedrag; });
  }

  // Elke categorie krijgt één vaste kleur uit de palet-variabelen, gerangschikt
  // op totaal-uitgegeven over de HELE dataset (niet de huidige filter) zodat
  // een categorie niet steeds van kleur wisselt zodra je de periode- of
  // accountfilter verandert. Dezelfde kleur wordt hergebruikt in de
  // categoriebalken, de onderverdeling ernaast, de subcategorieënlijst en de
  // categorietrend, zodat je een categorie visueel kan volgen tussen grafieken.
  function buildCategoryColorMap(){
    var totals = categoryTotals(DATA.artikelen);
    var map = {};
    totals.forEach(function(t, i){
      map[t.categorie] = CAT_COLOR_VARS[i % CAT_COLOR_VARS.length];
    });
    categoryColorMap = map;
  }
  function categoryColor(categorie){
    var v = categoryColorMap && categoryColorMap[categorie];
    return v ? "var(" + v + ")" : "var(--muted)";
  }

  // "BIO" komt op AH-kassabonnen altijd expliciet in de (afgekapte) omschrijving
  // voor bij biologische producten (bv. "AH BIO APPEL", "BIO SLA") - er is geen
  // apart datavlaggetje voor, dus we zoeken op deze substring.
  function isBioOmschrijving(omschrijving){
    return (omschrijving || "").toUpperCase().indexOf(BIO_KEYWORD) !== -1;
  }
  function bioAandeel(artikelen){
    var totaal = 0, bio = 0;
    artikelen.forEach(function(a){
      totaal += a.bedrag;
      if (isBioOmschrijving(a.omschrijving)) bio += a.bedrag;
    });
    return { totaal: totaal, bio: bio, pct: totaal > 0 ? (bio / totaal) * 100 : 0 };
  }

  // Categorie- (en indien actief subcategorie-)filter toepassen op een lijst
  // artikelen - gedeeld door top-producten en de transactietabel.
  function toegepasteCategorieFilter(artikelen){
    if (state.tableCategory){
      artikelen = artikelen.filter(function(a){ return a.categorie === state.tableCategory; });
    }
    if (state.tableSubcategory){
      artikelen = artikelen.filter(function(a){ return (a.subcategorie || OVERIG_SUB) === state.tableSubcategory; });
    }
    return artikelen;
  }

  function weeklyTotals(bonnen){
    var map = {};
    bonnen.forEach(function(b){
      var wk = isoWeekKey(b.datum);
      if (!map[wk]) map[wk] = { week: wk, start: weekStartDate(b.datum), totaal: 0 };
      map[wk].totaal += (b.totaal || 0);
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return a.start - b.start; });
  }

  // Elke dag met minstens één bon, als los punt (geen dagen met €0 ertussen) -
  // dit is de "alle punten"-weergave in de tijdgrafiek.
  function dailyTotals(bonnen){
    var map = {};
    bonnen.forEach(function(b){
      if (!map[b.datum]) map[b.datum] = { start: parseISODate(b.datum), totaal: 0 };
      map[b.datum].totaal += (b.totaal || 0);
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return a.start - b.start; });
  }

  function monthlyTotals(bonnen){
    var map = {};
    bonnen.forEach(function(b){
      var mk = monthKey(b.datum);
      if (!map[mk]) map[mk] = { key: mk, start: parseISODate(mk + "-01"), totaal: 0 };
      map[mk].totaal += (b.totaal || 0);
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return a.start - b.start; });
  }

  // Voortschrijdend 7-daags gemiddelde: elke kalenderdag in de volledige
  // periode krijgt een punt (ook dagen zonder bon tellen als €0), zodat het
  // gemiddelde de werkelijke tijdsverdeling volgt in plaats van alleen de
  // dagen waarop iets gekocht is.
  function rolling7DayAvg(bonnen){
    if (!bonnen.length) return [];
    var perDag = {};
    bonnen.forEach(function(b){ perDag[b.datum] = (perDag[b.datum] || 0) + (b.totaal || 0); });
    var dagen = Object.keys(perDag).sort();
    var eerste = parseISODate(dagen[0]);
    var laatste = parseISODate(dagen[dagen.length - 1]);
    var aantalDagen = Math.round((laatste - eerste) / 86400000) + 1;
    var reeks = [];
    for (var i = 0; i < aantalDagen; i++){
      var d = new Date(eerste);
      d.setUTCDate(d.getUTCDate() + i);
      reeks.push(perDag[toISODateString(d)] || 0);
    }
    var venster = 7;
    var som = 0;
    var rows = [];
    for (i = 0; i < reeks.length; i++){
      som += reeks[i];
      if (i >= venster) som -= reeks[i - venster];
      var n = Math.min(i + 1, venster);
      var d2 = new Date(eerste);
      d2.setUTCDate(d2.getUTCDate() + i);
      rows.push({ start: d2, totaal: som / n });
    }
    return rows;
  }

  // Bij wekelijkse bins zit er vaak maar een handjevol artikelen per categorie
  // per week in - het weekbedrag wisselt dan enorm (standaarddeviatie ~ het
  // gemiddelde) puur door welke dagen er toevallig boodschappen zijn gedaan,
  // niet door een echte trendverandering. Grotere bins middelen dat ruis eruit,
  // vandaar de keuze uit week / 2 weken / maand hieronder (net als bij de
  // "Uitgaven over tijd"-grafiek, zie TIME_MODES).
  var TREND_MODES = [
    { key:"week", label:"Week",
      sub:"Top 6 categorieën per week, de rest samengevoegd als \"overig\"",
      binKey: isoWeekKey, binStart: weekStartDate,
      titel: function(start){ return "week van " + fmtDateShort(toISODateString(start)); } },
    { key:"2weken", label:"2 weken",
      sub:"Top 6 categorieën per 2 weken, de rest samengevoegd als \"overig\"",
      binKey: biweekKey, binStart: biweekStartDate,
      titel: function(start){ return "2 weken vanaf " + fmtDateShort(toISODateString(start)); } },
    { key:"maand", label:"Maand",
      sub:"Top 6 categorieën per maand, de rest samengevoegd als \"overig\"",
      binKey: monthKey, binStart: function(iso){ return parseISODate(monthKey(iso) + "-01"); },
      titel: function(start){ return monthLabel(toISODateString(start).slice(0,7)); } }
  ];

  function categoryTrend(artikelen, modeCfg){
    var totals = categoryTotals(artikelen);
    var top = totals.slice(0,6).map(function(t){ return t.categorie; });
    // als de bestaande "overig"-categorie toevallig al bij de top 6 hoort, laat
    // kleinere categorieën daar dan in meelopen in plaats van een verwarrende
    // tweede "overig"-reeks te tonen.
    var foldLabel = top.indexOf("overig") !== -1 ? "overig" : OVERIG_LABEL;
    var bins = {};
    artikelen.forEach(function(a){
      var key = modeCfg.binKey(a.datum);
      if (!bins[key]) bins[key] = { key: key, start: modeCfg.binStart(a.datum), values:{} };
      var cat = top.indexOf(a.categorie) !== -1 ? a.categorie : foldLabel;
      bins[key].values[cat] = (bins[key].values[cat] || 0) + a.bedrag;
    });
    var series = top.indexOf(foldLabel) !== -1 ? top : top.concat([foldLabel]);
    var rows = Object.keys(bins).map(function(k){ return bins[k]; })
      .sort(function(a,b){ return a.start - b.start; });
    return { series: series, rows: rows };
  }

  function topProducts(artikelen, n, sortOp){
    var map = {};
    artikelen.forEach(function(a){
      var key = a.omschrijving;
      if (!map[key]) map[key] = { omschrijving:key, categorie:a.categorie, subcategorie:a.subcategorie, keer:0, totaal:0 };
      map[key].keer += 1;
      map[key].totaal += a.bedrag;
    });
    var lijst = Object.keys(map).map(function(k){ return map[k]; });
    if (sortOp === "totaal"){
      lijst.sort(function(a,b){ return b.totaal - a.totaal || b.keer - a.keer; });
    } else {
      lijst.sort(function(a,b){ return b.keer - a.keer || b.totaal - a.totaal; });
    }
    return lijst.slice(0, n);
  }

  // ---------- tooltip ----------

  var tooltipEl = document.getElementById("tooltip");
  function showTooltip(x, y, html){
    tooltipEl.innerHTML = "";
    html(tooltipEl);
    tooltipEl.style.left = x + "px";
    tooltipEl.style.top = (y - 10) + "px";
    tooltipEl.classList.add("show");
  }
  function hideTooltip(){ tooltipEl.classList.remove("show"); }

  function ttRow(container, label, value, swatchColor){
    var row = document.createElement("div");
    row.className = "t-row";
    var left = document.createElement("span");
    if (swatchColor){
      var sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = swatchColor;
      left.appendChild(sw);
    }
    left.appendChild(document.createTextNode(label));
    var val = document.createElement("span");
    val.className = "t-val";
    val.textContent = value;
    row.appendChild(left);
    row.appendChild(val);
    container.appendChild(row);
  }
  function ttTitle(container, text){
    var t = document.createElement("div");
    t.className = "t-title";
    t.textContent = text;
    container.appendChild(t);
  }

  // ---------- SVG helpers ----------

  var SVGNS = "http://www.w3.org/2000/svg";
  function el(tag, attrs){
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function niceMax(v){
    if (v <= 0) return 10;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / mag;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * mag;
  }

  // Weeklabels op de tijd-as: gelijkmatig verspreid (max ~8), plus altijd de
  // eerste week van een nieuw jaar erbij (ook als die niet in de gelijkmatige
  // spreiding valt) zodat een grafiek over meerdere jaren het jaartal toont
  // op de plek waar het wisselt, in plaats van bij elk tickje.
  function renderXAsLabels(svg, rows, x, W, H){
    var stap = rows.length > 8 ? Math.ceil(rows.length / 8) : 1;
    var vorigJaar = null;
    rows.forEach(function(r, i){
      var jaar = r.start.getUTCFullYear();
      var nieuwJaar = jaar !== vorigJaar;
      vorigJaar = jaar;
      if (!nieuwJaar && i % stap !== 0) return;
      var lbl = el("text", {x:x(i), y:H-8, class:"axis-label", "text-anchor":"middle"});
      lbl.textContent = fmtDateShort(toISODateString(r.start)) + (nieuwJaar ? " '" + String(jaar).slice(2) : "");
      if (nieuwJaar) lbl.setAttribute("font-weight", "600");
      svg.appendChild(lbl);
    });
  }

  // ---------- KPI row ----------

  function renderKPI(){
    var bonnen = filteredBonnen();
    var k = computeKPI(bonnen);
    var bio = bioAandeel(filteredArtikelen());
    var host = document.getElementById("kpiRow");
    host.innerHTML = "";
    var tiles = [
      { label:"Totaal uitgegeven", value: fmtEUR(k.totaal) },
      { label:"Aantal bonnen", value: String(k.aantal) },
      { label:"Gemiddeld per bon", value: fmtEUR(k.gemiddelde) },
      { label:"Bespaard met bonus", value: fmtEUR(k.bonus), good:true },
      { label:"Waarvan BIO-gelabeld", value: bio.totaal > 0 ? bio.pct.toLocaleString("nl-NL",{maximumFractionDigits:1}) + "%" : "—", foot: bio.totaal > 0 ? fmtEUR(bio.bio) + " van " + fmtEUR(bio.totaal) : null }
    ];
    tiles.forEach(function(t){
      var div = document.createElement("div");
      div.className = "kpi";
      var l = document.createElement("div"); l.className="label"; l.textContent=t.label;
      var v = document.createElement("div"); v.className="value" + (t.good ? " good" : ""); v.textContent=t.value;
      div.appendChild(l); div.appendChild(v);
      if (t.foot){
        var f = document.createElement("div"); f.className="foot"; f.textContent=t.foot;
        div.appendChild(f);
      }
      host.appendChild(div);
    });
  }

  // ---------- account filter ----------

  function renderAccountFilter(){
    var host = document.getElementById("accountFilter");
    if (!DATA.accounts || DATA.accounts.length < 2){
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = "";
    var all = ["alle"].concat(DATA.accounts);
    all.forEach(function(a){
      var btn = document.createElement("button");
      btn.textContent = a === "alle" ? "Alle accounts" : a;
      if (a === state.account) btn.classList.add("active");
      btn.addEventListener("click", function(){
        state.account = a;
        renderAll();
      });
      host.appendChild(btn);
    });
  }

  // ---------- period filter (van/tot) ----------

  function renderPeriodFilter(){
    var fromInput = document.getElementById("dateFromInput");
    var toInput = document.getElementById("dateToInput");
    var clearBtn = document.getElementById("periodClearBtn");

    // min/max op basis van de volledige dataset (niet het huidige account-
    // filter) zodat de datumkiezers niet steeds van grenzen wisselen zodra je
    // van account wisselt.
    var alleDatums = DATA.bonnen.map(function(b){ return b.datum; }).sort();
    if (alleDatums.length){
      fromInput.min = toInput.min = alleDatums[0];
      fromInput.max = toInput.max = alleDatums[alleDatums.length - 1];
    }
    fromInput.value = state.dateFrom || "";
    toInput.value = state.dateTo || "";
    clearBtn.hidden = !state.dateFrom && !state.dateTo;

    fromInput.onchange = function(){
      state.dateFrom = fromInput.value || null;
      renderAll();
    };
    toInput.onchange = function(){
      state.dateTo = toInput.value || null;
      renderAll();
    };
    clearBtn.onclick = function(){
      state.dateFrom = null;
      state.dateTo = null;
      renderAll();
    };
  }

  // ---------- time chart (dag / 7-daags gemiddelde / maand) ----------

  var TIME_MODES = [
    { key:"dag", label:"Dag",
      sub:"Elke dag met een bon in de gekozen periode",
      titel: function(r){ return fmtDateShort(toISODateString(r.start)); }, rowLabel:"totaal" },
    { key:"7dgem", label:"7d gem.",
      sub:"Voortschrijdend 7-daags gemiddelde in de gekozen periode",
      titel: function(r){ return fmtDateShort(toISODateString(r.start)); }, rowLabel:"gemiddeld/dag" },
    { key:"maand", label:"Maand",
      sub:"Totaal per maand in de gekozen periode",
      titel: function(r){ return monthLabel(r.key); }, rowLabel:"totaal" }
  ];

  function renderTimeModeToggle(){
    var host = document.getElementById("timeModeToggle");
    host.innerHTML = "";
    TIME_MODES.forEach(function(m){
      var btn = document.createElement("button");
      btn.textContent = m.label;
      if (state.timeMode === m.key) btn.classList.add("active");
      btn.addEventListener("click", function(){
        state.timeMode = m.key;
        renderTimeModeToggle();
        renderTimeChart();
      });
      host.appendChild(btn);
    });
  }

  function timeChartRows(mode, bonnen){
    if (mode === "dag") return dailyTotals(bonnen);
    if (mode === "maand") return monthlyTotals(bonnen);
    return rolling7DayAvg(bonnen);
  }

  function renderTimeChart(){
    var host = document.getElementById("timeChartHost");
    host.innerHTML = "";
    var modeCfg = TIME_MODES.filter(function(m){ return m.key === state.timeMode; })[0] || TIME_MODES[1];
    document.getElementById("timeChartSub").textContent = modeCfg.sub;

    var rows = timeChartRows(state.timeMode, filteredBonnen());
    if (!rows.length){
      host.innerHTML = '<div class="empty-note">Geen bonnen in deze periode.</div>';
      return;
    }
    var W = 800, H = 260, M = {top:16, right:20, bottom:30, left:52};
    var innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
    var maxY = niceMax(Math.max.apply(null, rows.map(function(r){ return r.totaal; })) * 1.15);
    var x = function(i){ return M.left + (rows.length === 1 ? innerW/2 : i/(rows.length-1)*innerW); };
    var y = function(v){ return M.top + innerH - (v/maxY)*innerH; };

    var svg = el("svg", {viewBox:"0 0 " + W + " " + H, role:"img", "aria-label":"Uitgaven over tijd"});

    // gridlines + y labels
    var ticks = 4;
    for (var t=0; t<=ticks; t++){
      var v = maxY * t / ticks;
      var gy = y(v);
      svg.appendChild(el("line", {x1:M.left, x2:W-M.right, y1:gy, y2:gy, class:"gridline"}));
      var lbl = el("text", {x:M.left-8, y:gy+4, class:"axis-label", "text-anchor":"end"});
      lbl.textContent = "€" + Math.round(v);
      svg.appendChild(lbl);
    }
    svg.appendChild(el("line", {x1:M.left, x2:W-M.right, y1:M.top+innerH, y2:M.top+innerH, class:"baseline"}));

    // x labels
    renderXAsLabels(svg, rows, x, W, H);

    // area
    var areaPts = rows.map(function(r,i){ return x(i) + "," + y(r.totaal); }).join(" L ");
    var areaPath = "M " + x(0) + "," + y(0) + " L " + areaPts + " L " + x(rows.length-1) + "," + y(0) + " Z";
    svg.appendChild(el("path", {d:areaPath, class:"area-fill", fill:"var(--seq-1)"}));

    // line
    var linePts = rows.map(function(r,i){ return x(i) + "," + y(r.totaal); }).join(" L ");
    svg.appendChild(el("path", {d:"M " + linePts, class:"line-path", stroke:"var(--seq-1)"}));

    // crosshair + een los "hover"-stipje (i.p.v. een vast stipje per punt),
    // want bij dag- of 7-daags-gemiddelde-weergave kan het aantal punten in
    // de honderden lopen en wordt de grafiek onleesbaar met overal stipjes.
    var cross = el("line", {x1:0,x2:0,y1:M.top,y2:M.top+innerH, class:"crosshair"});
    svg.appendChild(cross);
    var toonAlleStippen = rows.length <= 60;
    if (toonAlleStippen){
      rows.forEach(function(r, i){
        svg.appendChild(el("circle", {cx:x(i), cy:y(r.totaal), r:4, fill:"var(--seq-1)", class:"dot"}));
      });
    }
    var hoverDot = el("circle", {r:4, fill:"var(--seq-1)", class:"dot"});
    hoverDot.style.opacity = 0;
    svg.appendChild(hoverDot);

    // Eén overlay over de hele grafiekbreedte i.p.v. een los hit-vlak per
    // punt: bij honderden punten (dag/7-daags-gemiddelde) zijn individuele
    // hitvlakken te smal om te raken; hier bepalen we het dichtstbijzijnde
    // punt op basis van de muispositie.
    var overlay = el("rect", {x:M.left, y:M.top, width:innerW, height:innerH, class:"hit"});
    overlay.addEventListener("pointermove", function(ev){ showNearest(ev); });
    overlay.addEventListener("pointerleave", function(){ hideTooltip(); cross.style.opacity=0; hoverDot.style.opacity=0; });
    svg.appendChild(overlay);

    function showNearest(ev){
      var rect = svg.getBoundingClientRect();
      var scale = rect.width / W;
      var localX = (ev.clientX - rect.left) / scale;
      var frac = rows.length === 1 ? 0 : (localX - M.left) / innerW;
      var i = Math.round(frac * (rows.length - 1));
      i = Math.max(0, Math.min(rows.length - 1, i));
      var r = rows[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      cross.style.opacity = 1;
      hoverDot.setAttribute("cx", x(i)); hoverDot.setAttribute("cy", y(r.totaal));
      hoverDot.style.opacity = 1;
      var px = rect.left + x(i)*scale;
      var py = rect.top + y(r.totaal)*scale;
      showTooltip(px, py, function(c){
        ttTitle(c, modeCfg.titel(r));
        ttRow(c, modeCfg.rowLabel, fmtEUR(r.totaal), cssVar("--seq-1"));
      });
    }

    host.appendChild(svg);
  }

  // ---------- category bar chart ----------

  function renderCategoryChart(){
    var host = document.getElementById("categoryChartHost");
    host.innerHTML = "";
    var totals = categoryTotals(filteredArtikelen());
    if (!totals.length){
      host.innerHTML = '<div class="empty-note">Geen artikelen in deze periode.</div>';
      return;
    }
    var rowH = 30, W = 800, M = {top:6, right:70, bottom:6, left:150};
    var H = totals.length * rowH + M.top + M.bottom;
    var innerW = W - M.left - M.right;
    var maxV = niceMax(totals[0].bedrag * 1.1);
    var xScale = function(v){ return (v/maxV) * innerW; };

    var svg = el("svg", {viewBox:"0 0 " + W + " " + H, role:"img", "aria-label":"Uitgaven per categorie"});

    totals.forEach(function(t, i){
      var cy = M.top + i*rowH;
      var selected = state.tableCategory === t.categorie;
      var g = el("g", {class:"bar-row", tabindex:"0"});
      if (state.tableCategory && !selected) g.classList.add("dim");
      if (selected) g.classList.add("selected");

      var label = el("text", {x:M.left-10, y:cy+rowH/2+4, class:"cat-label", "text-anchor":"end"});
      label.textContent = t.categorie;
      g.appendChild(label);

      var barW = Math.max(2, xScale(t.bedrag));
      var barAttrs = {class:"bar", x:M.left, y:cy+5, width:barW, height:rowH-12, rx:4, fill:categoryColor(t.categorie)};
      if (selected){ barAttrs.stroke = cssVar("--ink"); barAttrs["stroke-width"] = 2; }
      var bar = el("rect", barAttrs);
      g.appendChild(bar);

      var val = el("text", {x:M.left+barW+8, y:cy+rowH/2+4, class:"val-label"});
      val.textContent = fmtEUR(t.bedrag);
      g.appendChild(val);

      var hit = el("rect", {x:0, y:cy, width:W, height:rowH, class:"hit"});
      g.appendChild(hit);

      g.addEventListener("click", function(){
        state.tableCategory = (state.tableCategory === t.categorie) ? null : t.categorie;
        state.tableSubcategory = null;
        renderCategoryChart();
        renderCategoryBreakdown();
        renderSubcategoryChart();
        renderTopProducts();
        renderTable();
      });
      g.addEventListener("keydown", function(ev){
        if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); g.dispatchEvent(new Event("click")); }
      });
      g.addEventListener("pointermove", function(ev){
        var rect = svg.getBoundingClientRect();
        var scale = rect.width / W;
        showTooltip(ev.clientX, rect.top + cy*scale, function(c){
          ttTitle(c, t.categorie);
          ttRow(c, "uitgegeven", fmtEUR(t.bedrag), categoryColor(t.categorie));
        });
      });
      g.addEventListener("pointerleave", hideTooltip);

      svg.appendChild(g);
    });

    host.appendChild(svg);
  }

  // ---------- category breakdown (subcategorieën binnen geselecteerde categorie) ----------

  function renderCategoryBreakdown(){
    var host = document.getElementById("categoryBreakdownHost");
    host.innerHTML = "";
    if (!state.tableCategory){ host.hidden = true; return; }
    host.hidden = false;

    var subs = subcategoryTotals(filteredArtikelen(), state.tableCategory);
    if (!subs.length) return;

    var head = document.createElement("div");
    head.className = "bd-head";
    var title = document.createElement("div");
    title.className = "bd-title";
    title.textContent = "Onderverdeling · " + state.tableCategory;
    var close = document.createElement("button");
    close.className = "bd-close";
    close.textContent = "✕";
    close.title = "Sluiten";
    close.addEventListener("click", wisCategorieFilter);
    head.appendChild(title);
    head.appendChild(close);
    host.appendChild(head);

    if (subs.length === 1 && subs[0].subcategorie === OVERIG_SUB){
      var hint = document.createElement("div");
      hint.className = "bd-hint";
      hint.textContent = "Nog geen producten hier gebundeld tot subcategorieën. Ken hieronder bij 'Meest gekochte producten' een subcategorie toe.";
      host.appendChild(hint);
    }

    var rowH = 28, W = 360, M = {top:4, right:64, bottom:4, left:96};
    var H = subs.length * rowH + M.top + M.bottom;
    var innerW = W - M.left - M.right;
    var maxV = niceMax(subs[0].bedrag * 1.1);
    var xScale = function(v){ return (v/maxV) * innerW; };

    var svg = el("svg", {viewBox:"0 0 " + W + " " + H, role:"img", "aria-label":"Onderverdeling van " + state.tableCategory});

    var baseColor = categoryColor(state.tableCategory);
    subs.forEach(function(s, i){
      var cy = M.top + i*rowH;
      var selected = state.tableSubcategory === s.subcategorie;
      var g = el("g", {class:"bar-row", tabindex:"0"});
      if (state.tableSubcategory && !selected) g.classList.add("dim");
      if (selected) g.classList.add("selected");

      var label = el("text", {x:M.left-8, y:cy+rowH/2+4, class:"cat-label", "text-anchor":"end"});
      label.textContent = s.subcategorie;
      g.appendChild(label);

      var barW = Math.max(2, xScale(s.bedrag));
      // Zelfde kleur als de bovenliggende categorie (om de link met de
      // linker categoriebalk te tonen), met een lichte opacity-trapsgewijs
      // per rang zodat de balken onderling toch te onderscheiden zijn.
      var opacity = Math.max(0.4, 1 - i*0.09);
      var barAttrs = {class:"bar", x:M.left, y:cy+4, width:barW, height:rowH-10, rx:3, fill:baseColor, "fill-opacity":opacity};
      if (selected){ barAttrs.stroke = cssVar("--ink"); barAttrs["stroke-width"] = 2; }
      var bar = el("rect", barAttrs);
      g.appendChild(bar);

      var val = el("text", {x:M.left+barW+6, y:cy+rowH/2+4, class:"val-label"});
      val.textContent = fmtEUR(s.bedrag);
      g.appendChild(val);

      var hit = el("rect", {x:0, y:cy, width:W, height:rowH, class:"hit"});
      g.appendChild(hit);

      g.addEventListener("click", function(){
        state.tableSubcategory = (state.tableSubcategory === s.subcategorie) ? null : s.subcategorie;
        renderCategoryBreakdown();
        renderSubcategoryChart();
        renderTopProducts();
        renderTable();
      });
      g.addEventListener("keydown", function(ev){
        if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); g.dispatchEvent(new Event("click")); }
      });
      g.addEventListener("pointermove", function(ev){
        var rect = svg.getBoundingClientRect();
        var scale = rect.width / W;
        showTooltip(ev.clientX, rect.top + cy*scale, function(c){
          ttTitle(c, s.subcategorie);
          ttRow(c, "uitgegeven", fmtEUR(s.bedrag), baseColor);
        });
      });
      g.addEventListener("pointerleave", hideTooltip);

      svg.appendChild(g);
    });

    host.appendChild(svg);

    if (state.tableSubcategory){
      var artikelenSub = filteredArtikelen().filter(function(a){
        return a.categorie === state.tableCategory && (a.subcategorie || OVERIG_SUB) === state.tableSubcategory;
      });
      var top3 = topProducts(artikelenSub, 3, "totaal");
      if (top3.length){
        var wrap = document.createElement("div");
        wrap.className = "bd-top3";
        var t3title = document.createElement("div");
        t3title.className = "bd-top3-title";
        t3title.textContent = "Top 3 producten · " + state.tableSubcategory;
        wrap.appendChild(t3title);
        top3.forEach(function(p){
          var row = document.createElement("div");
          row.className = "bd-top3-row";
          var name = document.createElement("span"); name.className="bd-top3-name"; name.textContent = p.omschrijving;
          var amount = document.createElement("span"); amount.className="bd-top3-amount"; amount.textContent = fmtEUR(p.totaal) + " · " + p.keer + "x";
          row.appendChild(name); row.appendChild(amount);
          wrap.appendChild(row);
        });
        host.appendChild(wrap);
      }
    }
  }

  // ---------- subcategorieën over alle categorieën heen ----------

  function renderSubcategoryChart(){
    var host = document.getElementById("subcategoryChartHost");
    host.innerHTML = "";
    var subs = allSubcategoryTotals(filteredArtikelen()).slice(0, 12);
    if (!subs.length){
      host.innerHTML = '<div class="empty-note">Geen artikelen in deze periode.</div>';
      return;
    }
    var rowH = 30, W = 800, M = {top:6, right:70, bottom:6, left:190};
    var H = subs.length * rowH + M.top + M.bottom;
    var innerW = W - M.left - M.right;
    var maxV = niceMax(subs[0].bedrag * 1.1);
    var xScale = function(v){ return (v/maxV) * innerW; };

    var svg = el("svg", {viewBox:"0 0 " + W + " " + H, role:"img", "aria-label":"Uitgaven per subcategorie"});

    subs.forEach(function(s, i){
      var cy = M.top + i*rowH;
      var selected = state.tableCategory === s.categorie && state.tableSubcategory === s.subcategorie;
      var g = el("g", {class:"bar-row", tabindex:"0"});
      if (selected) g.classList.add("selected");

      var label = el("text", {x:M.left-10, y:cy+rowH/2+4, class:"cat-label", "text-anchor":"end"});
      label.textContent = s.subcategorie + " (" + s.categorie + ")";
      g.appendChild(label);

      var color = categoryColor(s.categorie);
      var barW = Math.max(2, xScale(s.bedrag));
      var barAttrs = {class:"bar", x:M.left, y:cy+5, width:barW, height:rowH-12, rx:4, fill:color};
      if (selected){ barAttrs.stroke = cssVar("--ink"); barAttrs["stroke-width"] = 2; }
      var bar = el("rect", barAttrs);
      g.appendChild(bar);

      var val = el("text", {x:M.left+barW+8, y:cy+rowH/2+4, class:"val-label"});
      val.textContent = fmtEUR(s.bedrag);
      g.appendChild(val);

      var hit = el("rect", {x:0, y:cy, width:W, height:rowH, class:"hit"});
      g.appendChild(hit);

      g.addEventListener("click", function(){
        if (selected){
          state.tableCategory = null;
          state.tableSubcategory = null;
        } else {
          state.tableCategory = s.categorie;
          state.tableSubcategory = s.subcategorie;
        }
        renderCategoryChart();
        renderCategoryBreakdown();
        renderSubcategoryChart();
        renderTopProducts();
        renderTable();
      });
      g.addEventListener("keydown", function(ev){
        if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); g.dispatchEvent(new Event("click")); }
      });
      g.addEventListener("pointermove", function(ev){
        var rect = svg.getBoundingClientRect();
        var scale = rect.width / W;
        showTooltip(ev.clientX, rect.top + cy*scale, function(c){
          ttTitle(c, s.categorie + " › " + s.subcategorie);
          ttRow(c, "uitgegeven", fmtEUR(s.bedrag), color);
        });
      });
      g.addEventListener("pointerleave", hideTooltip);

      svg.appendChild(g);
    });

    host.appendChild(svg);
  }

  // ---------- category trend (stacked area) ----------

  function renderTrendModeToggle(){
    var host = document.getElementById("trendModeToggle");
    host.innerHTML = "";
    TREND_MODES.forEach(function(m){
      var btn = document.createElement("button");
      btn.textContent = m.label;
      if (state.trendMode === m.key) btn.classList.add("active");
      btn.addEventListener("click", function(){
        state.trendMode = m.key;
        renderTrendModeToggle();
        renderTrendChart();
      });
      host.appendChild(btn);
    });
  }

  function renderTrendChart(){
    var host = document.getElementById("trendChartHost");
    var legendHost = document.getElementById("trendLegend");
    host.innerHTML = ""; legendHost.innerHTML = "";
    var modeCfg = TREND_MODES.filter(function(m){ return m.key === state.trendMode; })[0] || TREND_MODES[2];
    document.getElementById("trendChartSub").textContent = modeCfg.sub;
    var trend = categoryTrend(filteredArtikelen(), modeCfg);
    if (!trend.rows.length){
      host.innerHTML = '<div class="empty-note">Geen artikelen in deze periode.</div>';
      return;
    }
    var series = trend.series, rows = trend.rows;
    var colorFor = function(idx){
      var naam = series[idx];
      return (naam === "overig" || naam === OVERIG_LABEL) ? "var(--muted)" : categoryColor(naam);
    };

    var W = 800, H = 280, M = {top:16, right:20, bottom:30, left:52};
    var innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
    var maxTotal = 0;
    rows.forEach(function(r){
      var sum = 0; series.forEach(function(s){ sum += (r.values[s]||0); });
      maxTotal = Math.max(maxTotal, sum);
    });
    maxTotal = niceMax(maxTotal * 1.15);
    var x = function(i){ return M.left + (rows.length === 1 ? innerW/2 : i/(rows.length-1)*innerW); };
    var y = function(v){ return M.top + innerH - (v/maxTotal)*innerH; };

    var svg = el("svg", {viewBox:"0 0 " + W + " " + H, role:"img", "aria-label":"Categorietrend per " + modeCfg.label.toLowerCase()});

    var ticks = 4;
    for (var t=0;t<=ticks;t++){
      var v = maxTotal*t/ticks, gy = y(v);
      svg.appendChild(el("line", {x1:M.left,x2:W-M.right,y1:gy,y2:gy,class:"gridline"}));
      var lbl = el("text", {x:M.left-8,y:gy+4,class:"axis-label","text-anchor":"end"});
      lbl.textContent = "€" + Math.round(v);
      svg.appendChild(lbl);
    }
    svg.appendChild(el("line", {x1:M.left,x2:W-M.right,y1:M.top+innerH,y2:M.top+innerH,class:"baseline"}));

    renderXAsLabels(svg, rows, x, W, H);

    // stacked cumulative baselines
    var cum = rows.map(function(){ return 0; });
    series.forEach(function(s, si){
      var topPts = [], botPts = [], color = colorFor(si);
      rows.forEach(function(r, i){
        var v = (r.values[s] || 0);
        botPts.push(x(i) + "," + y(cum[i]));
        cum[i] += v;
        topPts.push(x(i) + "," + y(cum[i]));
      });
      var path = "M " + topPts.join(" L ") + " L " + botPts.slice().reverse().join(" L ") + " Z";
      svg.appendChild(el("path", {d:path, fill:color, "fill-opacity":0.75}));
    });

    // crosshair + hit areas per week column
    var cross = el("line", {x1:0,x2:0,y1:M.top,y2:M.top+innerH, class:"crosshair"});
    svg.appendChild(cross);
    rows.forEach(function(r,i){
      var hit = el("rect", {x:x(i)-Math.max(14, innerW/rows.length/2), y:M.top, width:Math.max(28, innerW/rows.length), height:innerH, class:"hit"});
      hit.addEventListener("pointerenter", function(ev){ showStack(ev,i); });
      hit.addEventListener("pointermove", function(ev){ showStack(ev,i); });
      hit.addEventListener("pointerleave", function(){ hideTooltip(); cross.style.opacity=0; });
      svg.appendChild(hit);
    });

    function showStack(ev, i){
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      cross.style.opacity = 1;
      var r = rows[i];
      var rect = svg.getBoundingClientRect();
      var scale = rect.width / W;
      showTooltip(rect.left + x(i)*scale, rect.top + M.top*scale, function(c){
        ttTitle(c, modeCfg.titel(r.start));
        series.slice().forEach(function(s, si){
          var v = r.values[s] || 0;
          if (v > 0) ttRow(c, s, fmtEUR(v), colorFor(si));
        });
      });
    }

    host.appendChild(svg);

    series.forEach(function(s, si){
      var item = document.createElement("div");
      item.className = "legend-item";
      var sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = colorFor(si);
      item.appendChild(sw);
      item.appendChild(document.createTextNode(s));
      legendHost.appendChild(item);
    });
  }

  // ---------- top products ----------

  function wisCategorieFilter(){
    state.tableCategory = null;
    state.tableSubcategory = null;
    renderCategoryChart();
    renderCategoryBreakdown();
    renderSubcategoryChart();
    renderTopProducts();
    renderTable();
  }

  function renderCategoryFilterNote(elId){
    var note = document.getElementById(elId);
    if (!state.tableCategory){ note.hidden = true; return; }
    note.hidden = false;
    note.innerHTML = "";
    var label = state.tableSubcategory ? state.tableCategory + " › " + state.tableSubcategory : state.tableCategory;
    note.appendChild(document.createTextNode(label + " "));
    var btn = document.createElement("button");
    btn.textContent = "✕";
    btn.addEventListener("click", wisCategorieFilter);
    note.appendChild(btn);
  }

  // ---------- categorie bewerken ----------

  function alleCategorieen(){
    var set = new Set();
    DATA.artikelen.forEach(function(a){ if (a.categorie) set.add(a.categorie); });
    return Array.from(set).sort();
  }

  function alleSubcategorieen(categorie){
    var set = new Set([OVERIG_SUB]);
    DATA.artikelen.forEach(function(a){
      if (a.categorie === categorie && a.subcategorie) set.add(a.subcategorie);
    });
    return Array.from(set).sort(function(a,b){
      if (a === OVERIG_SUB) return 1;
      if (b === OVERIG_SUB) return -1;
      return a.localeCompare(b);
    });
  }

  function buildCategorySelect(huidigeCategorie, omschrijving){
    var select = document.createElement("select");
    select.className = "cat-edit";
    alleCategorieen().forEach(function(cat){
      var opt = document.createElement("option");
      opt.value = cat; opt.textContent = cat;
      if (cat === huidigeCategorie) opt.selected = true;
      select.appendChild(opt);
    });
    var nieuwOpt = document.createElement("option");
    nieuwOpt.value = "__nieuw__";
    nieuwOpt.textContent = "+ nieuwe categorie…";
    select.appendChild(nieuwOpt);

    select.addEventListener("click", function(ev){ ev.stopPropagation(); });
    select.addEventListener("change", function(){
      var waarde = select.value;
      if (waarde === "__nieuw__"){
        waarde = (window.prompt("Naam voor de nieuwe categorie:") || "").trim();
        if (!waarde){ select.value = huidigeCategorie; return; }
      }
      opslaanCategorie(omschrijving, waarde, select, huidigeCategorie);
    });
    return select;
  }

  function opslaanCategorie(omschrijving, categorie, select, vorigeCategorie){
    select.disabled = true;
    store.saveCategoryOverride(omschrijving, categorie).then(function(data){
      DATA = data;
      buildCategoryColorMap();
      renderAll();
    }).catch(function(err){
      showSnackbar("Opslaan mislukt: " + err.message, { error: true });
      select.disabled = false;
      select.value = vorigeCategorie;
    });
  }

  function buildSubcategorieSelect(categorie, huidigeSubcategorie, omschrijving){
    var select = document.createElement("select");
    select.className = "cat-edit";
    alleSubcategorieen(categorie).forEach(function(sub){
      var opt = document.createElement("option");
      opt.value = sub; opt.textContent = sub;
      if (sub === (huidigeSubcategorie || OVERIG_SUB)) opt.selected = true;
      select.appendChild(opt);
    });
    var nieuwOpt = document.createElement("option");
    nieuwOpt.value = "__nieuw__";
    nieuwOpt.textContent = "+ nieuwe subcategorie…";
    select.appendChild(nieuwOpt);

    select.addEventListener("click", function(ev){ ev.stopPropagation(); });
    select.addEventListener("change", function(){
      var waarde = select.value;
      if (waarde === "__nieuw__"){
        waarde = (window.prompt("Naam voor de nieuwe subcategorie binnen '" + categorie + "':") || "").trim();
        if (!waarde){ select.value = huidigeSubcategorie || OVERIG_SUB; return; }
      }
      opslaanSubcategorie(omschrijving, waarde, select, huidigeSubcategorie || OVERIG_SUB);
    });
    return select;
  }

  function opslaanSubcategorie(omschrijving, subcategorie, select, vorigeSubcategorie){
    select.disabled = true;
    store.saveSubcategoryOverride(omschrijving, subcategorie).then(function(data){
      DATA = data;
      buildCategoryColorMap();
      renderAll();
    }).catch(function(err){
      showSnackbar("Opslaan mislukt: " + err.message, { error: true });
      select.disabled = false;
      select.value = vorigeSubcategorie;
    });
  }

  // ---------- top producten ----------

  function renderTopSortToggle(){
    var host = document.getElementById("topSortToggle");
    host.innerHTML = "";
    [["keer","Meeste aankopen"], ["totaal","Meest uitgegeven"]].forEach(function(pair){
      var btn = document.createElement("button");
      btn.textContent = pair[1];
      if (state.topSort === pair[0]) btn.classList.add("active");
      btn.addEventListener("click", function(){
        state.topSort = pair[0];
        renderTopSortToggle();
        renderTopProducts();
      });
      host.appendChild(btn);
    });
  }

  function renderTopProducts(){
    var host = document.getElementById("topProducts");
    host.innerHTML = "";
    renderCategoryFilterNote("topProductsFilterNote");

    var artikelen = toegepasteCategorieFilter(filteredArtikelen());
    var n = state.tableCategory ? 1000 : 10;
    var top = topProducts(artikelen, n, state.topSort);

    var label = state.tableSubcategory ? state.tableCategory + " › " + state.tableSubcategory : state.tableCategory;
    var sortUitleg = state.topSort === "totaal" ? "gesorteerd op bedrag" : "gesorteerd op aantal aankopen";
    document.getElementById("topProductsSub").textContent = state.tableCategory
      ? top.length + " product(en) in '" + label + "', " + sortUitleg
      : "Op basis van aantal keer op een bon - klik een categorie hierboven om te filteren";

    if (!top.length){
      host.innerHTML = '<div class="empty-note">Geen artikelen in deze periode.</div>';
      return;
    }
    top.forEach(function(p, i){
      var row = document.createElement("div");
      row.className = "top-row" + (state.tableCategory ? " with-sub" : "");
      var rank = document.createElement("div"); rank.className="top-rank"; rank.textContent = String(i+1).padStart(2,"0");
      var name = document.createElement("div"); name.className="top-name";
      name.textContent = p.omschrijving;
      var count = document.createElement("div"); count.className="top-count"; count.textContent = p.keer + "x";
      var amount = document.createElement("div"); amount.className="top-amount"; amount.textContent = fmtEUR(p.totaal);
      var editHost = document.createElement("div");
      editHost.appendChild(buildCategorySelect(p.categorie, p.omschrijving));
      row.appendChild(rank); row.appendChild(name); row.appendChild(count); row.appendChild(amount); row.appendChild(editHost);
      if (state.tableCategory){
        var subEditHost = document.createElement("div");
        subEditHost.appendChild(buildSubcategorieSelect(p.categorie, p.subcategorie, p.omschrijving));
        row.appendChild(subEditHost);
      }
      host.appendChild(row);
    });
  }

  // ---------- table ----------

  function renderTable(){
    var body = document.getElementById("tableBody");
    body.innerHTML = "";
    var rows = filteredArtikelen().slice().sort(function(a,b){
      return b.datum.localeCompare(a.datum) || b.bedrag - a.bedrag;
    });
    renderCategoryFilterNote("categoryFilterNote");
    rows = toegepasteCategorieFilter(rows);

    if (!rows.length){
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 6; td.className = "empty-note"; td.textContent = "Geen transacties.";
      tr.appendChild(td); body.appendChild(tr);
      return;
    }

    rows.forEach(function(r){
      var tr = document.createElement("tr");

      var tdDate = document.createElement("td"); tdDate.textContent = fmtDateShort(r.datum);
      var tdAccount = document.createElement("td"); tdAccount.textContent = r.account || "—";
      var tdDesc = document.createElement("td"); tdDesc.className="desc"; tdDesc.textContent = r.omschrijving;
      var tdCat = document.createElement("td"); tdCat.textContent = r.categorie;
      var tdBonus = document.createElement("td");
      if (r.bonus){ var tag=document.createElement("span"); tag.className="bonus-tag"; tag.textContent="BONUS"; tdBonus.appendChild(tag); }
      var tdAmount = document.createElement("td"); tdAmount.className="amount"; tdAmount.textContent = fmtEUR(r.bedrag);

      tr.appendChild(tdDate); tr.appendChild(tdAccount); tr.appendChild(tdDesc); tr.appendChild(tdCat); tr.appendChild(tdBonus); tr.appendChild(tdAmount);
      body.appendChild(tr);
    });
  }

  // ---------- header range + footer ----------

  function renderHeader(){
    var kpiAll = DATA.kpi;
    var range = document.getElementById("rangeLine");
    var meerdereAccounts = DATA.accounts && DATA.accounts.length > 1;
    var derde = meerdereAccounts
      ? DATA.accounts.join(" + ")
      : ((DATA.bonnen[0] && DATA.bonnen[0].winkel_adres) || null);
    var periode = kpiAll.periode_van && kpiAll.periode_tot
      ? fmtDateShort(kpiAll.periode_van) + " – " + fmtDateShort(kpiAll.periode_tot)
      : "";
    range.textContent = [periode, kpiAll.aantal_bonnen + " bonnetjes", derde].filter(Boolean).join(" · ");
    document.getElementById("footerNote").textContent =
      "ah-bonnetjes · bijgewerkt " + new Date(DATA.gegenereerd_op).toLocaleString("nl-NL", {dateStyle:"medium", timeStyle:"short"});
  }

  // ---------- inklapbare kaarten ----------

  // Elke <section class="card"> krijgt een plus/min-knopje voor de titel.
  // Ingeklapt blijft alleen de titel (zonder subtitel/extra knoppen in de
  // card-head) zichtbaar; de rest van de kaart wordt via CSS verborgen.
  // De staat wordt per kaart (op titeltekst) onthouden in localStorage.
  function initCollapsibleCards(){
    document.querySelectorAll(".card").forEach(function(card){
      var h2 = card.querySelector(".card-head h2");
      if (!h2) return;

      var sub = h2.querySelector(".sub");
      var titleNodes = [];
      Array.prototype.forEach.call(h2.childNodes, function(n){
        if (n !== sub) titleNodes.push(n);
      });

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-toggle";

      var titleText = document.createElement("span");
      titleNodes.forEach(function(n){ titleText.appendChild(n); });

      var row = document.createElement("span");
      row.className = "card-title-row";
      row.appendChild(btn);
      row.appendChild(titleText);

      h2.innerHTML = "";
      h2.appendChild(row);
      if (sub) h2.appendChild(sub);

      var key = "dashboard-card-collapsed:" + titleText.textContent.trim();
      var collapsed = false;
      try { collapsed = localStorage.getItem(key) === "1"; } catch(e){}

      function apply(){
        card.classList.toggle("collapsed", collapsed);
        btn.textContent = collapsed ? "+" : "−";
        btn.setAttribute("aria-expanded", String(!collapsed));
        btn.setAttribute("aria-label", collapsed ? "Kaart uitklappen" : "Kaart inklappen");
      }
      apply();

      btn.addEventListener("click", function(){
        collapsed = !collapsed;
        try { localStorage.setItem(key, collapsed ? "1" : "0"); } catch(e){}
        apply();
      });
    });
  }

  // ---------- zijnavigatie (scrollspy) ----------

  function initSidenav(){
    var links = Array.prototype.slice.call(document.querySelectorAll("#sidenav a"));
    var sections = links
      .map(function(a){ return document.getElementById(a.getAttribute("href").slice(1)); })
      .filter(Boolean);
    if (!sections.length) return;

    function setActive(id){
      links.forEach(function(a){
        a.classList.toggle("active", a.getAttribute("href") === "#" + id);
      });
    }

    if (!("IntersectionObserver" in window)){
      setActive(sections[0].id);
      return;
    }

    var visible = new Set();
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      var current = sections.find(function(s){ return visible.has(s.id); });
      if (current) setActive(current.id);
    }, { rootMargin: "-15% 0px -70% 0px" });

    sections.forEach(function(s){ observer.observe(s); });
    setActive(sections[0].id);

    // Fallback: als de laatste sectie te kort is om ooit de
    // intersection-drempel te halen (weinig ruimte eronder om naar
    // toe te scrollen), activeer 'm zodra de pagina onderaan is.
    var lastId = sections[sections.length - 1].id;
    var ticking = false;
    window.addEventListener("scroll", function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        ticking = false;
        var atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
        if (atBottom) setActive(lastId);
      });
    }, { passive: true });
  }

  // ---------- wire up ----------

  initCollapsibleCards();
  initSidenav();

  document.getElementById("toggleTable").addEventListener("click", function(){
    var wrap = document.getElementById("tableWrap");
    wrap.hidden = !wrap.hidden;
    this.textContent = wrap.hidden ? "Tabel tonen" : "Tabel verbergen";
  });

  function renderAll(){
    renderAccountFilter();
    renderPeriodFilter();
    renderKPI();
    renderTimeModeToggle();
    renderTimeChart();
    renderCategoryChart();
    renderCategoryBreakdown();
    renderSubcategoryChart();
    renderTrendModeToggle();
    renderTrendChart();
    renderTopSortToggle();
    renderTopProducts();
    renderTable();
  }

  // ---------- entry points used by main.ts ----------
  // main.ts owns loading data from IndexedDB (there is no server to fetch
  // from) and calls these once it has a DashboardData object and a store
  // (see lib/db.ts) to write category-edits back to.

  export function setStore(newStore){
    store = newStore;
  }

  export function initDashboard(data){
    DATA = data;
    buildCategoryColorMap();
    renderHeader();
    renderAll();
  }
