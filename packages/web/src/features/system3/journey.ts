import type { LifecyclePhaseView } from './lifecycle-view';
import type { PhaseStatus } from './types';

export type JourneyStepStatus = 'done' | 'current' | 'attention' | 'stale' | 'upcoming';

export interface JourneyStepView {
  id: 'sources' | 'understanding' | 'plan' | 'run' | 'results';
  label: string;
  status: JourneyStepStatus;
  active: boolean;
}

// User-facing grouping only: the six lifecycle phases stay the canonical contract.
const STEPS: readonly {
  id: JourneyStepView['id'];
  label: string;
  phases: readonly LifecyclePhaseView['id'][];
}[] = [
  { id: 'sources', label: 'Nguồn', phases: ['intake'] },
  { id: 'understanding', label: 'Phân tích', phases: ['understanding'] },
  { id: 'plan', label: 'Duyệt kế hoạch', phases: ['readiness'] },
  { id: 'run', label: 'Chạy & kiểm tra', phases: ['build', 'verify'] },
  { id: 'results', label: 'Kết quả', phases: ['delivery'] },
];

function statusesOf(
  lifecycle: readonly LifecyclePhaseView[],
  phases: readonly LifecyclePhaseView['id'][]
): PhaseStatus[] {
  return phases.map(id => lifecycle.find(phase => phase.id === id)?.status ?? 'not_started');
}

export function buildJourney(lifecycle: readonly LifecyclePhaseView[]): JourneyStepView[] {
  let currentAssigned = false;
  return STEPS.map(step => {
    const statuses = statusesOf(lifecycle, step.phases);
    const active = statuses.includes('active');
    if (statuses.every(status => status === 'completed')) {
      return { id: step.id, label: step.label, status: 'done', active: false };
    }
    if (statuses.includes('stale')) {
      currentAssigned = true;
      return { id: step.id, label: step.label, status: 'stale', active };
    }
    if (currentAssigned) {
      return { id: step.id, label: step.label, status: 'upcoming', active: false };
    }
    currentAssigned = true;
    return {
      id: step.id,
      label: step.label,
      status: statuses.includes('blocked') ? 'attention' : 'current',
      active,
    };
  });
}
