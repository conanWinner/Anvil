import { AlertTriangle, CheckCircle2, Lightbulb, ShieldCheck } from 'lucide-react';
import type { ReactElement } from 'react';
import type { System3ExperimentResults } from './types';

const METRIC_LABELS: Record<string, string> = {
  roc_auc: 'ROC-AUC',
  pr_auc: 'PR-AUC',
  f1: 'F1',
  recall: 'Recall',
  precision: 'Precision',
  accuracy: 'Accuracy',
};
const METRIC_ORDER = ['roc_auc', 'pr_auc', 'f1', 'recall', 'precision', 'accuracy'];

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(3);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds.toString()} giây`
    : `${Math.round(seconds / 60).toString()} phút`;
}

const STATUS_LABEL: Record<System3ExperimentResults['variants'][number]['status'], string> = {
  verified: 'Đã xác minh',
  missing: 'Không có dự đoán',
  invalid_predictions: 'Dự đoán không hợp lệ',
};

const RUN_LABEL: Record<
  NonNullable<System3ExperimentResults['variants'][number]['runStatus']>,
  string
> = {
  completed: 'Chạy xong',
  failed: 'Lỗi khi chạy',
  resource_limit: 'Vượt giới hạn tài nguyên',
};

/** Plain-language reasons for the suggestion; the user still decides (FR-06 style). */
function suggestionText(results: System3ExperimentResults): {
  headline: string;
  notes: string[];
  tone: 'good' | 'warn';
} {
  const { suggestion, primaryMetric, variants } = results;
  const best = variants.find(variant => variant.id === suggestion.suggested);
  const metric = metricLabel(primaryMetric);
  if (!best)
    return {
      headline: 'Chưa có phương án nào được xác minh để gợi ý.',
      notes: ['Xem lỗi của từng phương án bên dưới.'],
      tone: 'warn',
    };
  const notes: string[] = [];
  let tone: 'good' | 'warn' = 'good';
  if (suggestion.reasons.includes('no_better_than_chance')) {
    tone = 'warn';
    notes.push(
      `${metric} gần mức đoán ngẫu nhiên: các mô hình gần như không học được gì từ dữ liệu này.`
    );
  }
  const thresholds = Object.entries(suggestion.thresholds ?? {});
  if (thresholds.length > 0) {
    const text = thresholds.map(([name, value]) => `${metricLabel(name)} ≥ ${value.toString()}`);
    if (suggestion.reasons.includes('meets_thresholds'))
      notes.push(`Đạt ngưỡng của blueprint (${text.join(', ')}).`);
    else {
      tone = 'warn';
      notes.push(
        suggestion.reasons.includes('no_variant_meets_thresholds')
          ? `Chưa phương án nào đạt ngưỡng của blueprint (${text.join(', ')}).`
          : `Phương án này chưa đạt ngưỡng của blueprint (${text.join(', ')}).`
      );
    }
  } else notes.push('Blueprint không đặt ngưỡng; đây là so sánh tương đối giữa các phương án.');
  for (const id of suggestion.fasterAlternatives) {
    const alternative = variants.find(variant => variant.id === id);
    if (alternative)
      notes.push(
        `${alternative.name} gần bằng (${metric} ${formatMetric(alternative.metrics?.[primaryMetric])}) nhưng chạy nhanh hơn.`
      );
  }
  return {
    headline: `Gợi ý: ${best.name} — ${metric} cao nhất (${formatMetric(best.metrics?.[primaryMetric])}).`,
    notes,
    tone,
  };
}

export function ExperimentResultsView({
  results,
  stale,
  selected,
  locked,
  onSelect,
}: {
  results: System3ExperimentResults;
  stale: boolean;
  /** Variant the user picked (or recorded in the delivery); null until chosen. */
  selected: string | null;
  /** True once a delivery recorded the choice. */
  locked: boolean;
  onSelect: (variant: string) => void;
}): ReactElement {
  const metrics = METRIC_ORDER.filter(metric =>
    results.variants.some(variant => variant.metrics?.[metric] !== undefined)
  );
  const primary = results.primaryMetric;
  const best = Math.max(
    ...results.variants.map(variant => variant.metrics?.[primary] ?? Number.NEGATIVE_INFINITY)
  );
  const suggestion = suggestionText(results);
  const blocking = results.review.findings.filter(finding => finding.severity === 'blocking');
  return (
    <section className="s3-experiment-results" aria-labelledby="experiment-results-title">
      <h3 id="experiment-results-title" className="s3-visually-hidden">
        Kết quả các phương án
      </h3>
      {stale ? (
        <p className="s3-note" role="status">
          Nguồn hoặc cấu hình đã thay đổi. Đây là kết quả của lần chạy trước; cần phê duyệt lại
          trước khi chạy với đầu vào mới.
        </p>
      ) : null}
      <div className={`s3-suggestion ${suggestion.tone}`}>
        {suggestion.tone === 'good' ? (
          <Lightbulb size={20} aria-hidden="true" />
        ) : (
          <AlertTriangle size={20} aria-hidden="true" />
        )}
        <div>
          <strong>{suggestion.headline}</strong>
          <ul>
            {suggestion.notes.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <small>Đây là gợi ý theo metric chính của blueprint; bạn là người chọn phương án.</small>
        </div>
      </div>

      <div className="s3-comparison-table-wrap">
        <table className="s3-comparison-table s3-experiment-table">
          <caption className="s3-visually-hidden">
            Metric trên tập kiểm tra giữ riêng, do Anvil tính
          </caption>
          <thead>
            <tr>
              <th scope="col">Phương án</th>
              <th scope="col">{metricLabel(primary)} (chính)</th>
              {metrics
                .filter(metric => metric !== primary)
                .map(metric => (
                  <th key={metric} scope="col">
                    {metricLabel(metric)}
                  </th>
                ))}
              <th scope="col">Thời gian</th>
              <th scope="col">Chọn</th>
            </tr>
          </thead>
          <tbody>
            {results.variants.map(variant => {
              const value = variant.metrics?.[primary];
              const width =
                value === undefined
                  ? 0
                  : Math.max(4, Math.round(Math.min(1, Math.max(0, value)) * 100));
              const isSuggested = variant.id === results.suggestion.suggested;
              return (
                <tr key={variant.id} className={selected === variant.id ? 'selected' : ''}>
                  <th scope="row">
                    <span className="s3-variant-name">{variant.name}</span>
                    <span className="s3-pill-row">
                      {variant.role === 'baseline' ? (
                        <span className="s3-pill subtle">Baseline</span>
                      ) : null}
                      {variant.recommended ? (
                        <span className="s3-pill subtle">System 2 khuyến nghị</span>
                      ) : null}
                      {isSuggested ? <span className="s3-pill">Gợi ý</span> : null}
                    </span>
                    {variant.status !== 'verified' ? (
                      <small className="s3-variant-error">
                        {STATUS_LABEL[variant.status]}
                        {variant.runStatus && variant.runStatus !== 'completed'
                          ? ` · ${RUN_LABEL[variant.runStatus]}`
                          : ''}
                        {variant.error ? ` · ${variant.error}` : ''}
                      </small>
                    ) : null}
                  </th>
                  <td>
                    <span className="s3-metric-cell">
                      <strong className={value === best ? 'best' : ''}>
                        {formatMetric(value)}
                      </strong>
                      <span className="s3-metric-bar" aria-hidden="true">
                        <span style={{ width: `${width.toString()}%` }} />
                      </span>
                    </span>
                  </td>
                  {metrics
                    .filter(metric => metric !== primary)
                    .map(metric => (
                      <td key={metric}>{formatMetric(variant.metrics?.[metric])}</td>
                    ))}
                  <td>{formatDuration(variant.durationMs)}</td>
                  <td>
                    <input
                      type="radio"
                      name="selected-variant"
                      aria-label={`Chọn ${variant.name}`}
                      checked={selected === variant.id}
                      disabled={locked || stale || variant.status !== 'verified'}
                      onChange={() => {
                        onSelect(variant.id);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="s3-experiment-footnote">
        Metric tính trên {results.split.testRows.toLocaleString('vi-VN')} dòng kiểm tra mà code
        không nhìn thấy nhãn · tỷ lệ lớp dương train/test{' '}
        {(results.split.trainPositiveRate * 100).toFixed(1)}% /{' '}
        {(results.split.testPositiveRate * 100).toFixed(1)}%
        {results.mismatches.length > 0 ? ' · chấm lại không khớp, xem chi tiết kỹ thuật' : ''}
      </p>
      {results.split.warnings.length > 0 ? (
        <ul className="s3-data-warnings">
          {results.split.warnings.map(warning => (
            <li key={warning}>
              <AlertTriangle size={14} aria-hidden="true" /> {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <details className="s3-secondary-details s3-review-report">
        <summary>
          <span>
            <ShieldCheck size={16} aria-hidden="true" /> Review code:{' '}
            {results.review.verdict === 'pass' ? 'đạt' : 'còn lỗi chặn'} ·{' '}
            {results.agents.builder.replace(/^router9\//u, '')} viết,{' '}
            {results.agents.reviewer.replace(/^router9\//u, '')} review
          </span>
        </summary>
        <p>{results.review.summary}</p>
        {results.review.findings.length > 0 ? (
          <ul className="s3-check-list">
            {results.review.findings.map(finding => (
              <li key={`${finding.file ?? ''}:${finding.message}`}>
                {finding.severity === 'blocking' ? (
                  <AlertTriangle size={14} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={14} aria-hidden="true" />
                )}
                <span>
                  {finding.file ? <code>{finding.file}</code> : null} {finding.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="s3-note">Không còn phát hiện nào ở lần review cuối.</p>
        )}
        {blocking.length > 0 ? (
          <p className="s3-note">
            Còn {blocking.length.toString()} lỗi chặn trong lần review cuối.
          </p>
        ) : null}
      </details>
    </section>
  );
}
