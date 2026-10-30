import { AlertTriangle, Code2, Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import {
  describeTrialParams,
  editsFromLatestTrials,
  editsFromParams,
  formatParamValue,
  parseParamEdits,
  type ParamEdits,
  type ParamTrial,
  type ParamValue,
} from './experiment-params-view';
import { metricLabel } from './ExperimentResults';
import type { System3ExperimentBuild } from './types';

export interface ExperimentRunChoice {
  variantIds: readonly string[];
  parallelism: number;
  keepEarlierResults: boolean;
  mode: 'tune' | 'run';
  variantParams: Record<string, Record<string, number | string | boolean | null>>;
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
  primaryMetric,
  mode,
  initialSelection,
  busy,
  onRun,
  onRebuild,
}: {
  build: System3ExperimentBuild;
  variants: readonly VariantOption[];
  primaryMetric?: string;
  mode: 'first' | 'rerun';
  initialSelection: readonly string[];
  busy: boolean;
  onRun: (choice: ExperimentRunChoice) => void;
  onRebuild?: () => void;
}): ReactElement {
  const [selected, setSelected] = useState<readonly string[]>(initialSelection);
  const [parallelism, setParallelism] = useState(1);
  const [keepEarlierResults, setKeepEarlierResults] = useState(true);
  // The server validated these as scalar values; the generated API type only says `unknown`.
  const trials = (build.trials ?? []) as readonly (ParamTrial & {
    validationMetrics?: Readonly<Record<string, number>> | null;
  })[];
  const [edits, setEdits] = useState<ParamEdits>(() => editsFromLatestTrials(trials));
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
  // The server validated these as scalar values; the generated API type only says `unknown`.
  const defaults = (build.variantParams ?? {}) as Record<string, Record<string, ParamValue>>;
  // Re-runs keep the settings the test score was opened with, so only a first run can change them.
  const canTune = mode === 'first' && !build.tuningClosed && Object.keys(defaults).length > 0;
  const { overrides, errors } = parseParamEdits(defaults, canTune ? edits : {}, ordered);
  const changedCount = Object.values(overrides).reduce(
    (total, values) => total + Object.keys(values).length,
    0
  );
  const start = (runMode: ExperimentRunChoice['mode']): void => {
    onRun({
      variantIds: ordered,
      parallelism,
      keepEarlierResults,
      mode: runMode,
      variantParams: overrides,
    });
  };
  const metric = primaryMetric ?? 'roc_auc';
  const edit = (variant: string, name: string, text: string): void => {
    setEdits(current => ({ ...current, [variant]: { ...current[variant], [name]: text } }));
  };
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
                {build.split.validationRows !== undefined
                  ? `${build.split.validationRows.toLocaleString('vi-VN')} dòng validation · `
                  : ''}
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

      {canTune ? (
        <details className="s3-secondary-details s3-experiment-params">
          <summary>
            Tham số huấn luyện và mô hình
            {changedCount > 0 ? ` · ${changedCount.toString()} giá trị khác mặc định` : ''}
          </summary>
          <p className="s3-note">
            Đổi tham số rồi bấm "Thử trên tập validation" để so sánh; không cần duyệt lại hay viết
            lại code. Lượt chạy thật dùng các giá trị đang có trong ô. Điểm tập kiểm tra chỉ mở khi
            bạn chạy thật, và sau đó không đổi tham số được nữa, để điểm này vẫn là ước lượng độc
            lập.
          </p>
          {options
            .filter(variant => ordered.includes(variant.id))
            .map(variant => (
              <fieldset key={variant.id}>
                <legend>{variant.name}</legend>
                {Object.entries(defaults[variant.id] ?? {}).map(([name, value]) => (
                  <label key={name}>
                    <code>{name}</code>
                    <input
                      type="text"
                      value={edits[variant.id]?.[name] ?? formatParamValue(value)}
                      disabled={busy}
                      onChange={event => {
                        edit(variant.id, name, event.target.value);
                      }}
                    />
                  </label>
                ))}
              </fieldset>
            ))}
          {errors.length > 0 ? (
            <p className="s3-experiment-param-errors" role="alert">
              {errors.join(' · ')}
            </p>
          ) : null}
        </details>
      ) : null}

      {canTune && trials.length > 0 ? (
        <div className="s3-comparison-table-wrap">
          <table className="s3-comparison-table s3-experiment-trials">
            <caption>
              Các lần thử: {metricLabel(metric)} trên tập validation, không phải tập kiểm tra
            </caption>
            <thead>
              <tr>
                <th scope="col">Lần</th>
                <th scope="col">Phương án</th>
                <th scope="col">Tham số đã đổi</th>
                <th scope="col">{metricLabel(metric)}</th>
                <th scope="col">Dùng</th>
              </tr>
            </thead>
            <tbody>
              {trials.map(trial => {
                const name =
                  options.find(variant => variant.id === trial.variant)?.name ?? trial.variant;
                const score = trial.validationMetrics?.[metric];
                const setting = trial.requested ?? trial.params;
                return (
                  <tr key={`${trial.round.toString()}:${trial.variant}`}>
                    <td>{trial.round}</td>
                    <td>{name}</td>
                    <td>{describeTrialParams(trial, defaults[trial.variant] ?? {})}</td>
                    <td>{score === undefined ? 'Lỗi khi chạy' : score.toFixed(3)}</td>
                    <td>
                      {setting ? (
                        <button
                          type="button"
                          className="s3-button s3-button-secondary"
                          disabled={busy}
                          onClick={() => {
                            setEdits(current => ({
                              ...current,
                              [trial.variant]: editsFromParams(setting),
                            }));
                          }}
                        >
                          Dùng
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

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
          disabled={busy || ordered.length === 0 || errors.length > 0}
          onClick={() => {
            start('run');
          }}
        >
          <Play size={15} aria-hidden="true" />{' '}
          {mode === 'first' ? `Chạy ${count} phương án` : `Chạy lại ${count} phương án`}
        </button>
        {canTune ? (
          <button
            type="button"
            className="s3-button s3-button-secondary"
            disabled={busy || ordered.length === 0 || errors.length > 0}
            onClick={() => {
              start('tune');
            }}
          >
            Thử trên tập validation
          </button>
        ) : null}
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
