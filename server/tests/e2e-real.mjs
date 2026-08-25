import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!email || !password) throw new Error('E2E_EMAIL and E2E_PASSWORD are required');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
const responses = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
page.on('response', (response) => {
  if (response.url().includes('/api/')) responses.push(`${response.status()} ${new URL(response.url()).pathname}`);
});

let token;
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const mobile = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    emailFont: parseFloat(getComputedStyle(document.querySelector('#email')).fontSize),
    passwordFont: parseFloat(getComputedStyle(document.querySelector('#password')).fontSize),
    mainHeight: document.querySelector('main').getBoundingClientRect().height,
  }));
  assert.equal(mobile.viewport, 390);
  assert.equal(mobile.scrollWidth, 390);
  assert.ok(mobile.emailFont >= 16 && mobile.passwordFont >= 16);
  assert.ok(mobile.mainHeight >= 844);
  console.log('PASS mobile auth geometry at 390px');

  await page.getByRole('button', { name: /create the owner account/i }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const signupResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/auth/signup'));
  await page.getByRole('button', { name: 'Create Scrawl' }).click();
  const signupResponse = await signupResponsePromise;
  const signupBody = await signupResponse.json();
  assert.equal(signupResponse.status(), 201, JSON.stringify(signupBody));
  await page.getByRole('heading', { name: 'Your notes' }).waitFor();
  token = await page.evaluate(() => localStorage.getItem('scrawl_session'));
  assert.ok(token && token.split('.').length === 3);
  assert.deepEqual(signupBody.folders.map((folder) => folder.name), ['OGTool', 'Vision']);
  console.log('PASS real signup and OGTool/Vision creation');

  const meResponse = await page.request.get(`${baseUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meBody = await meResponse.json();
  assert.equal(meResponse.status(), 200, JSON.stringify(meBody));
  assert.equal(meBody.user.email, email);
  assert.deepEqual(meBody.folders.map((folder) => folder.name), ['OGTool', 'Vision']);
  console.log('PASS valid JWT on protected /api/me');

  const badMeResponse = await page.request.get(`${baseUrl}/api/me`, { headers: { Authorization: `Bearer ${token.slice(0, -1)}x` } });
  assert.equal(badMeResponse.status(), 401);
  console.log('PASS tampered JWT rejected by /api/me');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Open Scrawl' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('scrawl_session')), null);
  console.log('PASS logout on mobile');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const loginResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/auth/login'));
  await page.getByRole('button', { name: 'Open desk' }).click();
  const loginResponse = await loginResponsePromise;
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status(), 200, JSON.stringify(loginBody));
  assert.deepEqual(loginBody.folders.map((folder) => folder.name), ['OGTool', 'Vision']);
  await page.getByRole('heading', { name: 'Your notes' }).waitFor();
  console.log('PASS real login and folder restoration');

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your notes' }).waitFor();
  console.log('PASS JWT session restoration through /api/me');

  assert.deepEqual(errors, []);
  console.log('PASS no console or page errors');
  console.log(`API responses: ${responses.join(', ')}`);
} finally {
  await context.close();
  await browser.close();
}
