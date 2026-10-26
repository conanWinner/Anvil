"""Anvil-owned split and evaluation for System 3 experiments.

This file is Anvil code, not agent code. It runs inside the experiment sandbox with the locked
ML runtime. Agents never see held-out labels: `split` writes them outside the agent data folder,
and `evaluate` recomputes every metric from the agents' saved predictions.

Usage (inside the sandbox, data mounted at /work/data, output at /work/out):
  python anvil_eval.py split
  python anvil_eval.py sample      (small stratified train/test sample for smoke runs)
  python anvil_eval.py evaluate
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

DATA = Path('/work/data')
OUT = Path('/work/out')
METRICS = ('roc_auc', 'pr_auc', 'f1', 'recall', 'precision', 'accuracy')


def sha256(path: Path) -> str:
    return 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()


def fail(message: str) -> None:
    print(json.dumps({'error': message}), file=sys.stderr)
    raise SystemExit(2)


def load_protocol() -> dict:
    return json.loads((DATA / 'protocol.json').read_text(encoding='utf-8'))


def split() -> None:
    protocol = load_protocol()
    table = pd.read_csv(DATA / 'table.csv', dtype={protocol['idColumn']: str})
    id_col, target_col = protocol['idColumn'], protocol['targetColumn']
    for column in (id_col, target_col):
        if column not in table.columns:
            fail(f'Modeling table has no column {column!r}')
    if table[id_col].isna().any() or table[id_col].duplicated().any():
        fail(f'Column {id_col!r} must be a unique, non-empty row id')
    labels = table[target_col].astype(str)
    positive = str(protocol['positiveLabel'])
    if labels.nunique() != 2 or positive not in set(labels):
        fail(f'Target {target_col!r} must have exactly two classes including {positive!r}')
    y = (labels == positive).astype(int)

    method = protocol['split']
    fraction = float(method['testFraction'])
    if method['kind'] == 'stratified_holdout':
        train_idx, test_idx = train_test_split(
            np.arange(len(table)), test_size=fraction, random_state=int(method['seed']), stratify=y
        )
    elif method['kind'] == 'time_holdout':
        time_col = method['timeColumn']
        if time_col not in table.columns:
            fail(f'Modeling table has no time column {time_col!r}')
        order = np.argsort(pd.to_datetime(table[time_col]).to_numpy(), kind='stable')
        cut = len(table) - math.ceil(len(table) * fraction)
        train_idx, test_idx = order[:cut], order[cut:]
    else:
        fail(f"Unsupported split kind {method['kind']!r}")
    if len(test_idx) == 0 or y.iloc[test_idx].nunique() != 2:
        fail('Held-out test set must contain both classes')
    for name, idx in (('train', train_idx), ('test', test_idx)):
        rate = float(y.iloc[idx].mean())
        minority = min(rate, 1 - rate)
        if minority * len(idx) < 5 or minority < 0.005:
            fail(
                f'The {name} split is degenerate: {rate:.4f} of {len(idx)} rows are positive, '
                'so no model can learn or be evaluated. Revisit the target definition or cutoff '
                f'so both classes occur (positive rate train/test = '
                f'{float(y.iloc[train_idx].mean()):.4f}/{float(y.iloc[test_idx].mean()):.4f}).'
            )

    agent_dir, holdout_dir = OUT / 'agent', OUT / 'holdout'
    agent_dir.mkdir(parents=True, exist_ok=True)
    holdout_dir.mkdir(parents=True, exist_ok=True)
    train = table.iloc[np.sort(train_idx)]
    test = table.iloc[np.sort(test_idx)]
    train.to_csv(agent_dir / 'train.csv', index=False)
    test.drop(columns=[target_col]).to_csv(agent_dir / 'test_features.csv', index=False)
    pd.DataFrame(
        {'id': test[id_col].to_numpy(), 'target': y.iloc[np.sort(test_idx)].to_numpy()}
    ).to_csv(holdout_dir / 'test_labels.csv', index=False)

    summary = {
        'rows': int(len(table)),
        'trainRows': int(len(train)),
        'testRows': int(len(test)),
        'trainPositiveRate': float(y.iloc[train_idx].mean()),
        'testPositiveRate': float(y.iloc[test_idx].mean()),
        'files': {
            'agent/train.csv': sha256(agent_dir / 'train.csv'),
            'agent/test_features.csv': sha256(agent_dir / 'test_features.csv'),
            'holdout/test_labels.csv': sha256(holdout_dir / 'test_labels.csv'),
        },
    }
    (OUT / 'split.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary))


def sample() -> None:
    """Small smoke-run sample that keeps both classes; never used for metrics."""
    settings = load_protocol()
    target = settings['targetColumn']
    train = pd.read_csv(DATA / 'train.csv', dtype={settings['idColumn']: str})
    test = pd.read_csv(DATA / 'test_features.csv', dtype={settings['idColumn']: str})
    train_rows = min(int(settings['trainRows']), len(train))
    if train[target].nunique() > 1 and train_rows < len(train):
        train, _ = train_test_split(
            train, train_size=train_rows, random_state=0, stratify=train[target].astype(str)
        )
    test = test.sample(n=min(int(settings['testRows']), len(test)), random_state=0)
    OUT.mkdir(parents=True, exist_ok=True)
    train.sort_index().to_csv(OUT / 'train.csv', index=False)
    test.sort_index().to_csv(OUT / 'test_features.csv', index=False)
    print(json.dumps({'trainRows': len(train), 'testRows': len(test)}))


def metrics_for(y: np.ndarray, score: np.ndarray, label: np.ndarray) -> dict:
    return {
        'roc_auc': float(roc_auc_score(y, score)),
        'pr_auc': float(average_precision_score(y, score)),
        'f1': float(f1_score(y, label, zero_division=0)),
        'recall': float(recall_score(y, label, zero_division=0)),
        'precision': float(precision_score(y, label, zero_division=0)),
        'accuracy': float(accuracy_score(y, label)),
    }


def evaluate_variant(variant: str, truth: pd.DataFrame) -> dict:
    path = DATA / 'predictions' / f'{variant}.csv'
    if not path.is_file():
        return {'status': 'missing', 'error': 'No predictions file'}
    try:
        predictions = pd.read_csv(path, dtype={'id': str})
    except Exception as error:  # noqa: BLE001 - any parse failure is reported as invalid data
        return {'status': 'invalid_predictions', 'error': f'Unreadable CSV: {error}'}
    if 'id' not in predictions.columns or 'score' not in predictions.columns:
        return {'status': 'invalid_predictions', 'error': 'Predictions need columns id and score'}
    if predictions['id'].duplicated().any() or set(predictions['id']) != set(truth['id']):
        return {
            'status': 'invalid_predictions',
            'error': 'Prediction ids must match the held-out test ids exactly once',
        }
    merged = truth.merge(predictions, on='id', how='left')
    score = pd.to_numeric(merged['score'], errors='coerce').to_numpy(dtype=float)
    if np.isnan(score).any() or (score < 0).any() or (score > 1).any():
        return {'status': 'invalid_predictions', 'error': 'score must be a probability in [0, 1]'}
    if 'label' in merged.columns:
        label = pd.to_numeric(merged['label'], errors='coerce').to_numpy(dtype=float)
        if np.isnan(label).any() or not set(np.unique(label)) <= {0.0, 1.0}:
            return {'status': 'invalid_predictions', 'error': 'label must be 0 or 1'}
    else:
        label = (score >= 0.5).astype(float)
    computed = metrics_for(merged['target'].to_numpy(dtype=int), score, label)

    # Agents only see training data, so their own numbers (e.g. cross-validation on train) are
    # informational. The held-out metrics above are the only verified ones.
    reported_path = DATA / 'reported' / f'{variant}.json'
    reported = (
        json.loads(reported_path.read_text(encoding='utf-8')) if reported_path.is_file() else {}
    )
    return {
        'status': 'verified',
        'metrics': computed,
        'reportedTrainingMetrics': reported if isinstance(reported, dict) else {},
        'predictionsHash': sha256(path),
    }


def evaluate() -> None:
    protocol = load_protocol()
    truth = pd.read_csv(DATA / 'holdout' / 'test_labels.csv', dtype={'id': str})
    variants = {variant: evaluate_variant(variant, truth) for variant in protocol['variants']}
    result = {'testRows': int(len(truth)), 'variants': variants}
    (OUT / 'evaluation.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'variants': {name: value['status'] for name, value in variants.items()}}))


if __name__ == '__main__':
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command == 'split':
        split()
    elif command == 'sample':
        sample()
    elif command == 'evaluate':
        evaluate()
    else:
        fail('Usage: anvil_eval.py split|sample|evaluate')
