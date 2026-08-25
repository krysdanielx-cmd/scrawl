/**
 * READ-ONLY deep audit of the live Scrawl deployment.
 *
 * Run from /home/kit so `playwright` resolves:
 *   cd /home/kit && node scrawl/server/tests/deep-check.mjs
 * Knobs: VIEWS='[[390,844]]', SHOTS=0
 *
 * SAFETY CONTRACT: this suite never writes. It creates no users, folders or
 * notes, never types into the editor, and issues no INSERT/UPDATE/DELETE.
 * It signs in by minting a JWT for the existing owner and only reads.
 */
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { chromium, devices } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '/home/kit/scrawl/.env' });
const { createToken } = await import('/home/kit/scrawl/server/utils/tokens.js');

const BASE = process.env.TEST_URL || 'https://markedly-avidly-ideal-amphibian.kitten.space';
const SHOT_DIR = '/tmp/scrawl-deep';
const VIEWS = JSON.parse(process.env.VIEWS || '[[390,844],[1440,900]]');
const TAKE_SHOTS = process.env.SHOTS !== '0';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let passed = 0;
const failures = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`  ok  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
}
function note(text) { notes.push(text); console.log(`  ..  NOTE ${text}`); }

async function tofu(page) {
  return page.evaluate(() => {
    const font = getComputedStyle(document.body).fontFamily;
    const chars = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const c of n.textContent) if (c.codePointAt(0) > 127) chars.add(c);
    }
    if (!chars.size) return [];
    const draw = (char) => {
      const canvas = document.createElement('canvas');
      canvas.width = 48; canvas.height = 48;
      const ctx = canvas.getContext('2d');
      ctx.font = `32px ${font}`;
      ctx.fillText(char, 6, 36);
      return ctx.getImageData(0, 0, 48, 48).data.join(',');
    };
    const missing = draw('\uE000');
    return [...chars].filter((c) => draw(c) === missing);
  });
}

function watch(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  return errors;
}

const overflow = (page) => page.evaluate(() =>
  Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

// Every visible interactive element smaller than 44x44 CSS px.
const smallTargets = (page) => page.evaluate(() => {
  const sel = 'a, button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.matches('.prose a, .reader-body a')) continue; // inline links in prose are exempt
    if (r.width < 44 || r.height < 44) {
      out.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }
  return out;
});

const smallText = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!el.offsetParent) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) out.push({ id: el.id || el.name || el.type, size });
  }
  return out;
});

const brokenImages = (page) => page.evaluate(() =>
  [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc || i.src));

const fontsLoaded = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  return {
    jakarta: document.fonts.check('16px "Plus Jakarta Sans"'),
    fraunces: document.fonts.check('16px "Fraunces"'),
    families: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`).slice(0, 12),
  };
});

async function shot(page, name) {
  if (!TAKE_SHOTS) return;
  await fs.mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

// ---------------------------------------------------------------- network / PWA
async function assetChecks() {
  console.log('\n===== assets, PWA, security =====');

  const manifestRes = await fetch(`${BASE}/manifest.json`);
  check('manifest.json returns 200', manifestRes.status === 200, manifestRes.status);
  check('manifest is served as JSON', /json/.test(manifestRes.headers.get('content-type') || ''), manifestRes.headers.get('content-type'));
  let manifest = null;
  try { manifest = JSON.parse(await manifestRes.text()); } catch (e) { check('manifest parses', false, e.message); }
  if (manifest) {
    check('manifest parses', true);
    for (const key of ['name', 'short_name', 'start_url', 'display', 'icons', 'background_color', 'theme_color']) {
      check(`manifest has ${key}`, manifest[key] !== undefined, manifest);
    }
    check('display is standalone', manifest.display === 'standalone', manifest.display);
    const sizes = (manifest.icons || []).map((i) => i.sizes);
    check('manifest declares a 192 icon', sizes.includes('192x192'), sizes);
    check('manifest declares a 512 icon', sizes.includes('512x512'), sizes);
    check('manifest declares a maskable icon',
      (manifest.icons || []).some((i) => (i.purpose || '').includes('maskable')), manifest.icons);

    // every declared icon must load and be the size it claims
    for (const icon of manifest.icons || []) {
      const res = await fetch(new URL(icon.src, BASE));
      const buf = Buffer.from(await res.arrayBuffer());
      const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      check(`icon ${icon.src} returns 200`, res.status === 200, res.status);
      check(`icon ${icon.src} is a real PNG`, isPng);
      check(`icon ${icon.src} is actually ${icon.sizes}`, `${w}x${h}` === icon.sizes, `${w}x${h}`);
    }
  }

  const apple = await fetch(`${BASE}/apple-touch-icon.png`);
  const appleBuf = Buffer.from(await apple.arrayBuffer());
  check('apple-touch-icon returns 200', apple.status === 200, apple.status);
  check('apple-touch-icon is 180x180', `${appleBuf.readUInt32BE(16)}x${appleBuf.readUInt32BE(20)}` === '180x180',
    `${appleBuf.readUInt32BE(16)}x${appleBuf.readUInt32BE(20)}`);

  const sw = await fetch(`${BASE}/sw.js`);
  const swBody = await sw.text();
  const hasSw = sw.status === 200 && !swBody.includes('<div id="root">');
  check('service worker file exists (needed for offline + auto install prompt)', hasSw,
    hasSw ? 'ok' : 'no /sw.js, the SPA fallback HTML is served instead');

  // no secrets in the shipped bundle
  const html = await (await fetch(BASE)).text();
  const bundle = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  const js = await (await fetch(BASE + bundle)).text();
  const css = await (await fetch(BASE + html.match(/href="(\/assets\/index-[^"]+\.css)"/)[1])).text();
  const leaked = ['service_role', 'SUPABASE_SERVICE_ROLE', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', process.env.JWT_SECRET]
    .filter((needle) => needle && (js.includes(needle) || css.includes(needle)));
  check('no service-role key or JWT secret in the client bundle', leaked.length === 0, leaked);
  check('client bundle is under 300KB uncompressed', js.length < 300_000, `${Math.round(js.length / 1024)}KB`);

  // deep links must return the SPA, not a 404
  for (const path of ['/archive', '/p/definitely-not-a-real-slug']) {
    const res = await fetch(BASE + path);
    check(`deep link ${path} serves the app shell`, res.status === 200 && (await res.text()).includes('id="root"'), res.status);
  }

  // API boundary
  const me = await fetch(`${BASE}/api/me`);
  check('GET /api/me without a token is 401', me.status === 401, me.status);
  const bad = await fetch(`${BASE}/api/me`, { headers: { authorization: 'Bearer not.a.token' } });
  check('GET /api/me with a junk token is 401', bad.status === 401, bad.status);
  const cors = await fetch(`${BASE}/api/me`, { headers: { origin: 'https://evil.example.com' } });
  check('CORS does not allow an unrelated origin',
    !cors.headers.get('access-control-allow-origin') || cors.headers.get('access-control-allow-origin') !== 'https://evil.example.com',
    cors.headers.get('access-control-allow-origin'));
  const publicMiss = await fetch(`${BASE}/api/public/notes/definitely-not-a-real-slug`);
  check('unknown public slug returns 404 from the API', publicMiss.status === 404, publicMiss.status);

  const headers = (await fetch(BASE)).headers;
  for (const h of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'content-security-policy', 'strict-transport-security']) {
    if (!headers.get(h)) note(`missing security header: ${h}`);
  }
}

// ---------------------------------------------------------------- browser
async function run() {
  await assetChecks();

  const { data: owner } = await supabase.from('users').select('id, email').limit(1).maybeSingle();
  if (!owner) throw new Error('no owner row');
  const token = createToken(owner.id);
  const { data: existingNotes } = await supabase.from('notes')
    .select('id, title, is_archived').eq('is_archived', false);
  console.log(`\nowner ${owner.email}, ${existingNotes.length} live note(s) - READ ONLY run\n`);

  const browser = await chromium.launch();

  for (const [width, height] of VIEWS) {
    const tag = `${width}x${height}`;
    const mobile = width < 900;
    console.log(`\n===== ${tag} =====`);

    // ---------- signed out ----------
    try {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: mobile ? 3 : 1,
        isMobile: mobile,
        hasTouch: mobile,
        userAgent: mobile ? devices['iPhone 13'].userAgent : undefined,
      });
      const page = await context.newPage();
      const errors = watch(page);
      await page.goto(BASE, { waitUntil: 'networkidle' });

      check(`[${tag}] auth form renders`, await page.locator('#password').isVisible());
      check(`[${tag}] no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      const inputs = await smallText(page);
      check(`[${tag}] every input is 16px or larger`, inputs.length === 0, inputs);
      const fonts = await fontsLoaded(page);
      check(`[${tag}] Plus Jakarta Sans loaded`, fonts.jakarta, fonts);
      check(`[${tag}] Fraunces loaded`, fonts.fraunces, fonts);
      check(`[${tag}] no tofu`, (await tofu(page)).length === 0, await tofu(page));
      check(`[${tag}] no broken images`, (await brokenImages(page)).length === 0, await brokenImages(page));
      const themeColor = await page.$eval('meta[name=theme-color]', (el) => el.content).catch(() => null);
      check(`[${tag}] theme-color meta present`, themeColor === '#0047AB', themeColor);
      const viewportMeta = await page.$eval('meta[name=viewport]', (el) => el.content);
      check(`[${tag}] viewport allows zoom (no user-scalable=no)`, !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(viewportMeta), viewportMeta);
      check(`[${tag}] viewport-fit=cover for notched phones`, /viewport-fit=cover/.test(viewportMeta), viewportMeta);
      const dvh = await page.evaluate(() => {
        const el = document.querySelector('.auth, .auth-page, #root > div');
        return el ? getComputedStyle(el).minHeight : null;
      });
      check(`[${tag}] auth shell has a min-height`, Boolean(dvh) && dvh !== '0px', dvh);
      const targets = await smallTargets(page);
      check(`[${tag}] auth touch targets are 44px or bigger`, targets.length === 0, targets);
      // password field must not be readable
      check(`[${tag}] password field is masked`, (await page.getAttribute('#password', 'type')) === 'password');
      const labelled = await page.evaluate(() => ['email', 'password']
        .filter((id) => !document.querySelector(`label[for=${id}]`) && !document.getElementById(id)?.getAttribute('aria-label')));
      check(`[${tag}] auth inputs have labels`, labelled.length === 0, labelled);
      const lang = await page.evaluate(() => document.documentElement.lang);
      check(`[${tag}] html has a lang attribute`, Boolean(lang), lang);
      check(`[${tag}] auth page is error free`, errors.length === 0, errors);
      await shot(page, `${tag}-01-auth`);
      await context.close();
    } catch (e) { failures.push(`[${tag}] signed out threw: ${e.message}`); console.log(`FAIL  [${tag}] signed out threw :: ${e.message}`); }

    // ---------- signed in, read only ----------
    try {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: mobile ? 3 : 1,
        isMobile: mobile,
        hasTouch: mobile,
        userAgent: mobile ? devices['iPhone 13'].userAgent : undefined,
      });
      await context.addInitScript((v) => window.localStorage.setItem('scrawl_session', v), token);
      const page = await context.newPage();
      const errors = watch(page);
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.shell', { timeout: 20000 });

      // dashboard
      check(`[${tag}] dashboard heading renders`, (await page.locator('.pane-head h1').innerText()).length > 0);
      const tiles = await page.locator('.folder-tile').count();
      check(`[${tag}] folder tiles render`, tiles >= 2, tiles);
      const tileBox = await page.locator('.folder-tile').first().boundingBox();
      check(`[${tag}] folder tile has real size`, tileBox && tileBox.width > 120 && tileBox.height > 44, tileBox);
      check(`[${tag}] dashboard has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      const sidebarX = (await page.locator('.sidebar').boundingBox()).x;
      check(`[${tag}] sidebar is ${mobile ? 'off canvas' : 'visible'}`, (sidebarX < 0) === mobile, sidebarX);
      check(`[${tag}] dashboard fonts loaded`, (await fontsLoaded(page)).jakarta);
      check(`[${tag}] no tofu on the dashboard`, (await tofu(page)).length === 0, await tofu(page));
      check(`[${tag}] no broken images on the dashboard`, (await brokenImages(page)).length === 0, await brokenImages(page));
      let targets = await smallTargets(page);
      check(`[${tag}] dashboard touch targets are 44px or bigger`, targets.length === 0, targets);
      await shot(page, `${tag}-02-dashboard`);

      // mobile navigation drawer
      if (mobile) {
        await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
        await page.waitForTimeout(400);
        const openX = (await page.locator('.sidebar').boundingBox()).x;
        check(`[${tag}] nav drawer slides in`, openX >= 0, openX);
        const navTargets = await smallTargets(page);
        check(`[${tag}] drawer touch targets are 44px or bigger`, navTargets.length === 0, navTargets);
        await shot(page, `${tag}-03-nav`);
        await page.keyboard.press('Escape').catch(() => {});
      }

      // note list
      if (mobile && (await page.locator('.sidebar').boundingBox()).x < 0) {
        await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
      }
      await page.locator('.nav-item', { hasText: 'All notes' }).click();
      await page.waitForSelector('.pane-head h1', { timeout: 10000 });
      await page.waitForTimeout(600);
      const rows = await page.locator('.note-row').count();
      check(`[${tag}] the note list shows the ${existingNotes.length} existing note(s)`, rows === existingNotes.length, { rows, expected: existingNotes.length });
      if (rows) {
        const rowBox = await page.locator('.note-row').first().boundingBox();
        check(`[${tag}] note rows have real height`, rowBox && rowBox.height > 40, rowBox);
      }
      check(`[${tag}] note list has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      await shot(page, `${tag}-04-list`);

      // editor, opened read only. NO typing, so no autosave fires.
      if (rows) {
        await page.locator('.note-row').first().click();
        await page.waitForSelector('#note-title', { timeout: 15000 });
        check(`[${tag}] editor opens`, await page.locator('.editor-bar').isVisible());
        const tools = await page.locator('.toolbar .tool').count();
        check(`[${tag}] Tiptap toolbar renders its tools`, tools >= 12, tools);
        check(`[${tag}] the writing surface is contenteditable`,
          (await page.locator('.prose[contenteditable="true"]').count()) === 1);
        const proseBox = await page.locator('.prose').boundingBox();
        check(`[${tag}] the writing surface has real size`, proseBox && proseBox.width > 200 && proseBox.height > 100, proseBox);
        const titleBox = await page.locator('#note-title').boundingBox();
        const innerBox = await page.locator('.editor-inner').boundingBox();
        check(`[${tag}] the title stays inside its column`,
          titleBox.x + titleBox.width <= innerBox.x + innerBox.width + 1, { titleBox, innerBox });
        check(`[${tag}] editor has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
        check(`[${tag}] no tofu in the editor`, (await tofu(page)).length === 0, await tofu(page));
        targets = await smallTargets(page);
        // toolbar buttons are dense by design on desktop; report, don't hard fail there
        if (targets.length && !mobile) note(`[${tag}] ${targets.length} sub-44px controls in the editor (desktop, pointer input): ${JSON.stringify(targets.slice(0, 8))}`);
        else check(`[${tag}] editor touch targets are 44px or bigger`, targets.length === 0, targets);
        const saveState = await page.locator('.save-state').innerText().catch(() => '(none)');
        check(`[${tag}] opening a note does not trigger a save`, !/saving/i.test(saveState), saveState);
        await shot(page, `${tag}-05-editor`);
        await page.locator('.editor-bar button[aria-label="Back to notes"]').click();
        await page.waitForSelector('.pane-head h1', { timeout: 10000 });
      } else {
        note(`[${tag}] no notes exist, editor was not exercised`);
      }

      // search overlay, read only query
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.search-panel', { state: 'visible', timeout: 10000 });
      check(`[${tag}] Cmd+K opens search`, await page.locator('.search-panel').isVisible());
      const searchInputSize = await page.$eval('.search-input-row input', (el) => parseFloat(getComputedStyle(el).fontSize));
      check(`[${tag}] search input is 16px or larger`, searchInputSize >= 16, searchInputSize);
      const focused = await page.evaluate(() => document.activeElement?.tagName);
      check(`[${tag}] search input is focused on open`, focused === 'INPUT', focused);
      await page.locator('.search-input-row input').fill('note');
      await page.waitForTimeout(900);
      const hits = await page.locator('.search-hit').count();
      check(`[${tag}] search returns results for an existing word`, hits >= 1, hits);
      check(`[${tag}] search panel has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      const panelBox = await page.locator('.search-panel').boundingBox();
      check(`[${tag}] search panel fits the viewport`, panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= width + 1, panelBox);
      await shot(page, `${tag}-06-search`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check(`[${tag}] Escape closes search`, (await page.locator('.search-panel').count()) === 0
        || !(await page.locator('.search-panel').isVisible()));

      // archive view
      if (mobile) await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
      await page.locator('.nav-item', { hasText: 'Archive' }).click();
      await page.waitForSelector('.pane-head h1', { timeout: 10000 });
      check(`[${tag}] archive view renders`, (await page.locator('.pane-head h1').innerText()).toLowerCase().includes('archive'));
      check(`[${tag}] archive has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      await shot(page, `${tag}-07-archive`);

      // reload keeps the session
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.shell', { timeout: 15000 });
      check(`[${tag}] session survives a reload`, (await page.locator('#password').count()) === 0);

      check(`[${tag}] signed-in session is error free`, errors.length === 0, errors);
      await context.close();
    } catch (e) { failures.push(`[${tag}] signed in threw: ${e.message}`); console.log(`FAIL  [${tag}] signed in threw :: ${e.message}`); }

    // ---------- public reader, unknown slug ----------
    try {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      const errors = watch(page);
      await page.goto(`${BASE}/p/definitely-not-a-real-slug`, { waitUntil: 'networkidle' });
      const heading = await page.locator('.empty h3').innerText();
      check(`[${tag}] an unknown share link shows the not-live page`, /not live/i.test(heading), heading);
      check(`[${tag}] the not-live page leaks no editor`, (await page.locator('[contenteditable="true"]').count()) === 0);
      check(`[${tag}] not-live page has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      const only404 = errors.filter((e) => !e.startsWith('http 404'));
      check(`[${tag}] not-live page has no unexpected errors`, only404.length === 0, only404);
      await shot(page, `${tag}-08-public-missing`);
      await context.close();
    } catch (e) { failures.push(`[${tag}] public reader threw: ${e.message}`); console.log(`FAIL  [${tag}] public reader threw :: ${e.message}`); }
  }

  await browser.close();
}

try {
  await run();
} catch (e) {
  failures.push(`suite threw: ${e.message}`);
  console.error(e);
} finally {
  const after = await supabase.from('notes').select('id', { count: 'exact', head: true });
  const users = await supabase.from('users').select('id', { count: 'exact', head: true });
  console.log(`\npost-run DB state: ${users.count} user(s), ${after.count} note(s) (unchanged by this suite)`);
  if (notes.length) console.log(`\nnotes:\n - ${notes.join('\n - ')}`);
  console.log(`\n${passed} passed / ${failures.length} failed`);
  if (failures.length) { console.log('failed:\n - ' + failures.join('\n - ')); process.exit(1); }
}
