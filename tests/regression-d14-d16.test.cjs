'use strict';
// Behaviour of the registration form for the two divisions that are open today (DUPR 14 and DUPR 16).
// These tests were written against the unmodified page first and must keep passing after the NR / DUPR 12 work.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openRegistration, fillRoster } = require('./helpers.cjs');

let server, browser, base;
test.before(async () => { server = await startServer(); base = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

async function openWithRoster(query, ratings, opts) {
  const ctx = await openRegistration(browser, base, { query, ...(opts || {}) });
  await fillRoster(ctx.page, ratings);
  return ctx;
}
const wizardMessage = page => page.locator('#wizardMessage').innerText();
const activeStep = page => page.evaluate(() => document.querySelector('.wizard-step.active').dataset.step);

test('only DUPR 14 and DUPR 16 are offered, with their limits', async () => {
  const { page, blocked, errors, context } = await openRegistration(browser, base);
  const cards = await page.locator('#publicDivisionGrid .division-card').count();
  assert.strictEqual(cards, 2);
  const text = await page.locator('#publicDivisionGrid').innerText();
  assert.match(text, /Team ≤\s*14\.00/); assert.match(text, /Player ≤\s*3\.99/);
  assert.match(text, /Team ≤\s*16\.00/); assert.match(text, /Player ≤\s*4\.49/);
  assert.deepStrictEqual(errors, []);
  assert.ok(blocked.every(u => !u.includes('supabase')), 'no un-mocked Supabase call');
  await context.close();
});

test('?division=D12 does not select a division', async () => {
  const { page, context } = await openRegistration(browser, base, { query: '?division=D12' });
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('division-selected')), false);
  await context.close();
});

for (const [label, id, ok, over, playerOk, playerOver] of [
  ['DUPR 14', 'D14', ['3.99', '3.99', '3.99', '2.03'], ['3.99', '3.99', '3.99', '2.04'], '3.99', '4.00'],
  ['DUPR 16', 'D16', ['4.49', '4.49', '4.49', '2.53'], ['4.49', '4.49', '4.49', '2.54'], '4.49', '4.50']
]) {
  test(`${label}: team exactly at the limit is accepted`, async () => {
    const { page, context } = await openWithRoster('?division=' + id, ok);
    assert.match(await page.locator('#eligibilityState').innerText(), /DUPR limits satisfied/);
    await page.click('#continueButton');
    assert.strictEqual(await activeStep(page), '4', await wizardMessage(page));
    await context.close();
  });

  test(`${label}: one hundredth over the team limit is blocked`, async () => {
    const { page, context } = await openWithRoster('?division=' + id, over);
    await page.click('#continueButton');
    assert.strictEqual(await activeStep(page), '3');
    assert.match(await wizardMessage(page), /Team DUPR is \d+\.\d\d; maximum is \d+\.\d\d\./);
    await context.close();
  });

  test(`${label}: individual limit is inclusive`, async () => {
    const good = await openWithRoster('?division=' + id, [playerOk, '2.00', '2.00', '2.00']);
    await good.page.click('#continueButton');
    assert.strictEqual(await activeStep(good.page), '4', await wizardMessage(good.page));
    await good.context.close();
    const bad = await openWithRoster('?division=' + id, [playerOver, '2.00', '2.00', '2.00']);
    await bad.page.click('#continueButton');
    assert.strictEqual(await activeStep(bad.page), '3');
    assert.match(await wizardMessage(bad.page), /max individual DUPR is/);
    await bad.context.close();
  });
}

test('roster needs exactly 2 men and 2 women, a captain and all fields', async () => {
  const { page, context } = await openRegistration(browser, base, { query: '?division=D14' });
  await page.fill('#teamName', 'Gate Test');
  await page.click('#continueButton');
  await page.click('#continueButton');
  assert.strictEqual(await activeStep(page), '3');
  assert.match(await wizardMessage(page), /Select gender/);
  await context.close();
});

test('a complete D14 registration is submitted with the expected payload and shows the reference', async () => {
  const { page, calls, context } = await openWithRoster('?division=D14', ['3.50', '3.40', '3.30', '3.20'], {
    functions: { 'submit-registration': { ok: true, reference: 'AOPL-TEST-0001', status: 'Under Review' } }
  });
  await page.click('#continueButton'); // -> 4
  await page.check('#acknowledgeRules'); await page.check('#acknowledgeConsent');
  await page.click('#continueButton'); // -> 5
  assert.strictEqual(await activeStep(page), '5', await wizardMessage(page));
  await page.click('#continueButton'); // submit
  await page.waitForSelector('#successPanel:not(.hidden)');
  assert.strictEqual(await page.locator('#successReference').innerText(), 'AOPL-TEST-0001');
  const sent = calls.find(c => c.name === 'submit-registration').body;
  assert.strictEqual(sent.divisionId, 'D14');
  assert.strictEqual(sent.players.length, 4);
  assert.deepStrictEqual(sent.players.map(p => Number(p.submittedDupr)), [3.5, 3.4, 3.3, 3.2]);
  assert.deepStrictEqual(sent.players.map(p => p.duprId), ['TST001', 'TST002', 'TST003', 'TST004']);
  assert.strictEqual(sent.players.filter(p => p.captain).length, 1);
  assert.ok(!sent.players.some(p => p.isNr), 'no player is flagged NR');
  await context.close();
});

test('saving a draft sends the ratings as typed', async () => {
  const { page, calls, context } = await openWithRoster('?division=D16', ['4.10', '3.20', '3.00', '2.50'], {
    functions: { 'save-draft': { ok: true, draftToken: 't', draftId: 'd' } }
  });
  await page.click('#saveDraftButton');
  await page.fill('#saveEmail', 'p1@example.test');
  await page.click('#confirmSaveDraft');
  await page.waitForFunction(() => /saved/i.test(document.querySelector('#saveMessage').textContent));
  const sent = calls.find(c => c.name === 'save-draft').body;
  assert.strictEqual(sent.state.divisionId, 'D16');
  assert.deepStrictEqual(sent.state.players.map(p => Number(p.duprRating)), [4.1, 3.2, 3, 2.5]);
  await context.close();
});
