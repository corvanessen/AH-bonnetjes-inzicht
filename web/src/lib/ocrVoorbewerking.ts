/**
 * Beeldbewerking vóór OCR, los van canvas/DOM zodat het ook in Node te
 * testen is. Twee soorten invoer:
 * - Screenshots (Lidl Plus-app): klein, egaal witte achtergrond. Vergroten en
 *   een vaste drempel werkt daar het best, zie ocr.ts.
 * - Camerafoto's van een papieren bon: groot, ongelijk belicht, met hand en
 *   ondergrond eromheen. Die worden bijgesneden tot het papier (papierKader)
 *   en met een lokale drempel zwart-wit gemaakt (binariseerAdaptief) — een
 *   vaste drempel valt weg in schaduw, en tesseract maakt van de rand
 *   (vingers, stoeptegels) anders regels vol rommel.
 */

export interface Kader {
  x: number;
  y: number;
  w: number;
  h: number;
}

function grijs(px: Uint8ClampedArray, i: number): number {
  return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
}

/**
 * Een screenshot heeft grote vlakken exact wit (255,255,255); een foto van
 * papier vrijwel nooit, ook niet als het papier overbelicht is.
 */
export function isScreenshot(px: Uint8ClampedArray): boolean {
  let wit = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) wit++;
  }
  return wit / (px.length / 4) > 0.1;
}

/** Langste aaneengesloten reeks indexen waar `tellingen` boven `fractie` van het maximum ligt. */
function langsteReeks(tellingen: number[], fractie: number): [number, number] {
  const grens = Math.max(...tellingen) * fractie;
  let beste: [number, number] = [0, tellingen.length];
  let besteLengte = 0;
  let start = -1;
  for (let i = 0; i <= tellingen.length; i++) {
    const aan = i < tellingen.length && tellingen[i] > grens;
    if (aan && start < 0) start = i;
    if (!aan && start >= 0) {
      if (i - start > besteLengte) {
        besteLengte = i - start;
        beste = [start, i];
      }
      start = -1;
    }
  }
  return beste;
}

/**
 * Kader rond de bon in een (verkleinde) foto: papier is licht en kleurloos,
 * huid is verzadigd en de ondergrond meestal donkerder. Eerst de kolommen met
 * veel papier, daarbinnen de rijen. Een scheve bon geeft een ruimer kader;
 * de lokale drempel kan die rand daarna wel hebben.
 */
export function papierKader(px: Uint8ClampedArray, w: number, h: number): Kader {
  const papier = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const kleur = Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]);
    papier[p] = kleur < 30 && grijs(px, i) > 120 ? 1 : 0;
  }
  const kolommen = new Array<number>(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) kolommen[x] += papier[y * w + x];
  const [x0, x1] = langsteReeks(kolommen, 0.5);
  const rijen = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) rijen[y] += papier[y * w + x];
  const [y0, y1] = langsteReeks(rijen, 0.5);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Zwart-wit met een lokale drempel (Bradley): een pixel wordt zwart als hij
 * duidelijk donkerder is dan het gemiddelde van zijn omgeving. Werkt in-place.
 */
export function binariseerAdaptief(px: Uint8ClampedArray, w: number, h: number): void {
  const g = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) g[p] = grijs(px, p * 4);
  // integraalbeeld: som van alle grijswaarden links-boven (x, y), exclusief
  const integraal = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rij = 0;
    for (let x = 0; x < w; x++) {
      rij += g[y * w + x];
      integraal[(y + 1) * (w + 1) + x + 1] = integraal[y * (w + 1) + x + 1] + rij;
    }
  }
  // venster ~1/16 van de bonbreedte: ruim groter dan een letter, kleiner dan een schaduwvlek
  const half = Math.max(1, Math.round(w / 32));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w, x + half + 1);
      const som =
        integraal[y1 * (w + 1) + x1] - integraal[y0 * (w + 1) + x1] - integraal[y1 * (w + 1) + x0] + integraal[y0 * (w + 1) + x0];
      const gemiddelde = som / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + x] < gemiddelde * 0.85 ? 0 : 255;
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
}
