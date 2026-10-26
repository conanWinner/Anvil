import { expect, test, type Page } from '@playwright/test';
import type { paths } from '../src/lib/api.generated';

/** The create form defaults to experiment mode; older flows pick their mode explicitly. */
async function selectProjectMode(page: Page, mode: 'comparison' | 'legacy'): Promise<void> {
  const advanced = page.getByText('Cấu hình bộ kiểm tra và nâng cao', { exact: true });
  if (!(await advanced.evaluate(element => element.parentElement?.hasAttribute('open') ?? false)))
    await advanced.click();
  await page.getByLabel('Chế độ dự án').selectOption(mode);
}

type ProjectFlow =
  paths['/api/system3/projects/{id}/flow']['get']['responses'][200]['content']['application/json'];

test('runs the Olist sample with two LLMs through the minimal workspace @olist-live', async ({
  page,
}, testInfo) => {
  test.skip(process.env.ANVIL_LIVE_9ROUTER !== 'true', 'Requires explicit live 9router opt-in.');
  test.setTimeout(240_000);
  const models = ['router9/cx/gpt-6-luna', 'router9/cx/gpt-5.6-luna'];
  await page.goto('/console/projects/new');
  await selectProjectMode(page, 'comparison');
  await expect(page.getByLabel('cx/gpt-6-luna', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Dùng bộ mẫu Olist' }).click();
  await expect(page.getByRole('status')).toContainText('Đã chọn bộ mẫu');
  await page.getByLabel('Tên dự án').fill(`Olist UI acceptance ${Date.now().toString()}`);
  for (const model of models) {
    await page.getByLabel(model.replace('router9/', ''), { exact: true }).check();
  }
  await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/flow$/u);
  const projectId = new URL(page.url()).pathname.split('/')[3];
  expect(projectId).toBeTruthy();
  const acceptUnderstanding = page.getByRole('button', { name: 'Chấp nhận Bản hiểu' });
  await expect(acceptUnderstanding).toBeEnabled({ timeout: 45_000 });
  await acceptUnderstanding.click();
  const approve = page.getByRole('button', { name: 'Phê duyệt và chạy', exact: true });
  await expect(approve).toBeEnabled({ timeout: 30_000 });
  const plan = page.locator('section[aria-labelledby="plan-summary-title"]');
  for (const model of models) await expect(plan).toContainText(model.replace('router9/', ''));
  for (const id of ['FR-01', 'FR-02', 'FR-03']) await expect(plan).toContainText(id);
  const executionResponse = page.waitForResponse(
    response => response.request().method() === 'POST' && response.url().endsWith('/executions')
  );
  await approve.click();
  const execution = await executionResponse;
  expect(execution.ok(), await execution.text()).toBe(true);
  const flowUrl = `/api/system3/projects/${projectId}/flow`;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(flowUrl);
        if (!response.ok()) return null;
        const flow: ProjectFlow = await response.json();
        return flow.verification?.status;
      },
      { timeout: 120_000 }
    )
    .toBe('completed');
  const response = await page.request.get(flowUrl);
  const flow: ProjectFlow = await response.json();
  const evidence = flow.verification?.evidenceMap;
  expect(evidence?.status).toBe('passed');
  expect(evidence?.models).toHaveLength(2);
  expect(evidence?.models?.map(model => model.model)).toEqual(models);
  expect(new Set(evidence?.models?.map(model => model.inputHash)).size).toBe(1);
  expect(new Set(evidence?.models?.map(model => model.runId)).size).toBe(2);
  for (const model of evidence?.models ?? []) {
    expect(model.status).toBe('completed');
    expect(model.codeHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(model.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(model.checks?.map(check => [check.requirementId, check.passed])).toEqual([
      ['FR-01', true],
      ['FR-02', true],
      ['FR-03', true],
    ]);
  }
  await expect(page.getByRole('heading', { name: 'Kết quả so sánh' })).toBeVisible();
  await expect(page.locator('.s3-comparison-table tbody > tr')).toHaveCount(2);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
    await expect(page.locator('.s3-comparison-table tbody > tr').first()).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`results-${width}.png`), fullPage: true });
    const openCode = page.getByRole('button', { name: `Xem code ${models[1]}` });
    await openCode.click();
    await expect(page.locator('.s3-presentation-markdown')).toContainText('models/1/solution.py');
    await expect(page.locator('.s3-presentation-markdown')).not.toContainText(
      'models/0/solution.py'
    );
    await page.keyboard.press('Escape');
    await expect(openCode).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/flow$`, 'u'));
  }
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Tạo và tải gói kết quả', exact: true }).click();
  await (await downloadPromise).saveAs(testInfo.outputPath('generated_project.tar.gz'));
  await expect(page.getByRole('link', { name: 'Tải gói chạy lại', exact: true })).toBeVisible();
  await testInfo.attach('project-evidence', {
    body: JSON.stringify({ projectId, evidence }, null, 2),
    contentType: 'application/json',
  });
});

test('reviews Olist output and labels stale results without running models @olist-review', async ({
  page,
}) => {
  const projectId = process.env.ANVIL_COMPARISON_PROJECT_ID;
  test.skip(!projectId, 'Requires an existing verified Olist project.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/console/projects/${projectId}/flow`);
  const output = page.getByRole('button', { name: 'Xem output router9/cx/gpt-5.6-luna' });
  await output.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  const url = page.url();
  await output.click();
  const viewer = page.getByRole('dialog');
  await expect(
    viewer.getByRole('heading', { name: 'Model output · router9/cx/gpt-5.6-luna' })
  ).toBeVisible();
  await expect(viewer).toContainText('total_customers');
  await expect(viewer).toContainText('1000');
  await expect(viewer).not.toContainText('Model output · router9/cx/gpt-6-luna');
  await page.keyboard.press('Escape');
  await expect(output).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

  await page.route(`**/api/system3/projects/${projectId}/flow`, async route => {
    const response = await route.fetch();
    const flow: ProjectFlow = await response.json();
    await route.fulfill({ json: { ...flow, project: { ...flow.project, freshness: 'stale' } } });
  });
  await page.reload();
  await page.getByText('Chi tiết vòng đời · 6 giai đoạn, 10 hoạt động', { exact: true }).click();
  await page.getByRole('button', { name: /TW-07.*Xác minh kết quả độc lập/u }).click();
  await expect(page.getByRole('heading', { name: 'Kết quả so sánh cũ' })).toBeVisible();
  await expect(page.getByText('Hoàn tất ở lần trước', { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Tạo và tải gói kết quả', exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tải gói chạy lại', exact: true })).toHaveCount(0);
});
