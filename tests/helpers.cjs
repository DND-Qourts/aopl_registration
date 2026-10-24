'use strict';
// Shared test helpers. Serves the repo root locally and intercepts every
// network request, so tests can never reach the production Supabase project.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

const CAPACITY = [
  { division_id: 'D14', capacity: 16, confirmed: 0, under_review: 0 },
  { division_id: 'D16', capacity: 4, confirmed: 0, under_review: 0 }
];

/**
 * Opens the registration page with all backend traffic mocked.
 * `functions` maps an Edge Function name (submit-registration, save-draft, ...) to a response body or function(payload).
 * Every call to a function is recorded in `calls`; every other external request is aborted and recorded in `blocked`.
 */
async function openRegistration(browser, baseUrl, { query = '', functions = {}, capacity = CAPACITY } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const blocked = [];
  const calls = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    const fn = url.pathname.match(/\/functions\/v1\/([^/]+)$/);
    if (fn && url.hostname.endsWith('.supabase.co')) {
      const name = fn[1];
      const body = route.request().method() === 'POST' ? JSON.parse(route.request().postData() || '{}') : null;
      calls.push({ name, body });
      if (name === 'public-capacity') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(capacity) });
      const h = functions[name];
      const out = typeof h === 'function' ? h(body) : h;
      if (!out) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'TEST_UNMOCKED_' + name }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
    }
    // Fonts, images and anything else off-box: record and refuse (never reaches the network).
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.goto(baseUrl + '/register/' + query);
  return { page, context, blocked, calls, errors };
}

const PLAYER_DEFAULTS = [
  { gender: 'Male', fullName: 'Pat One', email: 'p1@example.test', mobile: '09171234567', duprId: 'TST001', shirtSize: 'M' },
  { gender: 'Female', fullName: 'Pat Two', email: 'p2@example.test', mobile: '09171234568', duprId: 'TST002', shirtSize: 'S' },
  { gender: 'Male', fullName: 'Pat Three', email: 'p3@example.test', mobile: '09171234569', duprId: 'TST003', shirtSize: 'L' },
  { gender: 'Female', fullName: 'Pat Four', email: 'p4@example.test', mobile: '09171234570', duprId: 'TST004', shirtSize: 'XS' }
];

/** Fills step 2 (team) and step 3 (roster). `ratings[i]` is a rating string, or 'NR' to tick the NR box. */
async function fillRoster(page, ratings, { teamName = 'Test Team', captain = 1 } = {}) {
  await page.fill('#teamName', teamName);
  await page.click('#continueButton'); // step 2 -> 3
  for (let i = 0; i < 4; i++) {
    const n = i + 1;
    const d = PLAYER_DEFAULTS[i];
    await openPlayer(page, n);
    await page.selectOption(`[data-field="gender"][data-player="${n}"]`, d.gender);
    await page.fill(`[data-field="fullName"][data-player="${n}"]`, d.fullName);
    await page.fill(`[data-field="email"][data-player="${n}"]`, d.email);
    await page.fill(`[data-field="mobile"][data-player="${n}"]`, d.mobile);
    await page.fill(`[data-field="duprId"][data-player="${n}"]`, d.duprId);
    if (ratings[i] === 'NR') await page.check(`[data-nr="${n}"]`);
    else await page.fill(`[data-field="duprRating"][data-player="${n}"]`, ratings[i]);
    await page.selectOption(`[data-field="shirtSize"][data-player="${n}"]`, d.shirtSize);
  }
  await openPlayer(page, captain);
  await page.check(`[data-captain="${captain}"]`);
}

async function openPlayer(page, n) {
  await page.evaluate(id => { const c = document.querySelector(`[data-player-card="${id}"]`); if (!c.classList.contains('open')) c.querySelector('[data-toggle-player]').click(); }, n);
}

module.exports = { startServer, launch, openRegistration, fillRoster, openPlayer, PLAYER_DEFAULTS };
