import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const blueprintPath = fileURLToPath(
  new URL('../../../docs/system_2/DESIGN_B_2.md', import.meta.url)
);
const liveComparisonBlueprint = `# Synthetic CSV row count

## 1. PROBLEM PROFILE

**Business Goal:** Count every data row in the supplied CSV.

**Technical Objective:** Return one JSON object with the integer field rows.

### Data Profile

target: target

\`\`\`json
{"target_definition":"The target column is an existing synthetic label; count all rows regardless of its value."}
\`\`\`

### Constraints

- CPU-only, RAM 1GB, Python standard library only.

## 2. REQUIREMENTS CONTRACT

| ID | Type | Priority | Source | Requirement | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| FR-01 | FR | HIGH | synthetic fixture | Count all data rows in the input CSV. | The JSON field rows equals the number of CSV data rows, excluding the header. |

## 3. HIGH-LEVEL PIPELINE

Read CSV and count its data rows. FR-01.

## 4. SELECTED TECHNOLOGY STACK

Python standard library csv and json. FR-01.

## 5. MODULAR DESIGN PACKAGE

### DM-01 — Row count

Read every CSV row and return the count. FR-01.

## 6. EXECUTION BLUEPRINT

#### File: \`solution.py\`

Read /work/input.csv and emit one JSON object with the rows count. FR-01.
`;
const liveComparisonHarness =
  'import csv, json\n' +
  'rows = list(csv.DictReader(open("/work/input.csv", newline="")))\n' +
  'out = json.load(open("/work/candidate-output.json"))\n' +
  'print(json.dumps({"checks": [{"requirementId": "FR-01", "passed": out.get("rows") == len(rows), "detail": "Row count matches"}]}))\n';

async function enableLegacyProjectMode(page: Page): Promise<void> {
  const advanced = page.getByText('Cấu hình bộ kiểm tra và nâng cao', { exact: true });
  if (!(await advanced.evaluate(element => element.parentElement?.hasAttribute('open') ?? false)))
    await advanced.click();
  await page.getByLabel('Tạo dự án tham chiếu cũ (không so sánh nhiều LLM)').check();
}

async function openSecondaryRoute(page: Page, name: string): Promise<void> {
  // Each project route remounts the navigation, so the secondary menu can start closed.
  const menu = page.getByText('Chi tiết khác', { exact: true });
  if (!(await menu.evaluate(element => element.parentElement?.hasAttribute('open') ?? false)))
    await menu.click();
  await page.getByRole('link', { name, exact: true }).click();
}

async function expandLifecycleDetails(page: Page): Promise<void> {
  const summary = page.getByText('Chi tiết vòng đời · 6 giai đoạn, 10 hoạt động', { exact: true });
  if (!(await summary.evaluate(element => element.parentElement?.hasAttribute('open') ?? false)))
    await summary.click();
}

async function openComparisonConfig(page: Page): Promise<void> {
  const summary = page.getByText('Cấu hình bộ kiểm tra và nâng cao', { exact: true });
  if (!(await summary.evaluate(element => element.parentElement?.hasAttribute('open') ?? false)))
    await summary.click();
}

test('creates a real Customer Churn project and exposes the understanding workflow', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const projectName = `Customer Churn E2E ${Date.now().toString()}`;
  await page.goto('/console/projects');
  await expect(page.getByRole('heading', { name: 'Dự án của bạn' })).toBeVisible();
  await expect(page.locator('main#main-content')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

  await page.getByRole('link', { name: 'Tạo dự án' }).click();
  await expect(page.getByRole('heading', { name: 'Tạo dự án', level: 1 })).toBeVisible();
  await enableLegacyProjectMode(page);
  await page.getByLabel('Tên dự án').fill(projectName);
  const blueprint = await readFile(blueprintPath, 'utf8');
  await page.getByLabel('Blueprint Markdown').setInputFiles({
    name: 'DESIGN_B_2.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(blueprint),
  });
  await page.getByLabel('Dataset CSV').setInputFiles({
    name: 'customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('customer_id,target\n1,yes\n2,no\n3,yes\n4,yes\n'),
  });
  await expect(page.getByLabel('Blueprint Markdown')).not.toHaveValue('');
  await expect(page.getByLabel('Dataset CSV')).not.toHaveValue('');

  await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({
    timeout: 30_000,
  });
  await expandLifecycleDetails(page);
  await expect(
    page.getByRole('navigation', { name: '6 giai đoạn và 10 hoạt động vòng đời dự án' })
  ).toBeVisible({ timeout: 30_000 });
  const phaseNavigation = page.getByRole('navigation', {
    name: '6 giai đoạn và 10 hoạt động vòng đời dự án',
  });
  await expect(phaseNavigation.locator('.s3-lifecycle-rail-phase')).toHaveCount(6);
  await expect(phaseNavigation.getByRole('button')).toHaveCount(10);
  expect(
    await phaseNavigation.locator('.s3-lifecycle-rail-activities button > span').allTextContents()
  ).toEqual([
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
  await page.getByText('Lịch sử và kỹ thuật', { exact: true }).click();
  await page.getByText('Lịch sử và chạy lại', { exact: true }).click();
  const rerunAllButton = page.getByRole('button', { name: 'Chạy lại toàn bộ' });
  await rerunAllButton.click();
  const attemptDialog = page.getByRole('dialog', { name: 'Xem trước trước khi chạy lại' });
  await expect(attemptDialog).toBeVisible();
  await expect(
    attemptDialog.getByRole('button', { name: 'Dùng Source Version hiện hành' })
  ).toHaveClass(/selected/);
  await expect(attemptDialog.getByText(/Branch dự kiến:/)).toBeVisible();
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-lifecycle-attempt-desktop.png', fullPage: true });
  }
  await page.keyboard.press('Escape');
  await expect(attemptDialog).toBeHidden();
  await expect(rerunAllButton).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(phaseNavigation).toBeVisible();
  const compactRailSize = await phaseNavigation.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(compactRailSize.scrollWidth).toBeGreaterThan(compactRailSize.clientWidth);
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-lifecycle-attempt-compact.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedAnimationSeconds = await page.locator('.s3-activity-workspace').evaluate(element => {
    return Number.parseFloat(window.getComputedStyle(element).animationDuration);
  });
  expect(reducedAnimationSeconds).toBeLessThanOrEqual(0.001);
  await phaseNavigation.getByRole('button', { name: /TW-02.*Hiểu dự án/ }).click();
  await expect(page.getByText('Trạng thái Bản hiểu dự án', { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  const understandingPanel = page.locator('.s3-understanding-panel');
  await expect(
    understandingPanel.getByRole('heading', { name: /Cần xác nhận \(\d+\)/ })
  ).toBeVisible();
  await expect(
    understandingPanel
      .locator('.s3-understanding-decision-copy > strong')
      .filter({ hasText: 'Người dùng yêu cầu model interpretability' })
  ).toBeVisible();
  const firstDecisionOriginal = understandingPanel
    .locator('.s3-understanding-decision-details code')
    .first();
  await expect(firstDecisionOriginal).toBeHidden();
  await understandingPanel
    .getByText('Xem lý do và nội dung nguồn', { exact: true })
    .first()
    .click();
  await expect(firstDecisionOriginal).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận quyết định' }).first()).toBeVisible();
  await expect(page.getByLabel('Cột mục tiêu')).toBeVisible();
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-decisions-desktop.png', fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const compactDecisionLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(compactDecisionLayout.documentWidth).toBeLessThanOrEqual(
    compactDecisionLayout.viewportWidth
  );
  await expect(page.getByLabel('Cột mục tiêu')).toBeVisible();
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-decisions-compact.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const understandingUrl = page.url();
  const overviewReport = page.getByRole('button', { name: /Tổng quan dự án/ }).first();
  await overviewReport.click();
  const understandingReportDialog = page.getByRole('dialog');
  await expect(
    understandingReportDialog.getByRole('heading', { name: 'Tổng quan dự án', level: 2 })
  ).toBeVisible();
  expect(page.url()).toBe(understandingUrl);
  await expect(understandingReportDialog.locator('pre')).toHaveCount(0);
  await understandingReportDialog.getByText('Thông tin kỹ thuật', { exact: true }).click();
  await expect(understandingReportDialog.locator('pre')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(understandingReportDialog).toBeHidden();
  await expect(overviewReport).toBeFocused();
  const requirementsReport = page.getByRole('button', { name: /Danh sách yêu cầu/ }).first();
  await requirementsReport.click();
  const citationDialog = page.getByRole('dialog');
  const citationToggle = citationDialog.locator('.s3-source-citation summary').first();
  await expect(citationToggle).toBeVisible();
  await citationToggle.focus();
  await page.keyboard.press('Enter');
  await expect(citationDialog.locator('.s3-source-citation-excerpt').first()).toBeVisible();
  await expect(citationDialog.locator('.s3-source-citation-excerpt').first()).toContainText(
    'FR-01'
  );
  await expect(citationDialog.getByText('Đã đối chiếu với nguồn đã ghim').first()).toBeVisible();
  expect(page.url()).toBe(understandingUrl);
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-md-citation-desktop.png', fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(citationDialog.locator('.s3-source-citation-excerpt').first()).toBeVisible();
  expect((await citationDialog.boundingBox())?.width ?? 0).toBeLessThanOrEqual(390);
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-md-citation-compact.png', fullPage: true });
  }
  await page.keyboard.press('Escape');
  await expect(citationDialog).toBeHidden();
  await expect(requirementsReport).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByText('Node và lần chạy kỹ thuật').click();
  await expect(page.getByRole('tab', { name: 'Cách workflow hoạt động' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByText('system3-understand-project', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Xác minh đầu vào đã cố định' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Phân tích và tạo Bản hiểu dự án/ })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/').at(-2);
  expect(projectId).toBeTruthy();
  await page.evaluate(async id => {
    const waitOperation = async (operationId: string): Promise<void> => {
      for (;;) {
        const response = await fetch(`/api/system3/operations/${operationId}`);
        const operation = (await response.json()) as { status: string; error: string | null };
        if (operation.status === 'succeeded') return;
        if (['failed', 'abandoned', 'unknown'].includes(operation.status)) {
          throw new Error(operation.error ?? `Operation ended as ${operation.status}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    let flow = (await fetch(`/api/system3/projects/${id}/flow`).then(response =>
      response.json()
    )) as {
      project: { version: number };
      readiness: { id: string } | null;
      compilation: { id: string } | null;
      decisions: { id: string; options: string[]; status: string }[];
    };
    let understanding = (await fetch(`/api/system3/projects/${id}/phases/understanding/view`).then(
      response => response.json()
    )) as {
      candidateSnapshot: {
        id: string;
        analysis: {
          dataset: {
            targetColumn: string | null;
            targetDistribution: Record<string, number>;
          } | null;
        };
      } | null;
      canActivate: boolean;
      inputSnapshot: {
        sourceRefs: { sourceVersionId: string; kind: string }[];
      } | null;
      decisions: {
        id: string;
        options: string[];
        status: string;
        answer: string | null;
        binding: { kind: string; allowedValues: string[] } | null;
      }[];
    };
    if (!understanding.candidateSnapshot || !understanding.inputSnapshot) {
      throw new Error('Expected a candidate Understanding Snapshot with pinned inputs');
    }
    const immutableCandidate = understanding.candidateSnapshot;
    if (
      immutableCandidate.analysis.dataset?.targetColumn !== null ||
      Object.keys(immutableCandidate.analysis.dataset?.targetDistribution ?? {}).length !== 0
    ) {
      throw new Error('Undeclared Dataset target must remain unprofiled in the candidate snapshot');
    }
    const pinnedDataset = understanding.inputSnapshot.sourceRefs.find(
      source => source.kind === 'dataset'
    );
    if (!pinnedDataset)
      throw new Error('Candidate Understanding Snapshot is missing a pinned Dataset');
    const targetDecision = understanding.decisions.find(
      decision => decision.binding?.kind === 'dataset_target_column'
    );
    if (!targetDecision || !targetDecision.binding.allowedValues.includes('target')) {
      throw new Error(
        'Expected an explicit Dataset target-column decision with target as an option'
      );
    }
    for (const decision of understanding.decisions.filter(value => value.status === 'pending')) {
      flow = (await fetch(`/api/system3/projects/${id}/decisions/${decision.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: decision.id === targetDecision.id ? 'target' : decision.options[0],
          expectedVersion: flow.project.version,
        }),
      }).then(response => response.json())) as typeof flow;
    }
    understanding = (await fetch(`/api/system3/projects/${id}/phases/understanding/view`).then(
      response => response.json()
    )) as typeof understanding;
    if (!understanding.candidateSnapshot || !understanding.canActivate) {
      throw new Error('Bản hiểu dự án nháp chưa đủ điều kiện kích hoạt');
    }
    const answeredTargetDecision = understanding.decisions.find(
      decision => decision.id === targetDecision.id
    );
    if (answeredTargetDecision?.answer !== 'target') {
      throw new Error(
        'Dataset target-column decision did not retain the explicit target selection'
      );
    }
    const activation = await fetch(
      `/api/system3/projects/${id}/knowledge-snapshots/${understanding.candidateSnapshot.id}/activate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `e2e-activate-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expectedVersion: flow.project.version }),
      }
    );
    if (!activation.ok) throw new Error(await activation.text());
    const activatedSnapshot = (await activation.json()) as {
      id: string;
      analysis: {
        dataset: {
          targetColumn: string | null;
          targetDistribution: Record<string, number>;
        } | null;
      };
    };
    if (activatedSnapshot.id !== immutableCandidate.id) {
      throw new Error('Activated a different Knowledge Snapshot than the reviewed candidate');
    }
    if (
      activatedSnapshot.analysis.dataset?.targetColumn !== null ||
      Object.keys(activatedSnapshot.analysis.dataset?.targetDistribution ?? {}).length !== 0
    ) {
      throw new Error('Activating a target decision mutated the immutable Knowledge Snapshot');
    }
    const readinessDeadline = Date.now() + 30_000;
    for (;;) {
      const response = await fetch(`/api/system3/projects/${id}/flow`);
      if (!response.ok) throw new Error(await response.text());
      flow = (await response.json()) as typeof flow;
      if (flow.readiness !== null && flow.compilation !== null) break;
      if (Date.now() >= readinessDeadline) {
        throw new Error('Activation did not automatically complete Readiness and Compile');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const readinessContractResponse = await fetch(
      `/api/system3/projects/${id}/readiness-contracts/latest`
    );
    if (!readinessContractResponse.ok) throw new Error(await readinessContractResponse.text());
    const readinessContract = (await readinessContractResponse.json()) as {
      knowledgeSnapshotId: string;
      contract: { targetColumn: string; datasetSourceVersionId: string };
    } | null;
    if (
      readinessContract?.knowledgeSnapshotId !== immutableCandidate.id ||
      readinessContract.contract.targetColumn !== 'target' ||
      readinessContract.contract.datasetSourceVersionId !== pinnedDataset.sourceVersionId
    ) {
      throw new Error(
        'Readiness did not use the selected target and pinned Dataset Source Version'
      );
    }
    const persistedSnapshotResponse = await fetch(
      `/api/system3/projects/${id}/knowledge-snapshots/${immutableCandidate.id}`
    );
    if (!persistedSnapshotResponse.ok) throw new Error(await persistedSnapshotResponse.text());
    const persistedSnapshot = (await persistedSnapshotResponse.json()) as typeof activatedSnapshot;
    if (
      persistedSnapshot.analysis.dataset?.targetColumn !== null ||
      Object.keys(persistedSnapshot.analysis.dataset?.targetDistribution ?? {}).length !== 0
    ) {
      throw new Error('Readiness resolution mutated the persisted Knowledge Snapshot');
    }
  }, projectId);
  await page.reload();
  await openSecondaryRoute(page, 'Quyết định & Phê duyệt');
  await expect(
    page.getByRole('heading', { name: 'Đóng các lựa chọn trước khi thực thi' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Xem và phê duyệt kế hoạch' }).click();
  await expect(page.getByRole('heading', { name: 'Xem kế hoạch trước khi chạy' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Đóng' })).toBeFocused();
  await expect(page.getByText('Không tái sử dụng artifact', { exact: true })).toBeVisible();
  const executionPath = `/api/system3/projects/${projectId}/executions`;
  const isExecutionRequest = (request: import('@playwright/test').Request): boolean =>
    request.method() === 'POST' && new URL(request.url()).pathname === executionPath;
  const executionRequestPromise = page.waitForRequest(isExecutionRequest);
  const executionResponsePromise = page.waitForResponse(response =>
    isExecutionRequest(response.request())
  );
  await page.getByRole('button', { name: 'Phê duyệt và chạy' }).click();
  const [executionRequest, executionResponse] = await Promise.all([
    executionRequestPromise,
    executionResponsePromise,
  ]);
  expect(executionResponse.status()).toBe(202);
  const executionRequestBody = executionRequest.postDataJSON() as {
    compilationId: string;
    expectedVersion: number;
  };
  const executionIdempotencyKey = executionRequest.headers()['idempotency-key'];
  expect(executionIdempotencyKey).toBeTruthy();
  expect(executionRequestBody.compilationId).toBeTruthy();
  expect(Number.isSafeInteger(executionRequestBody.expectedVersion)).toBe(true);
  const initialExecutionResponse = (await executionResponse.json()) as {
    operation: { id: string };
    execution: { id: string };
  };
  const deliveryWorkspaceLink = page.getByRole('link', { name: 'Mở khu vực bàn giao' });
  await expect(deliveryWorkspaceLink).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/system3/projects/${projectId}/flow`);
        if (!response.ok()) return null;
        const flow = (await response.json()) as {
          verification: { status: string } | null;
        };
        return flow.verification?.status ?? null;
      },
      { timeout: 30_000 }
    )
    .toBe('completed');
  const historyBeforeReplayResponse = await page.request.get(
    `/api/system3/projects/${projectId}/history`
  );
  expect(historyBeforeReplayResponse.ok()).toBe(true);
  const historyBeforeReplay = (await historyBeforeReplayResponse.json()) as {
    approvals: unknown[];
    executions: unknown[];
  };
  const replayResponse = await page.request.post(`${new URL(page.url()).origin}${executionPath}`, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': executionIdempotencyKey,
    },
    data: executionRequestBody,
  });
  expect(replayResponse.status()).toBe(202);
  const replayBody = (await replayResponse.json()) as {
    operation: { id: string };
    execution: { id: string };
  };
  expect(replayBody.operation.id).toBe(initialExecutionResponse.operation.id);
  expect(replayBody.execution.id).toBe(initialExecutionResponse.execution.id);
  const mismatchedReplayResponse = await page.request.post(
    `${new URL(page.url()).origin}${executionPath}`,
    {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': executionIdempotencyKey,
      },
      data: { ...executionRequestBody, compilationId: crypto.randomUUID() },
    }
  );
  expect(mismatchedReplayResponse.status()).toBe(409);
  const historyAfterReplayResponse = await page.request.get(
    `/api/system3/projects/${projectId}/history`
  );
  expect(historyAfterReplayResponse.ok()).toBe(true);
  const historyAfterReplay = (await historyAfterReplayResponse.json()) as {
    approvals: unknown[];
    executions: unknown[];
  };
  expect(historyAfterReplay.approvals).toHaveLength(historyBeforeReplay.approvals.length);
  expect(historyAfterReplay.executions).toHaveLength(historyBeforeReplay.executions.length);
  await deliveryWorkspaceLink.click();
  await expect(page.getByRole('heading', { name: 'Kiểm tra và tạo gói bàn giao' })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận và tạo gói bàn giao' }).click();
  await expect(page.getByRole('link', { name: 'Tải gói bàn giao' })).toBeVisible({
    timeout: 60_000,
  });

  const historyResponse = await page.request.get(`/api/system3/projects/${projectId}/history`);
  expect(historyResponse.ok()).toBe(true);
  const history = (await historyResponse.json()) as {
    workflowVersions: unknown[];
    compilations: unknown[];
    approvals: unknown[];
    executions: unknown[];
    verifications: unknown[];
    deliveries: unknown[];
    artifacts: unknown[];
  };
  expect(history.workflowVersions).toHaveLength(1);
  expect(history.compilations).toHaveLength(1);
  expect(history.approvals).toHaveLength(1);
  expect(history.executions).toHaveLength(1);
  expect(history.verifications).toHaveLength(1);
  expect(history.deliveries).toHaveLength(1);
  expect(history.artifacts.length).toBeGreaterThanOrEqual(2);

  const canonicalActivityIds = [
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
  ];
  for (const activityId of canonicalActivityIds) {
    const activityResponse = await page.request.get(
      `/api/system3/projects/${projectId}/activities/${activityId}`
    );
    expect(activityResponse.ok()).toBe(true);
    const activity = (await activityResponse.json()) as {
      activityId: string;
      inputs: unknown[];
      outputs: unknown[];
      evidence: unknown[];
    };
    expect(activity.activityId).toBe(activityId);
    expect(Array.isArray(activity.inputs)).toBe(true);
    expect(Array.isArray(activity.outputs)).toBe(true);
    expect(Array.isArray(activity.evidence)).toBe(true);
  }

  await expect(page.getByRole('heading', { name: 'Gói sản phẩm' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Tải gói bàn giao' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('generated_project.tar.gz');

  await openSecondaryRoute(page, 'Tổng quan');
  await expect(page.getByText('Việc nên làm tiếp theo', { exact: true })).toBeVisible();
  await openSecondaryRoute(page, 'Quyết định & Phê duyệt');
  await expect(
    page.getByRole('heading', { name: 'Đóng các lựa chọn trước khi thực thi' })
  ).toBeVisible();
  await openSecondaryRoute(page, 'Kết quả & Bằng chứng');
  await expect(page.getByRole('heading', { name: 'Đối soát toàn bộ project' })).toBeVisible();
  await openSecondaryRoute(page, 'Bàn giao');
  await expect(page.getByRole('heading', { name: 'Kiểm tra và tạo gói bàn giao' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await openSecondaryRoute(page, 'Tổng quan');
  await expect(page.getByText('Việc nên làm tiếp theo', { exact: true })).toBeVisible();
  const mainHasHorizontalOverflow = await page.locator('main#main-content').evaluate(element => {
    return element.scrollWidth > element.clientWidth + 1;
  });
  expect(mainHasHorizontalOverflow).toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('link', { name: 'Workspace dự án', exact: true }).click();
  await expandLifecycleDetails(page);
  const lifecycleUrl = page.url();
  await phaseNavigation.getByRole('button', { name: /OP-00.*Tiếp nhận nguồn đầu vào/ }).click();
  const sourceResourceButton = page.getByRole('button', { name: /DESIGN_B_2\.md/ }).first();
  await sourceResourceButton.click();
  const resourceDialog = page.getByRole('dialog');
  await expect(resourceDialog.getByRole('heading', { name: 'DESIGN_B_2.md' })).toBeVisible();
  expect(page.url()).toBe(lifecycleUrl);
  await expect(resourceDialog.locator('pre')).toHaveCount(0);
  await resourceDialog.getByText('Thông tin kỹ thuật', { exact: true }).click();
  await expect(resourceDialog.locator('pre')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(resourceDialog).toBeHidden();
  await expect(sourceResourceButton).toBeFocused();
  await phaseNavigation.getByRole('button', { name: /TW-03.*Kiểm tra mức độ sẵn sàng/ }).click();
  await page.getByText('Node và lần chạy kỹ thuật').click();
  await expect(page.getByText('Freeze readiness contract', { exact: true })).toBeVisible();

  const scopedResult = await page.evaluate(async id => {
    type Flow = {
      project: { version: number };
      decisions: { id: string; options: string[]; status: string }[];
      readiness: unknown | null;
      compilation: { id: string } | null;
      approval: { id: string } | null;
      verification: { id: string; status: string } | null;
    };
    const loadFlow = async (): Promise<Flow> => {
      const response = await fetch(`/api/system3/projects/${id}/flow`);
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<Flow>;
    };
    const waitOperation = async (operationId: string): Promise<Record<string, unknown>> => {
      for (;;) {
        const response = await fetch(`/api/system3/operations/${operationId}`);
        if (!response.ok) throw new Error(await response.text());
        const operation = (await response.json()) as {
          status: string;
          error: string | null;
          result: Record<string, unknown> | null;
        };
        if (operation.status === 'succeeded') return operation.result ?? {};
        if (['failed', 'abandoned', 'unknown'].includes(operation.status)) {
          throw new Error(operation.error ?? `Operation ended as ${operation.status}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    const uploadConstraint = async (
      version: number,
      expectedVersion: number,
      sourceId?: string
    ): Promise<string> => {
      const form = new FormData();
      form.set('kind', 'constraints');
      form.set('role', 'primary');
      if (sourceId) form.set('sourceId', sourceId);
      form.set('expectedVersion', expectedVersion.toString());
      form.set(
        'file',
        new File(
          [JSON.stringify({ delivery: { packageFormat: 'tar.gz', policyVersion: version } })],
          'delivery-policy.json',
          { type: 'application/json' }
        )
      );
      const response = await fetch(`/api/system3/projects/${id}/sources`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `e2e-constraint-${version.toString()}` },
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      return ((await response.json()) as { source: { id: string } }).source.id;
    };

    let flow = await loadFlow();
    const constraintSourceId = await uploadConstraint(1, flow.project.version);
    flow = await loadFlow();
    await uploadConstraint(2, flow.project.version, constraintSourceId);
    flow = await loadFlow();
    const analysisResponse = await fetch(`/api/system3/projects/${id}/knowledge-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-analyze-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!analysisResponse.ok) throw new Error(await analysisResponse.text());
    const analysisOperation = (await analysisResponse.json()) as { operation: { id: string } };
    await waitOperation(analysisOperation.operation.id);
    flow = await loadFlow();
    let understandingResponse = await fetch(
      `/api/system3/projects/${id}/phases/understanding/view`
    );
    if (!understandingResponse.ok) throw new Error(await understandingResponse.text());
    let understanding = (await understandingResponse.json()) as {
      candidateSnapshot: { id: string } | null;
      canActivate: boolean;
      decisions: { id: string; options: string[]; status: string }[];
    };
    for (const decision of understanding.decisions.filter(value => value.status === 'pending')) {
      const decisionResponse = await fetch(
        `/api/system3/projects/${id}/decisions/${decision.id}/respond`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answer: decision.options[0],
            expectedVersion: flow.project.version,
          }),
        }
      );
      if (!decisionResponse.ok) throw new Error(await decisionResponse.text());
      flow = (await decisionResponse.json()) as Flow;
    }
    understandingResponse = await fetch(`/api/system3/projects/${id}/phases/understanding/view`);
    if (!understandingResponse.ok) throw new Error(await understandingResponse.text());
    understanding = (await understandingResponse.json()) as {
      candidateSnapshot: { id: string } | null;
      canActivate: boolean;
      decisions: { id: string; options: string[]; status: string }[];
    };
    if (!understanding.candidateSnapshot || !understanding.canActivate) {
      throw new Error('Bản hiểu dự án nháp chưa đủ điều kiện kích hoạt');
    }
    const activationResponse = await fetch(
      `/api/system3/projects/${id}/knowledge-snapshots/${understanding.candidateSnapshot.id}/activate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `e2e-activate-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expectedVersion: flow.project.version }),
      }
    );
    if (!activationResponse.ok) throw new Error(await activationResponse.text());
    const automaticCompileDeadline = Date.now() + 30_000;
    for (;;) {
      flow = await loadFlow();
      if (flow.readiness !== null && flow.compilation !== null) break;
      if (Date.now() >= automaticCompileDeadline) {
        throw new Error('Activation did not automatically complete Readiness and Compile');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const latestCompilationResponse = await fetch(
      `/api/system3/projects/${id}/compilations/latest`
    );
    if (!latestCompilationResponse.ok) throw new Error(await latestCompilationResponse.text());
    const compilation = (await latestCompilationResponse.json()) as {
      id: string;
      plan: {
        rerunScope: {
          mode: string;
          executionMode: string;
          skippedPhases: string[];
          reusedArtifacts: unknown[];
        };
      };
    };
    flow = await loadFlow();
    const approvalKey = `e2e-approve-${crypto.randomUUID()}`;
    const approvalRequest = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': approvalKey,
      },
      body: JSON.stringify({
        compilationId: compilation.id,
        expectedVersion: flow.project.version,
      }),
    };
    const approvalResponse = await fetch(
      `/api/system3/projects/${id}/approval-manifests`,
      approvalRequest
    );
    if (!approvalResponse.ok) throw new Error(await approvalResponse.text());
    const approval = (await approvalResponse.json()) as { id: string };
    const duplicateApprovalResponse = await fetch(
      `/api/system3/projects/${id}/approval-manifests`,
      approvalRequest
    );
    if (!duplicateApprovalResponse.ok) throw new Error(await duplicateApprovalResponse.text());
    const duplicateApproval = (await duplicateApprovalResponse.json()) as { id: string };
    if (duplicateApproval.id !== approval.id) throw new Error('Approval retry was not idempotent');
    const conflictingApprovalResponse = await fetch(
      `/api/system3/projects/${id}/approval-manifests`,
      {
        ...approvalRequest,
        body: JSON.stringify({
          compilationId: crypto.randomUUID(),
          expectedVersion: flow.project.version,
        }),
      }
    );
    if (conflictingApprovalResponse.status !== 409) {
      throw new Error('Approval idempotency-key payload mismatch was not rejected');
    }
    flow = await loadFlow();
    const executionKey = `e2e-execute-${crypto.randomUUID()}`;
    const executionRequest = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': executionKey,
      },
      body: JSON.stringify({ approvalId: approval.id, expectedVersion: flow.project.version }),
    };
    const executionResponse = await fetch(
      `/api/system3/projects/${id}/executions`,
      executionRequest
    );
    if (!executionResponse.ok) throw new Error(await executionResponse.text());
    const executionBody = (await executionResponse.json()) as { operation: { id: string } };
    const operationId = executionBody.operation.id;
    const duplicateExecutionResponse = await fetch(
      `/api/system3/projects/${id}/executions`,
      executionRequest
    );
    if (!duplicateExecutionResponse.ok) throw new Error(await duplicateExecutionResponse.text());
    const duplicateExecution = (await duplicateExecutionResponse.json()) as {
      operation: { id: string };
    };
    if (duplicateExecution.operation.id !== operationId) {
      throw new Error('Execution retry was not idempotent');
    }
    const conflictingExecutionResponse = await fetch(`/api/system3/projects/${id}/executions`, {
      ...executionRequest,
      body: JSON.stringify({
        approvalId: crypto.randomUUID(),
        expectedVersion: flow.project.version,
      }),
    });
    if (conflictingExecutionResponse.status !== 409) {
      throw new Error('Execution idempotency-key payload mismatch was not rejected');
    }
    for (;;) {
      const operationResponse = await fetch(`/api/system3/operations/${operationId}`);
      const operation = (await operationResponse.json()) as {
        status: string;
        error: string | null;
      };
      if (operation.status === 'succeeded') break;
      if (['failed', 'abandoned', 'unknown'].includes(operation.status)) {
        throw new Error(operation.error ?? `Scoped execution ended as ${operation.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (;;) {
      flow = await loadFlow();
      if (flow.verification?.status === 'completed') break;
      if (flow.verification?.status === 'failed') {
        throw new Error('Scoped verification failed');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const verification = flow.verification;
    if (!verification) throw new Error('Scoped execution did not create verification');
    const deliveryResponse = await fetch(
      `/api/system3/projects/${id}/verifications/${verification.id}/deliveries`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `e2e-delivery-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expectedVersion: flow.project.version }),
      }
    );
    if (!deliveryResponse.ok) throw new Error(await deliveryResponse.text());
    const delivery = (await deliveryResponse.json()) as { operation: { id: string } };
    await waitOperation(delivery.operation.id);
    const history = (await fetch(`/api/system3/projects/${id}/history`).then(response =>
      response.json()
    )) as { deliveries: unknown[]; executions: unknown[] };
    return { scope: compilation.plan.rerunScope, history };
  }, projectId);

  expect(scopedResult.scope).toMatchObject({
    mode: 'scoped',
    executionMode: 'delivery',
    skippedPhases: [
      'understanding',
      'readiness',
      'data',
      'features',
      'experiments',
      'explainability',
    ],
  });
  expect(scopedResult.scope.reusedArtifacts).toHaveLength(1);
  expect(scopedResult.history.executions).toHaveLength(2);
  expect(scopedResult.history.deliveries).toHaveLength(2);

  const datasetRerun = await page.evaluate(async id => {
    type Flow = {
      project: { version: number };
      decisions: { id: string; options: string[]; status: string }[];
      readiness: { id: string } | null;
      compilation: { id: string } | null;
      approval: { id: string } | null;
      verification: { id: string; status: string } | null;
    };
    type Artifact = {
      id: string;
      artifactKind: string;
      contentHash: string;
      sourceVersionIds: string[];
    };
    const loadFlow = async (): Promise<Flow> => {
      const response = await fetch(`/api/system3/projects/${id}/flow`);
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<Flow>;
    };
    const waitOperation = async (operationId: string): Promise<void> => {
      for (;;) {
        const response = await fetch(`/api/system3/operations/${operationId}`);
        if (!response.ok) throw new Error(await response.text());
        const operation = (await response.json()) as { status: string; error: string | null };
        if (operation.status === 'succeeded') return;
        if (['failed', 'abandoned', 'unknown'].includes(operation.status)) {
          throw new Error(operation.error ?? `Operation ended as ${operation.status}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    const loadBaselineArtifacts = async (): Promise<Artifact[]> => {
      const response = await fetch(`/api/system3/projects/${id}/history`);
      if (!response.ok) throw new Error(await response.text());
      const history = (await response.json()) as { artifacts: Artifact[] };
      return history.artifacts.filter(artifact => artifact.artifactKind === 'baseline_package');
    };

    let flow = await loadFlow();
    if (!flow.approval) throw new Error('Expected an existing approval before dataset replacement');
    const oldApprovalId = flow.approval.id;
    const beforeArtifacts = await loadBaselineArtifacts();
    const oldArtifactHashes = beforeArtifacts.map(artifact => artifact.contentHash);
    const sourceResponse = await fetch(`/api/system3/projects/${id}/sources`);
    if (!sourceResponse.ok) throw new Error(await sourceResponse.text());
    const sources = (await sourceResponse.json()) as {
      sources: {
        id: string;
        sourceId: string;
        kind: string;
        role: string;
        version: number;
      }[];
    };
    const dataset = sources.sources
      .filter(source => source.kind === 'dataset' && source.role === 'primary')
      .sort((left, right) => right.version - left.version)[0];
    if (!dataset) throw new Error('Primary dataset Source Version is missing');
    const form = new FormData();
    form.set('kind', 'dataset');
    form.set('role', 'primary');
    form.set('sourceId', dataset.sourceId);
    form.set('expectedVersion', flow.project.version.toString());
    form.set(
      'file',
      new File(
        ['customer_id,target\n1,yes\n2,no\n3,yes\n4,yes\n5,no\n6,yes\n'],
        'customers-b.csv',
        { type: 'text/csv' }
      )
    );
    const upload = await fetch(`/api/system3/projects/${id}/sources`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `e2e-dataset-b-${crypto.randomUUID()}` },
      body: form,
    });
    if (!upload.ok) throw new Error(await upload.text());
    const datasetB = (await upload.json()) as { version: { id: string } };

    flow = await loadFlow();
    const staleExecution = await fetch(`/api/system3/projects/${id}/executions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-stale-execution-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ approvalId: oldApprovalId, expectedVersion: flow.project.version }),
    });
    if (staleExecution.status !== 422) {
      throw new Error(`Stale approval execution returned ${staleExecution.status.toString()}`);
    }

    const analysis = await fetch(`/api/system3/projects/${id}/knowledge-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-analyze-b-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!analysis.ok) throw new Error(await analysis.text());
    await waitOperation(((await analysis.json()) as { operation: { id: string } }).operation.id);
    flow = await loadFlow();
    let understandingResponse = await fetch(
      `/api/system3/projects/${id}/phases/understanding/view`
    );
    if (!understandingResponse.ok) throw new Error(await understandingResponse.text());
    let understanding = (await understandingResponse.json()) as {
      candidateSnapshot: { id: string } | null;
      canActivate: boolean;
      decisions: { id: string; options: string[]; status: string }[];
    };
    for (const decision of understanding.decisions.filter(value => value.status === 'pending')) {
      const response = await fetch(`/api/system3/projects/${id}/decisions/${decision.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: decision.options[0],
          expectedVersion: flow.project.version,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      flow = await loadFlow();
    }
    understandingResponse = await fetch(`/api/system3/projects/${id}/phases/understanding/view`);
    if (!understandingResponse.ok) throw new Error(await understandingResponse.text());
    understanding = (await understandingResponse.json()) as {
      candidateSnapshot: { id: string } | null;
      canActivate: boolean;
      decisions: { id: string; options: string[]; status: string }[];
    };
    if (!understanding.candidateSnapshot || !understanding.canActivate) {
      throw new Error('Dataset B understanding cannot be activated');
    }
    const activation = await fetch(
      `/api/system3/projects/${id}/knowledge-snapshots/${understanding.candidateSnapshot.id}/activate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `e2e-activate-b-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expectedVersion: flow.project.version }),
      }
    );
    if (!activation.ok) throw new Error(await activation.text());
    const automaticCompileDeadline = Date.now() + 30_000;
    for (;;) {
      flow = await loadFlow();
      if (flow.readiness !== null && flow.compilation !== null) break;
      if (Date.now() >= automaticCompileDeadline) {
        throw new Error('Dataset activation did not automatically complete Readiness and Compile');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const compilationResponse = await fetch(`/api/system3/projects/${id}/compilations/latest`);
    if (!compilationResponse.ok) throw new Error(await compilationResponse.text());
    const compilation = (await compilationResponse.json()) as {
      id: string;
      plan: {
        rerunScope: { executionMode: string; reusedArtifacts: unknown[] };
      };
    };
    flow = await loadFlow();
    const approvalResponse = await fetch(`/api/system3/projects/${id}/approval-manifests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-approve-b-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        compilationId: compilation.id,
        expectedVersion: flow.project.version,
      }),
    });
    if (!approvalResponse.ok) throw new Error(await approvalResponse.text());
    const approval = (await approvalResponse.json()) as { id: string };
    flow = await loadFlow();
    const executionResponse = await fetch(`/api/system3/projects/${id}/executions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-execute-b-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ approvalId: approval.id, expectedVersion: flow.project.version }),
    });
    if (!executionResponse.ok) throw new Error(await executionResponse.text());
    await waitOperation(
      ((await executionResponse.json()) as { operation: { id: string } }).operation.id
    );
    for (;;) {
      flow = await loadFlow();
      if (flow.verification?.status === 'completed') break;
      if (flow.verification?.status === 'failed') throw new Error('Dataset B verification failed');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const afterArtifacts = await loadBaselineArtifacts();
    const newestArtifact = afterArtifacts.find(artifact =>
      artifact.sourceVersionIds.includes(datasetB.version.id)
    );
    return {
      staleStatus: staleExecution.status,
      executionMode: compilation.plan.rerunScope.executionMode,
      reusedArtifactCount: compilation.plan.rerunScope.reusedArtifacts.length,
      datasetSourceVersionId: datasetB.version.id,
      newestArtifact,
      oldArtifactHashes,
      afterArtifactHashes: afterArtifacts.map(artifact => artifact.contentHash),
    };
  }, projectId);

  expect(datasetRerun).toMatchObject({
    staleStatus: 422,
    executionMode: 'experiment',
    reusedArtifactCount: 1,
    newestArtifact: {
      sourceVersionIds: expect.arrayContaining([datasetRerun.datasetSourceVersionId]),
    },
  });
  for (const oldHash of datasetRerun.oldArtifactHashes) {
    expect(datasetRerun.afterArtifactHashes).toContain(oldHash);
  }
  const isolatedAttempts = await page.evaluate(async id => {
    interface Attempt {
      id: string;
      workingPath: string | null;
      branchName: string | null;
      runStatus: string;
      lifecycleStatus: string;
      basis: { sourceVersionIds: string[]; sourceHashes: string[]; baseCommitSha: string };
    }
    const attempts: Attempt[] = [];
    for (const inputMode of ['current', 'replay']) {
      const flowResponse = await fetch(`/api/system3/projects/${id}/flow`);
      const flow = (await flowResponse.json()) as { project: { version: number } };
      const request = {
        expectedVersion: flow.project.version,
        startActivityId: 'OP-00',
        scope: 'activity',
        inputMode,
        ...(attempts[0] ? { baseAttemptId: attempts[0].id } : {}),
      };
      const previewResponse = await fetch(`/api/system3/projects/${id}/attempts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!previewResponse.ok) throw new Error(await previewResponse.text());
      const preview = (await previewResponse.json()) as {
        canStart: boolean;
        blockingReasons: string[];
        previewHash: string;
      };
      if (!preview.canStart) throw new Error(preview.blockingReasons.join('; '));
      const createBody = {
        ...request,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      };
      const createdResponse = await fetch(`/api/system3/projects/${id}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      if (!createdResponse.ok) throw new Error(await createdResponse.text());
      let attempt = (await createdResponse.json()) as Attempt;
      const retry = await fetch(`/api/system3/projects/${id}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      if (!retry.ok) throw new Error(`Attempt retry failed: ${await retry.text()}`);
      if (((await retry.json()) as Attempt).id !== attempt.id)
        throw new Error('Attempt retry created another attempt');
      const mismatch = await fetch(`/api/system3/projects/${id}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createBody, scope: 'full' }),
      });
      if (mismatch.status !== 409) throw new Error('Attempt retry accepted a different payload');
      const deadline = Date.now() + 30_000;
      while (attempt.runStatus === 'preparing' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const response = await fetch(`/api/system3/projects/${id}/attempts/${attempt.id}`);
        if (!response.ok) throw new Error(await response.text());
        attempt = (await response.json()) as Attempt;
      }
      if (attempt.runStatus !== 'waiting' || !attempt.workingPath || !attempt.branchName) {
        throw new Error(`Attempt isolation not ready: ${JSON.stringify(attempt)}`);
      }
      const freshFlow = await fetch(`/api/system3/projects/${id}/flow`);
      const current = (await freshFlow.json()) as { project: { version: number } };
      const continued = await fetch(`/api/system3/projects/${id}/attempts/${attempt.id}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: current.project.version }),
      });
      if (!continued.ok) throw new Error(await continued.text());
      attempts.push((await continued.json()) as Attempt);
    }
    return attempts;
  }, projectId);
  expect(isolatedAttempts.map(attempt => attempt.runStatus)).toEqual(['completed', 'completed']);
  expect(isolatedAttempts[0]?.workingPath).not.toBe(isolatedAttempts[1]?.workingPath);
  expect(isolatedAttempts[0]?.branchName).not.toBe(isolatedAttempts[1]?.branchName);
  expect(isolatedAttempts[1]?.basis.sourceVersionIds).toEqual(
    isolatedAttempts[0]?.basis.sourceVersionIds
  );
  expect(isolatedAttempts[1]?.basis.sourceHashes).toEqual(isolatedAttempts[0]?.basis.sourceHashes);
  expect(isolatedAttempts[1]?.basis.baseCommitSha).toBe(isolatedAttempts[0]?.basis.baseCommitSha);
  for (const attempt of isolatedAttempts) {
    if (!attempt.workingPath) throw new Error('Missing isolated worktree');
    const head = await execFileAsync('git', ['-C', attempt.workingPath, 'rev-parse', 'HEAD']);
    expect(head.stdout.trim()).toBe(attempt.basis.baseCommitSha);
    const status = await execFileAsync('git', ['-C', attempt.workingPath, 'status', '--porcelain']);
    expect(status.stdout).toBe('');
  }
});

test('shows data_required as a business blocker with a Dataset next action', async ({ page }) => {
  test.setTimeout(90_000);
  const projectName = `Readiness without dataset ${Date.now().toString()}`;
  await page.goto('/console/projects/new');
  await expect(page.getByRole('heading', { name: 'Tạo dự án', level: 1 })).toBeVisible();
  await enableLegacyProjectMode(page);
  await page.getByLabel('Tên dự án').fill(projectName);
  const blueprint = await readFile(blueprintPath, 'utf8');
  await page.getByLabel('Blueprint Markdown').setInputFiles({
    name: 'DESIGN_B_2.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(blueprint),
  });
  await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 30_000 });
  // The button starts TW-02 asynchronously. Wait for its candidate before
  // requesting a second analysis with an expected project version.
  await expect(page.getByRole('button', { name: 'Xác nhận quyết định' }).first()).toBeVisible({
    timeout: 30_000,
  });
  const projectId = new URL(page.url()).pathname.split('/').at(-2);
  expect(projectId).toBeTruthy();

  await page.evaluate(async id => {
    const waitOperation = async (operationId: string): Promise<Record<string, unknown>> => {
      for (;;) {
        const response = await fetch(`/api/system3/operations/${operationId}`);
        const operation = (await response.json()) as {
          status: string;
          error: string | null;
          result: Record<string, unknown> | null;
        };
        if (operation.status === 'succeeded') return operation.result ?? {};
        if (['failed', 'abandoned', 'unknown'].includes(operation.status)) {
          throw new Error(operation.error ?? `Operation ended as ${operation.status}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    let flow = (await fetch(`/api/system3/projects/${id}/flow`).then(response =>
      response.json()
    )) as {
      project: { version: number };
      readinessEvaluation: { status: string } | null;
      readiness: { id: string } | null;
      compilation: { id: string } | null;
    };
    const analysis = await fetch(`/api/system3/projects/${id}/knowledge-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-missing-data-analyze-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!analysis.ok) throw new Error(await analysis.text());
    await waitOperation(((await analysis.json()) as { operation: { id: string } }).operation.id);
    let understanding = (await fetch(`/api/system3/projects/${id}/phases/understanding/view`).then(
      response => response.json()
    )) as {
      candidateSnapshot: { id: string } | null;
      canActivate: boolean;
      projectVersion: number;
      decisions: { id: string; options: string[]; status: string }[];
    };
    for (const decision of understanding.decisions.filter(value => value.status === 'pending')) {
      const response = await fetch(`/api/system3/projects/${id}/decisions/${decision.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: decision.options[0],
          expectedVersion: understanding.projectVersion,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      understanding = (await fetch(`/api/system3/projects/${id}/phases/understanding/view`).then(
        value => value.json()
      )) as typeof understanding;
    }
    if (!understanding.candidateSnapshot || !understanding.canActivate) {
      throw new Error('Understanding without a Dataset must remain activatable');
    }
    const activation = await fetch(
      `/api/system3/projects/${id}/knowledge-snapshots/${understanding.candidateSnapshot.id}/activate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `e2e-missing-data-activate-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expectedVersion: understanding.projectVersion }),
      }
    );
    if (!activation.ok) throw new Error(await activation.text());
    const readinessDeadline = Date.now() + 30_000;
    for (;;) {
      const flowResponse = await fetch(`/api/system3/projects/${id}/flow`);
      if (!flowResponse.ok) throw new Error(await flowResponse.text());
      flow = (await flowResponse.json()) as typeof flow;
      if (flow.readinessEvaluation?.status === 'data_required') break;
      if (Date.now() >= readinessDeadline) {
        throw new Error('Activation did not automatically evaluate missing Dataset readiness');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (flow.readiness !== null) {
      throw new Error('Readiness created a contract even though Dataset is missing');
    }
    if (flow.compilation !== null) {
      throw new Error('Readiness compiled a plan even though Dataset is missing');
    }
  }, projectId);

  await page.goto(`/console/projects/${projectId}/flow`);
  await expandLifecycleDetails(page);
  await page
    .getByRole('navigation', { name: '6 giai đoạn và 10 hoạt động vòng đời dự án' })
    .getByRole('button', { name: /TW-03.*Kiểm tra mức độ sẵn sàng/ })
    .click();
  await expect(
    page.getByText('Cần liên kết và kiểm tra Dataset thật trước công việc phụ thuộc dữ liệu.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Điều kiện Readiness' })).toBeVisible();
  await expect(page.getByText('Workflow failed')).toHaveCount(0);
  const readinessWorkspace = page.getByRole('article', {
    name: 'Kiểm tra mức độ sẵn sàng',
  });
  await expect(readinessWorkspace.getByRole('link', { name: 'Liên kết Dataset' })).toHaveAttribute(
    'href',
    `/console/projects/${projectId}/sources`
  );
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({
      path: '/tmp/anvil-readiness-data-required-desktop.png',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(readinessWorkspace).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Điều kiện Readiness' })).toBeVisible();
  await expect(readinessWorkspace.getByRole('link', { name: 'Liên kết Dataset' })).toBeVisible();
  const compactBox = await readinessWorkspace.boundingBox();
  expect(compactBox?.width ?? 0).toBeLessThanOrEqual(390);
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({
      path: '/tmp/anvil-readiness-data-required-compact.png',
      fullPage: true,
    });
  }
});

test('completes the UI-driven core lifecycle @core', async ({ page }) => {
  test.setTimeout(90_000);
  const projectName = `Core lifecycle ${Date.now().toString()}`;
  await page.goto('/console/projects/new');
  await expect(page.getByRole('heading', { name: 'Tạo dự án', level: 1 })).toBeVisible();
  await enableLegacyProjectMode(page);
  await page.getByLabel('Tên dự án').fill(projectName);
  const blueprint = await readFile(blueprintPath, 'utf8');
  await page.getByLabel('Blueprint Markdown').setInputFiles({
    name: 'DESIGN_B_2.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(blueprint),
  });
  await page.getByLabel('Dataset CSV').setInputFiles({
    name: 'core-sample.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,target\n1,yes\n2,no\n3,yes\n4,no\n'),
  });
  await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 20_000 });
  await expandLifecycleDetails(page);
  const understandingPanel = page.locator('.s3-understanding-panel');
  await expect(understandingPanel.getByLabel('Cột mục tiêu')).toBeVisible({ timeout: 30_000 });
  const pendingDecisionButton = understandingPanel.getByRole('button', {
    name: 'Xác nhận quyết định',
  });
  for (let decisionIndex = 0; decisionIndex < 10; decisionIndex += 1) {
    const pendingCount = await pendingDecisionButton.count();
    if (pendingCount === 0) break;
    const targetColumn = understandingPanel.getByLabel('Cột mục tiêu');
    if (await targetColumn.isVisible().catch(() => false))
      await targetColumn.selectOption('target');
    const decisionRequest = page.waitForResponse(response => {
      const request = response.request();
      return (
        request.method() === 'POST' &&
        /\/decisions\/[^/]+\/respond$/.test(new URL(request.url()).pathname)
      );
    });
    await pendingDecisionButton.first().click();
    expect((await decisionRequest).ok()).toBe(true);
    await expect(pendingDecisionButton).toHaveCount(pendingCount - 1, { timeout: 10_000 });
  }
  await expect(pendingDecisionButton).toHaveCount(0, { timeout: 10_000 });
  const activateButton = understandingPanel.getByRole('button', {
    name: 'Chấp nhận Bản hiểu',
  });
  await expect(activateButton).toBeEnabled({ timeout: 2_000 });
  await activateButton.click();
  await expandLifecycleDetails(page);
  await expect(
    page.getByRole('navigation', { name: '6 giai đoạn và 10 hoạt động vòng đời dự án' })
  ).toBeVisible({ timeout: 30_000 });

  // Backend chains Readiness and Compile; the workspace then shows the plan inline with one
  // approve-and-run action instead of a separate review dialog.
  const planSummary = page.locator('section[aria-labelledby="plan-summary-title"]');
  await expect(planSummary).toBeVisible({ timeout: 45_000 });
  await expect(planSummary).toContainText('nguồn đã ghim phiên bản');
  await page.getByRole('button', { name: 'Phê duyệt và chạy', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mở khu vực bàn giao' })).toBeVisible({
    timeout: 45_000,
  });
  const projectId = new URL(page.url()).pathname.split('/').at(-2);
  expect(projectId).toBeTruthy();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/system3/projects/${projectId}/flow`);
        if (!response.ok()) return null;
        const flow = (await response.json()) as { verification: { status: string } | null };
        return flow.verification?.status ?? null;
      },
      { timeout: 20_000 }
    )
    .toBe('completed');

  await page.getByRole('link', { name: 'Mở khu vực bàn giao' }).click();
  await expect(page.getByRole('heading', { name: 'Kiểm tra và tạo gói bàn giao' })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận và tạo gói bàn giao' }).click();
  const downloadLink = page.getByRole('link', { name: 'Tải gói bàn giao' });
  await expect(downloadLink).toBeVisible({ timeout: 30_000 });
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-core-flow-desktop.png', fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(downloadLink).toBeVisible();
  const compactLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(compactLayout.documentWidth).toBeLessThanOrEqual(compactLayout.viewportWidth);
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    await page.screenshot({ path: '/tmp/anvil-core-flow-compact.png', fullPage: true });
  }
  const downloadPromise = page.waitForEvent('download');
  await downloadLink.click();
  expect((await downloadPromise).suggestedFilename()).toBe('generated_project.tar.gz');

  const historyResponse = await page.request.get(`/api/system3/projects/${projectId}/history`);
  expect(historyResponse.ok()).toBe(true);
  const history = (await historyResponse.json()) as {
    approvals: unknown[];
    executions: unknown[];
    verifications: unknown[];
    deliveries: unknown[];
  };
  expect(history.approvals).toHaveLength(1);
  expect(history.executions).toHaveLength(1);
  expect(history.verifications).toHaveLength(1);
  expect(history.deliveries).toHaveLength(1);
});

test('runs live pinned model comparison through Delivery @comparison', async ({ page }) => {
  test.skip(
    process.env.ANVIL_LIVE_9ROUTER !== 'true',
    'Live 9router comparison requires explicit opt-in and configured credentials.'
  );
  test.setTimeout(180_000);
  const projectName = `Live model comparison ${Date.now().toString()}`;
  await page.goto('/console/projects/new');
  await expect(page.getByRole('heading', { name: 'Tạo dự án', level: 1 })).toBeVisible();
  await page.getByLabel('Tên dự án').fill(projectName);
  await page.getByLabel('Blueprint Markdown').setInputFiles({
    name: 'model-comparison-fixture.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(liveComparisonBlueprint),
  });
  await page.getByLabel('Dataset CSV').setInputFiles({
    name: 'four-rows.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,target\n1,yes\n2,no\n3,yes\n4,no\n'),
  });
  await openComparisonConfig(page);
  const modelRefs = page.getByLabel('Mã model thủ công (2–4, mỗi dòng một model)');
  await modelRefs.fill('router9/cx/gpt-6-luna\nrouter9/cx/gpt-5.6-luna');
  await page
    .getByLabel('Prompt chung')
    .fill(
      'Write a Python standard-library solution that reads /work/input.csv and prints one JSON object with rows equal to the number of CSV data rows, excluding the header.'
    );
  await page.getByLabel('Requirement IDs (phân cách bằng dấu phẩy hoặc xuống dòng)').fill('FR-01');
  await page.getByLabel('Harness Python (.py, tối đa 64 KiB)').setInputFiles({
    name: 'fr01-harness.py',
    mimeType: 'text/x-python',
    buffer: Buffer.from(liveComparisonHarness),
  });
  await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 30_000 });

  const understandingPanel = page.locator('.s3-understanding-panel');
  const pendingDecisionButton = understandingPanel.getByRole('button', {
    name: 'Xác nhận quyết định',
  });
  const activateButton = understandingPanel.getByRole('button', {
    name: 'Chấp nhận Bản hiểu',
  });
  await expect
    .poll(
      async () => {
        if ((await pendingDecisionButton.count()) > 0) return 'decision_required';
        return (await activateButton.isEnabled()) ? 'ready' : 'analyzing';
      },
      { timeout: 45_000 }
    )
    .not.toBe('analyzing');
  for (let decisionIndex = 0; decisionIndex < 10; decisionIndex += 1) {
    const pendingCount = await pendingDecisionButton.count();
    if (pendingCount === 0) break;
    const targetColumn = understandingPanel.getByLabel('Cột mục tiêu');
    if (await targetColumn.isVisible().catch(() => false))
      await targetColumn.selectOption('target');
    const decisionResponse = page.waitForResponse(response => {
      const request = response.request();
      return (
        request.method() === 'POST' &&
        /\/decisions\/[^/]+\/respond$/.test(new URL(request.url()).pathname)
      );
    });
    await pendingDecisionButton.first().click();
    expect((await decisionResponse).ok()).toBe(true);
    await expect(pendingDecisionButton).toHaveCount(pendingCount - 1, { timeout: 15_000 });
  }
  await expect(pendingDecisionButton).toHaveCount(0, { timeout: 10_000 });
  await expect(activateButton).toBeEnabled({ timeout: 5_000 });
  await activateButton.click();

  const phaseNavigation = page.getByRole('navigation', {
    name: '6 giai đoạn và 10 hoạt động vòng đời dự án',
  });
  await expandLifecycleDetails(page);
  await expect(phaseNavigation).toBeVisible({ timeout: 30_000 });
  await openSecondaryRoute(page, 'Quyết định & Phê duyệt');
  await expect(
    page.getByRole('heading', { name: 'Đóng các lựa chọn trước khi thực thi' })
  ).toBeVisible({ timeout: 20_000 });
  const reviewPlanButton = page.getByRole('button', {
    name: /Xem và phê duyệt kế hoạch|Chuẩn bị Execution Plan/,
  });
  await expect(reviewPlanButton).toBeEnabled({ timeout: 30_000 });
  await reviewPlanButton.click();
  await expect(page.getByRole('heading', { name: 'Xem kế hoạch trước khi chạy' })).toBeVisible({
    timeout: 20_000,
  });
  const comparisonPlan = page.locator('section[aria-labelledby="model-comparison-plan-title"]');
  await expect(comparisonPlan).toBeVisible();
  await expect(comparisonPlan).toContainText('router9/cx/gpt-6-luna');
  await expect(comparisonPlan).toContainText('router9/cx/gpt-5.6-luna');
  await expect(comparisonPlan).toContainText('FR-01');
  await expect(comparisonPlan).toContainText('cùng input đã pin');
  await page.getByRole('button', { name: 'Phê duyệt và chạy' }).click();

  await expect(page.getByRole('link', { name: 'Mở khu vực bàn giao' })).toBeVisible({
    timeout: 120_000,
  });
  const projectId = new URL(page.url()).pathname.split('/').at(-2);
  expect(projectId).toBeTruthy();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/system3/projects/${projectId}/flow`);
        if (!response.ok()) return null;
        const flow = (await response.json()) as {
          verification: {
            status: string;
            evidenceMap: {
              models?: {
                model: string;
                status: string;
                runId: string;
                inputHash: string;
                codeHash: string | null;
                outputHash: string | null;
                usage: { status: string };
                checks: { requirementId: string; passed: boolean; detail: string }[] | null;
              }[];
            } | null;
          } | null;
        };
        const models = flow.verification?.evidenceMap?.models;
        return flow.verification?.status === 'completed' && models?.length === 2 ? models : null;
      },
      { timeout: 45_000 }
    )
    .toMatchObject([
      { model: 'router9/cx/gpt-6-luna', status: 'completed' },
      { model: 'router9/cx/gpt-5.6-luna', status: 'completed' },
    ]);
  const completedFlowResponse = await page.request.get(`/api/system3/projects/${projectId}/flow`);
  expect(completedFlowResponse.ok()).toBe(true);
  const completedFlow = (await completedFlowResponse.json()) as {
    verification: {
      status: string;
      evidenceMap: {
        status: string;
        executionStatus: string;
        models: {
          model: string;
          status: string;
          runId: string;
          inputHash: string;
          codeHash: string | null;
          outputHash: string | null;
          usage: { status: string };
          checks: { requirementId: string; passed: boolean; detail: string }[] | null;
        }[];
      } | null;
    } | null;
  };
  const modelEvidence = completedFlow.verification?.evidenceMap;
  expect(completedFlow.verification?.status).toBe('completed');
  expect(modelEvidence?.status).toBe('passed');
  expect(modelEvidence?.executionStatus).toBe('passed');
  expect(modelEvidence?.models).toHaveLength(2);
  expect(modelEvidence?.models?.map(model => model.status)).toEqual(['completed', 'completed']);
  expect(modelEvidence?.models?.[0]?.inputHash).toBe(modelEvidence?.models?.[1]?.inputHash);
  expect(modelEvidence?.models?.[0]?.runId).not.toBe(modelEvidence?.models?.[1]?.runId);
  for (const model of modelEvidence?.models ?? []) {
    expect(model.codeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(model.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(model.usage.status).toBe('unknown');
    expect(model.checks).toContainEqual({
      requirementId: 'FR-01',
      passed: true,
      detail: 'Row count matches',
    });
  }

  await phaseNavigation.getByRole('button', { name: /TW-07.*Xác minh kết quả độc lập/ }).click();
  const modelResults = page.locator('section[aria-labelledby="model-comparison-results-title"]');
  await expect(modelResults).toBeVisible({ timeout: 30_000 });
  const modelRows = modelResults.locator('tbody > tr');
  await expect(modelRows).toHaveCount(2);
  await expect(modelResults).toContainText('Chi phí: chưa xác định.');
  for (const model of ['router9/cx/gpt-6-luna', 'router9/cx/gpt-5.6-luna']) {
    const row = modelRows.filter({ hasText: model.replace(/^router9\//u, '') });
    await expect(row).toHaveCount(1);
    await expect(row.locator('th[scope="row"]')).toHaveText(model.replace(/^router9\//u, ''));
    await expect(row).toContainText('Hoàn tất');
    const checkResults = row.locator('td').nth(2);
    const checkSummary = checkResults.locator('summary');
    await expect(checkSummary).toHaveText('1/1 đạt');
    await checkSummary.click();
    await expect(checkResults).toContainText('FR-01');
    await expect(checkResults).toContainText('Row count matches');
    await expect(row.getByRole('button', { name: `Xem code ${model}` })).toBeEnabled();
    await expect(row.getByRole('button', { name: `Xem output ${model}` })).toBeEnabled();
  }
  const screenshotStem = `/tmp/anvil-live-comparison-${projectId}`;
  await page.screenshot({ path: `${screenshotStem}-tw07-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const compactVerification = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(compactVerification.documentWidth).toBeLessThanOrEqual(compactVerification.viewportWidth);
  await page.screenshot({ path: `${screenshotStem}-tw07-390px.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  const historyResponse = await page.request.get(`/api/system3/projects/${projectId}/history`);
  expect(historyResponse.ok()).toBe(true);
  const history = (await historyResponse.json()) as {
    approvals: unknown[];
    executions: unknown[];
    verifications: unknown[];
  };
  expect(history.approvals).toHaveLength(1);
  expect(history.executions).toHaveLength(1);
  expect(history.verifications).toHaveLength(1);

  await phaseNavigation.getByRole('button', { name: /OP-08.*Yêu cầu bàn giao/ }).click();
  await page.getByRole('link', { name: 'Mở khu vực bàn giao' }).click();
  await expect(page.getByRole('heading', { name: 'Kiểm tra và tạo gói bàn giao' })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận và tạo gói bàn giao' }).click();
  const downloadLink = page.getByRole('link', { name: 'Tải gói bàn giao' });
  await expect(downloadLink).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: `${screenshotStem}-delivery-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const compactDelivery = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(compactDelivery.documentWidth).toBeLessThanOrEqual(compactDelivery.viewportWidth);
  await page.screenshot({ path: `${screenshotStem}-delivery-390px.png`, fullPage: true });

  const downloadPromise = page.waitForEvent('download');
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('generated_project.tar.gz');
  await download.saveAs(`${screenshotStem}-generated_project.tar.gz`);
});

test('previews verified model code and output inline @comparison-preview', async ({ page }) => {
  const projectId = process.env.ANVIL_COMPARISON_PROJECT_ID;
  test.skip(!projectId, 'Requires an existing verified comparison fixture.');
  await page.goto(`/console/projects/${projectId}/flow`);
  await expandLifecycleDetails(page);
  const navigation = page.getByRole('navigation', {
    name: '6 giai đoạn và 10 hoạt động vòng đời dự án',
  });
  await navigation.getByRole('button', { name: /TW-07.*Xác minh kết quả độc lập/ }).click();
  const modelRows = page.locator('.s3-comparison-results tbody > tr');
  const firstModelCode = modelRows
    .filter({ hasText: 'cx/gpt-6-luna' })
    .getByRole('button', { name: 'Xem code router9/cx/gpt-6-luna' });
  await firstModelCode.click();
  const viewer = page.getByRole('dialog');
  await expect(viewer.locator('pre')).toHaveCount(1);
  await expect(viewer.locator('pre').first()).toBeVisible();
  expect((await viewer.locator('pre').first().boundingBox())?.height ?? 0).toBeGreaterThan(50);
  await expect(viewer).toContainText('models/0/solution.py');
  await expect(viewer).not.toContainText('models/1/solution.py');
  const originalUrl = page.url();
  await viewer.locator('pre').first().scrollIntoViewIfNeeded();
  expect(
    await viewer
      .locator('pre')
      .first()
      .evaluate(element => element.parentElement?.getBoundingClientRect().height ?? 0)
  ).toBeGreaterThan(50);
  await page.screenshot({ path: '/tmp/anvil-comparison-inline-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await viewer.locator('pre').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/anvil-comparison-inline-390px.png' });
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(firstModelCode).toBeFocused();
  const secondModelOutput = modelRows
    .filter({ hasText: 'cx/gpt-5.6-luna' })
    .getByRole('button', { name: 'Xem output router9/cx/gpt-5.6-luna' });
  await secondModelOutput.click();
  const outputViewer = page.getByRole('dialog');
  await expect(
    outputViewer.getByRole('heading', { name: 'Model output · router9/cx/gpt-5.6-luna' })
  ).toBeVisible();
  await expect(
    outputViewer.getByRole('heading', { name: 'Model output · router9/cx/gpt-6-luna' })
  ).toHaveCount(0);
  await expect(outputViewer.locator('table tbody tr')).toContainText('rows');
  await page.keyboard.press('Escape');
  await expect(secondModelOutput).toBeFocused();
  expect(page.url()).toBe(originalUrl);
});
