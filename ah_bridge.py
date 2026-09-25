"""Lokale brug tussen het web-dashboard en de AH-API, om AH-bonnetjes direct te importeren.

Voor gewone gebruikers doet de browser-extensie in extension/ dit; dit script is
een alternatief voor ontwikkelaars (geen extensie nodig, wel Python/uv). Het
dashboard gebruikt de extensie als die er is, en anders dit script als het draait.

Het dashboard (GitHub Pages of `npm run dev`) kan niet zelf met api.ah.nl
praten: AH staat geen browser-verzoeken van andere sites toe (CORS), en na het
inloggen stuurt AH door naar `appie://login-exit?code=...`, een adres dat een
webpagina niet kan opvangen. Dit script lost beide op, net als `appie login`
(github.com/gwillem/appie-go):

- `/__bridge/login` opent de echte AH-loginpagina via een reverse proxy op dit
  adres. De proxy herschrijft de appie://-doorverwijzing naar
  `/__bridge/callback`, wisselt de code om voor tokens en meldt het dashboard
  (postMessage) dat het inloggen gelukt is.
- `/__bridge/receipts` haalt de bonnetjes op en streamt ze als NDJSON terug.

De tokens blijven lokaal, in hetzelfde bestand dat `appie login` en
fetch_receipts.py gebruiken (~/.config/appie/config-<account>.json). De browser
ziet ze nooit. Alleen de origins in --allow-origin mogen de API gebruiken.

Gebruik:
    uv run ah_bridge.py
    uv run ah_bridge.py --port 8765 --allow-origin http://localhost:4173
"""

from __future__ import annotations

import argparse
import gzip
import http.client
import http.server
import json
import re
import socket
import sys
import threading
import time
import urllib.error
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from ah_receipts.ah_api import (
    LOGIN_BASE_URL,
    REDIRECT_URI,
    Client,
    NotLoggedIn,
    combine,
    config_path,
    exchange_code,
    login_url,
)

DEFAULT_PORT = 8765
DEFAULT_ORIGINS = {"https://corvanessen.github.io", "http://localhost:5173", "http://127.0.0.1:5173"}
PREFIX = "/__bridge"
LOGIN_HOST = urlsplit(LOGIN_BASE_URL).netloc

HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}
# Headers die de proxy onbruikbaar maken op http://127.0.0.1. COOP moet er ook
# uit: anders verbreekt de AH-pagina de band met het dashboard (window.opener).
STRIP_RESPONSE_HEADERS = {
    "content-security-policy", "content-security-policy-report-only", "strict-transport-security",
    "x-frame-options", "cross-origin-opener-policy", "cross-origin-embedder-policy",
}


def account_config(account: str) -> Path:
    """Accountnaam uit het dashboard -> tokenbestand. Leeg of 'default' = het standaardbestand van appie."""
    safe = re.sub(r"[^a-z0-9_-]", "_", account.strip().lower())
    return config_path(None if safe in ("", "default") else safe)


def sanitize_cookie(cookie: str) -> str:
    """Strip Secure/SameSite/Domain zodat de cookie werkt over http op 127.0.0.1 (zoals appie-go)."""
    parts = cookie.split(";")
    keep = [parts[0]]
    for p in parts[1:]:
        attr = p.strip().lower()
        if attr == "secure" or attr.startswith("samesite") or attr.startswith("domain"):
            continue
        keep.append(p)
    return ";".join(keep)


def page(title: str, body: str) -> bytes:
    return (
        "<!DOCTYPE html><html lang=nl><head><meta charset=utf-8>"
        f"<title>{title}</title><meta name=viewport content='width=device-width'></head>"
        "<body style='font-family:system-ui;max-width:480px;margin:48px auto;padding:0 16px;line-height:1.5'>"
        f"{body}</body></html>"
    ).encode()


class BridgeServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # Op Windows laat SO_REUSEADDR een tweede proces stilletjes op dezelfde poort
    # binden; dan draaien er twee helpers door elkaar. Exclusief binden dus.
    allow_reuse_address = sys.platform != "win32"

    def server_bind(self) -> None:
        if sys.platform == "win32":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def __init__(self, addr, handler, allowed_origins: set[str]):
        super().__init__(addr, handler)
        self.allowed_origins = allowed_origins
        self.local_origin = f"http://127.0.0.1:{self.server_address[1]}"
        self.lock = threading.Lock()
        # Wie er aan het inloggen is: gezet door /__bridge/login, gebruikt door de callback.
        self.pending_account: str | None = None
        self.pending_origin: str | None = None


class BridgeHandler(http.server.BaseHTTPRequestHandler):
    server: BridgeServer

    # --- routing -----------------------------------------------------------

    def do_OPTIONS(self) -> None:
        if not self.path.startswith(PREFIX):
            self._proxy()
            return
        origin = self.headers.get("Origin")
        if origin not in self.server.allowed_origins:
            self.send_error(403)
            return
        self.send_response(204)
        self._cors_headers(origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if not url.path.startswith(PREFIX):
            self._proxy()
            return
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        route = url.path[len(PREFIX):]
        if route == "/status":
            self._api(lambda: self._status(q.get("account", "")))
        elif route == "/login":
            self._start_login(q.get("account", ""), q.get("origin", ""))
        elif route == "/callback":
            self._finish_login(q.get("code", ""))
        elif route == "/handmatig":
            if not self._set_pending(q.get("account", ""), q.get("origin", "")):
                return
            self._manual_page()
        else:
            self.send_error(404)

    def do_POST(self) -> None:
        url = urlsplit(self.path)
        if not url.path.startswith(PREFIX):
            self._proxy()
            return
        route = url.path[len(PREFIX):]
        if route == "/receipts":
            self._receipts()
        elif route == "/logout":
            self._api(lambda: self._logout(self._json_body().get("account", "")))
        elif route == "/handmatig":
            self._manual_submit()
        else:
            self.send_error(404)

    def do_PUT(self) -> None:
        self._proxy()

    def do_HEAD(self) -> None:
        self._proxy()

    # --- API voor het dashboard ---------------------------------------------

    def _cors_headers(self, origin: str) -> None:
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        # Chrome: publieke site -> localhost vereist deze toestemming (Private Network Access).
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _checked_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin in self.server.allowed_origins:
            return origin
        self._send(403, b'{"error":"origin niet toegestaan"}', "application/json")
        return None

    def _json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}

    def _api(self, fn) -> None:
        origin = self._checked_origin()
        if origin is None:
            return
        try:
            status, obj = 200, fn()
        except Exception as exc:  # noqa: BLE001 - fout netjes teruggeven aan het dashboard
            status, obj = 500, {"error": str(exc)}
        body = json.dumps(obj).encode()
        self.send_response(status)
        self._cors_headers(origin)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _status(self, account: str) -> dict:
        path = account_config(account)
        if not path.exists():
            return {"loggedIn": False, "updatedAt": None}
        try:
            cfg = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return {"loggedIn": False, "updatedAt": None}
        logged_in = bool(cfg.get("refresh_token") or cfg.get("access_token"))
        return {"loggedIn": logged_in, "updatedAt": path.stat().st_mtime}

    def _logout(self, account: str) -> dict:
        account_config(account).unlink(missing_ok=True)
        return {"ok": True}

    def _receipts(self) -> None:
        origin = self._checked_origin()
        if origin is None:
            return
        req = self._json_body()
        account = str(req.get("account", ""))
        known = {str(i) for i in req.get("knownIds", []) if isinstance(i, (str, int))}

        self.send_response(200)
        self._cors_headers(origin)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()  # geen Content-Length: HTTP/1.0, verbinding sluit aan het eind

        def emit(obj: dict) -> None:
            self.wfile.write(json.dumps(obj, ensure_ascii=False).encode() + b"\n")
            self.wfile.flush()

        try:
            client = Client(account_config(account))
            receipts = client.list_receipts()
            new = [r for r in receipts if r["id"] not in known]
            emit({"type": "total", "n": len(new), "all": len(receipts)})
            for r in new:
                emit({"type": "receipt", "data": combine(r, client.get_receipt_details(r["id"]))})
                time.sleep(0.5)  # rate limit between detail requests
            emit({"type": "done"})
        except NotLoggedIn as exc:
            emit({"type": "error", "needsLogin": True, "message": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass  # dashboard heeft afgebroken
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "message": str(exc)})

    # --- inloggen ------------------------------------------------------------

    def _set_pending(self, account: str, origin: str) -> bool:
        if origin not in self.server.allowed_origins:
            self._send(403, page("Niet toegestaan", "<p>Deze pagina moet vanuit het dashboard geopend worden.</p>"))
            return False
        with self.server.lock:
            self.server.pending_account = account
            self.server.pending_origin = origin
        return True

    def _start_login(self, account: str, origin: str) -> None:
        if not self._set_pending(account, origin):
            return
        self.send_response(302)
        self.send_header("Location", login_url(self.server.local_origin))
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _finish_login(self, code: str) -> None:
        with self.server.lock:
            account, origin = self.server.pending_account, self.server.pending_origin
        if account is None or origin is None:
            self._send(400, page("Inloggen mislukt", "<p>Onbekende loginpoging. Start het inloggen opnieuw vanuit het dashboard.</p>"))
            return
        if not code:
            self._send(400, page("Inloggen mislukt", "<p>AH gaf geen code terug. Probeer het opnieuw.</p>"))
            return
        try:
            exchange_code(code, account_config(account))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:300]
            self._send(502, page("Inloggen mislukt", f"<p>Code omwisselen mislukt ({exc.code}).</p><pre>{_esc(detail)}</pre>"))
            return
        with self.server.lock:
            self.server.pending_account = self.server.pending_origin = None
        print(f"[{datetime.now():%H:%M:%S}] Ingelogd voor account '{account or 'default'}'.")
        msg = json.dumps({"type": "ah-login", "ok": True, "account": account})
        self._send(200, page(
            "Ingelogd",
            "<h1>Ingelogd bij AH</h1><p>Je kunt dit venster sluiten; het dashboard gaat verder.</p>"
            f"<script>try{{window.opener&&window.opener.postMessage({msg},{json.dumps(origin)})}}catch(e){{}}"
            "setTimeout(function(){window.close()},600)</script>",
        ))

    def _manual_page(self, error: str = "") -> None:
        direct = login_url()
        err = f"<p style='color:#a8372a'>{_esc(error)}</p>" if error else ""
        self._send(200, page("Handmatig inloggen", f"""
<h1>Handmatig inloggen bij AH</h1>
<p>Gebruik dit als het automatische inloggen niet werkt.</p>
<ol>
<li>Open de <a href="{direct}" target="_blank" rel="noopener">AH-loginpagina</a> en open daar de
ontwikkelaarstools (F12), tabblad <b>Netwerk</b>.</li>
<li>Log in. De browser probeert daarna <code>{REDIRECT_URI}?code=…</code> te openen; dat lukt niet, maar
het verzoek staat in het Netwerk-tabblad.</li>
<li>Kopieer die URL (of alleen de code) en plak hem hieronder.</li>
</ol>
{err}
<form method=post>
<input name=code placeholder="{REDIRECT_URI}?code=…" style="width:100%;padding:8px" required autofocus>
<p><button type=submit>Inloggen</button></p>
</form>"""))

    def _manual_submit(self) -> None:
        # Alleen vanaf onze eigen pagina: anders kan een willekeurige site je aan
        # een ánder AH-account koppelen.
        if self.headers.get("Origin") not in (self.server.local_origin, None):
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = parse_qs(self.rfile.read(length).decode()).get("code", [""])[0].strip()
        m = re.search(r"[?&]code=([^&\s]+)", raw)
        code = m.group(1) if m else raw
        if not code:
            self._manual_page("Geen code gevonden.")
            return
        self._finish_login(code)

    # --- reverse proxy naar login.ah.nl ----------------------------------------

    def _proxy(self) -> None:
        local = self.server.local_origin
        target = "https://" + LOGIN_HOST
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        headers = {}
        for k, v in self.headers.items():
            lk = k.lower()
            if lk in HOP_BY_HOP or lk in ("host", "accept-encoding", "content-length"):
                continue
            if lk in ("origin", "referer"):
                v = v.replace(local, target)
            headers[k] = v
        headers["Host"] = LOGIN_HOST
        if body is not None:
            headers["Content-Length"] = str(len(body))

        try:
            conn = http.client.HTTPSConnection(LOGIN_HOST, timeout=30)
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            conn.close()
        except OSError as exc:
            self._send(502, page("Proxyfout", f"<p>Kon {LOGIN_HOST} niet bereiken: {_esc(str(exc))}</p>"))
            return

        callback = local + PREFIX + "/callback"
        out_headers: list[tuple[str, str]] = []
        content_type = resp.getheader("Content-Type", "")
        encoding = (resp.getheader("Content-Encoding") or "").lower()
        rewrite = any(t in content_type for t in ("text/html", "javascript", "json"))

        for k, v in resp.getheaders():
            lk = k.lower()
            if lk in HOP_BY_HOP or lk in STRIP_RESPONSE_HEADERS or lk == "content-length":
                continue
            if lk == "location":
                if v.startswith("appie://"):
                    query = urlsplit(v).query
                    v = callback + ("?" + query if query else "")
                else:
                    v = v.replace(target, local)
            elif lk == "set-cookie":
                v = sanitize_cookie(v)
            elif lk == "content-encoding" and rewrite:
                continue
            out_headers.append((k, v))

        if rewrite:
            if encoding == "gzip":
                data = gzip.decompress(data)
            data = data.replace(REDIRECT_URI.encode(), callback.encode())
            data = data.replace(target.encode(), local.encode())

        self.send_response(resp.status, resp.reason)
        for k, v in out_headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # --- hulpjes -----------------------------------------------------------------

    def _send(self, status: int, body: bytes, content_type: str = "text/html; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - vaste signatuur van de basisklasse
        # Alleen de eigen API loggen, niet elk proxied bestand van de loginpagina.
        if self.path.startswith(PREFIX) and not self.path.startswith(PREFIX + "/status"):
            super().log_message(format, *args)


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main() -> None:
    parser = argparse.ArgumentParser(description="Lokale brug tussen het dashboard en de AH-API.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Poort (standaard {DEFAULT_PORT})")
    parser.add_argument(
        "--allow-origin", action="append", default=[],
        help="Extra toegestane dashboard-origin, bv. http://localhost:4173 (herhaalbaar)",
    )
    args = parser.parse_args()

    origins = DEFAULT_ORIGINS | {o.rstrip("/") for o in args.allow_origin}
    try:
        httpd = BridgeServer(("127.0.0.1", args.port), BridgeHandler, origins)
    except OSError:
        sys.exit(f"Poort {args.port} is bezet. Draait de helper al?")

    with httpd:
        print(f"[{datetime.now():%H:%M:%S}] AH-brug draait op {httpd.local_origin} (Ctrl+C om te stoppen)")
        print("Toegestane dashboards: " + ", ".join(sorted(origins)))
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nBrug gestopt.")


if __name__ == "__main__":
    main()
