/**
 * Bonnetjes uit afbeeldingen via OCR (tesseract.js) in de browser: Lidl
 * Plus-screenshots en foto's van papieren bonnen (AH of Lidl). Welke winkel
 * het is volgt uit de herkende tekst, niet uit het soort afbeelding.
 *
 * Voorbewerking verschilt per soort afbeelding (zie ocrVoorbewerking.ts):
 * - Screenshot: vergroot 3x en zwart-wit met een vaste drempel. De
 *   app-screenshots zijn klein (~340px breed); zonder die voorbewerking valt
 *   tesseract regels over en leest het de blauwe kortingsregels niet.
 * - Foto: bijgesneden tot het papier, geschaald naar een vaste breedte en
 *   zwart-wit met een lokale drempel. Vergroten zou bij een foto van
 *   12 MP een canvas opleveren dat de browser niet aankan. Hoe goed
 *   tesseract een foto leest wisselt met de breedte; lukt het op de eerste
 *   niet (regels tellen niet op), dan volgen de andere uit FOTO_BREEDTES.
 */
// Worker, wasm-kern en Nederlandse taaldata worden meegebundeld en vanaf de
// eigen origin geladen i.p.v. tesseract.js' standaard-CDN: de CSP in
// index.html staat alleen 'self' toe, en zo verlaat er niets de browser.
import tesseractWorkerUrl from "tesseract.js/dist/worker.min.js?url";
import tesseractCoreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import nldTraineddataUrl from "@tesseract.js-data/nld/4.0.0_best_int/nld.traineddata.gz?url";
import { isAhTekst, parseAhText } from "./ahOcrParser";
import { isLidlTekst, parseLidlText, type OcrBon } from "./lidlOcrParser";
import { binariseerAdaptief, isScreenshot, papierKader } from "./ocrVoorbewerking";
import type { Artikel, Bon } from "./types";

// Afgestemd op de Lidl Plus-screenshots (zwarte en blauwe tekst op wit, grijs watermerk).
const SCREENSHOT_SCHAAL = 3;
const SCREENSHOT_DREMPEL = 170;
// Breedtes van de bijgesneden bon (~35 tekens per regel), in volgorde van proberen.
const FOTO_BREEDTES = [1500, 1100, 2000];
// Verkleinde kopie om screenshot/foto te onderscheiden en het papier te vinden.
const PROEF_BREEDTE = 400;

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas niet beschikbaar");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

function voorbewerkScreenshot(bitmap: ImageBitmap): HTMLCanvasElement {
  const [canvas, ctx] = canvas2d(bitmap.width * SCREENSHOT_SCHAAL, bitmap.height * SCREENSHOT_SCHAAL);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const grijs = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const v = grijs >= SCREENSHOT_DREMPEL ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function voorbewerkFoto(bitmap: ImageBitmap, proef: ImageData, doelBreedte: number): HTMLCanvasElement {
  const kader = papierKader(proef.data, proef.width, proef.height);
  const f = bitmap.width / proef.width;
  const [sx, sy, sw, sh] = [kader.x * f, kader.y * f, kader.w * f, kader.h * f];
  const [canvas, ctx] = canvas2d(doelBreedte, Math.round((sh * doelBreedte) / sw));
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  binariseerAdaptief(img.data, img.width, img.height);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function parseTekst(tekst: string, bestand: string): OcrBon {
  if (isAhTekst(tekst)) return parseAhText(tekst, bestand);
  if (isLidlTekst(tekst)) return parseLidlText(tekst, bestand);
  throw new Error("geen herkenbare AH- of Lidl-kassabon");
}

/** Voorbewerken, herkennen en parseren; een foto krijgt bij een mislukte lezing nog een kans op een andere breedte. */
async function leesAfbeelding(worker: TesseractWorker, file: Blob, bestand: string): Promise<OcrBon> {
  const bitmap = await createImageBitmap(file);
  try {
    const [, proefCtx] = canvas2d(PROEF_BREEDTE, Math.max(1, Math.round((bitmap.height * PROEF_BREEDTE) / bitmap.width)));
    proefCtx.drawImage(bitmap, 0, 0, proefCtx.canvas.width, proefCtx.canvas.height);
    const proef = proefCtx.getImageData(0, 0, proefCtx.canvas.width, proefCtx.canvas.height);
    const pogingen = isScreenshot(proef.data)
      ? [() => voorbewerkScreenshot(bitmap)]
      : FOTO_BREEDTES.map((b) => () => voorbewerkFoto(bitmap, proef, b));

    let fout: unknown;
    for (const voorbewerk of pogingen) {
      const { data } = await worker.recognize(voorbewerk());
      try {
        return parseTekst(data.text, bestand);
      } catch (err) {
        // de eerste fout is de meest bruikbare melding: de latere pogingen lezen meestal slechter
        fout ??= err;
      }
    }
    throw fout;
  } finally {
    bitmap.close();
  }
}

/** Parseert meerdere afbeeldingen; een onleesbare bon mag de rest van de batch niet blokkeren. */
export async function parseReceiptImages(
  files: { name: string; data: Blob }[],
  onProgress?: (klaar: number, totaal: number) => void,
): Promise<{ bonnen: Bon[]; artikelen: Artikel[]; warnings: string[] }> {
  const bonnen: Bon[] = [];
  const artikelen: Artikel[] = [];
  const warnings: string[] = [];
  if (files.length === 0) return { bonnen, artikelen, warnings };

  // Pas hier laden: wie alleen PDF/JSON importeert downloadt tesseract (en de taaldata) nooit.
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  let worker: TesseractWorker | null = null;
  try {
    worker = await createWorker("nld", OEM.LSTM_ONLY, {
      workerPath: tesseractWorkerUrl,
      corePath: tesseractCoreUrl,
      // tesseract zoekt "<langPath>/nld.traineddata.gz"; vite.config.ts houdt die bestandsnaam daarom zonder hash
      langPath: new URL(".", new URL(nldTraineddataUrl, location.href)).href,
      // worker gewoon als bestand vanaf 'self' starten, niet als blob:-kopie
      workerBlobURL: false,
      // de browser-HTTP-cache volstaat; tesseract's eigen IndexedDB-kopie (ongezipt ~10 MB) is overbodig
      cacheMethod: "none",
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
    });

    for (const [i, { name, data }] of files.entries()) {
      onProgress?.(i, files.length);
      try {
        const { bon, artikelen: items, meldingen } = await leesAfbeelding(worker, data, name);
        bonnen.push(bon);
        artikelen.push(...items);
        warnings.push(...meldingen.map((m) => `${name}: ${m}`));
      } catch (err) {
        warnings.push(`kon ${name} niet verwerken: ${(err as Error).message}`);
      }
    }
    onProgress?.(files.length, files.length);
  } finally {
    await worker?.terminate();
  }

  return { bonnen, artikelen, warnings };
}
