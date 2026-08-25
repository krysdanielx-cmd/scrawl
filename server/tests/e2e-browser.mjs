import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5198';
const browser = await chromium.launch({ headless: true });
let passed = 0;

async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

  await page.route('**/api/auth/signup', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    assert.equal(body.email, 'owner@example.com');
    assert.equal(body.password, 'long-test-password');
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'signup.jwt.token',
        user: { id: 'user-1', email: body.email },
        folders: [
          { id: 'folder-1', name: 'OGTool', position: 0 },
          { id: 'folder-2', name: 'Vision', position: 1 },
        ],
      }),
    });
  });

  await check('mobile auth page geometry', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      emailFont: parseFloat(getComputedStyle(document.querySelector('#email')).fontSize),
      passwordFont: parseFloat(getComputedStyle(document.querySelector('#password')).fontSize),
      mainHeight: document.querySelector('main').getBoundingClientRect().height,
    }));
    assert.equal(geometry.width, geometry.viewport);
    assert.ok(geometry.emailFont >= 16);
    assert.ok(geometry.passwordFont >= 16);
    assert.ok(geometry.mainHeight >= 844);
  });

  await check('signup browser flow', async () => {
    await page.getByRole('button', { name: /create the owner account/i }).click();
    await page.getByLabel('Email').fill('owner@example.com');
    await page.getByLabel('Password').fill('long-test-password');
    await page.getByRole('button', { name: 'Create Scrawl' }).click();
    await page.getByRole('heading', { name: 'Your notes' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('scrawl_session')), 'signup.jwt.token');
    const folderLabels = await page.locator('.nav-item').allTextContents();
    assert.ok(folderLabels.some((label) => label.includes('OGTool')));
    assert.ok(folderLabels.some((label) => label.includes('Vision')));
  });

  await check('sign out clears token', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Open Scrawl' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('scrawl_session')), null);
  });

  await page.route('**/api/auth/login', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    assert.equal(body.email, 'owner@example.com');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'login.jwt.token',
        user: { id: 'user-1', email: body.email },
        folders: [
          { id: 'folder-1', name: 'OGTool', position: 0 },
          { id: 'folder-2', name: 'Vision', position: 1 },
        ],
      }),
    });
  });

  await check('login browser flow', async () => {
    await page.getByLabel('Email').fill('owner@example.com');
    await page.getByLabel('Password').fill('long-test-password');
    await page.getByRole('button', { name: 'Open desk' }).click();
    await page.getByRole('heading', { name: 'Your notes' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('scrawl_session')), 'login.jwt.token');
    const folderLabels = await page.locator('.nav-item').allTextContents();
    assert.ok(folderLabels.some((label) => label.includes('OGTool')));
    assert.ok(folderLabels.some((label) => label.includes('Vision')));
  });

  await check('no browser errors', async () => assert.deepEqual(errors, []));
  await context.close();
  console.log(`${passed} browser checks passed`);
} finally {
  await browser.close();
}
