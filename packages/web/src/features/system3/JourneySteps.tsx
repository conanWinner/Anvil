import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import type { JourneyStepView } from './journey';

const STATUS_LABEL: Record<JourneyStepView['status'], string> = {
  done: 'đã xong',
  current: 'bước hiện tại',
  attention: 'cần xử lý',
  stale: 'cần chạy lại',
  upcoming: 'chưa tới',
};

export function JourneySteps({ steps }: { steps: readonly JourneyStepView[] }): ReactElement {
  return (
    <ol className="s3-journey-steps" aria-label="Tiến độ dự án">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={`s3-journey-step ${step.status} ${step.active ? 'active' : ''}`}
          aria-current={
            step.status === 'current' || step.status === 'attention' ? 'step' : undefined
          }
        >
          <span className="s3-journey-step-marker" aria-hidden="true">
            {step.status === 'done' ? (
              <Check size={14} strokeWidth={3} />
            ) : step.active ? (
              <RefreshCw size={13} className="s3-spin" />
            ) : step.status === 'attention' || step.status === 'stale' ? (
              <AlertTriangle size={13} />
            ) : (
              (index + 1).toString()
            )}
          </span>
          <span className="s3-journey-step-label">
            {step.label}
            <span className="s3-visually-hidden">
              {' '}
              — {step.active ? 'đang xử lý' : STATUS_LABEL[step.status]}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
