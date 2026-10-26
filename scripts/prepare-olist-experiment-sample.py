#!/usr/bin/env python3
"""Deterministic Olist subset for the System 3 experiment sample (review-risk blueprint).

Keeps the reviewed orders whose SHA-256(order_id) sorts first, plus their items, payments,
reviews and products. Standard library only.

  python3 scripts/prepare-olist-experiment-sample.py /path/to/olist-csvs \
      packages/web/public/samples/olist/review-risk 8000
"""

import csv
import hashlib
import sys
from pathlib import Path

TABLES = {
    'orders': 'olist_orders_dataset.csv',
    'items': 'olist_order_items_dataset.csv',
    'payments': 'olist_order_payments_dataset.csv',
    'reviews': 'olist_order_reviews_dataset.csv',
    'products': 'olist_products_dataset.csv',
}


def rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline='', encoding='utf-8') as source:
        reader = csv.DictReader(source)
        return list(reader.fieldnames or []), list(reader)


def write(path: Path, header: list[str], data: list[dict[str, str]]) -> None:
    with path.open('w', newline='', encoding='utf-8') as target:
        writer = csv.DictWriter(target, fieldnames=header, lineterminator='\n')
        writer.writeheader()
        writer.writerows(data)


def main(source_dir: Path, target_dir: Path, count: int) -> None:
    tables = {name: rows(source_dir / filename) for name, filename in TABLES.items()}
    reviewed = {row['order_id'] for row in tables['reviews'][1]}
    chosen = set(
        sorted(reviewed, key=lambda order_id: hashlib.sha256(order_id.encode()).hexdigest())[:count]
    )
    target_dir.mkdir(parents=True, exist_ok=True)
    kept_products: set[str] = set()
    for name in ('orders', 'items', 'payments', 'reviews'):
        header, data = tables[name]
        subset = [row for row in data if row['order_id'] in chosen]
        if name == 'items':
            kept_products = {row['product_id'] for row in subset}
        write(target_dir / TABLES[name], header, subset)
    header, data = tables['products']
    write(target_dir / TABLES['products'], header, [r for r in data if r['product_id'] in kept_products])
    low = sum(1 for row in tables['reviews'][1] if row['order_id'] in chosen and int(row['review_score']) <= 2)
    print(f'{len(chosen)} orders, {low} reviews scored 1-2 written to {target_dir}')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]))
