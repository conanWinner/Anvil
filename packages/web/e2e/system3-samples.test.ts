import { expect, test } from '@playwright/test';
import type { paths } from '../src/lib/api.generated';

const catalogModels = [
  {
    ref: 'router9/test/model-a',
    provider: 'router9',
    id: 'model-a',
    name: 'Test Model A',
    reasoning: false,
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
  },
  {
    ref: 'router9/test/model-b',
    provider: 'router9',
    id: 'model-b',
    name: 'Test Model B',
    reasoning: false,
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
  },
  {
    ref: 'router9/test/model-c',
    provider: 'router9',
    id: 'model-c',
    name: 'Test Model C',
    reasoning: false,
    cost: { input: 0, output: 0 },
    contextWindow: 128000,
  },
];

test('selects the Olist comparison sample and uploads pinned sources without calling a model', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const executionRequests: string[] = [];
  await page.route('**/api/providers/pi/models', route =>
    route.fulfill({ json: { models: catalogModels } })
  );
  page.on('request', request => {
    if (
      request.method() === 'POST' &&
      /\/(analyze|execute|readiness|compile|approve|deliver)$/u.test(
        new URL(request.url()).pathname
      )
    ) {
      executionRequests.push(request.url());
    }
  });
  await page.goto('/console/projects/new');
  await expect(page.getByRole('heading', { name: 'Tạo dự án', level: 1 })).toBeVisible();
  await expect(page.getByText('Test Model A', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dùng bộ mẫu Olist' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Đã chọn bộ mẫu');
  await expect(page.getByRole('link', { name: /customer-summary-blueprint\.md/u })).toBeVisible();
  await expect(page.getByRole('link', { name: /olist-customers-sample.csv/u })).toBeVisible();
  await expect(page.getByLabel('Tên dự án')).toHaveValue('Tổng hợp khách hàng Olist');
  await expect(page.getByLabel('Test Model A')).toBeChecked();
  await expect(page.getByLabel('Test Model B')).toBeChecked();
  await expect(page.getByLabel('Test Model C')).not.toBeChecked();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(page.getByRole('button', { name: 'Dùng tệp của tôi' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
    if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
      await page.screenshot({ path: `/tmp/anvil-olist-sample-${width}.png`, fullPage: true });
    }
  }

  await page.getByRole('button', { name: 'Dùng tệp của tôi' }).click();
  await expect(page.getByLabel('Blueprint Markdown')).toBeVisible();
  await expect(page.getByLabel('Dataset CSV')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Dùng bộ mẫu Olist' }).click();
  await expect(page.getByRole('status')).toContainText('Đã chọn bộ mẫu');
  const projectName = `Tổng hợp khách hàng Olist ${Date.now().toString()}`;
  await page.getByLabel('Tên dự án').fill(projectName);
  await page.getByRole('button', { name: 'Chỉ tạo dự án', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/')[3];
  expect(projectId).toBeTruthy();
  const response = await page.request.get(`/api/system3/projects/${projectId}/sources`);
  expect(response.ok()).toBe(true);
  const sources: paths['/api/system3/projects/{id}/sources']['get']['responses'][200]['content']['application/json'] =
    await response.json();
  expect(sources.sources.map(source => source.filename).sort()).toEqual([
    'customer-summary-blueprint.md',
    'model-comparison.json',
    'olist-customers-sample.csv',
  ]);
  const dataset = sources.sources.find(source => source.filename.endsWith('.csv'));
  expect(dataset).toBeDefined();
  const csv = await page.request.get(
    `/api/system3/projects/${projectId}/source-versions/${dataset?.id}/content`
  );
  expect(csv.ok()).toBe(true);
  const rows = (await csv.text()).trim().split('\n');
  expect(rows).toHaveLength(1001);
  expect(rows[0]).toBe('customer_unique_id,order_count,last_purchase_date,customer_state,target');
  const comparison = sources.sources.find(source => source.filename === 'model-comparison.json');
  expect(comparison).toBeDefined();
  const comparisonResponse = await page.request.get(
    `/api/system3/projects/${projectId}/source-versions/${comparison?.id}/content`
  );
  expect(comparisonResponse.ok()).toBe(true);
  const comparisonConfig: unknown = await comparisonResponse.json();
  expect(comparisonConfig).toMatchObject({
    modelComparison: {
      models: ['router9/test/model-a', 'router9/test/model-b'],
      requirementIds: expect.any(Array),
    },
  });
  expect(executionRequests).toEqual([]);
  const historyResponse = await page.request.get(`/api/system3/projects/${projectId}/history`);
  expect(historyResponse.ok()).toBe(true);
  expect(await historyResponse.json()).toMatchObject({
    approvals: [],
    executions: [],
    verifications: [],
    deliveries: [],
  });
  await expect(page.getByRole('button', { name: 'Bắt đầu phân tích' })).toBeEnabled();
  await expect(page.getByText('Chi tiết vòng đời · 6 giai đoạn, 10 hoạt động')).toBeVisible();
  await expect(page.getByText('Lịch sử và kỹ thuật')).toBeVisible();
  if (process.env.CAPTURE_SYSTEM3_UI === 'true') {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `/tmp/anvil-olist-project-${width}.png`, fullPage: true });
    }
  }
});

test('sample download failure preserves selected uploads and allows retry', async ({ page }) => {
  await page.route('**/api/providers/pi/models', route =>
    route.fulfill({ json: { models: catalogModels } })
  );
  await page.goto('/console/projects/new');
  await page.getByLabel('Blueprint Markdown').setInputFiles({
    name: 'my-blueprint.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# My project\n'),
  });
  await page.route('**/samples/olist/olist-customers-sample.csv', route =>
    route.fulfill({ status: 503, body: 'Unavailable' })
  );
  await page.getByRole('button', { name: 'Dùng bộ mẫu Olist' }).click();
  await expect(page.getByRole('alert')).toContainText('Không tải được bộ mẫu Olist');
  await expect(page.getByLabel('Blueprint Markdown')).toHaveValue(/my-blueprint.md$/u);
  await expect(page.getByRole('button', { name: 'Dùng bộ mẫu Olist' })).toBeEnabled();
  await page.unroute('**/samples/olist/olist-customers-sample.csv');
  await page.route('**/samples/olist/olist-customers-sample.csv', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Wrong file</html>' })
  );
  await page.getByRole('button', { name: 'Dùng bộ mẫu Olist' }).click();
  await expect(page.getByRole('alert')).toContainText('Tệp mẫu Olist không hợp lệ');
  await expect(page.getByLabel('Blueprint Markdown')).toHaveValue(/my-blueprint.md$/u);
  await page.unroute('**/samples/olist/olist-customers-sample.csv');
  await page.getByRole('button', { name: 'Dùng bộ mẫu Olist' }).click();
  await expect(page.getByRole('status')).toContainText('Đã chọn bộ mẫu');
});
