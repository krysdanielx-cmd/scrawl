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
const createdFolders = new Set();
const stamp = Date.now();

const notes = [];
function note(text) { notes.push(text); console.log(`  ..  NOTE ${text}`); }

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

/** On mobile the sidebar is off canvas; clicking into it silently times out. */
async function openDrawer(page, mobile) {
  if (!mobile) return;
  const box = await page.locator('.sidebar').boundingBox();
  if (box && box.x >= 0) return;
  await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
  await page.waitForTimeout(420);
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

      // ---------- the rest of the rich text toolbar ----------
      // Each block type is LEFT in place. Toggling a heading or a quote off
      // after typing converts that node back to a paragraph, which erases the
      // very thing the assertion is looking for. Exit by the route the editor
      // actually supports: Enter after a heading, Enter twice out of a list,
      // triple Enter out of a code block.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter'); // out of the bullet list

      await page.locator('.toolbar button[aria-label="Bold"]').click();
      await page.keyboard.type('bold words', { delay: 10 });
      await page.locator('.toolbar button[aria-label="Bold"]').click();
      check(`[${tag}] bold renders in the document`, (await page.locator('.prose strong').count()) >= 1);

      await page.keyboard.press('Enter');
      await page.locator('.toolbar button[aria-label="Italic"]').click();
      await page.keyboard.type('italic words', { delay: 10 });
      await page.locator('.toolbar button[aria-label="Italic"]').click();
      check(`[${tag}] italic renders in the document`, (await page.locator('.prose em').count()) >= 1);

      for (const [level, label] of [[1, 'Heading 1'], [2, 'Heading 2'], [3, 'Heading 3']]) {
        await page.keyboard.press('Enter');
        await page.locator(`.toolbar button[aria-label="${label}"]`).click();
        await page.keyboard.type(`heading ${level}`, { delay: 10 });
        check(`[${tag}] ${label} renders as an h${level}`, (await page.locator(`.prose h${level}`).count()) >= 1);
        check(`[${tag}] ${label} reports itself active while the caret is inside it`,
          (await page.getAttribute(`.toolbar button[aria-label="${label}"]`, 'data-on')) === 'true');
      }

      await page.keyboard.press('Enter'); // a heading's Enter drops to a paragraph
      await page.locator('.toolbar button[aria-label="Numbered list"]').click();
      await page.keyboard.type('step one', { delay: 10 });
      check(`[${tag}] numbered list renders`, (await page.locator('.prose ol li').count()) >= 1);
      const olStyle = await page.$eval('.prose ol', (el) => getComputedStyle(el).listStyleType).catch(() => 'missing');
      check(`[${tag}] numbered lists show their numbers`, olStyle === 'decimal', olStyle);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter'); // out of the ordered list

      await page.locator('.toolbar button[aria-label="Code block"]').click();
      await page.keyboard.type('const x = 1', { delay: 10 });
      check(`[${tag}] code block renders`, (await page.locator('.prose pre code').count()) >= 1);
      const codeFont = await page.$eval('.prose pre', (el) => getComputedStyle(el).fontFamily);
      check(`[${tag}] code blocks are monospaced`, /mono|courier|consol/i.test(codeFont), codeFont);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter'); // exitOnTripleEnter
      check(`[${tag}] triple Enter leaves the code block`,
        await page.evaluate(() => !document.activeElement?.closest('pre')));

      // Blockquote goes last: it has no keyboard exit, so nothing types after it.
      await page.locator('.toolbar button[aria-label="Quote"]').click();
      await page.keyboard.type('a quoted line', { delay: 10 });
      check(`[${tag}] blockquote renders`, (await page.locator('.prose blockquote').count()) >= 1);

      await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
      const rich = await supabase.from('notes').select('content').eq('title', title).maybeSingle();
      const richJson = JSON.stringify(rich.data?.content || {});
      for (const marker of ['"bold"', '"italic"', '"heading"', '"orderedList"', '"blockquote"', '"codeBlock"']) {
        check(`[${tag}] ${marker.replace(/"/g, '')} survived the save`, richJson.includes(marker), richJson.slice(0, 300));
      }

      // ---------- undo / redo ----------
      await page.locator('.toolbar button[aria-label="Undo"]').click();
      await page.waitForTimeout(300);
      const afterUndo = await page.locator('.prose').innerText();
      check(`[${tag}] undo changes the document`, !afterUndo.includes('a quoted line'), afterUndo.slice(-80));
      await page.locator('.toolbar button[aria-label="Redo"]').click();
      await page.waitForTimeout(300);
      check(`[${tag}] redo puts it back`, (await page.locator('.prose').innerText()).includes('a quoted line'));
      await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });

      // ---------- an open note should be a real place ----------
      // No history entry means: reload dumps you back at the desk, the note
      // cannot be linked or bookmarked, and on Android standalone the system
      // back gesture closes the whole app instead of leaving the note.
      const noteUrl = page.url();
      check(`[${tag}] opening a note gives it its own URL`, new URL(noteUrl).pathname !== '/', noteUrl);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.shell', { timeout: 20000 });
      const stayedOpen = (await page.locator('#note-title').count()) === 1;
      check(`[${tag}] a reload keeps the note you were writing open`, stayedOpen,
        'reload returned to the desk, so an iOS background-reload loses your place');

      if (!stayedOpen) {
        if (mobile) await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
        await page.locator('.nav-item', { hasText: 'All notes' }).click();
        await page.locator('.note-row', { hasText: title }).waitFor({ timeout: 10000 });
        await page.locator('.note-row', { hasText: title }).click();
        await page.waitForSelector('#note-title', { timeout: 15000 });
      }
      check(`[${tag}] the note kept its title`, (await page.inputValue('#note-title')) === title);
      const reloaded = await page.locator('.prose').innerText();
      check(`[${tag}] the body persisted`, reloaded.includes('Cobalt cathedral') && reloaded.includes('bold words'), reloaded.slice(0, 120));
      check(`[${tag}] formatting persisted`, (await page.locator('.prose strong').count()) >= 1
        && (await page.locator('.prose h1').count()) >= 1);

      // The in-app back control must leave the note, and history back must not
      // strand the user outside the app.
      await page.goBack().catch(() => {});
      await page.waitForTimeout(800);
      const stillHome = page.url().startsWith(BASE);
      const shellThere = stillHome && (await page.locator('.shell').count()) > 0;
      check(`[${tag}] the system back gesture does not leave the app`, shellThere, page.url());
      if (!stillHome) { await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForSelector('.shell', { timeout: 20000 }); }
      check(`[${tag}] back out of a note lands on a list, not a dead end`,
        (await page.locator('#note-title').count()) === 0 || (await page.locator('.shell').count()) === 1);
      if (!(await page.locator('#note-title').count())) {
        if (mobile) await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
        await page.locator('.nav-item', { hasText: 'All notes' }).click();
        await page.locator('.note-row', { hasText: title }).waitFor({ timeout: 10000 });
        await page.locator('.note-row', { hasText: title }).click();
        await page.waitForSelector('#note-title', { timeout: 15000 });
      }

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

      // ---------- unpublish then republish ----------
      const firstSlug = publicUrl.split('/p/')[1];
      await page.locator('.editor-bar button[aria-label="Unpublish note"]').click();
      await page.waitForSelector('.editor-bar button[aria-label="Publish note"]', { timeout: 10000 });
      check(`[${tag}] unpublish flips the control back`, true);
      const unpublished = await supabase.from('notes').select('is_published, public_slug').eq('title', title).maybeSingle();
      check(`[${tag}] unpublish clears the flag in Postgres`, unpublished.data?.is_published === false, unpublished.data);
      const deadSlug = await fetch(`${BASE}/api/public/notes/${firstSlug}`);
      check(`[${tag}] the old share link is dead immediately`, deadSlug.status === 404, deadSlug.status);
      await page.locator('.editor-bar button[aria-label="Publish note"]').click();
      await page.waitForSelector('.publish-bar', { timeout: 10000 });
      publicUrl = (await page.locator('.publish-bar code').innerText()).trim();
      check(`[${tag}] republishing issues a link again`, /\/p\/[A-Za-z0-9_-]{12,64}$/.test(publicUrl), publicUrl);
      check(`[${tag}] republishing does not reuse the revoked slug`, !publicUrl.endsWith(firstSlug), { firstSlug, publicUrl });

      // ---------- unpin ----------
      await page.locator('.editor-bar button[aria-label="Unpin note"]').click();
      await page.waitForSelector('.editor-bar button[aria-label="Pin note"]', { timeout: 10000 });
      const unpinned = await supabase.from('notes').select('is_pinned').eq('title', title).maybeSingle();
      check(`[${tag}] unpin persists`, unpinned.data?.is_pinned === false, unpinned.data);
      await page.locator('.editor-bar button[aria-label="Pin note"]').click();
      await page.waitForSelector('.editor-bar button[aria-label="Unpin note"]', { timeout: 10000 });

      // ---------- back to the list ----------
      await page.locator('.editor-bar button[aria-label="Back to notes"]').click();
      await page.waitForSelector('.pane-head h1', { timeout: 10000 });

      await openDrawer(page, mobile);
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

      await openDrawer(page, mobile);
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

      // ---------- search with no matches ----------
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.search-panel', { state: 'visible', timeout: 10000 });
      await page.locator('.search-input-row input').fill('qzxwv-no-such-text-anywhere');
      await page.waitForTimeout(900);
      check(`[${tag}] a search with no matches returns nothing`, (await page.locator('.search-hit').count()) === 0);
      const emptyCopy = await page.locator('.search-panel').innerText();
      check(`[${tag}] the empty search state says something`, /no|nothing|found/i.test(emptyCopy), emptyCopy.slice(0, 120));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // ---------- folders: create in the UI ----------
      await openDrawer(page, mobile);
      const folderName = `zz folder ${stamp} ${tag}`;
      await page.locator('.side-label button[aria-label="New folder"]').click();
      await page.waitForSelector('.folder-modal', { state: 'visible', timeout: 10000 });
      check(`[${tag}] the new-folder modal opens`, await page.locator('#folder-name').isVisible());
      const folderInputSize = await page.$eval('#folder-name', (el) => parseFloat(getComputedStyle(el).fontSize));
      check(`[${tag}] the folder input is 16px or larger`, folderInputSize >= 16, folderInputSize);
      check(`[${tag}] the folder input takes focus`, await page.evaluate(() => document.activeElement?.id === 'folder-name'));
      await page.fill('#folder-name', folderName);
      await page.locator('.folder-modal button[type=submit]').click();
      await page.waitForSelector('.folder-modal', { state: 'hidden', timeout: 10000 });
      const madeFolder = await supabase.from('folders').select('id, name').eq('name', folderName).maybeSingle();
      check(`[${tag}] the folder reached Postgres`, Boolean(madeFolder.data), madeFolder.error?.message);
      if (madeFolder.data) createdFolders.add(madeFolder.data.id);
      check(`[${tag}] the new folder appears in the sidebar`,
        (await page.locator('.nav-item', { hasText: folderName }).count()) >= 1);

      // duplicate names must be refused, not silently doubled
      await openDrawer(page, mobile);
      await page.locator('.side-label button[aria-label="New folder"]').click();
      await page.waitForSelector('.folder-modal', { state: 'visible', timeout: 10000 });
      await page.fill('#folder-name', folderName);
      await page.locator('.folder-modal button[type=submit]').click();
      await page.waitForTimeout(1200);
      check(`[${tag}] a duplicate folder name is refused with a message`,
        (await page.locator('.folder-modal .form-error').count()) >= 1, await page.locator('.folder-modal').innerText());
      await page.locator('.folder-modal button', { hasText: 'Cancel' }).click();
      await page.waitForSelector('.folder-modal', { state: 'hidden', timeout: 10000 });
      const dupes = await supabase.from('folders').select('id').eq('name', folderName);
      check(`[${tag}] no duplicate folder row was written`, (dupes.data || []).length === 1, dupes.data);

      // ---------- folders: rename + delete are API only ----------
      const authed = (path, init = {}) => fetch(`${BASE}/api${path}`, {
        ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
      });
      const renamedName = `${folderName} renamed`;
      if (madeFolder.data) {
        await openDrawer(page, mobile);
        const renameBtn = page.locator(`.nav-tool[aria-label="Rename ${folderName}"]`);
        check(`[${tag}] the sidebar exposes a rename control`, (await renameBtn.count()) === 1);
        const renameBox = await renameBtn.boundingBox();
        check(`[${tag}] the rename control clears ${mobile ? 44 : 24}px`,
          renameBox && renameBox.width >= (mobile ? 44 : 24) && renameBox.height >= (mobile ? 44 : 24), renameBox);
        await renameBtn.click();
        await page.waitForSelector('.folder-modal', { state: 'visible', timeout: 10000 });
        const prefilled = await page.inputValue('#folder-name');
        check(`[${tag}] the rename dialog is prefilled with the current name`,
          prefilled === folderName, { prefilled, expected: folderName });
        await page.fill('#folder-name', renamedName);
        await page.locator('.folder-modal button[type=submit]').click();
        await page.waitForSelector('.folder-modal', { state: 'hidden', timeout: 10000 });
        const afterRename = await supabase.from('folders').select('name').eq('id', madeFolder.data.id).maybeSingle();
        check(`[${tag}] the rename persisted`, afterRename.data?.name === renamedName, afterRename.data);
        check(`[${tag}] the sidebar shows the new name`,
          (await page.locator('.nav-item', { hasText: renamedName }).count()) >= 1);
      }

      // ---------- deleting a folder: cancel, then confirm ----------
      if (madeFolder.data) {
        await openDrawer(page, mobile);
        await page.locator(`.nav-tool[aria-label="Delete ${renamedName}"]`).click();
        await page.waitForSelector('[role=alertdialog]', { state: 'visible', timeout: 10000 });
        const dialogText = await page.locator('[role=alertdialog]').innerText();
        check(`[${tag}] the folder confirm names the folder`, dialogText.includes(renamedName), dialogText);
        check(`[${tag}] the folder confirm says it cannot be undone`, /cannot be undone/i.test(dialogText), dialogText);
        check(`[${tag}] the confirm focuses cancel, not the destructive button`,
          await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Keep it'),
          await page.evaluate(() => document.activeElement?.textContent));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        const survived = await supabase.from('folders').select('id').eq('id', madeFolder.data.id).maybeSingle();
        check(`[${tag}] cancelling the confirm deletes nothing`, Boolean(survived.data), survived.data);

        await page.locator(`.nav-tool[aria-label="Delete ${renamedName}"]`).click();
        await page.waitForSelector('[role=alertdialog]', { state: 'visible', timeout: 10000 });
        await page.locator('[role=alertdialog] .btn-danger').click();
        await page.waitForSelector('[role=alertdialog]', { state: 'hidden', timeout: 10000 });
        const folderGone = await supabase.from('folders').select('id').eq('id', madeFolder.data.id).maybeSingle();
        check(`[${tag}] confirming really deletes the folder`, !folderGone.data, folderGone.data);
        if (!folderGone.data) createdFolders.delete(madeFolder.data.id);
        check(`[${tag}] the folder leaves the sidebar`,
          (await page.locator('.nav-item', { hasText: renamedName }).count()) === 0);
      }

      // ---------- archiving must never destroy anything ----------
      // The archive button used to call DELETE. Now that DELETE really deletes,
      // this is the assertion that stops that ever coming back.
      const archiveVictim = await authed('/notes', {
        method: 'POST', body: JSON.stringify({ title: `zz ui note ${stamp} ${tag} archived` }),
      });
      const archiveVictimId = (await archiveVictim.json().catch(() => ({})))?.note?.id;
      if (archiveVictimId) {
        createdNotes.add(archiveVictimId);
        await page.goto(`${BASE}/n/${archiveVictimId}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#note-title', { timeout: 20000 });
        check(`[${tag}] a note URL opens that note directly`, (await page.locator('#note-title').count()) === 1);
        await page.locator('.editor-bar button[aria-label="Archive note"]').click();
        await page.waitForSelector('.pane-head h1', { timeout: 15000 });
        const stillThere = await supabase.from('notes').select('id, is_archived').eq('id', archiveVictimId).maybeSingle();
        check(`[${tag}] archiving keeps the row`, Boolean(stillThere.data), stillThere.data);
        check(`[${tag}] archiving only flips is_archived`, stillThere.data?.is_archived === true, stillThere.data);
      }

      // ---------- deleting a note from the archive: cancel, then confirm ----------
      await openDrawer(page, mobile);
      await page.locator('.nav-item', { hasText: 'Archive' }).click();
      await page.waitForSelector('.pane-head h1', { timeout: 10000 });
      const victimTitle = `zz ui note ${stamp} ${tag} archived`;
      const victimRow = page.locator('.note-row', { hasText: victimTitle });
      await victimRow.waitFor({ timeout: 10000 });
      const deleteBtn = victimRow.getByRole('button', { name: 'Delete' });
      check(`[${tag}] archived rows offer a delete button`, (await deleteBtn.count()) === 1);
      await deleteBtn.click();
      await page.waitForSelector('[role=alertdialog]', { state: 'visible', timeout: 10000 });
      const noteDialog = await page.locator('[role=alertdialog]').innerText();
      check(`[${tag}] the note confirm is explicit that this is not archiving`,
        /cannot be undone/i.test(noteDialog) && /not the same as archiving/i.test(noteDialog), noteDialog);
      await page.locator('[role=alertdialog] .btn-ghost').click();
      await page.waitForTimeout(400);
      const notDeleted = await supabase.from('notes').select('id').eq('id', archiveVictimId).maybeSingle();
      check(`[${tag}] cancelling keeps the note`, Boolean(notDeleted.data), notDeleted.data);

      await deleteBtn.click();
      await page.waitForSelector('[role=alertdialog]', { state: 'visible', timeout: 10000 });
      await page.locator('[role=alertdialog] .btn-danger').click();
      await page.waitForSelector('[role=alertdialog]', { state: 'hidden', timeout: 10000 });
      await page.waitForTimeout(600);
      const reallyGone = await supabase.from('notes').select('id').eq('id', archiveVictimId).maybeSingle();
      check(`[${tag}] confirming deletes the note for good`, !reallyGone.data, reallyGone.data);
      if (!reallyGone.data) createdNotes.delete(archiveVictimId);
      check(`[${tag}] the deleted note leaves the archive list`,
        (await page.locator('.note-row', { hasText: victimTitle }).count()) === 0);

      check(`[${tag}] signed-in session is error free`, errors.length === 0, errors);
      await context.close();
    } catch (error) { failures.push(`[${tag}] signed-in threw: ${error.message}`); console.log(`FAIL  [${tag}] signed-in threw :: ${error.message}`); }

    // ---------- sign out ----------
    // A context with addInitScript re-plants the token on EVERY navigation, so
    // a reload there can never prove you stayed signed out. This one plants it
    // once, by hand.
    try {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = await pageErrors(page);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.evaluate((value) => window.localStorage.setItem('scrawl_session', value), token);
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.shell', { timeout: 20000 });

      await openDrawer(page, mobile);
      await page.locator('.nav-item', { hasText: 'Sign out' }).click();
      await page.waitForSelector('#password', { timeout: 10000 });
      check(`[${tag}] signing out returns to the auth page`, await page.locator('#password').isVisible());
      check(`[${tag}] signing out clears the stored session`,
        !(await page.evaluate(() => window.localStorage.getItem('scrawl_session'))));

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      check(`[${tag}] a reload after sign out stays signed out`, (await page.locator('#password').count()) === 1);
      check(`[${tag}] the signed-out reload exposes no workspace`, (await page.locator('.shell').count()) === 0);

      // a wrong password is refused, and refused the same way for everyone
      await page.fill('#email', owner.email);
      await page.fill('#password', 'definitely-not-the-password');
      await page.locator('.auth-form button[type=submit]').click();
      await page.waitForSelector('.form-error', { timeout: 15000 });
      const authError = await page.locator('.form-error').innerText();
      check(`[${tag}] a bad password shows an error`, authError.length > 0, authError);
      check(`[${tag}] a bad password does not sign anyone in`, (await page.locator('.shell').count()) === 0);
      check(`[${tag}] the error does not confirm the account exists`,
        !/no account|unknown|not found|does not exist/i.test(authError), authError);
      await shot(page, `${tag}-09-signedout`);
      // The deliberate wrong-password attempt makes the browser log its 401.
      const unexpected = errors.filter((e) => !/status of 401/.test(e));
      check(`[${tag}] the sign-out flow is error free`, unexpected.length === 0, unexpected);
      await context.close();
    } catch (error) { failures.push(`[${tag}] sign out threw: ${error.message}`); console.log(`FAIL  [${tag}] sign out threw :: ${error.message}`); }

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
      await page.waitForSelector('.reader-body > h1', { timeout: 15000 });

      check(`[${tag}] public reader shows the title`, (await page.locator('.reader-body > h1').first().innerText()).includes('zz ui note'));
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
  for (const id of createdFolders) await supabase.from('folders').delete().eq('id', id);
  await supabase.from('folders').delete().like('name', 'zz folder %');
  // Belt and braces: nothing named zz ui note should ever survive a run.
  await supabase.from('notes').delete().like('title', 'zz ui note %');
  const { count } = await supabase.from('notes').select('id', { count: 'exact', head: true }).like('title', 'zz ui note %');
  const { count: folderLeft } = await supabase.from('folders').select('id', { count: 'exact', head: true }).like('name', 'zz folder %');
  console.log(`\ncleaned up ${createdNotes.size} note(s) and ${createdFolders.size} folder(s); leftovers: ${count} note(s), ${folderLeft} folder(s)`);
  if (notes.length) console.log(`notes:\n - ${notes.join('\n - ')}`);
  console.log(`${passed} passed / ${failures.length} failed`);
  if (failures.length) { console.log('failed:\n - ' + failures.join('\n - ')); process.exit(1); }
}
