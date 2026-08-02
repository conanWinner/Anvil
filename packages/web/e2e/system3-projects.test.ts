import { expect, test } from '@playwright/test';
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
  await page.getByLabel('Blueprint Markdown *').setInputFiles(blueprintPath);
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
  await expect(page.getByRole('link', { name: /Xử lý.*quyết định/ })).toHaveCount(1);
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedAnimationSeconds = await page.locator('.s3-activity-workspace').evaluate(element => {
    return Number.parseFloat(window.getComputedStyle(element).animationDuration);
  });
  expect(reducedAnimationSeconds).toBeLessThanOrEqual(0.001);
  await phaseNavigation.getByRole('button', { name: /TW-02.*Hiểu dự án/ }).click();
  await page.getByText('Node và lần chạy kỹ thuật').click();
  await expect(page.getByRole('tab', { name: 'Cách workflow hoạt động' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByText('system3-understand-project', { exact: true })).toBeVisible();
  await expect(page.getByText('Trích xuất blueprint', { exact: true })).toBeVisible();
  await expect(page.getByText('Tạo decision', { exact: true })).toBeVisible();

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
    for (const decision of flow.decisions.filter(value => value.status === 'pending')) {
      flow = (await fetch(`/api/system3/projects/${id}/decisions/${decision.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: decision.options[0],
          expectedVersion: flow.project.version,
        }),
      }).then(response => response.json())) as typeof flow;
    }
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
    for (const decision of flow.decisions.filter(value => value.status === 'pending')) {
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
    const readinessResponse = await fetch(`/api/system3/projects/${id}/readiness-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-readiness-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!readinessResponse.ok) throw new Error(await readinessResponse.text());
    const readinessOperation = (await readinessResponse.json()) as { operation: { id: string } };
    await waitOperation(readinessOperation.operation.id);
    flow = await loadFlow();
    const compilationResponse = await fetch(`/api/system3/projects/${id}/compilations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `e2e-compile-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedVersion: flow.project.version }),
    });
    if (!compilationResponse.ok) throw new Error(await compilationResponse.text());
    const compilationOperation = (await compilationResponse.json()) as {
      operation: { id: string };
    };
    await waitOperation(compilationOperation.operation.id);
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
});
