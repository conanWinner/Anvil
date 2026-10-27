import { expect, test } from '@playwright/test';

// Full experiment flow through the web UI with real models via 9router. Opt-in: it spends tokens
// and runs for tens of minutes (agent build, review, four sandboxed model runs, verification).
test('runs the Olist review-risk experiment from the default form to a chosen variant @experiment-live', async ({
  page,
}, testInfo) => {
  test.skip(process.env.ANVIL_LIVE_9ROUTER !== 'true', 'Requires explicit live 9router opt-in.');
  test.setTimeout(75 * 60_000);
  await page.goto('/console/projects/new');
  await expect(page.getByLabel('Agent thi công (viết code)')).not.toHaveValue('', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Dùng bộ mẫu Olist' }).click();
  await expect(page.getByRole('status')).toContainText('Đã chọn bộ mẫu');
  await page.getByLabel('Tên dự án').fill(`Olist review risk live ${Date.now().toString()}`);
  await page.getByRole('button', { name: 'Tạo và bắt đầu phân tích', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/flow$/u, { timeout: 60_000 });

  const accept = page.getByRole('button', { name: 'Chấp nhận Bản hiểu' });
  await expect(accept).toBeEnabled({ timeout: 120_000 });
  await accept.click();

  const plan = page.locator('section[aria-labelledby="plan-summary-title"]');
  await expect(plan).toContainText('Kế hoạch thí nghiệm', { timeout: 120_000 });
  for (const name of ['Logistic Regression', 'Random Forest', 'XGBoost', 'LightGBM'])
    await expect(plan).toContainText(name);
  await expect(plan).toContainText('ROC-AUC');
  await page.getByRole('button', { name: 'Phê duyệt và chạy', exact: true }).click();

  // Build first: the agent writes and smoke-tests the code, then the user chooses what to run.
  await expect(page.getByRole('heading', { name: 'Code đã sẵn sàng' })).toBeVisible({
    timeout: 40 * 60_000,
  });
  await page.screenshot({ path: testInfo.outputPath('experiment-build.png'), fullPage: true });
  await page.getByRole('button', { name: 'Chạy 4 phương án' }).click();

  await expect(page.getByRole('heading', { name: 'Kết quả thí nghiệm' })).toBeVisible({
    timeout: 40 * 60_000,
  });
  const rows = page.locator('.s3-experiment-table tbody > tr');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('.s3-suggestion')).toContainText('ROC-AUC');
  await page.screenshot({ path: testInfo.outputPath('experiment-results.png'), fullPage: true });

  const baseline = page.getByRole('radio', { name: 'Chọn Logistic Regression' });
  await baseline.check();
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: /^Chọn Logistic Regression và tải gói$/u }).click();
  await (await downloadPromise).saveAs(testInfo.outputPath('experiment-package.tar.gz'));
  await expect(page.getByRole('radio', { name: 'Chọn Logistic Regression' })).toBeDisabled();
});
