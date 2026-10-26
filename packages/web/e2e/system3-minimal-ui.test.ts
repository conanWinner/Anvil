import { expect, test, type Page } from '@playwright/test';

/** The create form defaults to experiment mode; older flows pick their mode explicitly. */
async function selectProjectMode(page: Page, mode: 'comparison' | 'legacy'): Promise<void> {
  const advanced = page.getByText('Cấu hình bộ kiểm tra và nâng cao', { exact: true });
  if (!(await advanced.evaluate(element => element.parentElement?.hasAttribute('open') ?? false)))
    await advanced.click();
  await page.getByLabel('Chế độ dự án').selectOption(mode);
}

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
];

test('opens the minimal project entry and keeps the sample action in the compact viewport', async ({
  page,
}) => {
  await page.route('**/api/system3/projects', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/api/providers/pi/models', route =>
    route.fulfill({ json: { models: catalogModels } })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/console\/projects$/u);
  await expect(page.getByRole('heading', { name: 'Dự án của bạn' })).toBeVisible();
  await page.getByRole('link', { name: 'Tạo dự án' }).click();
  await expect(page.getByRole('heading', { name: 'Tạo dự án', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dùng bộ mẫu Olist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dùng bộ mẫu Olist' })).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('catalog retry preserves the draft and invalid model selections never create a project', async ({
  page,
}) => {
  let catalogAttempts = 0;
  let createAttempts = 0;
  await page.route('**/api/providers/pi/models', route => {
    catalogAttempts += 1;
    return route.fulfill(
      catalogAttempts === 1
        ? { status: 503, json: { error: 'Catalog unavailable' } }
        : { json: { models: catalogModels } }
    );
  });
  await page.route('**/api/system3/projects', route => {
    if (route.request().method() === 'POST') createAttempts += 1;
    return route.fulfill({
      status: 503,
      json: { error: 'Deliberate test stop before persistence' },
    });
  });
  await page.goto('/console/projects/new');
  await selectProjectMode(page, 'comparison');
  await page.getByLabel('Tên dự án').fill('Kept draft');
  await page.getByLabel('Blueprint Markdown').setInputFiles({
    name: 'draft.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Kept blueprint'),
  });
  await expect(page.getByRole('button', { name: 'Tải lại danh sách model' })).toBeEnabled();
  await page.getByRole('button', { name: 'Tải lại danh sách model' }).click();
  await expect(page.getByLabel('Test Model A')).toBeVisible();
  await expect(page.getByLabel('Tên dự án')).toHaveValue('Kept draft');
  await expect(page.getByLabel('Blueprint Markdown')).toHaveValue(/draft.md$/u);
  await page.getByLabel('Prompt chung').fill('Read the pinned CSV and print JSON.');
  await page.getByLabel('Requirement IDs (phân cách bằng dấu phẩy hoặc xuống dòng)').fill('FR-01');
  await page.getByLabel('Harness Python (.py, tối đa 64 KiB)').setInputFiles({
    name: 'check.py',
    mimeType: 'text/x-python',
    buffer: Buffer.from('print("checks")'),
  });
  const manual = page.getByLabel('Mã model thủ công (2–4, mỗi dòng một model)');
  for (const refs of [
    '',
    'router9/a',
    'router9/a\nrouter9/a',
    'router9/a\nrouter9/b\nrouter9/c\nrouter9/d\nrouter9/e',
  ]) {
    await manual.fill(refs);
    await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Chọn 2–4 model khác nhau');
  }
  expect(createAttempts).toBe(0);
  for (const refs of ['router9/a\nrouter9/b', 'router9/a\nrouter9/b\nrouter9/c\nrouter9/d']) {
    await manual.fill(refs);
    await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Deliberate test stop before persistence');
  }
  expect(createAttempts).toBe(2);
});
