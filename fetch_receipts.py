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
import re
import sys
import time
from pathlib import Path

from ah_receipts.ah_api import Client, NotLoggedIn, combine, config_path

SCRIPT_DIR = Path(__file__).resolve().parent


def data_dir(account: str | None) -> Path:
    return SCRIPT_DIR / (f"data-{account}" if account else "data")


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
    cfg_path = config_path(args.account)
    try:
        client = Client(cfg_path)
    except NotLoggedIn as e:
        sys.exit(
            f"{e}\n"
            f'Run eerst `appie login -c "{cfg_path}"` (of log in via het dashboard met ah_bridge.py).'
        )

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
        combined = combine(r, details)
        out_path = out_dir / receipt_filename(r["id"], r["dateTime"])
        out_path.write_text(json.dumps(combined, indent=2, ensure_ascii=False))
        print(f"  [{i}/{len(new_receipts)}] {out_path.name}")
        time.sleep(0.5)  # rate limit between detail requests

    print(f"Klaar. {len(new_receipts)} nieuwe bonnetjes opgeslagen in {out_dir}")


if __name__ == "__main__":
    main()
