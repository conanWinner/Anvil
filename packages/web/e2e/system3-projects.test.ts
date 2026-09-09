import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const blueprintPath = fileURLToPath(
  new URL('../../../docs/system_2/DESIGN_B_2.md', import.meta.url)
);

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

  await page.getByRole('link', { name: 'Tạo project' }).click();
  await expect(page.getByRole('heading', { name: 'Thông tin dự án' })).toBeVisible();
  await page.getByLabel('Tên project').fill(projectName);
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByRole('heading', { name: 'Chọn workflow khởi đầu' })).toBeVisible();

  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  const blueprint = await readFile(blueprintPath, 'utf8');
  await page.getByLabel('Blueprint Markdown *').setInputFiles({
    name: 'DESIGN_B_2.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(blueprint),
  });
  await page.getByLabel('Dataset CSV').setInputFiles({
    name: 'customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('customer_id,target\n1,yes\n2,no\n3,yes\n4,yes\n'),
  });
  await expect(page.getByText('DESIGN_B_2.md', { exact: true })).toBeVisible();
  await expect(page.getByText('customers.csv', { exact: true })).toBeVisible();

  for (const heading of ['Ràng buộc', 'Sẵn sàng phân tích đầu vào', 'Tạo Project Flow']) {
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Tạo và kiểm tra nguồn' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'Tiếp nhận nguồn đầu vào' })).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp tục Hiểu dự án' }).click();
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
  await expect(page.getByText('Trạng thái Bản hiểu dự án', { exact: true })).toBeVisible();
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
    understandingReportDialog.getByRole('heading', { name: 'Tổng quan dự án' })
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
    flow = (await fetch(`/api/system3/projects/${id}/flow`).then(response =>
      response.json()
    )) as typeof flow;
    const readiness = await fetch(`/api/system3/projects/${id}/readiness-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-readiness-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!readiness.ok) throw new Error(await readiness.text());
    const body = (await readiness.json()) as { operation: { id: string } };
    await waitOperation(body.operation.id);
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
  const compileWorkspaceLink = page.getByRole('link', { name: 'Chuẩn bị Execution Plan' });
  await expect(compileWorkspaceLink).toBeVisible({
    timeout: 30_000,
  });
  await compileWorkspaceLink.click();
  await expect(
    page.getByRole('heading', { name: 'Đóng các lựa chọn trước khi thực thi' })
  ).toBeVisible();
  const compileButton = page.getByRole('button', { name: 'Chuẩn bị Execution Plan' });
  await compileButton.click();
  await expect(page.getByRole('heading', { name: 'Review kế hoạch trước khi build' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Đóng' })).toBeFocused();
  await expect(page.getByText('Không tái sử dụng artifact', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve manifest' }).click();
  await page.getByRole('link', { name: 'Vòng đời dự án', exact: true }).click();
  const executeButton = page.getByRole('button', { name: 'Chạy baseline MVP' }).first();
  await expect(executeButton).toBeVisible({ timeout: 30_000 });
  await executeButton.click();
  const deliveryWorkspaceLink = page.getByRole('link', { name: 'Mở khu vực bàn giao' });
  await expect(deliveryWorkspaceLink).toBeVisible({
    timeout: 60_000,
  });
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

  await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
  await expect(page.getByText('Việc nên làm tiếp theo', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Quyết định & Phê duyệt', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Đóng các lựa chọn trước khi thực thi' })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Kết quả & Bằng chứng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đối soát toàn bộ project' })).toBeVisible();
  await page.getByRole('link', { name: 'Bàn giao', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kiểm tra và tạo gói bàn giao' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
  await expect(page.getByText('Việc nên làm tiếp theo', { exact: true })).toBeVisible();
  const mainHasHorizontalOverflow = await page.locator('main#main-content').evaluate(element => {
    return element.scrollWidth > element.clientWidth + 1;
  });
  expect(mainHasHorizontalOverflow).toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('link', { name: 'Vòng đời dự án', exact: true }).click();
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
    flow = await loadFlow();
    const readinessKey = `e2e-readiness-${crypto.randomUUID()}`;
    const readinessExpectedVersion = flow.project.version;
    const readinessRequest = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': readinessKey,
      },
      body: JSON.stringify({ expectedVersion: readinessExpectedVersion }),
    };
    const [readinessResponse, concurrentReadinessResponse] = await Promise.all([
      fetch(`/api/system3/projects/${id}/readiness-contracts`, readinessRequest),
      fetch(`/api/system3/projects/${id}/readiness-contracts`, readinessRequest),
    ]);
    if (!readinessResponse.ok) throw new Error(await readinessResponse.text());
    if (!concurrentReadinessResponse.ok) {
      throw new Error(await concurrentReadinessResponse.text());
    }
    const readinessOperation = (await readinessResponse.json()) as { operation: { id: string } };
    const concurrentReadiness = (await concurrentReadinessResponse.json()) as {
      operation: { id: string };
    };
    if (concurrentReadiness.operation.id !== readinessOperation.operation.id) {
      throw new Error('Concurrent readiness requests created more than one operation');
    }
    await waitOperation(readinessOperation.operation.id);
    flow = await loadFlow();
    const duplicateReadinessResponse = await fetch(
      `/api/system3/projects/${id}/readiness-contracts`,
      readinessRequest
    );
    if (!duplicateReadinessResponse.ok) throw new Error(await duplicateReadinessResponse.text());
    const duplicateReadiness = (await duplicateReadinessResponse.json()) as {
      operation: { id: string };
    };
    if (duplicateReadiness.operation.id !== readinessOperation.operation.id) {
      throw new Error('Readiness retry after project version advance was not idempotent');
    }
    const compilationKey = `e2e-compile-${crypto.randomUUID()}`;
    const compilationExpectedVersion = flow.project.version;
    const compilationRequest = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': compilationKey,
      },
      body: JSON.stringify({ expectedVersion: compilationExpectedVersion }),
    };
    const compilationResponse = await fetch(
      `/api/system3/projects/${id}/compilations`,
      compilationRequest
    );
    if (!compilationResponse.ok) throw new Error(await compilationResponse.text());
    const compilationOperation = (await compilationResponse.json()) as {
      operation: { id: string };
    };
    await waitOperation(compilationOperation.operation.id);
    const duplicateCompilationResponse = await fetch(
      `/api/system3/projects/${id}/compilations`,
      compilationRequest
    );
    if (!duplicateCompilationResponse.ok)
      throw new Error(await duplicateCompilationResponse.text());
    const duplicateCompilation = (await duplicateCompilationResponse.json()) as {
      operation: { id: string };
    };
    if (duplicateCompilation.operation.id !== compilationOperation.operation.id) {
      throw new Error('Compilation retry after project version advance was not idempotent');
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
    flow = await loadFlow();
    const readiness = await fetch(`/api/system3/projects/${id}/readiness-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-readiness-b-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!readiness.ok) throw new Error(await readiness.text());
    await waitOperation(((await readiness.json()) as { operation: { id: string } }).operation.id);
    flow = await loadFlow();
    const compile = await fetch(`/api/system3/projects/${id}/compilations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-compile-b-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!compile.ok) throw new Error(await compile.text());
    await waitOperation(((await compile.json()) as { operation: { id: string } }).operation.id);
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
});

test('shows data_required as a business blocker with a Dataset next action', async ({ page }) => {
  test.setTimeout(90_000);
  const projectName = `Readiness without dataset ${Date.now().toString()}`;
  await page.goto('/console/projects/new');
  await page.getByLabel('Tên project').fill(projectName);
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  const blueprint = await readFile(blueprintPath, 'utf8');
  await page.getByLabel('Blueprint Markdown *').setInputFiles({
    name: 'DESIGN_B_2.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(blueprint),
  });
  for (const heading of ['Ràng buộc', 'Sẵn sàng phân tích đầu vào', 'Tạo Project Flow']) {
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Tạo và kiểm tra nguồn' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Tiếp tục Hiểu dự án' }).click();
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
    )) as { project: { version: number } };
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
    flow = (await fetch(`/api/system3/projects/${id}/flow`).then(response =>
      response.json()
    )) as typeof flow;
    const readiness = await fetch(`/api/system3/projects/${id}/readiness-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-missing-data-readiness-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!readiness.ok) throw new Error(await readiness.text());
    const result = await waitOperation(
      ((await readiness.json()) as { operation: { id: string } }).operation.id
    );
    if ((result.evaluation as { status?: string } | undefined)?.status !== 'data_required') {
      throw new Error('Readiness without Dataset did not return data_required');
    }
    if (result.readinessContractId !== null) {
      throw new Error('Readiness created a contract even though Dataset is missing');
    }
  }, projectId);

  await page.goto(`/console/projects/${projectId}/flow`);
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
