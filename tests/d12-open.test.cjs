'use strict';
// DUPR 12 is offered only while the public capacity feed reports it open (is_open: true).
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openRegistration, fillRoster } = require('./helpers.cjs');

let server, browser, base;
test.before(async () => { server = await startServer(); base = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

const feed = d12Open => [
  { division_id: 'D12', capacity: 8, confirmed: 0, under_review: 0, is_open: d12Open },
  { division_id: 'D14', capacity: 16, confirmed: 3, under_review: 0, is_open: true },
  { division_id: 'D16', capacity: 4, confirmed: 0, under_review: 0, is_open: true }
];
const capacityLoaded = page => page.waitForFunction(() => /Live capacity/.test(document.querySelector('#availabilitySource').textContent));
const activeStep = page => page.evaluate(() => document.querySelector('.wizard-step.active').dataset.step);
const cards = page => page.locator('#publicDivisionGrid .division-card');

test('D12 reported closed stays hidden, and a link to it does not select it', async () => {
  const { page, context, errors } = await openRegistration(browser, base, { query: '?division=D12', capacity: feed(false) });
  await capacityLoaded(page);
  assert.strictEqual(await cards(page).count(), 2);
  assert.strictEqual(await page.locator('#divisionPicker .division-option').count(), 2);
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('division-selected')), false);
  assert.strictEqual(await page.locator('#rulesDialog [data-division-item="D12"]').evaluate(el => el.hidden), true);
  assert.deepStrictEqual(errors, []);
  await context.close();
});

test('D12 stays hidden when the capacity feed is unavailable', async () => {
  const { page, context } = await openRegistration(browser, base, { query: '?division=D12', capacity: { error: 'CAPACITY_UNAVAILABLE' } });
  await page.waitForFunction(() => /temporarily unavailable/.test(document.querySelector('#availabilitySource').textContent));
  assert.strictEqual(await cards(page).count(), 2);
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('division-selected')), false);
  await context.close();
});

test('D12 reported open is offered first, with its own limits and capacity', async () => {
  const { page, context, errors } = await openRegistration(browser, base, { capacity: feed(true) });
  await capacityLoaded(page);
  assert.strictEqual(await cards(page).count(), 3);
  const first = await cards(page).first().innerText();
  assert.match(first, /\b12\b/); assert.match(first, /8\s+SLOTS AVAILABLE/i); assert.match(first, /Team ≤ 12\.00 · Player ≤ 3\.49/);
  assert.match(await cards(page).nth(1).innerText(), /13\s+SLOTS AVAILABLE/i);
  assert.strictEqual(await page.locator('#divisionPicker .division-option').count(), 3);
  assert.strictEqual(await page.locator('#rulesDialog [data-division-item="D12"]').evaluate(el => el.hidden), false);
  assert.deepStrictEqual(errors, []);
  await context.close();
});

test('register button and link both open the D12 form', async () => {
  let c = await openRegistration(browser, base, { capacity: feed(true) });
  await capacityLoaded(c.page);
  await c.page.click('[data-register-division="D12"]');
  assert.strictEqual(await activeStep(c.page), '2');
  await c.context.close();
  c = await openRegistration(browser, base, { query: '?division=D12', capacity: feed(true) });
  await capacityLoaded(c.page);
  assert.strictEqual(await activeStep(c.page), '2');
  assert.strictEqual(await c.page.evaluate(() => document.body.classList.contains('division-selected')), true);
  await c.context.close();
});

test('D12 limits: NR counts as 3.00, team 12.00 passes, 12.01 fails, player 3.50 fails', async () => {
  async function check(ratings) {
    const c = await openRegistration(browser, base, { query: '?division=D12', capacity: feed(true) });
    await capacityLoaded(c.page);
    await fillRoster(c.page, ratings);
    const total = await c.page.locator('#teamDuprValue').innerText();
    await c.page.click('#continueButton');
    const r = { total, step: await activeStep(c.page), msg: await c.page.locator('#wizardMessage').innerText() };
    await c.context.close();
    return r;
  }
  let r = await check(['NR', '3.00', '3.00', '3.00']); assert.strictEqual(r.total, '12.00'); assert.strictEqual(r.step, '4', r.msg);
  r = await check(['NR', '3.01', '3.00', '3.00']); assert.strictEqual(r.step, '3'); assert.match(r.msg, /Team DUPR is 12\.01; maximum is 12\.00/);
  r = await check(['3.49', '2.50', '2.50', '2.50']); assert.strictEqual(r.step, '4', r.msg);
  r = await check(['3.50', '2.50', '2.50', '2.50']); assert.strictEqual(r.step, '3');
});

test('a D12 team is submitted with divisionId D12', async () => {
  const { page, calls, context } = await openRegistration(browser, base, {
    query: '?division=D12', capacity: feed(true),
    functions: { 'submit-registration': { ok: true, reference: 'AOPL-12-TEST', status: 'Under Review' } }
  });
  await capacityLoaded(page);
  await fillRoster(page, ['NR', '3.00', '3.00', '3.00']);
  await page.click('#continueButton');
  assert.match(await page.locator('#reviewStack').innerText(), /DUPR NR \(counts as 3\.00\)/);
  await page.check('#acknowledgeRules'); await page.check('#acknowledgeConsent');
  await page.click('#continueButton'); await page.click('#continueButton');
  await page.waitForSelector('#successPanel:not(.hidden)');
  const sent = calls.find(c => c.name === 'submit-registration').body;
  assert.strictEqual(sent.divisionId, 'D12');
  assert.strictEqual(sent.players[0].isNr, true);
  await context.close();
});

test('home page shows D12 in the format section only while it is open', async () => {
  let c = await openRegistration(browser, base, { pagePath: '/', capacity: feed(false) });
  await capacityLoaded(c.page);
  assert.strictEqual(await c.page.locator('.division-showcase-item:visible').count(), 2);
  assert.match(await c.page.locator('#format-title').innerText(), /^Two divisions\./);
  await c.context.close();
  c = await openRegistration(browser, base, { pagePath: '/', capacity: feed(true) });
  await capacityLoaded(c.page);
  assert.strictEqual(await c.page.locator('.division-showcase-item:visible').count(), 3);
  assert.match(await c.page.locator('.division-showcase-item:visible').first().innerText(), /12[\s\S]*12\.00[\s\S]*3\.49/);
  assert.match(await c.page.locator('#format-title').innerText(), /^Three divisions\./);
  assert.strictEqual(await c.page.locator('#rulesDialog [data-division-item="D12"]').evaluate(el => el.hidden), false);
  assert.deepStrictEqual(c.errors, []);
  await c.context.close();
});
