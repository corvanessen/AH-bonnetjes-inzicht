"""Minimale client voor de AH-API (api.ah.nl), gedeeld door fetch_receipts.py en ah_bridge.py.

Praat met dezelfde endpoints als de AH-app en github.com/gwillem/appie-go, en
leest/schrijft tokens in hetzelfde configbestand als `appie login`
(~/.config/appie/config[-NAAM].json), zodat beide door elkaar te gebruiken zijn.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_URL = "https://api.ah.nl"
LOGIN_BASE_URL = "https://login.ah.nl"
CLIENT_ID = "appie-ios"
CLIENT_VERSION = "9.28"
USER_AGENT = "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)"
REDIRECT_URI = "appie://login-exit"
PAGE_SIZE = 100

RECEIPTS_QUERY = """
query FetchPosReceipts($offset: Int!, $limit: Int!) {
    posReceiptsPage(pagination: {offset: $offset, limit: $limit}) {
        posReceipts {
            id
            dateTime
            totalAmount { amount }
        }
    }
}
"""

RECEIPT_DETAILS_QUERY = """
query FetchReceipt($id: String!) {
    posReceiptDetails(id: $id) {
        id
        products {
            id
            quantity
            name
            price { amount }
            amount { amount }
        }
        discounts {
            name
            amount { amount }
        }
        payments {
            method
            amount { amount }
        }
    }
}
"""


class NotLoggedIn(Exception):
    """Er is (nog) geen bruikbaar token: eerst (opnieuw) inloggen."""


def config_path(account: str | None) -> Path:
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    filename = f"config-{account}.json" if account else "config.json"
    return base / "appie" / filename


def login_url(base: str = LOGIN_BASE_URL) -> str:
    return f"{base}/login?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}"


def parse_iso(s: str) -> datetime:
    # Go emits up to 9 fractional digits; Python's fromisoformat handles at
    # most 6, so trim any extra precision before parsing.
    s = re.sub(r"(\.\d{6})\d+", r"\1", s)
    return datetime.fromisoformat(s)


def _request(method: str, path: str, body: dict | None, access_token: str | None = None) -> dict:
    headers = {
        "User-Agent": USER_AGENT,
        "x-client-name": CLIENT_ID,
        "x-client-version": CLIENT_VERSION,
        "x-application": "AHWEBSHOP",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if access_token:
        headers["Authorization"] = "Bearer " + access_token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else {}


def _token_to_config(tok: dict, cfg: dict) -> dict:
    cfg["access_token"] = tok["access_token"]
    cfg["refresh_token"] = tok["refresh_token"]
    if tok.get("member_id"):
        cfg["member_id"] = tok["member_id"]
    expires_in = tok.get("expires_in")
    if expires_in:
        new_expiry = datetime.now(timezone.utc).astimezone() + timedelta(seconds=expires_in)
        cfg["expires_at"] = new_expiry.isoformat()
    return cfg


def save_config(path: Path, cfg: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2))
    try:
        path.chmod(0o600)
    except OSError:
        pass  # Windows: best effort


def exchange_code(code: str, cfg_path: Path) -> None:
    """Wissel een autorisatiecode (uit appie://login-exit?code=...) om voor tokens en sla die op."""
    tok = _request("POST", "/mobile-auth/v1/auth/token", {"clientId": CLIENT_ID, "code": code})
    save_config(cfg_path, _token_to_config(tok, {}))


def combine(listing: dict, details: dict) -> dict:
    """Bouw het JSON-object per bon dat web/src/lib/jsonParser.ts en ah_receipts/json_parser.py verwachten."""
    return {
        "id": listing["id"],
        "dateTime": listing["dateTime"],
        "totalAmount": listing["totalAmount"]["amount"],
        "products": details.get("products", []),
        "discounts": details.get("discounts", []),
        "payments": details.get("payments", []),
    }


class Client:
    def __init__(self, cfg_path: Path):
        self.cfg_path = cfg_path
        if not cfg_path.exists():
            raise NotLoggedIn(f"Geen config gevonden op {cfg_path}.")
        self.cfg = json.loads(cfg_path.read_text())
        self._ensure_fresh_token()

    def _ensure_fresh_token(self) -> None:
        expires_at = self.cfg.get("expires_at")
        if expires_at:
            try:
                if parse_iso(expires_at) - timedelta(seconds=60) > datetime.now(
                    timezone.utc
                ).astimezone():
                    return  # still valid
            except ValueError:
                pass  # fall through and try to refresh
        refresh_token = self.cfg.get("refresh_token")
        if not refresh_token:
            if self.cfg.get("access_token"):
                return  # geen verloopdatum/refresh bekend: gewoon proberen
            raise NotLoggedIn("Geen token in config.")
        body = {"clientId": CLIENT_ID, "refreshToken": refresh_token}
        try:
            tok = _request("POST", "/mobile-auth/v1/auth/token/refresh", body)
        except urllib.error.HTTPError as e:
            raise NotLoggedIn(
                f"Token verversen mislukt ({e.code}): {e.read().decode(errors='replace')}"
            ) from e
        _token_to_config(tok, self.cfg)
        save_config(self.cfg_path, self.cfg)

    def graphql(self, query: str, variables: dict) -> dict:
        try:
            resp = _request(
                "POST", "/graphql", {"query": query, "variables": variables}, self.cfg["access_token"]
            )
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise NotLoggedIn("AH weigert het token (401).") from e
            raise
        if resp.get("errors"):
            raise RuntimeError(f"GraphQL error: {resp['errors'][0].get('message')}")
        return resp["data"]

    def list_receipts(self) -> list[dict]:
        receipts = []
        offset = 0
        while True:
            data = self.graphql(RECEIPTS_QUERY, {"offset": offset, "limit": PAGE_SIZE})
            page = data["posReceiptsPage"]["posReceipts"]
            receipts.extend(page)
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
            time.sleep(0.3)  # be gentle, this is a personal script not a scraper
        return receipts

    def get_receipt_details(self, receipt_id: str) -> dict:
        data = self.graphql(RECEIPT_DETAILS_QUERY, {"id": receipt_id})
        return data["posReceiptDetails"]
