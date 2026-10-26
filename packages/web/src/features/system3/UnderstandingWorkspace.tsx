import { AlertTriangle, Check, CircleHelp, Database, FileCheck2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { presentDecisionQuestion } from './decision-presentation';
import { system3Store, useSystem3Project } from './store';
import type { System3UnderstandingView } from './types';

function qualityLabel(
  status: NonNullable<System3UnderstandingView['candidateSnapshot']>['qualityStatus']
): string {
  if (status === 'passed') return 'Đạt kiểm tra chất lượng';
  if (status === 'decision_required') return 'Cần trả lời quyết định';
  if (status === 'revision_required') return 'Cần sửa hoặc bổ sung nguồn';
  if (status === 'blocked') return 'Không thể tạo kết quả tin cậy';
  return 'Chưa có báo cáo chất lượng';
}

export function UnderstandingWorkspace({
  projectId,
  projectVersion,
}: {
  projectId: string;
  projectVersion: number;
}): ReactElement {
  const [view, setView] = useState<System3UnderstandingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const project = useSystem3Project();
  const analyzing =
    project.operation?.type === 'analyze' &&
    (project.operation.status === 'accepted' || project.operation.status === 'running');
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setView(await system3Store.getUnderstandingView());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải Bản hiểu dự án');
    } finally {
      setLoading(false);
    }
  }, []);
  const operationKey = `${project.operation?.id ?? ''}:${project.operation?.status ?? ''}`;
  useEffect(() => {
    void load();
  }, [load, projectId, projectVersion, operationKey]);

  if (loading && view === null) {
    return (
      <section className="s3-understanding-panel" aria-live="polite">
        <RefreshCw size={17} className="s3-spin" /> Đang tải trạng thái Bản hiểu dự án…
      </section>
    );
  }
  if (error !== null && view === null) {
    return (
      <section className="s3-understanding-panel error" role="alert">
        <AlertTriangle size={18} />
        <div>
          <strong>Không thể tải trạng thái Hiểu dự án</strong>
          <p>{error}</p>
          <button
            type="button"
            className="s3-button s3-button-secondary"
            onClick={() => void load()}
          >
            Thử lại
          </button>
        </div>
      </section>
    );
  }
  if (view === null) return <section className="s3-understanding-panel" />;
  const candidate = view.candidateSnapshot;
  const active = view.activeSnapshot;
  if (candidate === null && active === null && view.decisions.length === 0) {
    return (
      <section className="s3-understanding-empty" aria-live="polite">
        {analyzing ? (
          <>
            <RefreshCw size={20} className="s3-spin" aria-hidden="true" />
            <div>
              <strong>Anvil đang đọc mô tả bài toán và dữ liệu…</strong>
              <p>
                Bản hiểu sẽ hiện tại đây để bạn xác nhận. Bạn có thể rời trang; tiến độ được lưu
                trên máy chủ.
              </p>
            </div>
          </>
        ) : (
          <>
            <FileCheck2 size={20} aria-hidden="true" />
            <div>
              <strong>Chưa phân tích</strong>
              <p>
                Phân tích đọc các nguồn đã ghim, rút ra mục tiêu, yêu cầu và những câu hỏi cần bạn
                xác nhận. Bước này chưa chạy các LLM so sánh.
              </p>
            </div>
          </>
        )}
      </section>
    );
  }
  const reviewed = candidate ?? active;
  const quality = candidate?.qualityReport;
  const pendingDecisions = view.decisions.filter(decision => decision.status === 'pending');
  const answeredDecisions = view.decisions.filter(decision => decision.status === 'answered');
  const renderDecision = (
    decision: System3UnderstandingView['decisions'][number]
  ): ReactElement => {
    const presentation = presentDecisionQuestion(decision.question);
    return (
      <article key={decision.id}>
        <div className="s3-understanding-decision-copy">
          <strong>{presentation.summary}</strong>
          <small>{decision.title}</small>
          <details>
            <summary>Xem lý do và nội dung nguồn</summary>
            <div className="s3-understanding-decision-details">
              {presentation.suggestion !== null ? (
                <p>
                  <b>Gợi ý từ tài liệu:</b> {presentation.suggestion}
                </p>
              ) : null}
              <p>
                <b>Vì sao Anvil cần hỏi:</b> {decision.why}
              </p>
              <p>
                <b>Khuyến nghị:</b> {decision.recommendation}
              </p>
              {presentation.showOriginal ? (
                <p>
                  <b>Nội dung nguyên văn:</b> <code>{presentation.original}</code>
                </p>
              ) : null}
            </div>
          </details>
        </div>
        {decision.status === 'pending' ? (
          <div className="s3-understanding-decision-action">
            {decision.binding?.kind === 'dataset_target_column' ? (
              <label>
                Cột mục tiêu
                <select
                  value={answers[decision.id] ?? ''}
                  disabled={submitting}
                  onChange={event => {
                    setAnswers(current => ({
                      ...current,
                      [decision.id]: event.target.value,
                    }));
                  }}
                >
                  <option value="">Chọn một cột</option>
                  {decision.binding.allowedValues.map(value => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className="s3-button s3-button-secondary"
              disabled={
                submitting ||
                (decision.binding?.kind === 'dataset_target_column' &&
                  (answers[decision.id] ?? '').length === 0)
              }
              onClick={() => {
                const answer =
                  decision.binding?.kind === 'dataset_target_column'
                    ? answers[decision.id]
                    : 'Đã xem xét và xác nhận';
                if (!answer) return;
                setSubmitting(true);
                setError(null);
                void system3Store
                  .answerDecision(decision.id, answer)
                  .then(load)
                  .catch(actionError => {
                    setError(
                      actionError instanceof Error
                        ? actionError.message
                        : 'Không thể lưu quyết định'
                    );
                  })
                  .finally(() => {
                    setSubmitting(false);
                  });
              }}
            >
              Xác nhận quyết định
            </button>
          </div>
        ) : (
          <span className="s3-chip good">Đã trả lời</span>
        )}
      </article>
    );
  };
  return (
    <section className="s3-understanding-panel" aria-labelledby="understanding-state-title">
      <header>
        <div>
          <p className="s3-kicker">Trạng thái Bản hiểu dự án</p>
          <h3 id="understanding-state-title">
            {candidate
              ? 'Có bản nháp đang chờ xem xét'
              : active
                ? 'Đang dùng Bản hiểu đã kích hoạt'
                : 'Chưa có Bản hiểu dự án'}
          </h3>
        </div>
        {candidate ? (
          <span className={`s3-understanding-quality ${candidate.qualityStatus ?? 'unknown'}`}>
            {qualityLabel(candidate.qualityStatus)}
          </span>
        ) : null}
      </header>

      {reviewed ? (
        <div className="s3-understanding-brief">
          <div>
            <span>Mục tiêu</span>
            <p>{reviewed.analysis.businessGoal ?? 'Tài liệu chưa nêu rõ mục tiêu.'}</p>
          </div>
          {reviewed.analysis.requirements.length > 0 ? (
            <div>
              <span>Yêu cầu ({reviewed.analysis.requirements.length.toString()})</span>
              <ul>
                {reviewed.analysis.requirements.slice(0, 6).map(requirement => (
                  <li key={requirement.id}>
                    <b>{requirement.id}</b> {requirement.statement}
                  </li>
                ))}
              </ul>
              {reviewed.analysis.requirements.length > 6 ? (
                <small>
                  +{(reviewed.analysis.requirements.length - 6).toString()} yêu cầu khác trong báo
                  cáo Bản hiểu
                </small>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="s3-understanding-metrics">
        <summary>Chi tiết trích xuất</summary>
        <div className="s3-understanding-summary">
          <article>
            <FileCheck2 size={18} aria-hidden="true" />
            <div>
              <span>Bản đang hoạt động</span>
              <strong>
                {active
                  ? `Đã kích hoạt ${new Date(active.activatedAt ?? active.createdAt).toLocaleString('vi-VN')}`
                  : 'Chưa có'}
              </strong>
              <small>{active?.analysis.businessGoal ?? 'Chưa có mục tiêu được xác nhận.'}</small>
            </div>
          </article>
          <article>
            <Database size={18} aria-hidden="true" />
            <div>
              <span>Đầu vào bản nháp</span>
              <strong>
                {view.inputSnapshot
                  ? `${view.inputSnapshot.sourceRefs.length.toString()} phiên bản nguồn đã ghim`
                  : 'Chưa có'}
              </strong>
              <small>{view.inputSnapshot?.parserVersion ?? 'Chưa chạy bộ đọc tài liệu.'}</small>
            </div>
          </article>
          <article>
            <CircleHelp size={18} aria-hidden="true" />
            <div>
              <span>Chất lượng trích xuất</span>
              <strong>
                {quality
                  ? `${quality.extractedComponents.toString()} / ${quality.totalComponents.toString()} thành phần đã trích xuất`
                  : 'Chưa kiểm tra'}
              </strong>
              <small>
                {quality
                  ? `${quality.unsupportedComponents.toString()} không hỗ trợ · ${quality.unclassifiedComponents.toString()} chưa phân loại`
                  : 'Chưa có báo cáo.'}
              </small>
            </div>
          </article>
        </div>
      </details>

      {view.blockingReasons.length > 0 ? (
        <div className="s3-understanding-blockers" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Cần xử lý trước khi chấp nhận</strong>
            <ul>
              {view.blockingReasons.map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : candidate ? (
        <div className="s3-understanding-ready">
          <Check size={18} aria-hidden="true" />
          Bản hiểu đã sẵn sàng. Chấp nhận để Anvil kiểm tra điều kiện và chuẩn bị kế hoạch chạy.
        </div>
      ) : null}

      {view.decisions.length > 0 ? (
        <div className="s3-understanding-decisions">
          {pendingDecisions.length > 0 ? (
            <section aria-labelledby="pending-understanding-decisions">
              <h4 id="pending-understanding-decisions">
                Cần xác nhận ({pendingDecisions.length.toString()})
              </h4>
              <div className="s3-understanding-decision-list">
                {pendingDecisions.map(renderDecision)}
              </div>
            </section>
          ) : null}
          {answeredDecisions.length > 0 ? (
            <details className="s3-understanding-answered">
              <summary>Đã trả lời ({answeredDecisions.length.toString()})</summary>
              <div className="s3-understanding-decision-list">
                {answeredDecisions.map(renderDecision)}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <footer>
        <p>{error}</p>
        {candidate === null ? null : (
          <button
            type="button"
            className="s3-button"
            disabled={!view.canActivate || candidate === null || submitting}
            onClick={() => {
              if (candidate === null) return;
              setSubmitting(true);
              setError(null);
              void system3Store
                .activateUnderstanding(candidate.id, view.projectVersion)
                .then(load)
                .catch(actionError => {
                  setError(
                    actionError instanceof Error
                      ? actionError.message
                      : 'Không thể kích hoạt Bản hiểu dự án'
                  );
                })
                .finally(() => {
                  setSubmitting(false);
                });
            }}
          >
            {submitting ? 'Đang lưu…' : 'Chấp nhận Bản hiểu'}
          </button>
        )}
      </footer>
    </section>
  );
}
