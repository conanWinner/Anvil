import { ArrowRight, GitBranch, History, Play, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  createSystem3LifecycleAttempt,
  cleanupSystem3LifecycleAttempt,
  cleanupAllSystem3LifecycleAttempts,
  continueSystem3LifecycleAttempt,
  listSystem3LifecycleAttempts,
  previewSystem3LifecycleAttempt,
  type System3LifecycleAttempt,
  type System3LifecycleAttemptActivity,
  type System3LifecycleAttemptPreview,
} from '@/lib/api';

/** Short Vietnamese names, so a re-run preview does not read as a list of internal codes. */
const ACTIVITY_NAMES: Record<System3LifecycleAttemptActivity, string> = {
  'OP-00': 'Tiếp nhận nguồn',
  'OP-01': 'Phát hiện thay đổi',
  'TW-02': 'Hiểu dự án',
  'TW-03': 'Kiểm tra sẵn sàng',
  'OP-04': 'Chuẩn bị kế hoạch',
  'OP-05': 'Phê duyệt',
  'TW-06': 'Xây dựng và chạy',
  'TW-07': 'Xác minh',
  'OP-08': 'Yêu cầu bàn giao',
  'TW-09': 'Tạo gói bàn giao',
};

function attemptStatusLabel(status: System3LifecycleAttempt['runStatus']): string {
  if (status === 'preparing') return 'Đang tạo môi trường';
  if (status === 'running') return 'Đang chạy';
  if (status === 'waiting') return 'Đang chờ bước tiếp theo';
  if (status === 'completed') return 'Đã hoàn tất';
  if (status === 'failed') return 'Cần xử lý lỗi';
  return 'Cần xác minh trạng thái';
}

export function LifecycleAttemptBar({
  projectId,
  projectVersion,
  selectedActivityId,
  onSelectActivity,
  onRunActivity,
  executionStatus,
}: {
  projectId: string;
  projectVersion: number;
  selectedActivityId: string;
  onSelectActivity: (activityId: string) => void;
  onRunActivity: (activityId: System3LifecycleAttemptActivity) => Promise<void>;
  /** Status of the project's latest execution, if any. */
  executionStatus?: 'accepted' | 'running' | 'completed' | 'failed';
}): ReactElement {
  const [attempts, setAttempts] = useState<System3LifecycleAttempt[]>([]);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'full' | 'activity' | 'downstream'>('full');
  const [inputMode, setInputMode] = useState<'replay' | 'current'>('current');
  const [preview, setPreview] = useState<System3LifecycleAttemptPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeDialog = useCallback((): void => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const reload = useCallback((): void => {
    void listSystem3LifecycleAttempts(projectId)
      .then(setAttempts)
      .catch(() => {
        setAttempts([]);
      });
  }, [projectId]);
  useEffect(reload, [projectId, projectVersion]);

  useEffect(() => {
    if (!attempts.some(attempt => ['preparing', 'running'].includes(attempt.runStatus))) return;
    const intervalId = window.setInterval(reload, 1500);
    return (): void => {
      window.clearInterval(intervalId);
    };
  }, [attempts, reload]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', closeOnEscape);
    return (): void => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeDialog, open]);

  // An in-page confirmation: native confirm() dialogs are suppressed in embedded browsers.
  const [confirmCleanup, setConfirmCleanup] = useState<{
    message: string;
    run: () => void;
  } | null>(null);

  const active =
    attempts.find(attempt => attempt.lifecycleStatus === 'active') ?? attempts[0] ?? null;
  const startActivityId =
    scope === 'full' ? 'OP-00' : (selectedActivityId as System3LifecycleAttemptActivity);

  const openPreview = (
    nextScope: 'full' | 'activity' | 'downstream',
    nextInputMode = inputMode
  ): void => {
    setScope(nextScope);
    setInputMode(nextInputMode);
    setPreview(null);
    setError(null);
    setOpen(true);
    setLoading(true);
    void previewSystem3LifecycleAttempt(projectId, {
      expectedVersion: projectVersion,
      baseAttemptId: active?.id ?? null,
      startActivityId:
        nextScope === 'full' ? 'OP-00' : (selectedActivityId as System3LifecycleAttemptActivity),
      scope: nextScope,
      inputMode: nextInputMode,
    })
      .then(setPreview)
      .catch(value => {
        setError(value instanceof Error ? value.message : 'Không thể xem trước lượt chạy');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const createAttempt = (): void => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    void createSystem3LifecycleAttempt(projectId, {
      expectedVersion: projectVersion,
      baseAttemptId: active?.id ?? null,
      startActivityId,
      scope,
      inputMode,
      previewHash: preview.previewHash,
      idempotencyKey: crypto.randomUUID(),
    })
      .then(() => {
        closeDialog();
        reload();
      })
      .catch(value => {
        setError(value instanceof Error ? value.message : 'Không thể tạo lượt chạy');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const cleanupAttempt = (attempt: System3LifecycleAttempt): void => {
    if (!['completed', 'failed'].includes(attempt.runStatus)) {
      setError('Chỉ có thể dọn lượt chạy đã hoàn tất hoặc đã thất bại.');
      return;
    }
    setConfirmCleanup({
      message: `Dọn payload artifact, worktree và local branch của Lượt #${attempt.sequence.toString()}? Nguồn đầu vào và lịch sử kiểm toán vẫn được giữ lại.`,
      run: () => {
        runCleanup(attempt);
      },
    });
  };

  const runCleanup = (attempt: System3LifecycleAttempt): void => {
    setLoading(true);
    setError(null);
    void cleanupSystem3LifecycleAttempt(projectId, attempt.id, {
      expectedVersion: projectVersion,
      confirmation: 'cleanup_attempt',
      force: false,
    })
      .then(reload)
      .catch(value => {
        setError(value instanceof Error ? value.message : 'Không thể dọn lượt chạy');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const continueAttempt = (): void => {
    if (
      !active ||
      (active.nextActivityId !== 'OP-00' &&
        active.nextActivityId !== 'OP-01' &&
        active.nextActivityId !== 'OP-08')
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    void continueSystem3LifecycleAttempt(projectId, active.id, { expectedVersion: projectVersion })
      .then(attempt => {
        onSelectActivity(attempt.nextActivityId ?? 'TW-02');
        reload();
      })
      .catch(value => {
        setError(value instanceof Error ? value.message : 'Không thể tiếp tục lượt chạy');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const openNextActivity = (): void => {
    if (!active?.nextActivityId) return;
    if (
      active.nextActivityId === 'OP-00' ||
      active.nextActivityId === 'OP-01' ||
      active.nextActivityId === 'OP-08'
    ) {
      continueAttempt();
      return;
    }
    onSelectActivity(active.nextActivityId);
    if (active.nextActivityId === 'TW-02') return;
    setLoading(true);
    setError(null);
    void onRunActivity(active.nextActivityId)
      .then(reload)
      .catch(value => {
        setError(value instanceof Error ? value.message : 'Không thể chạy bước này');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const cleanupAllAttempts = (): void => {
    if (!attempts.some(attempt => ['completed', 'failed'].includes(attempt.runStatus))) return;
    setConfirmCleanup({
      message:
        'Dọn toàn bộ payload artifact, worktree và local branch của các lượt chạy đã kết thúc? Nguồn đầu vào và lịch sử kiểm toán vẫn được giữ.',
      run: runCleanupAll,
    });
  };

  const runCleanupAll = (): void => {
    setLoading(true);
    setError(null);
    void cleanupAllSystem3LifecycleAttempts(projectId, {
      expectedVersion: projectVersion,
      confirmation: 'cleanup_all_attempts',
      force: false,
    })
      .then(reload)
      .catch(value => {
        setError(value instanceof Error ? value.message : 'Không thể dọn toàn bộ lượt chạy');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <section className="s3-attempt-bar" aria-label="Lượt chạy Project Lifecycle">
      <div>
        <span className="s3-attempt-kicker">Lượt chạy</span>
        {active ? (
          <strong>
            Lượt #{active.sequence.toString()} · {attemptStatusLabel(active.runStatus)}
          </strong>
        ) : (
          <strong>
            {executionStatus === 'failed'
              ? 'Lần thực thi gần nhất bị lỗi'
              : executionStatus
                ? 'Có lần thực thi'
                : 'Chưa có lượt chạy'}
          </strong>
        )}
        {active?.branchName ? (
          <small>
            <GitBranch size={14} /> {active.branchName}
          </small>
        ) : null}
      </div>
      <div className="s3-attempt-actions">
        {active?.runStatus === 'waiting' && active.nextActivityId ? (
          <button type="button" className="s3-button" onClick={openNextActivity} disabled={loading}>
            <ArrowRight size={15} />
            {active.nextActivityId === 'OP-00' ||
            active.nextActivityId === 'OP-01' ||
            active.nextActivityId === 'OP-08'
              ? `Tiếp tục: ${ACTIVITY_NAMES[active.nextActivityId]}`
              : active.nextActivityId === 'TW-02'
                ? `Mở bước: ${ACTIVITY_NAMES[active.nextActivityId]}`
                : `Chạy bước: ${ACTIVITY_NAMES[active.nextActivityId]}`}
          </button>
        ) : null}
      </div>
      <details className="s3-attempt-advanced">
        <summary>Lịch sử và chạy lại</summary>
        <div className="s3-attempt-actions">
          <button
            type="button"
            className="s3-button s3-button-secondary"
            onClick={() => {
              setShowHistory(value => !value);
            }}
            aria-expanded={showHistory}
          >
            <History size={15} /> {showHistory ? 'Ẩn lịch sử' : 'Xem lịch sử'}
          </button>
          {attempts.some(attempt => ['completed', 'failed'].includes(attempt.runStatus)) ? (
            <button
              type="button"
              className="s3-button s3-button-secondary"
              onClick={cleanupAllAttempts}
              disabled={loading}
            >
              <Trash2 size={15} /> Dọn lượt đã kết thúc
            </button>
          ) : null}
          <button
            type="button"
            className="s3-button s3-button-secondary"
            onClick={event => {
              triggerRef.current = event.currentTarget;
              openPreview('activity');
            }}
          >
            <RotateCcw size={15} /> Chạy lại từ đây
          </button>
          <button
            type="button"
            className="s3-button s3-button-secondary"
            onClick={event => {
              triggerRef.current = event.currentTarget;
              openPreview('full');
            }}
          >
            <Play size={15} /> Chạy lại toàn bộ
          </button>
        </div>
        {confirmCleanup ? (
          <div
            className="s3-attempt-confirm"
            role="alertdialog"
            aria-label="Xác nhận dọn lượt chạy"
          >
            <p>{confirmCleanup.message}</p>
            <div className="s3-attempt-actions">
              <button
                type="button"
                className="s3-button"
                disabled={loading}
                onClick={() => {
                  const { run } = confirmCleanup;
                  setConfirmCleanup(null);
                  run();
                }}
              >
                <Trash2 size={15} /> Dọn
              </button>
              <button
                type="button"
                className="s3-button s3-button-secondary"
                onClick={() => {
                  setConfirmCleanup(null);
                }}
              >
                Hủy
              </button>
            </div>
          </div>
        ) : null}
        {showHistory ? (
          <div className="s3-attempt-history" aria-live="polite">
            {attempts.length === 0 ? <p>Chưa có lượt chạy nào.</p> : null}
            {attempts.map(attempt => (
              <div
                key={attempt.id}
                className={attempt.lifecycleStatus === 'active' ? 'current' : ''}
              >
                <span>Lượt #{attempt.sequence.toString()}</span>
                <strong>{attemptStatusLabel(attempt.runStatus)}</strong>
                <small>
                  {attempt.scope === 'full'
                    ? 'Toàn bộ'
                    : attempt.scope === 'activity'
                      ? 'Một bước'
                      : 'Từ đây đến cuối'}
                </small>
                {attempt.branchName ? (
                  <small>
                    <GitBranch size={13} /> {attempt.branchName}
                  </small>
                ) : null}
                {attempt.cleanupStatus === 'completed' ? <small>Đã dọn payload</small> : null}
                {attempt.lifecycleStatus !== 'cleaned' &&
                ['completed', 'failed'].includes(attempt.runStatus) ? (
                  <button
                    type="button"
                    className="s3-attempt-cleanup"
                    onClick={() => {
                      cleanupAttempt(attempt);
                    }}
                    disabled={loading}
                  >
                    <Trash2 size={14} /> Dọn
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </details>
      {open ? (
        <div
          className="s3-dialog-backdrop"
          role="presentation"
          onMouseDown={() => {
            closeDialog();
          }}
        >
          <section
            className="s3-dialog s3-attempt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attempt-dialog-title"
            onMouseDown={event => {
              event.stopPropagation();
            }}
          >
            <header className="s3-dialog-head">
              <div>
                <p className="s3-kicker">Lượt chạy mới</p>
                <h2 id="attempt-dialog-title">Xem trước trước khi chạy lại</h2>
                <p>Mỗi lượt chạy trong một bản làm việc riêng; các lượt cũ vẫn được giữ nguyên.</p>
              </div>
              <button
                type="button"
                className="s3-icon-button"
                aria-label="Đóng"
                onClick={() => {
                  closeDialog();
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="s3-attempt-scope" role="group" aria-label="Phạm vi chạy lại">
              {(
                [
                  ['full', 'Toàn bộ từ Tiếp nhận'],
                  ['activity', 'Chỉ bước này'],
                  ['downstream', 'Từ đây đến cuối'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={scope === value ? 'selected' : ''}
                  onClick={() => {
                    openPreview(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="s3-attempt-scope" role="group" aria-label="Đầu vào cho lượt chạy lại">
              {(
                [
                  ['replay', 'Dữ liệu của lượt trước'],
                  ['current', 'Dữ liệu hiện tại'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={inputMode === value ? 'selected' : ''}
                  // Replay needs an earlier attempt to copy its pinned inputs from.
                  disabled={value === 'replay' && active === null}
                  title={
                    value === 'replay' && active === null
                      ? 'Chưa có lượt chạy trước để dùng lại dữ liệu'
                      : undefined
                  }
                  onClick={() => {
                    openPreview(scope, value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="s3-note">
              {inputMode === 'replay'
                ? 'Dùng lại đúng các phiên bản dữ liệu của lượt trước; phù hợp để tái lập kết quả.'
                : 'Ghim lại các phiên bản dữ liệu đang dùng; lịch sử cũ không bị thay đổi.'}
            </p>
            {loading ? (
              <p className="s3-resource-loading" role="status">
                Đang kiểm tra dữ liệu cho lượt chạy…
              </p>
            ) : null}
            {error ? (
              <p className="s3-note" role="alert">
                {error}
              </p>
            ) : null}
            {preview ? (
              <div className="s3-attempt-preview">
                <p>
                  <GitBranch size={15} /> Nhánh làm việc: <strong>{preview.branchHint}</strong>
                </p>
                <p>
                  <History size={15} /> {preview.basis.sourceVersionIds.length.toString()} phiên bản
                  dữ liệu sẽ được ghim lại.
                </p>
                <p>
                  Các bước sẽ chạy:{' '}
                  {preview.activities.map(activity => ACTIVITY_NAMES[activity]).join(' · ')}
                </p>
                {preview.checkpoints.length > 0 ? (
                  <p>
                    Hệ thống sẽ dừng để bạn xác nhận tại:{' '}
                    {preview.checkpoints.map(activity => ACTIVITY_NAMES[activity]).join(', ')}.
                  </p>
                ) : null}
                {preview.warnings.map(warning => (
                  <p key={warning} className="s3-note">
                    {warning}
                  </p>
                ))}
                {preview.blockingReasons.map(reason => (
                  <p key={reason} className="s3-note" role="alert">
                    {reason}
                  </p>
                ))}
              </div>
            ) : null}
            <footer className="s3-dialog-actions">
              <button
                type="button"
                className="s3-button s3-button-secondary"
                onClick={() => {
                  closeDialog();
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="s3-button"
                disabled={loading || preview?.canStart !== true}
                onClick={createAttempt}
              >
                {loading ? 'Đang tạo…' : 'Tạo lượt chạy mới'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
