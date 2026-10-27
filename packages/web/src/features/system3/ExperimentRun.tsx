import { AlertTriangle, Code2, Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type { System3ExperimentBuild } from './types';

export interface ExperimentRunChoice {
  variantIds: readonly string[];
  parallelism: number;
  keepEarlierResults: boolean;
}

interface VariantOption {
  id: string;
  name: string;
  role: 'baseline' | 'candidate';
  recommended: boolean;
}

/**
 * Run choice for an experiment build (plan 13 §10): which approved variants to run and how many at
 * once on this host. `rerun` mode starts from the variants that did not verify and keeps the other
 * results from the latest run.
 */
export function ExperimentRunPanel({
  build,
  variants,
  mode,
  initialSelection,
  busy,
  onRun,
  onRebuild,
}: {
  build: System3ExperimentBuild;
  variants: readonly VariantOption[];
  mode: 'first' | 'rerun';
  initialSelection: readonly string[];
  busy: boolean;
  onRun: (choice: ExperimentRunChoice) => void;
  onRebuild?: () => void;
}): ReactElement {
  const [selected, setSelected] = useState<readonly string[]>(initialSelection);
  const [parallelism, setParallelism] = useState(1);
  const [keepEarlierResults, setKeepEarlierResults] = useState(true);
  const options = variants.filter(variant => build.variantIds.includes(variant.id));
  const ordered = options.map(variant => variant.id).filter(id => selected.includes(id));
  const toggle = (id: string): void => {
    setSelected(current =>
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    );
  };
  const blocking = build.review.findings.filter(finding => finding.severity === 'blocking');
  const slots = Array.from({ length: build.hostSlots }, (_, index) => index + 1);
  const count = ordered.length.toString();
  return (
    <section className="s3-experiment-run" aria-labelledby={`experiment-run-${mode}`}>
      {mode === 'first' ? (
        <>
          <h3 id={`experiment-run-${mode}`}>
            <Code2 size={18} aria-hidden="true" /> Code đã sẵn sàng
          </h3>
          <p className="s3-experiment-run-lead">
            Agent đã viết code, chạy thử trên mẫu dữ liệu và qua review. Chọn phương án cần chạy
            thật; Anvil giữ nhãn tập kiểm tra và tự chấm sau khi chạy.
          </p>
          <dl className="s3-experiment-run-facts">
            <div>
              <dt>Review code</dt>
              <dd>
                <ShieldCheck size={14} aria-hidden="true" />{' '}
                {build.review.verdict === 'pass'
                  ? 'Đạt'
                  : `Còn ${blocking.length.toString()} lỗi chặn`}{' '}
                · {build.builderModel.replace(/^router9\//u, '')} viết,{' '}
                {build.reviewerModel.replace(/^router9\//u, '')} review
              </dd>
            </div>
            <div>
              <dt>Dữ liệu</dt>
              <dd>
                {build.split.trainRows.toLocaleString('vi-VN')} dòng train ·{' '}
                {build.split.testRows.toLocaleString('vi-VN')} dòng kiểm tra · lớp dương{' '}
                {(build.split.trainPositiveRate * 100).toFixed(1)}% /{' '}
                {(build.split.testPositiveRate * 100).toFixed(1)}%
              </dd>
            </div>
          </dl>
          {build.review.summary ? (
            <p className="s3-experiment-run-review">{build.review.summary}</p>
          ) : null}
          {blocking.length > 0 ? (
            <div className="s3-suggestion warn" role="status">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>Review còn lỗi chặn sau các vòng sửa</strong>
                <ul>
                  {blocking.map(finding => (
                    <li key={`${finding.file ?? ''}:${finding.message}`}>
                      {finding.file ? <code>{finding.file}</code> : null} {finding.message}
                    </li>
                  ))}
                </ul>
                <small>
                  Code vẫn chạy được trên mẫu. Nếu lỗi này mâu thuẫn với blueprint, bạn có thể vẫn
                  chạy; nếu không, hãy viết lại code hoặc cập nhật blueprint.
                </small>
              </div>
            </div>
          ) : null}
          {build.split.warnings.length > 0 ? (
            <ul className="s3-data-warnings">
              {build.split.warnings.map(warning => (
                <li key={warning}>
                  <AlertTriangle size={14} aria-hidden="true" /> {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <h3 id={`experiment-run-${mode}`}>
          <RotateCcw size={18} aria-hidden="true" /> Chạy lại một phần
        </h3>
      )}

      <fieldset className="s3-experiment-run-variants">
        <legend>Phương án</legend>
        {options.map(variant => (
          <label key={variant.id}>
            <input
              type="checkbox"
              checked={selected.includes(variant.id)}
              disabled={busy}
              onChange={() => {
                toggle(variant.id);
              }}
            />
            <span>{variant.name}</span>
            {variant.role === 'baseline' ? <span className="s3-pill subtle">Baseline</span> : null}
            {variant.recommended ? (
              <span className="s3-pill subtle">System 2 khuyến nghị</span>
            ) : null}
          </label>
        ))}
      </fieldset>

      <div className="s3-experiment-run-options">
        <label>
          Chạy cùng lúc
          <select
            value={parallelism}
            disabled={busy || build.hostSlots === 1}
            onChange={event => {
              setParallelism(Number(event.target.value));
            }}
          >
            {slots.map(value => (
              <option key={value} value={value}>
                {value === 1 ? '1 (lần lượt)' : `${value.toString()} phương án`}
              </option>
            ))}
          </select>
        </label>
        <small>
          {build.hostSlots === 1
            ? 'Máy này đủ cho 1 phương án mỗi lúc (mỗi phương án dùng tối đa 2 GB RAM, 2 CPU).'
            : `Máy này chạy được tối đa ${build.hostSlots.toString()} phương án cùng lúc (mỗi phương án 2 GB RAM, 2 CPU).`}
        </small>
        {mode === 'rerun' && build.latestRunExecutionId ? (
          <label className="s3-experiment-run-keep">
            <input
              type="checkbox"
              checked={keepEarlierResults}
              disabled={busy}
              onChange={event => {
                setKeepEarlierResults(event.target.checked);
              }}
            />
            Giữ kết quả các phương án không chạy lại
          </label>
        ) : null}
      </div>

      <div className="s3-experiment-run-actions">
        <button
          type="button"
          className="s3-button"
          disabled={busy || ordered.length === 0}
          onClick={() => {
            onRun({ variantIds: ordered, parallelism, keepEarlierResults });
          }}
        >
          <Play size={15} aria-hidden="true" />{' '}
          {mode === 'first' ? `Chạy ${count} phương án` : `Chạy lại ${count} phương án`}
        </button>
        {onRebuild ? (
          <button
            type="button"
            className="s3-button s3-button-secondary"
            disabled={busy}
            onClick={onRebuild}
          >
            Viết lại code
          </button>
        ) : null}
      </div>
    </section>
  );
}
