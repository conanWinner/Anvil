import { describe, expect, test } from 'bun:test';
import { buildLifecycleView, selectSuggestedLifecycleActivity } from './lifecycle-view';
import type { System3Project } from './types';

function projectFixture(overrides: Partial<System3Project> = {}): System3Project {
  return {
    id: 'project-1',
    codebaseId: 'codebase-1',
    name: 'Lifecycle test',
    description: 'Test canonical UI projection',
    stage: 'draft',
    attention: 'none',
    freshness: 'current',
    workflowVersion: 'customer-churn-reference@1',
    version: 1,
    phases: [
      {
        id: 'understanding',
        title: 'Hiểu dự án',
        summary: 'Understanding',
        technicalWorkflow: 'system3-understand-project',
        status: 'not_started',
        progress: 0,
        objective: 'Understand',
        inputs: ['Sources'],
        outputs: ['Knowledge'],
        workflowSteps: [],
      },
      {
        id: 'data',
        title: 'Legacy data section',
        summary: 'Internal section',
        technicalWorkflow: 'system3-baseline-experiment',
        status: 'waiting',
        progress: 0,
        objective: 'Build',
        inputs: [],
        outputs: [],
        workflowSteps: [],
      },
    ],
    decisions: [],
    sources: [],
    intakeReports: [],
    intakeGate: {
      ready: false,
      blueprintReady: false,
      activeSourceCount: 0,
      changeDetection: [],
      recoveries: [],
      blockingReasons: ['Cần Blueprint nguồn chính.'],
    },
    evidence: [],
    impacts: [],
    manifestApproved: false,
    planCompiled: false,
    deliveryReady: false,
    deliveryAvailable: false,
    ...overrides,
  };
}

describe('buildLifecycleView', () => {
  test('projects legacy backend sections into exactly 6 phases and 10 activities', () => {
    const lifecycle = buildLifecycleView(projectFixture());

    expect(lifecycle.map(phase => phase.id)).toEqual([
      'intake',
      'understanding',
      'readiness',
      'build',
      'verify',
      'delivery',
    ]);
    expect(lifecycle.flatMap(phase => phase.activities).map(activity => activity.id)).toEqual([
      'OP-00',
      'OP-01',
      'TW-02',
      'TW-03',
      'OP-04',
      'OP-05',
      'TW-06',
      'TW-07',
      'OP-08',
      'TW-09',
    ]);
    expect(lifecycle.some(phase => phase.id === ('data' as string))).toBe(false);
    expect(
      lifecycle
        .flatMap(phase => phase.activities)
        .filter(activity => activity.id === 'OP-04' || activity.id === 'OP-05')
        .map(activity => activity.route)
    ).toEqual(['decisions', 'decisions']);
  });

  test('explains a migrated source without inventing an OP-00 report', () => {
    const lifecycle = buildLifecycleView(
      projectFixture({
        sources: [
          {
            id: 'source-version-1',
            sourceId: 'source-1',
            name: 'blueprint.md',
            originalFilename: 'blueprint.md',
            kind: 'blueprint',
            role: 'primary',
            mediaType: 'text/markdown',
            version: 1,
            hash: 'sha256:legacy',
            sizeBytes: 100,
            storageStatus: 'ready',
            validationReport: {
              schemaVersion: 1,
              outcome: 'accepted',
              checks: [],
              warnings: ['Migrated legacy source'],
            },
            origin: 'legacy',
            intakeReportArtifactId: null,
            createdAt: '2026-07-20T00:00:00.000Z',
            status: 'ready',
            detail: 'Migrated source',
          },
        ],
        intakeGate: {
          ready: false,
          blueprintReady: true,
          activeSourceCount: 1,
          changeDetection: [
            {
              sourceVersionId: 'source-version-1',
              filename: 'blueprint.md',
              operationId: null,
              status: 'not_started',
              error: null,
              retryable: true,
            },
          ],
          recoveries: [],
          blockingReasons: ['OP-01 chưa hoàn tất.'],
        },
      })
    );
    const intake = lifecycle[0];
    const sourceIntake = intake?.activities[0];
    const changeDetection = intake?.activities[1];

    expect(sourceIntake).toMatchObject({
      id: 'OP-00',
      status: 'completed',
      legacy: true,
    });
    expect(sourceIntake?.statusDetail).toContain('Anvil cũ');
    expect(changeDetection).toMatchObject({ id: 'OP-01', status: 'ready' });
  });

  test('routes a data_required readiness result to Dataset intake with its blocker reason', () => {
    const lifecycle = buildLifecycleView(
      projectFixture({
        readinessEvaluation: {
          status: 'data_required',
          blockerReasons: [
            'Cần liên kết và kiểm tra Dataset thật trước công việc phụ thuộc dữ liệu.',
          ],
          nextAction: 'link_dataset',
          checks: [
            {
              id: 'dataset_profile',
              label: 'Dataset Profile',
              status: 'failed',
              message: 'Cần liên kết Dataset thật.',
            },
          ],
        },
      })
    );
    const readiness = lifecycle
      .flatMap(phase => phase.activities)
      .find(activity => activity.id === 'TW-03');

    expect(readiness).toMatchObject({
      status: 'blocked',
      route: 'sources',
      statusDetail: 'Cần liên kết và kiểm tra Dataset thật trước công việc phụ thuộc dữ liệu.',
    });
  });

  test('selects pending decisions and missing data ahead of the next incomplete activity', () => {
    const decision = projectFixture({
      intakeGate: {
        ready: true,
        blueprintReady: true,
        activeSourceCount: 1,
        changeDetection: [],
        recoveries: [],
        blockingReasons: [],
      },
      decisions: [
        {
          id: 'decision-1',
          title: 'Target',
          question: 'Choose target',
          why: '',
          recommendation: '',
          options: ['a', 'b'],
          binding: null,
          affectedPhases: [],
          status: 'pending',
          answer: null,
        },
      ],
    });
    expect(selectSuggestedLifecycleActivity(decision)).toEqual({
      activityId: 'TW-03',
      reason: 'pending_decision',
    });
    expect(
      selectSuggestedLifecycleActivity(
        projectFixture({
          readinessEvaluation: {
            status: 'data_required',
            blockerReasons: ['Dataset required'],
            nextAction: 'link_dataset',
            checks: [
              { id: 'dataset_profile', label: 'Dataset', status: 'failed', message: 'Required' },
            ],
          },
        })
      )
    ).toEqual({ activityId: 'TW-03', reason: 'missing_data' });
  });

  test('unknown and active operations take precedence without changing their state', () => {
    const unknown = projectFixture({
      operation: { id: 'op-1', type: 'execute', status: 'unknown', error: null },
      execution: { id: 'execution-1', workflowRunId: 'run-1', status: 'running', error: null },
    });
    expect(selectSuggestedLifecycleActivity(unknown)).toEqual({
      activityId: 'TW-06',
      reason: 'unknown_operation',
    });
    expect(unknown.operation?.status).toBe('unknown');
    expect(
      selectSuggestedLifecycleActivity(
        projectFixture({
          operation: { id: 'op-unknown-analyze', type: 'analyze', status: 'unknown', error: null },
        })
      )
    ).toEqual({ activityId: 'TW-02', reason: 'unknown_operation' });
    expect(
      selectSuggestedLifecycleActivity(
        projectFixture({
          operation: { id: 'op-2', type: 'verify', status: 'running', error: null },
        })
      )
    ).toEqual({ activityId: 'TW-07', reason: 'active_operation' });
  });

  test('selects stale blockers, approval, and current comparison results deterministically', () => {
    const staleProject = projectFixture({
      phases: projectFixture().phases.map(item =>
        item.id === 'understanding' ? { ...item, status: 'stale' as const } : item
      ),
      intakeGate: {
        ready: true,
        blueprintReady: true,
        activeSourceCount: 1,
        changeDetection: [],
        recoveries: [],
        blockingReasons: [],
      },
    });
    expect(selectSuggestedLifecycleActivity(staleProject)).toEqual({
      activityId: 'TW-02',
      reason: 'blocker',
    });
    expect(
      selectSuggestedLifecycleActivity(
        projectFixture({
          planCompiled: true,
        })
      )
    ).toEqual({ activityId: 'OP-05', reason: 'approval' });
    const verifiedComparison = projectFixture({
      phases: projectFixture().phases.map(item =>
        item.id === 'understanding' ? { ...item, status: 'completed' as const } : item
      ),
      verification: {
        id: 'verification-1',
        workflowRunId: 'run-1',
        status: 'completed',
        error: null,
        modelReports: [
          {
            runId: 'run-1',
            model: 'router9/model-a',
            inputHash: 'input',
            promptHash: 'prompt',
            codeHash: null,
            outputHash: null,
            harnessHash: 'harness',
            status: 'completed',
            error: null,
            usage: { status: 'unknown' },
            checks: [],
          },
        ],
      },
      deliveryReady: true,
    });
    expect(selectSuggestedLifecycleActivity(verifiedComparison)).toEqual({
      activityId: 'TW-07',
      reason: 'verification_results',
    });
    expect(
      buildLifecycleView(verifiedComparison)
        .flatMap(item => item.activities)
        .find(item => item.id === 'TW-06')?.route
    ).toBe('flow');
  });

  test('an experiment build waits at TW-06 for the run choice instead of verification', () => {
    const build = {
      executionId: '00000000-0000-4000-8000-000000000006',
      approvalId: '00000000-0000-4000-8000-000000000005',
      builtAt: '2026-10-27T00:00:00.000Z',
      variantIds: ['logistic_regression'],
      review: { verdict: 'pass' as const, summary: 'OK', findings: [] },
      split: {
        rows: 100,
        trainRows: 80,
        testRows: 20,
        trainPositiveRate: 0.2,
        testPositiveRate: 0.2,
        warnings: [],
      },
      builderModel: 'router9/a',
      reviewerModel: 'router9/b',
      hostSlots: 1,
      latestRunExecutionId: null,
      tuningClosed: false,
    };
    const project = projectFixture({
      planCompiled: true,
      manifestApproved: true,
      execution: {
        id: build.executionId,
        workflowRunId: 'run-6',
        status: 'completed',
        error: null,
      },
      experimentBuild: build,
    });
    const activities = buildLifecycleView(project).flatMap(item => item.activities);
    expect(activities.find(item => item.id === 'TW-06')?.status).toBe('ready');
    expect(activities.find(item => item.id === 'TW-06')?.awaitingUser).toBe(true);
    expect(activities.find(item => item.id === 'TW-07')?.status).toBe('waiting');
    expect(selectSuggestedLifecycleActivity(project)).toEqual({
      activityId: 'TW-06',
      reason: 'next_activity',
    });
  });

  test('selects failed readiness as a blocker without presenting it as complete', () => {
    const failed = projectFixture({
      readinessEvaluation: {
        status: 'blocked',
        blockerReasons: ['Runtime chưa sẵn sàng'],
        nextAction: 'configure_runtime',
        checks: [{ id: 'runtime', label: 'Runtime', status: 'failed', message: 'Unavailable' }],
      },
    });
    expect(selectSuggestedLifecycleActivity(failed)).toEqual({
      activityId: 'TW-03',
      reason: 'blocker',
    });
    expect(
      buildLifecycleView(failed)
        .flatMap(item => item.activities)
        .find(item => item.id === 'TW-03')?.status
    ).toBe('blocked');
  });

  test('routes stale project inputs to change detection instead of current results', () => {
    const stale = projectFixture({
      freshness: 'partially_stale',
      verification: {
        id: 'verification-1',
        workflowRunId: 'run-1',
        status: 'completed',
        error: null,
        modelReports: [
          {
            runId: 'run-1',
            model: 'router9/model-a',
            inputHash: 'input',
            promptHash: 'prompt',
            codeHash: null,
            outputHash: null,
            harnessHash: 'harness',
            status: 'completed',
            error: null,
            usage: { status: 'unknown' },
            checks: [],
          },
        ],
      },
    });
    expect(selectSuggestedLifecycleActivity(stale)).toEqual({
      activityId: 'OP-01',
      reason: 'blocker',
    });
  });

  test('does not present a candidate awaiting review as not started', () => {
    const project = projectFixture({ stage: 'understanding' });
    const understanding = buildLifecycleView(project).find(phase => phase.id === 'understanding');
    expect(understanding?.activities[0]?.status).toBe('active');
    expect(understanding?.activities[0]?.statusDetail).toContain('chấp nhận');
    // Nothing runs while the draft waits for the user, so it must not read as running.
    expect(understanding?.activities[0]?.awaitingUser).toBe(true);
    expect(understanding?.awaitingUser).toBe(true);
  });

  test('summarises a stopped build in one line: a question or the first error line', () => {
    const detail = (error: string): string | undefined =>
      buildLifecycleView(
        projectFixture({
          manifestApproved: true,
          execution: { id: 'execution-1', workflowRunId: 'run-1', status: 'failed', error },
        })
      )
        .find(phase => phase.id === 'build')
        ?.activities.find(activity => activity.id === 'TW-06')?.statusDetail;
    expect(detail('Cần bạn quyết định trước khi tiếp tục (bước review): FR-03 …')).toBe(
      'Agent dừng lại hỏi bạn về một điểm trong blueprint.'
    );
    expect(detail('Agent đã dùng hết số vòng sửa.\nTraceback …')).toBe(
      'Agent đã dùng hết số vòng sửa.'
    );
  });

  test('a re-analysis puts the understanding first and later steps back to waiting', () => {
    // A new blueprint version was analysed: the old snapshot, plan and failed build still exist.
    const project = projectFixture({
      stage: 'understanding',
      intakeGate: {
        ready: true,
        blueprintReady: true,
        activeSourceCount: 2,
        changeDetection: [],
        recoveries: [],
        blockingReasons: [],
      },
      planCompiled: true,
      manifestApproved: true,
      execution: { id: 'execution-1', workflowRunId: 'run-1', status: 'failed', error: 'boom' },
    });
    const lifecycle = buildLifecycleView(project);
    const activities = lifecycle.flatMap(phase => phase.activities);
    expect(activities.find(item => item.id === 'TW-02')?.awaitingUser).toBe(true);
    for (const id of ['OP-05', 'TW-06', 'TW-07', 'TW-09'])
      expect(activities.find(item => item.id === id)?.status).toBe('waiting');
    expect(selectSuggestedLifecycleActivity(project, lifecycle).activityId).toBe('TW-02');
  });

  test('a running analysis is not awaiting the user', () => {
    const project = projectFixture({
      stage: 'understanding',
      operation: { id: 'op', type: 'analyze', status: 'running' } as System3Project['operation'],
    });
    const understanding = buildLifecycleView(project).find(phase => phase.id === 'understanding');
    expect(understanding?.activities[0]?.awaitingUser).toBe(false);
    expect(understanding?.awaitingUser).toBe(false);
  });
});
