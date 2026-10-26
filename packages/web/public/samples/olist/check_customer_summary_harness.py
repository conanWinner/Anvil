"""Run with python3; lightweight regression check for the bundled checker."""

import contextlib
import csv
import importlib.util
import io
import json
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('customer_summary_harness', HERE / 'customer-summary-harness.py')
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('Cannot load the sample harness')
HARNESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARNESS)


def run(input_path: Path, output_path: Path) -> dict[str, object]:
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        assert HARNESS.main(input_path, output_path) == 0
    return json.loads(stdout.getvalue())


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    input_path = root / 'input.csv'
    output_path = root / 'output.json'
    with input_path.open('w', newline='', encoding='utf-8') as target:
        writer = csv.DictWriter(target, fieldnames=['customer_unique_id', 'order_count', 'customer_state'])
        writer.writeheader()
        writer.writerows([
            {'customer_unique_id': 'a', 'order_count': '2', 'customer_state': 'SP'},
            {'customer_unique_id': 'b', 'order_count': '1', 'customer_state': 'RJ'},
        ])
    output_path.write_text(json.dumps({
        'total_customers': 2,
        'total_orders': 3,
        'by_state': {'SP': {'customers': 1, 'orders': 2}, 'RJ': {'customers': 1, 'orders': 1}},
    }), encoding='utf-8')
    valid = run(input_path, output_path)
    assert all(check['passed'] for check in valid['checks'])
    assert {check['requirementId'] for check in valid['checks']} == set(HARNESS.REQUIREMENTS)

    output_path.write_text(json.dumps({'total_customers': 2, 'total_orders': 99, 'by_state': {}}), encoding='utf-8')
    tampered = run(input_path, output_path)
    assert not tampered['checks'][1]['passed'] and not tampered['checks'][2]['passed']
    assert {check['requirementId'] for check in tampered['checks']} == set(HARNESS.REQUIREMENTS)

    error = run(input_path, root / 'missing-output.json')
    assert all(not check['passed'] for check in error['checks'])
    assert {check['requirementId'] for check in error['checks']} == set(HARNESS.REQUIREMENTS)

    output_path.write_text('runner stdout was not JSON', encoding='utf-8')
    invalid_stdout = run(input_path, output_path)
    assert all(not check['passed'] for check in invalid_stdout['checks'])
    assert {check['requirementId'] for check in invalid_stdout['checks']} == set(HARNESS.REQUIREMENTS)

print('customer-summary harness self-check passed')
