import { expect, test, type APIRequestContext } from '@playwright/test';

interface CreatedProject {
  id: string;
  version: number;
}

interface IntakeResult {
  operationId: string;
  outcome: 'created_source' | 'created_version' | 'unchanged';
  source: { id: string };
  version: { id: string; version: number; contentHash: string; storageKey?: string };
  projectVersion: number;
  changeDetectionOperationId: string | null;
  intakeReport: { id: string; report: { outcome: string } };
}

interface ImpactFlowResult {
  impacts: {
    sourceVersionId: string;
    id: string;
    schemaVersion: 1 | 2 | 3;
    manifest: {
      detectorVersion: string;
      changes: { kind: string }[];
      affectedActivities: string[];
      affectedResources: { resourceId: string }[];
      reusableResources: { resourceId: string }[];
      proposedRerun: { mode: 'none' | 'scoped' | 'full' };
    } | null;
  }[];
}

interface ActivityResourceResult {
  inputs: { id: string; resourceType: string }[];
  outputs: { id: string; resourceType: string }[];
  technicalResources: { id: string; resourceType: string }[];
  history: { id: string; resource?: { id: string; resourceType: string } | null }[];
}

async function createProject(request: APIRequestContext): Promise<CreatedProject> {
  const response = await request.post('/api/system3/projects', {
    data: {
      name: `Source Intake E2E ${crypto.randomUUID()}`,
      description: 'Kiểm tra OP-00 độc lập',
      createManagedCodebase: true,
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<CreatedProject>;
}

function blueprintFile(body: string, name = 'project.md') {
  return { name, mimeType: 'text/markdown', buffer: Buffer.from(body) };
}

test('OP-00 is immutable, idempotent, report-visible, and gates Understanding', async ({
  request,
  page,
}) => {
  const project = await createProject(request);
  const uploadUrl = `/api/system3/projects/${project.id}/sources`;
  const firstMultipart = {
    kind: 'blueprint',
    role: 'primary',
    expectedVersion: project.version.toString(),
    file: blueprintFile('# Project\n\nTarget: churn'),
  };
  const first = await request.post(uploadUrl, {
    headers: { 'Idempotency-Key': 'e2e-source-intake-first' },
    multipart: firstMultipart,
  });
  expect(first.status()).toBe(201);
  const created = (await first.json()) as IntakeResult;
  expect(created.outcome).toBe('created_source');
  expect(created.version.version).toBe(1);
  expect(created.version.storageKey).toBeUndefined();
  expect(created.changeDetectionOperationId).toBeTruthy();
  expect(created.intakeReport.report.outcome).toBe('created_source');

  const idempotentRetry = await request.post(uploadUrl, {
    headers: { 'Idempotency-Key': 'e2e-source-intake-first' },
    multipart: firstMultipart,
  });
  expect(idempotentRetry.status()).toBe(200);
  const retried = (await idempotentRetry.json()) as IntakeResult;
  expect(retried.operationId).toBe(created.operationId);
  expect(retried.version.id).toBe(created.version.id);
  expect(retried.intakeReport.id).toBe(created.intakeReport.id);

  const unchanged = await request.post(uploadUrl, {
    headers: { 'Idempotency-Key': 'e2e-source-intake-unchanged' },
    multipart: {
      ...firstMultipart,
      sourceId: created.source.id,
      expectedVersion: created.projectVersion.toString(),
    },
  });
  expect(unchanged.status()).toBe(200);
  const unchangedBody = (await unchanged.json()) as IntakeResult;
  expect(unchangedBody.outcome).toBe('unchanged');
  expect(unchangedBody.version.id).toBe(created.version.id);
  expect(unchangedBody.changeDetectionOperationId).toBeNull();

  const changed = await request.post(uploadUrl, {
    headers: { 'Idempotency-Key': 'e2e-source-intake-version-2' },
    multipart: {
      kind: 'blueprint',
      role: 'primary',
      sourceId: created.source.id,
      expectedVersion: created.projectVersion.toString(),
      file: blueprintFile('# Project\n\nTarget: churn\n\nConstraint: CPU only'),
    },
  });
  expect(changed.status()).toBe(201);
  const changedBody = (await changed.json()) as IntakeResult;
  expect(changedBody.outcome).toBe('created_version');
  expect(changedBody.version.version).toBe(2);
  expect(changedBody.version.id).not.toBe(created.version.id);

  const flowAfterChange = await request.get(`/api/system3/projects/${project.id}/flow`);
  expect(flowAfterChange.status()).toBe(200);
  const impactFlow = (await flowAfterChange.json()) as ImpactFlowResult;
  const latestImpact = impactFlow.impacts.find(
    impact => impact.sourceVersionId === changedBody.version.id
  );
  expect(latestImpact).toBeDefined();
  expect(latestImpact).toMatchObject({
    schemaVersion: 3,
    manifest: {
      detectorVersion: 'system3-change-detector@3',
      proposedRerun: { mode: 'full' },
    },
  });
  expect(latestImpact?.manifest?.changes.map(change => change.kind)).not.toContain(
    'formatting_only'
  );
  expect(latestImpact?.manifest?.affectedActivities).toContain('TW-02');

  if (!latestImpact) throw new Error('Không tìm thấy báo cáo ảnh hưởng phiên bản 3');
  const previousImpact = impactFlow.impacts.find(
    impact => impact.sourceVersionId === created.version.id
  );
  if (!previousImpact) throw new Error('Không tìm thấy báo cáo ảnh hưởng trước đó');
  const activityResponse = await request.get(
    `/api/system3/projects/${project.id}/activities/OP-01`
  );
  expect(activityResponse.status()).toBe(200);
  const activity = (await activityResponse.json()) as ActivityResourceResult;
  expect(activity.outputs).toEqual([
    expect.objectContaining({ id: latestImpact.id, resourceType: 'impact_manifest' }),
  ]);
  expect(activity.inputs.map(input => input.id).sort()).toEqual(
    [created.version.id, changedBody.version.id].sort()
  );
  expect(activity.technicalResources).toEqual([
    expect.objectContaining({ id: latestImpact.id, resourceType: 'dependency_graph_snapshot' }),
  ]);
  expect(activity.history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: previousImpact.id,
        resource: expect.objectContaining({
          id: previousImpact.id,
          resourceType: 'impact_manifest',
        }),
      }),
    ])
  );
  const presentationResponse = await request.get(
    `/api/system3/projects/${project.id}/resources/impact_manifest/${latestImpact.id}`
  );
  expect(presentationResponse.status()).toBe(200);
  const presentation = (await presentationResponse.json()) as {
    blocks: { title?: string }[];
  };
  expect(presentation.blocks.map(block => block.title)).toEqual(
    expect.arrayContaining([
      'So sánh nội dung cũ và mới',
      'Kết quả cần cập nhật',
      'Kết quả có thể giữ lại',
    ])
  );

  const download = await request.get(
    `/api/system3/projects/${project.id}/source-versions/${changedBody.version.id}/content`
  );
  expect(download.status()).toBe(200);
  expect(download.headers().etag).toBe(`"${changedBody.version.contentHash}"`);
  expect(await download.text()).toContain('CPU only');

  const rejected = await request.post(uploadUrl, {
    headers: { 'Idempotency-Key': 'e2e-source-intake-rejected' },
    multipart: {
      kind: 'dataset',
      role: 'primary',
      expectedVersion: changedBody.projectVersion.toString(),
      file: blueprintFile('# Not a CSV', 'wrong.md'),
    },
  });
  expect(rejected.status()).toBe(415);
  const rejectedBody = (await rejected.json()) as {
    intakeReport: { report: { outcome: string; storageStatus: string } };
  };
  expect(rejectedBody.intakeReport.report).toMatchObject({
    outcome: 'rejected',
    storageStatus: 'not_stored',
  });

  const duplicatePrimary = await request.post(uploadUrl, {
    headers: { 'Idempotency-Key': 'e2e-source-intake-duplicate-primary' },
    multipart: {
      kind: 'blueprint',
      role: 'primary',
      expectedVersion: changedBody.projectVersion.toString(),
      file: blueprintFile('# A second primary lineage', 'second.md'),
    },
  });
  expect(duplicatePrimary.status()).toBe(409);
  expect(await duplicatePrimary.json()).toMatchObject({
    intakeReport: { report: { outcome: 'rejected', storageStatus: 'not_stored' } },
  });

  const reports = await request.get(`/api/system3/projects/${project.id}/source-intake-reports`);
  expect(reports.status()).toBe(200);
  const reportList = (await reports.json()) as {
    reports: { id: string; artifactKey?: string; report: { outcome: string } }[];
  };
  expect(reportList.reports).toHaveLength(5);
  expect(reportList.reports.every(report => report.artifactKey === undefined)).toBe(true);
  const downloadableReport = reportList.reports.find(
    report => report.report.outcome === 'rejected'
  );
  if (!downloadableReport) throw new Error('Rejected Source Intake report was not persisted');
  const reportDownload = await request.get(
    `/api/system3/projects/${project.id}/source-intake-reports/${downloadableReport.id}/content`
  );
  expect(reportDownload.status()).toBe(200);
  expect(reportDownload.headers().etag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
  expect((await reportDownload.json()) as { outcome: string }).toMatchObject({
    outcome: 'rejected',
  });
  const gate = await request.get(`/api/system3/projects/${project.id}/intake-gate`);
  expect(gate.status()).toBe(200);
  expect(await gate.json()).toMatchObject({
    ready: true,
    blueprintReady: true,
    activeSourceCount: 1,
    recoveries: [],
  });

  await page.goto(`/console/projects/${project.id}/sources`);
  await expect(page.getByRole('heading', { name: 'Tiếp nhận nguồn đầu vào' })).toBeVisible();
  await expect(page.getByText('Hoạt động vòng đời · OP-00')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lịch sử báo cáo tiếp nhận' })).toBeVisible();
  await expect(page.locator('.s3-chip.warn', { hasText: 'Bị từ chối' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Tiếp tục Hiểu dự án' })).toBeEnabled();
  await expect(page.getByText('storageKey')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Báo cáo ảnh hưởng gần nhất' })).toBeVisible();
  await page.getByRole('button', { name: 'Xem chi tiết thay đổi' }).click();
  const impactDialog = page.getByRole('dialog');
  await expect(
    impactDialog.getByRole('heading', { name: 'Báo cáo ảnh hưởng hiện tại' })
  ).toBeVisible();
  await expect(impactDialog.getByText('Các bước cần đánh giá lại')).toBeVisible();
  await expect(
    impactDialog.getByRole('heading', { name: 'So sánh nội dung cũ và mới' })
  ).toBeVisible();
  await expect(impactDialog.getByText('Kết quả cần cập nhật')).toBeVisible();
  await expect(page).toHaveURL(`/console/projects/${project.id}/sources`);
  await page.keyboard.press('Escape');
  await expect(impactDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Xem chi tiết thay đổi' })).toBeFocused();

  await page.goto(`/console/projects/${project.id}/flow`);
  // The 6-phase / 10-activity rail lives in a collapsed disclosure on the workspace.
  await page.getByText('Chi tiết vòng đời · 6 giai đoạn, 10 hoạt động', { exact: true }).click();
  await page.getByRole('button', { name: /OP-01.*Phát hiện thay đổi/u }).click();
  await expect(page.getByRole('heading', { name: 'Phát hiện thay đổi' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Báo cáo ảnh hưởng hiện tại/u })).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: /Bản quan hệ được dùng để kiểm tra/u })
  ).toHaveCount(0);
  await page.getByText(/Lịch sử hoạt động/u).click();
  await expect(page.getByRole('button', { name: 'Xem báo cáo này' })).toBeVisible();
  await page.getByText('Thông tin kỹ thuật dùng khi kiểm tra').click();
  await expect(
    page.getByRole('button', { name: /Thông tin quan hệ dùng khi kiểm tra/u })
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const compactWidth = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(compactWidth.content).toBeLessThanOrEqual(compactWidth.viewport);
});
