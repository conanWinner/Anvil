import type { System3Phase } from './contracts';

interface PhaseDefinition {
  id: string;
  title: string;
  summary: string;
  technicalWorkflow: string;
  objective: string;
  inputs: string[];
  outputs: string[];
}

const phaseDefinitions: readonly PhaseDefinition[] = [
  {
    id: 'understanding',
    title: 'Hiểu dự án',
    technicalWorkflow: 'system3-understand-project',
    summary: 'Đọc blueprint, profile dataset và tạo tri thức có thể kiểm tra.',
    objective: 'Chuyển DESIGN_B_2.md thành requirement, constraint và decision có provenance.',
    inputs: ['Blueprint', 'Dataset mẫu'],
    outputs: ['Project overview', 'Requirements', 'Open decisions'],
  },
  {
    id: 'readiness',
    title: 'Sẵn sàng & quyết định',
    technicalWorkflow: 'system3-readiness-contract',
    summary: 'Khóa các quyết định cần thiết trước compilation.',
    objective: 'Không suy đoán target, metric hoặc phạm vi.',
    inputs: ['Project overview', 'Open decisions'],
    outputs: ['Readiness contract', 'Decision log'],
  },
  {
    id: 'data',
    title: 'Nền tảng dữ liệu',
    technicalWorkflow: 'system3-baseline-experiment',
    summary: 'Kiểm tra schema và target của dataset MVP.',
    objective: 'Xác nhận dữ liệu có thể chạy baseline.',
    inputs: ['Dataset source', 'Readiness contract'],
    outputs: ['Dataset profile', 'Data checks'],
  },
  {
    id: 'features',
    title: 'Đặc trưng & temporal split',
    technicalWorkflow: 'system3-baseline-build',
    summary: 'Thiết kế baseline tái lập được.',
    objective: 'Ghi rõ phần chưa thuộc MVP.',
    inputs: ['Dataset profile'],
    outputs: ['Feature plan', 'Split contract'],
  },
  {
    id: 'experiments',
    title: 'Baseline & thử nghiệm',
    technicalWorkflow: 'system3-baseline-experiment',
    summary: 'Chạy baseline và thu execution evidence.',
    objective: 'Không đánh đồng baseline với full DESIGN_B_2 coverage.',
    inputs: ['Generated project'],
    outputs: ['Baseline result', 'Test result'],
  },
  {
    id: 'explainability',
    title: 'Chọn mô hình & giải thích',
    technicalWorkflow: 'system3-baseline-experiment',
    summary: 'Nêu rõ evidence và scope gap.',
    objective: 'Không tuyên bố SHAP hoặc model selection khi chưa chạy.',
    inputs: ['Experiment output'],
    outputs: ['Known limitations'],
  },
  {
    id: 'delivery',
    title: 'Xác minh & bàn giao',
    technicalWorkflow: 'system3-verify + system3-delivery',
    summary: 'Đóng gói artifact có provenance.',
    objective: 'Bàn giao baseline với limitation rõ ràng.',
    inputs: ['Evidence records'],
    outputs: ['Delivery manifest', 'Package'],
  },
];

export function buildProjectPhases(input: {
  understood: boolean;
  readinessComplete?: boolean;
  pendingDecisions: number;
  freshness: 'current' | 'partially_stale' | 'stale';
  approved?: boolean;
  executionStatus?: 'accepted' | 'running' | 'completed' | 'failed';
  verificationStatus?: 'accepted' | 'running' | 'completed' | 'failed';
  delivered?: boolean;
}): System3Phase[] {
  return phaseDefinitions.map(definition => {
    const understanding = definition.id === 'understanding';
    const readiness = definition.id === 'readiness';
    const executable = ['data', 'experiments', 'delivery'].includes(definition.id);
    const outsideMvp = definition.id === 'features' || definition.id === 'explainability';
    const status = outsideMvp
      ? ('out_of_mvp_scope' as const)
      : executable
        ? input.delivered
          ? ('completed' as const)
          : definition.id === 'delivery' && input.verificationStatus === 'failed'
            ? ('blocked' as const)
            : definition.id === 'delivery' && input.verificationStatus === 'completed'
              ? ('ready' as const)
              : definition.id === 'delivery' &&
                  (input.verificationStatus === 'accepted' ||
                    input.verificationStatus === 'running')
                ? ('active' as const)
                : input.executionStatus === 'running' || input.executionStatus === 'accepted'
                  ? ('active' as const)
                  : input.executionStatus === 'failed'
                    ? ('blocked' as const)
                    : input.approved
                      ? ('ready' as const)
                      : ('waiting' as const)
        : understanding
          ? input.understood
            ? input.freshness === 'current'
              ? ('completed' as const)
              : ('stale' as const)
            : ('not_started' as const)
          : readiness && input.understood && input.freshness === 'current'
            ? input.pendingDecisions > 0
              ? ('blocked' as const)
              : input.readinessComplete
                ? ('completed' as const)
                : ('ready' as const)
            : ('waiting' as const);
    const technicalSteps: Record<
      string,
      { id: string; title: string; description: string; input: string; output: string }[]
    > = {
      readiness: [
        {
          id: 'evaluate-gates',
          title: 'Evaluate readiness gates',
          description: 'Kiểm tra blueprint và decision snapshot trước khi khóa contract.',
          input: 'Knowledge snapshot + decisions',
          output: 'Readiness gates',
        },
        {
          id: 'resolve-decisions',
          title: 'Resolve decisions',
          description: 'Xác nhận không còn manual-review item chưa được trả lời.',
          input: 'Decision log',
          output: 'Resolved decisions',
        },
        {
          id: 'finalize-contract',
          title: 'Freeze readiness contract',
          description: 'Persist contract bất biến được compiler và approval pin lại.',
          input: 'Gate result + resolved decisions',
          output: 'readiness-contract.json',
        },
      ],
      data: [
        {
          id: 'validate-dataset',
          title: 'Validate dataset',
          description: 'Kiểm tra CSV, số dòng và target column trước execution.',
          input: 'Immutable dataset source',
          output: 'Dataset validation',
        },
        {
          id: 'run-data-pipeline',
          title: 'Run data pipeline',
          description: 'Chạy pipeline deterministic trên generated project.',
          input: 'Validated project',
          output: 'data-pipeline.json',
        },
      ],
      experiments: [
        {
          id: 'run-tests',
          title: 'Run generated tests',
          description: 'Chạy unittest độc lập trước baseline.',
          input: 'Generated Python project',
          output: 'test-results.json',
        },
        {
          id: 'run-baseline',
          title: 'Run majority baseline',
          description: 'Chạy majority-class baseline với seed cố định.',
          input: 'Validated dataset',
          output: 'baseline-experiment.json',
        },
      ],
      delivery: [
        {
          id: 'build-evidence-map',
          title: 'Build evidence map',
          description: 'Tách runtime checks khỏi requirement coverage.',
          input: 'Test + data + experiment results',
          output: 'requirement-evidence-map.json',
        },
        {
          id: 'evaluate-baseline-gate',
          title: 'Evaluate G5',
          description: 'Fail closed nếu baseline execution không pass.',
          input: 'Evidence map',
          output: 'G5 decision',
        },
        {
          id: 'package',
          title: 'Package generated project',
          description: 'Tạo immutable tar.gz và content hash.',
          input: 'Verified generated project',
          output: 'generated_project.tar.gz',
        },
        {
          id: 'delivery-manifest',
          title: 'Publish delivery manifest',
          description: 'Gắn package, evidence và limitation vào execution.',
          input: 'Package + evidence + gate',
          output: 'Delivery manifest',
        },
      ],
    };
    const steps = understanding
      ? [
          {
            id: 'verify-input-snapshot',
            title: 'Xác minh đầu vào đã cố định',
            description:
              'Đọc đúng các phiên bản nguồn và kiểm tra mã nội dung trước khi phân tích.',
            kind: 'input' as const,
            status: input.understood ? ('completed' as const) : ('pending' as const),
            input: 'Các phiên bản nguồn trong Bản chụp đầu vào',
            output: 'Đầu vào đã xác minh',
          },
          {
            id: 'analyze-understanding',
            title: 'Phân tích và tạo Bản hiểu dự án',
            description:
              'Đọc cấu trúc System 2, đối chiếu dữ liệu, kiểm tra chất lượng và tạo báo cáo.',
            kind: 'artifact' as const,
            status: input.understood ? ('completed' as const) : ('pending' as const),
            input: 'Đầu vào đã xác minh',
            output: 'Bản hiểu nháp · báo cáo · quyết định cần xác nhận',
          },
        ]
      : (technicalSteps[definition.id] ?? []).map(step => ({
          ...step,
          kind:
            step.id === 'package' || step.id === 'delivery-manifest'
              ? ('artifact' as const)
              : ('check' as const),
          status:
            status === 'completed'
              ? ('completed' as const)
              : status === 'active'
                ? ('running' as const)
                : status === 'blocked'
                  ? ('blocked' as const)
                  : ('pending' as const),
        }));
    return {
      ...definition,
      status,
      progress:
        status === 'completed' || status === 'stale'
          ? 100
          : status === 'active'
            ? 55
            : status === 'blocked'
              ? 45
              : 0,
      workflowSteps: steps,
    };
  });
}
