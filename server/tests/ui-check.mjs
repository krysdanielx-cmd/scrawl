/**
 * Browser suite for Scrawl, run against the LIVE https URL.
 *
 * Run from /home/kit so `playwright` resolves:
 *   cd /home/kit && node scrawl/server/tests/ui-check.mjs
 * Knobs: VIEWS='[[390,844]]' to test one viewport, SHOTS=0 to skip screenshots.
 *
 * Safety: signs in by planting a minted JWT for the EXISTING owner. It never
 * creates or deletes a user, and every note it makes is hard-deleted at the end.
 */
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '/home/kit/scrawl/.env' });
const { createToken } = await import('/home/kit/scrawl/server/utils/tokens.js');

const BASE = process.env.TEST_URL || 'https://markedly-avidly-ideal-amphibian.kitten.space';
const SHOT_DIR = '/tmp/scrawl-shots';
const VIEWS = JSON.parse(process.env.VIEWS || '[[390,844],[1440,900]]');
const TAKE_SHOTS = process.env.SHOTS !== '0';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let passed = 0;
const failures = [];
const createdNotes = new Set();
const stamp = Date.now();

function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  ok  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`); }
}

/**
 * Tofu detector. A missing glyph and a real glyph can share an advance width
 * (that is how a page of empty boxes once passed a width check), so this
 * rasterises each non-ASCII character in the page's own font and compares the
 * bitmap to U+E000, which is always missing. Identical pixels = tofu.
 */
async function tofu(page) {
  return page.evaluate(() => {
    const font = getComputedStyle(document.body).fontFamily;
    const chars = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const char of node.textContent) if (char.codePointAt(0) > 127) chars.add(char);
    }
    if (!chars.size) return [];

    const draw = (char, family) => {
      const canvas = document.createElement('canvas');
      canvas.width = 48; canvas.height = 48;
      const ctx = canvas.getContext('2d');
      ctx.font = `32px ${family}`;
      ctx.fillText(char, 6, 36);
      return canvas.getContext('2d').getImageData(0, 0, 48, 48).data.join(',');
    };

    const missing = draw('\uE000', font);
    return [...chars].filter((char) => draw(char, font) === missing);
  });
}

async function pageErrors(page) {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

const overflow = (page) => page.evaluate(() =>
  Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

async function shot(page, name) {
  if (!TAKE_SHOTS) return;
  await fs.mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
}

async function run() {
  const { data: owner } = await supabase.from('users').select('id, email').limit(1).maybeSingle();
  if (!owner) throw new Error('no owner row');
  const token = createToken(owner.id);
  console.log(`Signing in as the existing owner ${owner.email}\nBase: ${BASE}\n`);

  const browser = await chromium.launch();

  for (const [width, height] of VIEWS) {
    const tag = `${width}x${height}`;
    const mobile = width < 900;
    console.log(`\n===== ${tag} =====`);

    // ---------- signed out ----------
    try {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = await pageErrors(page);
      await page.goto(BASE, { waitUntil: 'networkidle' });

      check(`[${tag}] signed-out page shows the auth form`, await page.locator('#password').isVisible());
      check(`[${tag}] signed-out has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      const emailSize = await page.$eval('#email', (el) => parseFloat(getComputedStyle(el).fontSize));
      check(`[${tag}] auth inputs are 16px or larger`, emailSize >= 16, emailSize);
      const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      check(`[${tag}] body uses Plus Jakarta Sans`, /Plus Jakarta Sans/.test(bodyFont), bodyFont);
      const h1Font = await page.$eval('.auth-intro h1', (el) => getComputedStyle(el).fontFamily);
      check(`[${tag}] display type uses Fraunces`, /Fraunces/.test(h1Font), h1Font);
      const accent = await page.$eval('.btn-primary', (el) => getComputedStyle(el).backgroundColor);
      check(`[${tag}] primary button is cobalt`, accent === 'rgb(0, 71, 171)', accent);
      check(`[${tag}] no tofu on the auth page`, (await tofu(page)).length === 0, await tofu(page));
      check(`[${tag}] signed-out page is error free`, errors.length === 0, errors);
      await shot(page, `${tag}-01-auth`);
      await context.close();
    } catch (error) { failures.push(`[${tag}] signed-out threw: ${error.message}`); console.log(`FAIL  [${tag}] signed-out threw :: ${error.message}`); }

    // ---------- signed in ----------
    let publicUrl = null;
    try {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript((value) => window.localStorage.setItem('scrawl_session', value), token);
      const page = await context.newPage();
      const errors = await pageErrors(page);

      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.shell', { timeout: 15000 });

      check(`[${tag}] desk heading renders`, (await page.locator('.pane-head h1').innerText()).includes('Your desk'));
      check(`[${tag}] folder tiles render`, (await page.locator('.folder-tile').count()) >= 3);
      const tileBox = await page.locator('.folder-tile').first().boundingBox();
      check(`[${tag}] folder tile has real width`, tileBox && tileBox.width > 120, tileBox);
      const kbd = await page.locator('.searchbar .kbd').boundingBox();
      check(`[${tag}] the Cmd K pill is not stretched`, kbd && kbd.width < 90, kbd);
      check(`[${tag}] dashboard has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      check(`[${tag}] sidebar is ${mobile ? 'off canvas' : 'visible'}`,
        (await page.locator('.sidebar').boundingBox()).x < 0 === mobile);
      await shot(page, `${tag}-02-dashboard`);

      // ---------- create + autosave ----------
      const title = `zz ui note ${stamp} ${tag}`;
      if (mobile) await page.locator('.topbar .icon-btn[aria-label="New note"]').click();
      else await page.getByRole('button', { name: 'Quick capture' }).click();

      await page.waitForSelector('#note-title', { timeout: 15000 });
      check(`[${tag}] editor opens`, await page.locator('.editor-bar').isVisible());
      check(`[${tag}] toolbar renders`, (await page.locator('.toolbar .tool').count()) >= 12);

      await page.fill('#note-title', title);
      await page.locator('.prose').click();
      await page.keyboard.type('Cobalt cathedral notes for the standup.', { delay: 12 });
      await page.keyboard.press('Enter');
      await page.locator('.toolbar button[aria-label="Bulleted list"]').click();
      await page.keyboard.type('first bullet', { delay: 12 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('second bullet', { delay: 12 });
      await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
      check(`[${tag}] autosave reports saved`, (await page.locator('.save-state').innerText()).includes('Saved'));
      check(`[${tag}] bullet list rendered in the doc`, (await page.locator('.prose ul li').count()) >= 2);

      const created = await supabase.from('notes').select('id, title, content').eq('title', title).maybeSingle();
      check(`[${tag}] the note reached Postgres`, Boolean(created.data), created.error?.message);
      if (created.data) createdNotes.add(created.data.id);
      check(`[${tag}] the body persisted`, JSON.stringify(created.data?.content || {}).includes('Cobalt cathedral'));

      // ---------- checklist ----------
      await page.locator('.toolbar button[aria-label="Checklist"]').click();
      await page.keyboard.type('a task', { delay: 12 });
      check(`[${tag}] checklist renders a checkbox`, (await page.locator('.prose ul[data-type="taskList"] input').count()) >= 1);
      await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
      const kbdFlex = await page.$eval('.kbd', () => 1).catch(() => null);
      void kbdFlex;
      const titleTag = await page.$eval('#note-title', (el) => el.tagName);
      check(`[${tag}] the title field wraps instead of scrolling`, titleTag === 'TEXTAREA', titleTag);
      const titleBox = await page.locator('#note-title').boundingBox();
      const innerBox = await page.locator('.editor-inner').boundingBox();
      check(`[${tag}] the title stays inside its column`,
        titleBox && innerBox && titleBox.x + titleBox.width <= innerBox.x + innerBox.width + 1, { titleBox, innerBox });
      const proseOutline = await page.$eval('.prose', (el) => getComputedStyle(el).outlineStyle);
      check(`[${tag}] the writing area has no input-style focus box`, proseOutline === 'none', proseOutline);
      check(`[${tag}] editor has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      const listStyle = await page.$eval('.prose ul:not([data-type="taskList"])', (el) => getComputedStyle(el).listStyleType).catch(() => 'missing');
      check(`[${tag}] bulleted lists show a marker`, listStyle === 'disc', listStyle);
      check(`[${tag}] no tofu in the editor`, (await tofu(page)).length === 0, await tofu(page));
      await shot(page, `${tag}-03-editor`);

      // ---------- pin + publish ----------
      await page.locator('.editor-bar button[aria-label="Pin note"]').click();
      await page.waitForSelector('.editor-bar button[aria-label="Unpin note"]', { timeout: 10000 });
      check(`[${tag}] pin toggles`, true);

      await page.locator('.editor-bar button[aria-label="Publish note"]').click();
      await page.waitForSelector('.publish-bar', { timeout: 10000 });
      publicUrl = (await page.locator('.publish-bar code').innerText()).trim();
      check(`[${tag}] publish shows a link`, /\/p\/[A-Za-z0-9_-]{12,64}$/.test(publicUrl), publicUrl);
      await shot(page, `${tag}-04-published`);

      // ---------- back to the list ----------
      await page.locator('.editor-bar button[aria-label="Back to notes"]').click();
      await page.waitForSelector('.pane-head h1', { timeout: 10000 });

      if (mobile) await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
      await page.locator('.nav-item', { hasText: 'All notes' }).click();
      await page.locator('.note-row', { hasText: title }).waitFor({ timeout: 10000 });
      check(`[${tag}] the new note is listed`, (await page.locator('.note-row', { hasText: title }).count()) === 1);
      check(`[${tag}] a Pinned section appears`, (await page.locator('.section-head h2', { hasText: 'Pinned' }).count()) >= 1);
      check(`[${tag}] the row shows the Shared tag`, (await page.locator('.tag-live').count()) >= 1);
      const rowBox = await page.locator('.note-row').first().boundingBox();
      check(`[${tag}] note rows have real height`, rowBox && rowBox.height > 40, rowBox);
      check(`[${tag}] list view has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      await shot(page, `${tag}-05-list`);

      // ---------- search ----------
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.search-panel', { state: 'visible', timeout: 10000 });
      await page.locator('.search-input-row input').fill('Cobalt cathedral');
      await page.waitForSelector('.search-hit', { timeout: 10000 });
      check(`[${tag}] search finds the note by body text`, (await page.locator('.search-hit', { hasText: title }).count()) >= 1);
      await shot(page, `${tag}-06-search`);
      await page.locator('.search-hit').first().click();
      await page.waitForSelector('#note-title', { timeout: 10000 });
      check(`[${tag}] a search hit opens the note`, (await page.inputValue('#note-title')) === title);

      // ---------- archive + restore ----------
      await page.locator('.editor-bar button[aria-label="Archive note"]').click();
      let archiveToast = '';
      try {
        await page.locator('.toast', { hasText: 'archive' }).waitFor({ timeout: 10000 });
        archiveToast = await page.locator('.toast').innerText();
      } catch {
        archiveToast = await page.locator('.toast').innerText().catch(() => '(no toast)');
      }
      check(`[${tag}] archiving shows a toast`, archiveToast.includes('archive'), archiveToast);
      await page.waitForSelector('.pane-head h1', { timeout: 10000 });

      if (mobile) await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
      await page.locator('.nav-item', { hasText: 'Archive' }).click();
      await page.locator('.note-row', { hasText: title }).waitFor({ timeout: 10000 });
      check(`[${tag}] the archived note is in Archive`, (await page.locator('.note-row', { hasText: title }).count()) === 1);
      const archivedRow = await supabase.from('notes').select('is_archived, is_published').eq('title', title).maybeSingle();
      check(`[${tag}] archiving revoked the public link`, archivedRow.data?.is_published === false, archivedRow.data);
      await shot(page, `${tag}-07-archive`);

      await page.locator('.note-row', { hasText: title }).getByRole('button', { name: 'Restore' }).click();
      await page.locator('.note-row', { hasText: title }).waitFor({ state: 'detached', timeout: 10000 });
      const restored = await supabase.from('notes').select('is_archived').eq('title', title).maybeSingle();
      check(`[${tag}] restore un-archives the note`, restored.data?.is_archived === false, restored.data);

      check(`[${tag}] signed-in session is error free`, errors.length === 0, errors);
      await context.close();
    } catch (error) { failures.push(`[${tag}] signed-in threw: ${error.message}`); console.log(`FAIL  [${tag}] signed-in threw :: ${error.message}`); }

    // ---------- public reader, no token ----------
    try {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = await pageErrors(page);

      // Archived above, so the old slug must be dead.
      await page.goto(publicUrl || `${BASE}/p/aaaaaaaaaaaaaaaaaaaaaa`, { waitUntil: 'networkidle' });
      check(`[${tag}] a revoked share link shows the not-live page`,
        (await page.locator('.empty h3').innerText()).includes('not live'));
      await context.close();
      void errors;
    } catch (error) { failures.push(`[${tag}] revoked link threw: ${error.message}`); console.log(`FAIL  [${tag}] revoked link threw :: ${error.message}`); }

    // ---------- a live public note ----------
    try {
      const id = [...createdNotes].pop();
      const slug = `uiread${stamp}${width}`.slice(0, 22).padEnd(14, 'x');
      await supabase.from('notes').update({ is_published: true, public_slug: slug }).eq('id', id);

      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = await pageErrors(page);
      await page.goto(`${BASE}/p/${slug}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.reader-body h1', { timeout: 15000 });

      check(`[${tag}] public reader shows the title`, (await page.locator('.reader-body h1').innerText()).includes('zz ui note'));
      check(`[${tag}] public reader shows the body`, (await page.locator('.prose').innerText()).includes('Cobalt cathedral'));
      check(`[${tag}] public reader is read only`, (await page.locator('.prose[contenteditable="true"]').count()) === 0);
      check(`[${tag}] public reader has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      check(`[${tag}] no tofu on the public reader`, (await tofu(page)).length === 0, await tofu(page));
      check(`[${tag}] public reader is error free`, errors.length === 0, errors);
      await shot(page, `${tag}-08-public`);
      await context.close();
    } catch (error) { failures.push(`[${tag}] public reader threw: ${error.message}`); console.log(`FAIL  [${tag}] public reader threw :: ${error.message}`); }
  }

  await browser.close();
}

try {
  await run();
} catch (error) {
  failures.push(`suite threw: ${error.message}`);
  console.error(error);
} finally {
  for (const id of createdNotes) await supabase.from('notes').delete().eq('id', id);
  // Belt and braces: nothing named zz ui note should ever survive a run.
  await supabase.from('notes').delete().like('title', 'zz ui note %');
  const { count } = await supabase.from('notes').select('id', { count: 'exact', head: true }).like('title', 'zz ui note %');
  console.log(`\ncleaned up ${createdNotes.size} note(s); leftovers: ${count}`);
  console.log(`${passed} passed / ${failures.length} failed`);
  if (failures.length) { console.log('failed:\n - ' + failures.join('\n - ')); process.exit(1); }
}
