#!/usr/bin/env python3
"""
Download Albert Heijn kassabonnetjes (in-store receipts) as JSON.

Reads the access/refresh token that `appie login` (github.com/gwillem/appie-go)
saved to ~/.config/appie/config.json, refreshes it when needed, and talks
directly to the same GraphQL endpoint the AH app uses (api.ah.nl/graphql).

Run `appie login` once first (see README instructions given in chat).

Usage:
    python fetch_receipts.py
    python fetch_receipts.py --account tweede-account

Each account has its own token file and its own data folder, so multiple
accounts never overwrite each other:
  - default account:  config.json          -> ./data/
  - --account NAME:   config-NAME.json     -> ./data-NAME/

Every run:
  - lists all receipts known to the account (cheap call, no PDFs),
  - skips any receipt that already has a JSON file in that account's data folder,
  - downloads full details (items, discounts, payments) only for new ones.

So the first run backfills everything; later runs only fetch what's new.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_URL = "https://api.ah.nl"
CLIENT_ID = "appie-ios"
USER_AGENT = "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)"
SCRIPT_DIR = Path(__file__).resolve().parent
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


def config_path(account: str | None) -> Path:
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    filename = f"config-{account}.json" if account else "config.json"
    return base / "appie" / filename


def data_dir(account: str | None) -> Path:
    return SCRIPT_DIR / (f"data-{account}" if account else "data")


def load_config(path: Path) -> dict:
    if not path.exists():
        sys.exit(
            f"Geen config gevonden op {path}.\n"
            f'Run eerst `appie login -c "{path}"` (zie instructies in chat) om in te loggen.'
        )
    return json.loads(path.read_text())


def save_config(path: Path, cfg: dict) -> None:
    path.write_text(json.dumps(cfg, indent=2))


def parse_iso(s: str) -> datetime:
    # Go emits up to 9 fractional digits; Python's fromisoformat handles at
    # most 6, so trim any extra precision before parsing.
    s = re.sub(r"(\.\d{6})\d+", r"\1", s)
    return datetime.fromisoformat(s)


class Client:
    def __init__(self, cfg_path: Path):
        self.cfg_path = cfg_path
        self.cfg = load_config(cfg_path)
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
            return
        body = {"clientId": CLIENT_ID, "refreshToken": refresh_token}
        try:
            tok = self._request("POST", "/mobile-auth/v1/auth/token/refresh", body, auth=False)
        except urllib.error.HTTPError as e:
            sys.exit(
                f"Token verversen mislukt ({e.code}). Run `appie login` opnieuw.\n{e.read().decode(errors='replace')}"
            )
        self.cfg["access_token"] = tok["access_token"]
        self.cfg["refresh_token"] = tok["refresh_token"]
        expires_in = tok.get("expires_in")
        if expires_in:
            new_expiry = datetime.now(timezone.utc).astimezone() + timedelta(seconds=expires_in)
            self.cfg["expires_at"] = new_expiry.isoformat()
        save_config(self.cfg_path, self.cfg)

    def _request(self, method: str, path: str, body: dict | None, auth: bool = True) -> dict:
        headers = {
            "User-Agent": USER_AGENT,
            "x-client-name": CLIENT_ID,
            "x-client-version": "9.28",
            "x-application": "AHWEBSHOP",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if auth:
            headers["Authorization"] = "Bearer " + self.cfg["access_token"]
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
        return json.loads(raw) if raw else {}

    def graphql(self, query: str, variables: dict) -> dict:
        resp = self._request("POST", "/graphql", {"query": query, "variables": variables})
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


def receipt_filename(receipt_id: str, date_time: str) -> str:
    safe_date = date_time[:19].replace(":", "-")
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", receipt_id)
    return f"{safe_date}__{safe_id}.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--account",
        help="Naam van het account (gebruikt config-NAME.json en data-NAME/). "
        "Zonder deze optie wordt het standaardaccount gebruikt (config.json en data/).",
    )
    args = parser.parse_args()

    out_dir = data_dir(args.account)
    out_dir.mkdir(parents=True, exist_ok=True)
    client = Client(config_path(args.account))

    print("Bonnetjeslijst ophalen...")
    receipts = client.list_receipts()
    print(f"{len(receipts)} bonnetjes gevonden op je account.")

    existing_ids = set()
    for f in out_dir.glob("*.json"):
        try:
            existing_ids.add(json.loads(f.read_text())["id"])
        except (json.JSONDecodeError, KeyError):
            continue

    new_receipts = [r for r in receipts if r["id"] not in existing_ids]
    if not new_receipts:
        print("Niets nieuws sinds de vorige download.")
        return

    print(f"{len(new_receipts)} nieuwe bonnetjes downloaden...")
    for i, r in enumerate(new_receipts, 1):
        details = client.get_receipt_details(r["id"])
        combined = {
            "id": r["id"],
            "dateTime": r["dateTime"],
            "totalAmount": r["totalAmount"]["amount"],
            "products": details.get("products", []),
            "discounts": details.get("discounts", []),
            "payments": details.get("payments", []),
        }
        out_path = out_dir / receipt_filename(r["id"], r["dateTime"])
        out_path.write_text(json.dumps(combined, indent=2, ensure_ascii=False))
        print(f"  [{i}/{len(new_receipts)}] {out_path.name}")
        time.sleep(0.5)  # rate limit between detail requests

    print(f"Klaar. {len(new_receipts)} nieuwe bonnetjes opgeslagen in {out_dir}")


if __name__ == "__main__":
    main()
