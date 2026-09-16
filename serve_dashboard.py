"""Start een lokale webserver voor dashboard.html en open die in de browser.

Draai dit na `uv run export_dashboard_data.py`. De server serveert deze map
(zodat dashboard.html bij data/dashboard_data.json kan) en blijft draaien tot
je 'm afbreekt met Ctrl+C.

Deze server doet meer dan alleen statische bestanden serveren: het dashboard
kan via een POST naar /api/categorie de categorie van een product aanpassen.
Zo'n verzoek wordt hier verwerkt: de override wordt weggeschreven naar
`ah_receipts/categorie_overrides.csv`, de categorie-kolom in
data/artikelen.parquet/.csv wordt herberekend, en data/dashboard_data.json
wordt opnieuw opgebouwd - de aanpassing is dus meteen zichtbaar zonder
`main.py` opnieuw te hoeven draaien.

Gebruik:
    uv run serve_dashboard.py            # kiest zelf een vrije poort
    uv run serve_dashboard.py --port 8000
"""

import argparse
import http.server
import json
import socketserver
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

import pandas as pd

from ah_receipts.categorisatie import categoriseer, categoriseer_sub, stel_override_in, stel_sub_override_in
from export_dashboard_data import bouw_dashboard_data, laad_account_labels

DATA_MAP = Path("data")
LABELS_PAD = Path("accounts/labels.json")

# Enige bestanden die dashboard.html zelf opvraagt. Zonder deze whitelist zou
# SimpleHTTPRequestHandler de hele werkmap serveren, inclusief accounts/ (echte
# kassabonnen/adressen) en data/*.parquet/.csv - die horen alleen lokaal op
# schijf te blijven, niet over http bereikbaar te zijn.
TOEGESTANE_GET_PADEN = {"/dashboard.html", "/favicon.svg", "/data/dashboard_data.json"}


def _herbereken_categorieen() -> None:
    """Ken categorieën (en subcategorieën) opnieuw toe en herbouw dashboard_data.json."""
    artikelen = pd.read_parquet(DATA_MAP / "artikelen.parquet")
    is_product = artikelen["type"] == "product"
    artikelen.loc[is_product, "categorie"] = [
        categoriseer(omschr, bedrag)
        for omschr, bedrag in zip(artikelen.loc[is_product, "omschrijving"], artikelen.loc[is_product, "bedrag"])
    ]
    artikelen.loc[is_product, "subcategorie"] = [
        categoriseer_sub(omschr, cat, bedrag)
        for omschr, cat, bedrag in zip(
            artikelen.loc[is_product, "omschrijving"],
            artikelen.loc[is_product, "categorie"],
            artikelen.loc[is_product, "bedrag"],
        )
    ]
    artikelen.to_parquet(DATA_MAP / "artikelen.parquet", index=False)
    artikelen.to_csv(DATA_MAP / "artikelen.csv", index=False)

    dashboard_data = bouw_dashboard_data(DATA_MAP, laad_account_labels(LABELS_PAD))
    (DATA_MAP / "dashboard_data.json").write_text(
        json.dumps(dashboard_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if urlsplit(self.path).path not in TOEGESTANE_GET_PADEN:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if urlsplit(self.path).path not in TOEGESTANE_GET_PADEN:
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        if not self._eigen_origin():
            self._json_antwoord(403, {"fout": "verzoek moet van de dashboardpagina zelf komen"})
            return
        if self.path == "/api/categorie":
            self._verwerk_indeling("categorie", "categorie", stel_override_in)
        elif self.path == "/api/subcategorie":
            self._verwerk_indeling("subcategorie", "subcategorie", stel_sub_override_in)
        else:
            self._json_antwoord(404, {"fout": "onbekend endpoint"})

    def _eigen_origin(self) -> bool:
        """Wijs POST's af die niet vanaf onze eigen dashboardpagina komen.

        Zonder deze check kan elke andere pagina die toevallig openstaat in
        dezelfde browser (of elk ander lokaal proces) categorie-overrides
        laten wegschrijven via een cross-origin POST naar deze server.
        """
        host, poort = self.server.server_address[:2]
        eigen_origin = f"http://{host}:{poort}"
        origin = self.headers.get("Origin")
        if origin is not None:
            return origin == eigen_origin
        referer = self.headers.get("Referer")
        return referer is not None and referer.startswith(eigen_origin + "/")

    def _verwerk_indeling(self, veld: str, antwoordveld: str, override_setter) -> None:
        lengte = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(lengte) or b"{}")
            omschrijving = str(payload["omschrijving"]).strip()
            waarde = str(payload[veld]).strip()
            if not omschrijving or not waarde:
                raise ValueError(f"omschrijving en {veld} mogen niet leeg zijn")
        except Exception as exc:
            self._json_antwoord(400, {"fout": str(exc)})
            return

        try:
            override_setter(omschrijving, waarde)
            _herbereken_categorieen()
        except Exception as exc:
            self._json_antwoord(500, {"fout": str(exc)})
            return

        self._json_antwoord(200, {"ok": True, "omschrijving": omschrijving, antwoordveld: waarde})

    def _json_antwoord(self, status: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - vaste signatuur van de basisklasse
        # stiller dan de standaard: alleen POST's (categorie-aanpassingen) loggen,
        # niet elke losse GET van dashboard.html/data/dashboard_data.json.
        if self.command == "POST":
            super().log_message(format, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serveer dashboard.html lokaal.")
    parser.add_argument("--port", type=int, default=0, help="Poort (standaard: laat het OS een vrije poort kiezen)")
    args = parser.parse_args()

    with socketserver.TCPServer(("127.0.0.1", args.port), DashboardHandler) as httpd:
        poort = httpd.server_address[1]
        url = f"http://127.0.0.1:{poort}/dashboard.html"
        print(f"Dashboard staat klaar op {url} (Ctrl+C om te stoppen)")
        webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer gestopt.")


if __name__ == "__main__":
    main()
