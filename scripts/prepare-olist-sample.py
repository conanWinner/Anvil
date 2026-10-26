"""Create the small UI fixture from the original Olist Kaggle archive (stdlib only).

Usage: python3 scripts/prepare-olist-sample.py /path/to/brazilian-ecommerce.zip
"""

import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile


def prepare(archive_path: Path) -> None:
    with archive_path.open("rb") as content:
        archive_hash = hashlib.file_digest(content, "sha256").hexdigest()
    if archive_hash != "967e41e04fc306fe604e2a693f488995a8b41e5047418f8a5c8e4abd6deca784":
        raise ValueError("Archive does not match the pinned Olist source; review the source before updating the sample.")
    cutoff = datetime(2018, 8, 31, 23, 59, 59)
    with zipfile.ZipFile(archive_path) as archive:
        def rows(name: str):
            with archive.open(name) as content:
                yield from csv.DictReader(io.TextIOWrapper(content, encoding="utf-8-sig"))

        customers = {row["customer_id"]: row for row in rows("olist_customers_dataset.csv")}
        orders = {}
        for order in rows("olist_orders_dataset.csv"):
            purchased = datetime.fromisoformat(order["order_purchase_timestamp"])
            if order["order_status"] == "delivered" and purchased <= cutoff:
                customer = customers[order["customer_id"]]
                key = customer["customer_unique_id"]
                summary = orders.setdefault(key, {
                    "customer_unique_id": key,
                    "order_count": 0,
                    "last_purchase": purchased,
                    "customer_state": customer["customer_state"],
                })
                summary["order_count"] += 1
                summary["last_purchase"] = max(summary["last_purchase"], purchased)

    # ponytail: 1,000 customers for UI intake; full nine-table modeling is a separate pipeline.
    selected = sorted(orders, key=lambda key: hashlib.sha256(key.encode()).digest())[:1000]
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["customer_unique_id", "order_count", "last_purchase_date", "customer_state", "target"])
    classes = {0: 0, 1: 0}
    for key in selected:
        row = orders[key]
        target = int(cutoff - row["last_purchase"] > timedelta(days=90))
        classes[target] += 1
        writer.writerow([key, row["order_count"], row["last_purchase"].isoformat(sep=" "), row["customer_state"], target])
    body = output.getvalue().encode()
    parsed = list(csv.DictReader(io.StringIO(body.decode())))
    assert len(parsed) == 1000 and len({row["customer_unique_id"] for row in parsed}) == 1000
    assert all(classes.values()) and sum(classes.values()) == len(parsed)
    for row in parsed:
        assert int(row["target"]) == int(cutoff - datetime.fromisoformat(row["last_purchase_date"]) > timedelta(days=90))

    folder = Path(__file__).resolve().parents[1] / "packages/web/public/samples/olist"
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {
        "source": "https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce",
        "publisher": "Olist",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "downloadUrl": "https://www.kaggle.com/api/v1/datasets/download/olistbr/brazilian-ecommerce",
        "preparedAt": datetime.now(timezone.utc).date().isoformat(),
        "archiveSha256": archive_hash,
        "sampleSha256": hashlib.sha256(body).hexdigest(),
        "rowCount": len(parsed),
        "eligibleCustomerCount": len(orders),
        "targetDistribution": classes,
        "cutoff": cutoff.isoformat(),
        "targetRule": "1 iff cutoff - last delivered purchase > 90 days; 0 otherwise",
        "selection": "First 1000 eligible customer_unique_id values ordered by SHA-256 digest",
        "inputTables": ["olist_customers_dataset.csv", "olist_orders_dataset.csv"],
        "limitations": "Derived intake/demo fixture, not the full nine-table pipeline or a leakage-safe forecasting benchmark.",
    }
    (folder / "olist-customers-sample.csv").write_bytes(body)
    (folder / "source.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Validated {len(parsed)} sample customers; target counts: {classes}.")


if __name__ == "__main__":
    prepare(Path(sys.argv[1]))
