// Firefox geeft host-rechten van een MV3-extensie niet altijd bij installatie;
// permissions.request mag alleen vanuit een klik op een pagina van de extensie zelf.
const ext = globalThis.browser ?? chrome;
const ORIGINS = ["https://api.ah.nl/*", "https://login.ah.nl/*"];
const result = document.getElementById("result");

function done() {
  result.className = "ok";
  result.textContent = "Gelukt. Ga terug naar het dashboard en kies daar opnieuw “Ophalen bij supermarkt”.";
  document.getElementById("grant").hidden = true;
}

ext.permissions.contains({ origins: ORIGINS }).then((ok) => ok && done());

document.getElementById("grant").addEventListener("click", async () => {
  try {
    if (await ext.permissions.request({ origins: ORIGINS })) return done();
    result.className = "fout";
    result.textContent = "Geen toestemming gegeven. Zonder kan de extensie je bonnetjes niet ophalen.";
  } catch (err) {
    result.className = "fout";
    result.textContent = `Er ging iets mis: ${err.message}`;
  }
});
