import { describe, expect, test } from 'bun:test';
import { buildLifecycleView } from './lifecycle-view';
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
});
