#!/usr/bin/env python3
"""Independent checker for the Olist customer summary exercise; never runs candidate code."""

import csv
import json
import sys
from pathlib import Path

INPUT = Path('/work/input.csv')
OUTPUT = Path('/work/candidate-output.json')
REQUIREMENTS = ('FR-01', 'FR-02', 'FR-03')


def main(input_path: Path = INPUT, output_path: Path = OUTPUT) -> int:
    try:
        with input_path.open(newline='', encoding='utf-8') as source:
            rows = list(csv.DictReader(source))
        with output_path.open(encoding='utf-8') as source:
            actual = json.load(source)
        ids = [row['customer_unique_id'] for row in rows]
        states: dict[str, dict[str, int]] = {}
        for row in rows:
            state = row['customer_state']
            bucket = states.setdefault(state, {'customers': 0, 'orders': 0})
            bucket['customers'] += 1
            bucket['orders'] += int(row['order_count'])
        expected = {
            'total_customers': len(rows),
            'total_orders': sum(int(row['order_count']) for row in rows),
            'by_state': states,
        }
        shape_ok = (
            isinstance(actual, dict)
            and set(actual) == {'total_customers', 'total_orders', 'by_state'}
            and type(actual.get('total_customers')) is int
            and type(actual.get('total_orders')) is int
            and isinstance(actual.get('by_state'), dict)
            and all(
                isinstance(bucket, dict)
                and set(bucket) == {'customers', 'orders'}
                and type(bucket.get('customers')) is int
                and type(bucket.get('orders')) is int
                for bucket in actual.get('by_state', {}).values()
            )
        )
        checks = [
            {
                'requirementId': 'FR-01',
                'passed': len(ids) == len(set(ids)) and shape_ok and actual.get('total_customers') == expected['total_customers'],
                'detail': 'Tổng khách hàng khớp CSV và customer_unique_id không trùng.' if len(ids) == len(set(ids)) and shape_ok and actual.get('total_customers') == expected['total_customers'] else 'Tổng khách hàng sai, ID bị trùng, hoặc JSON sai schema.',
            },
            {
                'requirementId': 'FR-02',
                'passed': shape_ok and actual.get('total_orders') == expected['total_orders'],
                'detail': 'Tổng order_count khớp CSV.' if shape_ok and actual.get('total_orders') == expected['total_orders'] else 'Tổng đơn sai hoặc JSON sai schema.',
            },
            {
                'requirementId': 'FR-03',
                'passed': shape_ok and actual.get('by_state') == expected['by_state'],
                'detail': 'Số khách hàng và tổng đơn theo từng bang khớp CSV.' if shape_ok and actual.get('by_state') == expected['by_state'] else 'Tổng theo bang sai, thiếu/thừa bang, hoặc JSON sai schema.',
            },
        ]
        print(json.dumps({'checks': checks}, ensure_ascii=False))
        return 0
    except (OSError, csv.Error, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        checks = [
            {'requirementId': requirement, 'passed': False, 'detail': f'Không thể kiểm tra đầu vào/đầu ra: {error}'[:2000]}
            for requirement in REQUIREMENTS
        ]
        print(json.dumps({'checks': checks}, ensure_ascii=False))
        return 0


if __name__ == '__main__':
    raise SystemExit(main(*(Path(argument) for argument in sys.argv[1:3])))
