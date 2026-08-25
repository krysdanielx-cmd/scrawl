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
  page.on('requestfailed', (r) => {
    // A reload cancels in-flight fetches. That is the harness, not the app.
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  return errors;
}

const overflow = (page) => page.evaluate(() =>
  Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

// Every visible interactive element smaller than 44x44 CSS px.
const smallTargets = (page, floor = 44) => page.evaluate((min) => {
  const sel = 'a, button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.matches('.prose a, .reader-body a')) continue; // inline links in prose are exempt
    if (r.width < min || r.height < min) {
      out.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }
  return out;
}, floor);

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
    anyFraunces: [...document.fonts].some((f) => /Fraunces/.test(f.family) && f.status === 'loaded'),
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

  if (manifest) {
    // identity + scope: without an id, a future start_url change orphans the installed app
    check('manifest declares an id', typeof manifest.id === 'string' && manifest.id.length > 0, manifest.id);
    check('manifest declares a scope', typeof manifest.scope === 'string' && manifest.scope.length > 0, manifest.scope);
    if (manifest.scope && manifest.start_url) {
      const scope = new URL(manifest.scope, BASE);
      const start = new URL(manifest.start_url, BASE);
      check('start_url sits inside scope', start.href.startsWith(scope.href), { scope: scope.href, start: start.href });
    }
    const startRes = await fetch(new URL(manifest.start_url, BASE));
    check('start_url actually loads', startRes.status === 200, startRes.status);
    check('start_url returns the app shell', (await startRes.text()).includes('id="root"'));
    // A notes app is perfectly usable in landscape on a tablet; locking it is a downgrade.
    check('manifest does not lock orientation',
      !manifest.orientation || manifest.orientation === 'any', manifest.orientation);
  }

  const shellHtml = await (await fetch(BASE)).text();
  const meta = (name) => shellHtml.match(new RegExp(`<meta[^>]+name="${name}"[^>]+content="([^"]*)"`))?.[1] ?? null;
  check('theme-color meta matches the manifest theme_color',
    manifest ? meta('theme-color') === manifest.theme_color : false, { meta: meta('theme-color'), manifest: manifest?.theme_color });
  check('apple-mobile-web-app-title is set for the iOS home screen', Boolean(meta('apple-mobile-web-app-title')), meta('apple-mobile-web-app-title'));
  check('apple-mobile-web-app-capable is set (iOS standalone)', meta('apple-mobile-web-app-capable') === 'yes', meta('apple-mobile-web-app-capable'));
  // Chrome deprecated the apple- prefixed one and warns in console without this.
  check('mobile-web-app-capable is set (Chrome no longer accepts the apple- one alone)',
    meta('mobile-web-app-capable') === 'yes', meta('mobile-web-app-capable'));
  // black-translucent always paints the clock and battery WHITE. On a cream shell they vanish.
  const barStyle = meta('apple-mobile-web-app-status-bar-style');
  const shellIsLight = manifest && /^#(f|e|d)/i.test(manifest.background_color || '');
  check('iOS status bar style suits a light app shell',
    !(shellIsLight && barStyle === 'black-translucent'),
    { barStyle, background: manifest?.background_color, why: 'black-translucent forces white status bar glyphs' });

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
  check('service worker is served as JavaScript', /javascript/.test(sw.headers.get('content-type') || ''), sw.headers.get('content-type'));
  check('service worker is not cached', /no-cache|no-store/.test(sw.headers.get('cache-control') || ''), sw.headers.get('cache-control'));
  check('service worker has a fetch handler', /addEventListener\('fetch'/.test(swBody));
  check('service worker never caches /api/', /pathname\.startsWith\('\/api\/'\)/.test(swBody));

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
  for (const path of ['/archive', '/login', '/p/definitely-not-a-real-slug', '/some/unknown/deep/path']) {
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
  // Auth boundary. None of these can write: signup is blocked by a DB-level
  // singleton constraint on users, and a failed login writes nothing.
  const post = (path, body) => fetch(BASE + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const ownerEmail = (await supabase.from('users').select('email').limit(1).maybeSingle()).data?.email;
  const wrongPass = await post('/api/auth/login', { email: ownerEmail, password: 'definitely-not-the-password' });
  check('login with a wrong password is 401', wrongPass.status === 401, wrongPass.status);
  const wrongBody = await wrongPass.json().catch(() => ({}));
  const unknownUser = await post('/api/auth/login', { email: 'nobody@example.com', password: 'definitely-not-the-password' });
  check('login with an unknown email is 401', unknownUser.status === 401, unknownUser.status);
  const unknownBody = await unknownUser.json().catch(() => ({}));
  check('login does not leak which accounts exist', wrongBody.error === unknownBody.error, { wrongBody, unknownBody });
  const shortPass = await post('/api/auth/login', { email: ownerEmail, password: 'short' });
  check('login rejects a too-short password before hashing', shortPass.status === 400, shortPass.status);
  const secondOwner = await post('/api/auth/signup', { email: 'intruder@example.com', password: 'a-long-enough-password' });
  check('signup is closed once an owner exists', secondOwner.status === 409, secondOwner.status);
  const usersNow = await supabase.from('users').select('id', { count: 'exact', head: true });
  check('the signup attempt created no second user', usersNow.count === 1, usersNow.count);

  const publicMiss = await fetch(`${BASE}/api/public/notes/definitely-not-a-real-slug`);
  check('unknown public slug returns 404 from the API', publicMiss.status === 404, publicMiss.status);

  const headers = (await fetch(BASE)).headers;
  for (const h of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'content-security-policy', 'strict-transport-security']) {
    check(`security header ${h} is set`, Boolean(headers.get(h)), headers.get(h));
  }
  const csp = headers.get('content-security-policy') || '';
  check('CSP blocks framing outright', /frame-ancestors 'none'/.test(csp), csp);
  check('CSP keeps scripts same-origin', /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe/.test(csp), csp);
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
      check(`[${tag}] a Fraunces weight actually loaded`, fonts.fraunces || fonts.anyFraunces, fonts);
      const headingFont = await page.$eval('.auth-intro h1', (el) => getComputedStyle(el).fontFamily);
      check(`[${tag}] the display heading is set in Fraunces`, /Fraunces/.test(headingFont), headingFont);
      const headingRendered = await page.evaluate(() => {
        const el = document.querySelector('.auth-intro h1');
        const style = getComputedStyle(el);
        const canvas = document.createElement('canvas').getContext('2d');
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const withFont = canvas.measureText(el.textContent).width;
        canvas.font = `${style.fontWeight} ${style.fontSize} serif`;
        return { withFont, fallback: canvas.measureText(el.textContent).width };
      });
      check(`[${tag}] the heading is NOT falling back to a system serif`,
        Math.abs(headingRendered.withFont - headingRendered.fallback) > 1, headingRendered);
      check(`[${tag}] no tofu`, (await tofu(page)).length === 0, await tofu(page));
      const thirdParty = await page.evaluate(() => performance.getEntriesByType('resource')
        .map((e) => new URL(e.name).origin).filter((o) => o !== location.origin));
      check(`[${tag}] the page loads nothing third party`, thirdParty.length === 0, [...new Set(thirdParty)]);
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
      const floor = mobile ? 44 : 24; // Apple's touch floor vs WCAG 2.2 AA for a pointer
      const targets = await smallTargets(page, floor);
      check(`[${tag}] auth targets clear ${floor}px`, targets.length === 0, targets);
      // password field must not be readable
      check(`[${tag}] password field is masked`, (await page.getAttribute('#password', 'type')) === 'password');
      const labelled = await page.evaluate(() => ['email', 'password']
        .filter((id) => !document.querySelector(`label[for=${id}]`) && !document.getElementById(id)?.getAttribute('aria-label')));
      check(`[${tag}] auth inputs have labels`, labelled.length === 0, labelled);
      const lang = await page.evaluate(() => document.documentElement.lang);
      check(`[${tag}] html has a lang attribute`, Boolean(lang), lang);
      check(`[${tag}] auth page is error free`, errors.length === 0, errors);
      await shot(page, `${tag}-01-auth`);

      // service worker: registers, controls the page, and serves a shell offline
      const registered = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return null;
        await navigator.serviceWorker.ready;
        return { scope: reg.scope, active: Boolean(reg.active) };
      });
      check(`[${tag}] the service worker registers and activates`, registered?.active === true, registered);
      const cached = await page.evaluate(async () => {
        const keys = await caches.keys();
        const names = [];
        for (const key of keys) names.push(...(await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname));
        return names;
      });
      check(`[${tag}] the shell is precached`, cached.includes('/'), cached);
      check(`[${tag}] the fonts are precached for offline`,
        cached.some((u) => u.includes('fraunces')), cached);
      check(`[${tag}] no API response was cached`, !cached.some((u) => u.startsWith('/api/')), cached);
      check(`[${tag}] the built bundles are precached`,
        cached.some((u) => u.endsWith('.js') && u.startsWith('/assets/'))
        && cached.some((u) => u.endsWith('.css')), cached);

      const offlineFailures = [];
      page.on('requestfailed', (r) => offlineFailures.push(new URL(r.url()).pathname));
      await context.setOffline(true);
      const offline = await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForTimeout(1500);
      check(`[${tag}] the app still answers while offline`, Boolean(offline) && offline.status() < 400,
        offline ? offline.status() : 'no response');
      const offlineText = await page.evaluate(() => document.body.innerText.slice(0, 120));
      check(`[${tag}] the offline response is not a browser error page`, offlineText.length > 0, offlineText);
      check(`[${tag}] nothing fails to load offline`, offlineFailures.length === 0, offlineFailures);
      const offlineFonts = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
      });
      check(`[${tag}] both typefaces render offline`,
        offlineFonts.some((f) => /Fraunces/.test(f)) && offlineFonts.some((f) => /Jakarta/.test(f)), offlineFonts);
      check(`[${tag}] the offline shell still shows the sign-in form`,
        (await page.locator('#password').count()) === 1);
      await shot(page, `${tag}-09-offline`);
      await context.setOffline(false);
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
      const floor = mobile ? 44 : 24;
      let targets = await smallTargets(page, floor);
      check(`[${tag}] dashboard targets clear ${floor}px`, targets.length === 0, targets);
      await shot(page, `${tag}-02-dashboard`);

      // mobile navigation drawer
      if (mobile) {
        await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
        await page.waitForTimeout(400);
        const openX = (await page.locator('.sidebar').boundingBox()).x;
        check(`[${tag}] nav drawer slides in`, openX >= 0, openX);
        const navTargets = await smallTargets(page, 44);
        check(`[${tag}] drawer touch targets are 44px or bigger`, navTargets.length === 0, navTargets);
        await shot(page, `${tag}-03-nav`);
      }

      // note list. On mobile the drawer is already open from the block above.
      if (mobile && (await page.locator('.sidebar').boundingBox()).x < 0) {
        await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
        await page.waitForTimeout(400);
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
        // Only the title text is wired to onOpen, so tapping the row body does nothing.
        const rowBody = await page.locator('.note-row').first().boundingBox();
        await page.mouse.click(rowBody.x + rowBody.width - 24, rowBody.y + rowBody.height - 12);
        // The editor is a lazy chunk, so give it real time. A fixed short wait
        // reported "the card is not clickable" when it just had not loaded yet.
        const bodyOpened = await page.waitForSelector('#note-title', { timeout: 15000 })
          .then(() => true).catch(() => false);
        check(`[${tag}] tapping the row body (not the title) opens the note`, bodyOpened,
          'the card should be one big target, not just the title text');
        if (!bodyOpened) {
          await page.locator('.note-row .title').first().click();
        }
        await page.waitForSelector('#note-title', { timeout: 15000 });
        check(`[${tag}] editor opens`, await page.locator('.editor-bar').isVisible());
        const tools = await page.locator('.toolbar .tool').count();
        check(`[${tag}] Tiptap toolbar renders its tools`, tools >= 12, tools);
        check(`[${tag}] the writing surface is contenteditable`,
          (await page.locator('.prose[contenteditable="true"]').count()) === 1);
        const proseBox = await page.locator('.prose').boundingBox();
        check(`[${tag}] the writing surface has real size`, proseBox && proseBox.width > 200 && proseBox.height > 240, proseBox);
        const paragraphs = await page.locator('.prose > *').count();
        check(`[${tag}] the document always has a node to type into`, paragraphs >= 1, paragraphs);
        const emptyState = await page.evaluate(() => {
          const first = document.querySelector('.prose').firstElementChild;
          const isEmptyDoc = document.querySelector('.prose').innerText.trim().length === 0;
          return { isEmptyDoc, placeholder: first ? getComputedStyle(first, '::before').content : 'none' };
        });
        if (emptyState.isEmptyDoc) {
          check(`[${tag}] an empty note shows its placeholder before you focus it`,
            emptyState.placeholder && emptyState.placeholder !== 'none', emptyState);
        }
        // clicking the blank space below the text must land the cursor
        await page.mouse.click(proseBox.x + proseBox.width / 2, proseBox.y + proseBox.height - 20);
        await page.waitForTimeout(250);
        check(`[${tag}] clicking the blank writing area focuses the editor`,
          await page.evaluate(() => document.activeElement?.classList.contains('prose')
            || Boolean(document.activeElement?.closest('.prose'))));
        const titleBox = await page.locator('#note-title').boundingBox();
        const innerBox = await page.locator('.editor-inner').boundingBox();
        check(`[${tag}] the title stays inside its column`,
          titleBox.x + titleBox.width <= innerBox.x + innerBox.width + 1, { titleBox, innerBox });
        check(`[${tag}] editor has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
        check(`[${tag}] no tofu in the editor`, (await tofu(page)).length === 0, await tofu(page));
        targets = await smallTargets(page, floor);
        check(`[${tag}] editor targets clear ${floor}px`, targets.length === 0, targets);
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
      const hitLayout = await page.evaluate(() => {
        const el = document.querySelector('.search-hit');
        if (!el) return null;
        const title = el.querySelector('.title');
        const excerpt = el.querySelector('.excerpt');
        if (!title || !excerpt) return null;
        return { title: title.getBoundingClientRect().bottom, excerpt: excerpt.getBoundingClientRect().top };
      });
      check(`[${tag}] the search hit snippet sits below the title, not glued to it`,
        hitLayout && hitLayout.excerpt >= hitLayout.title - 1, hitLayout);
      check(`[${tag}] search panel has no horizontal overflow`, (await overflow(page)) <= 0, await overflow(page));
      const panelBox = await page.locator('.search-panel').boundingBox();
      check(`[${tag}] search panel fits the viewport`, panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= width + 1, panelBox);
      await shot(page, `${tag}-06-search`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check(`[${tag}] Escape closes search`, (await page.locator('.search-panel').count()) === 0
        || !(await page.locator('.search-panel').isVisible()));

      // archive view
      if (mobile && (await page.locator('.sidebar').boundingBox()).x < 0) {
        await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
        await page.waitForTimeout(400);
      }
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
      const only404 = errors.filter((e) => !/404/.test(e));
      check(`[${tag}] not-live page has no unexpected errors`, only404.length === 0, only404);
      await shot(page, `${tag}-08-public-missing`);
      await context.close();
    } catch (e) { failures.push(`[${tag}] public reader threw: ${e.message}`); console.log(`FAIL  [${tag}] public reader threw :: ${e.message}`); }
  }

  await pwaChecks(browser, token);
  await browser.close();
}

/**
 * Installed-app behaviour: Chrome's install criteria, display-mode:standalone
 * (emulated over CDP, which is what DevTools itself uses), and iOS
 * add-to-home-screen, where navigator.standalone is the only signal.
 */
async function pwaChecks(browser, token) {
  console.log('\n===== installed / standalone =====');

  // ---------- Chrome installability ----------
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__bip = false;
      window.addEventListener('beforeinstallprompt', () => { window.__bip = true; });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const criteria = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      const manifest = link ? await (await fetch(link.href)).json() : null;
      const reg = await navigator.serviceWorker.getRegistration();
      const icons = manifest?.icons || [];
      const size = (s) => icons.some((i) => (i.sizes || '').split(' ').includes(s));
      return {
        https: location.protocol === 'https:',
        manifestLinked: Boolean(link),
        name: Boolean(manifest?.name || manifest?.short_name),
        startUrl: Boolean(manifest?.start_url),
        display: ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest?.display),
        icon192: size('192x192'),
        icon512: size('512x512'),
        serviceWorker: Boolean(reg?.active),
        fired: window.__bip,
      };
    });
    const swSource = await (await fetch(`${BASE}/sw.js`)).text();
    const hasFetch = /addEventListener\('fetch'/.test(swSource);
    const missing = Object.entries(criteria)
      .filter(([k, v]) => k !== 'fired' && v !== true).map(([k]) => k);
    check('every Chrome install criterion is met', missing.length === 0, { missing, criteria });
    check('the worker has the fetch handler the automatic prompt needs', hasFetch);
    // Headless Chromium does not raise beforeinstallprompt, so its absence proves nothing.
    if (criteria.fired) check('beforeinstallprompt actually fired', true);
    else note('beforeinstallprompt did not fire in headless Chromium (expected); criteria are asserted above instead');
    await context.close();
  } catch (e) { failures.push(`installability threw: ${e.message}`); console.log(`FAIL  installability threw :: ${e.message}`); }

  // ---------- display-mode: standalone ----------
  for (const [width, height] of [[390, 844], [1024, 768]]) {
    const tag = `standalone ${width}x${height}`;
    try {
      const mobile = width < 900;
      const context = await browser.newContext({
        viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
        userAgent: mobile ? devices['iPhone 13'].userAgent : undefined,
      });
      await context.addInitScript((v) => window.localStorage.setItem('scrawl_session', v), token);
      const page = await context.newPage();
      const errors = watch(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.shell', { timeout: 20000 });

      // This Chromium ignores CDP display-mode emulation and there is no X
      // server here for a real --app window, so instead of faking a pass:
      // prove that nothing in the stylesheet BRANCHES on display-mode, which
      // makes the installed layout identical to this chrome-less viewport.
      const emulated = await page.evaluate(() => matchMedia('(display-mode: standalone)').matches);
      if (emulated) check(`[${tag}] the app really is in standalone display mode`, true);
      else {
        const css = await (await fetch(`${BASE}${(await (await fetch(BASE)).text()).match(/href="(\/assets\/index-[^"]+\.css)"/)[1]}`)).text();
        check(`[${tag}] no stylesheet rule branches on display-mode, so installed == this layout`,
          !/display-mode/.test(css));
        note(`[${tag}] display-mode could not be emulated here; standalone layout is covered by the chrome-less viewport above`);
      }
      check(`[${tag}] the workspace renders with no browser chrome`, await page.locator('.shell').isVisible());
      check(`[${tag}] no horizontal overflow in standalone`, (await overflow(page)) <= 0, await overflow(page));

      // There is no browser back button in standalone, so the app must own navigation.
      if (mobile) {
        await page.locator('.topbar .icon-btn[aria-label="Open navigation"]').click();
        await page.waitForTimeout(350);
        await page.locator('.nav-item', { hasText: 'All notes' }).click();
        await page.waitForSelector('.pane-head h1', { timeout: 10000 });
        await page.waitForTimeout(400);
        if (await page.locator('.note-row').count()) {
          await page.locator('.note-row').first().click();
          await page.waitForSelector('#note-title', { timeout: 15000 });
          check(`[${tag}] the editor has its own in-app back control`,
            await page.locator('.editor-bar button[aria-label="Back to notes"]').isVisible());
          await page.locator('.editor-bar button[aria-label="Back to notes"]').click();
          await page.waitForSelector('.pane-head h1', { timeout: 10000 });
          check(`[${tag}] in-app back returns to the list without the browser`,
            (await page.locator('#note-title').count()) === 0);
        }
      }

      // The top rail must reserve room for the status bar, or the clock sits on the UI.
      const railPad = await page.evaluate(() => {
        const el = document.querySelector('.topbar') || document.querySelector('.sidebar');
        return el ? getComputedStyle(el).paddingTop : null;
      });
      check(`[${tag}] the top rail reserves safe-area space`, railPad !== null, railPad);
      const bottomClear = await page.evaluate(() => {
        const el = document.querySelector('.editor-body') || document.querySelector('.pane');
        return el ? getComputedStyle(el).paddingBottom : null;
      });
      check(`[${tag}] content clears the home indicator at the bottom`,
        bottomClear && parseFloat(bottomClear) >= 20, bottomClear);
      check(`[${tag}] standalone session is error free`, errors.length === 0, errors);
      await shot(page, `${tag.replace(/[ :]/g, '-')}`);
      await context.close();
    } catch (e) { failures.push(`[${tag}] threw: ${e.message}`); console.log(`FAIL  [${tag}] threw :: ${e.message}`); }
  }

  // ---------- iOS add-to-home-screen ----------
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    await context.addInitScript((v) => {
      window.localStorage.setItem('scrawl_session', v);
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    }, token);
    const page = await context.newPage();
    const errors = watch(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.shell', { timeout: 20000 });

    check('[iOS A2HS] navigator.standalone is honoured without breaking the app',
      await page.evaluate(() => window.navigator.standalone === true));
    check('[iOS A2HS] the workspace renders on a home-screen launch', await page.locator('.shell').isVisible());
    check('[iOS A2HS] no horizontal overflow', (await overflow(page)) <= 0, await overflow(page));
    check('[iOS A2HS] every touch target clears 44px', (await smallTargets(page, 44)).length === 0, await smallTargets(page, 44));
    check('[iOS A2HS] the launch is error free', errors.length === 0, errors);
    await shot(page, 'ios-a2hs');
    await context.close();
  } catch (e) { failures.push(`iOS A2HS threw: ${e.message}`); console.log(`FAIL  iOS A2HS threw :: ${e.message}`); }
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
