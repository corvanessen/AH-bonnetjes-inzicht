// Bouwt de Firefox-versie (computer en Android) van de extensie in
// build/firefox-extension/: dezelfde bestanden, met manifest.json aangevuld met
// firefox/manifest-overrides.json (achtergrondscript i.p.v. service worker,
// add-on-id, minimale Firefox-versie).
//
//   node extension/firefox/build.mjs
//   npx web-ext run -s build/firefox-extension            (Firefox op de computer)
//   npx web-ext run -s build/firefox-extension -t firefox-android --android-device <id>

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(src, "..", "build", "firefox-extension");

// Inhoud legen i.p.v. de map zelf: die kan open staan (web-ext run, terminal).
mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) rmSync(join(out, name), { recursive: true, force: true });
for (const name of readdirSync(src)) {
  if (name === "firefox" || name === "manifest.json" || name.startsWith(".")) continue;
  cpSync(join(src, name), join(out, name), { recursive: true });
}

const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const overrides = JSON.parse(readFileSync(join(src, "firefox", "manifest-overrides.json"), "utf8"));
writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...manifest, ...overrides }, null, 2) + "\n");
console.log(`Firefox-extensie gebouwd in ${out}`);
