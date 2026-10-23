'use strict';
// NR (no DUPR rating) handling, exact two-decimal arithmetic, and DUPR 12 staying closed.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openRegistration, fillRoster, openPlayer } = require('./helpers.cjs');

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
const teamTotal = page => page.locator('#teamDuprValue').innerText();
async function passes(query, ratings) {
  const c = await openWithRoster(query, ratings);
  await c.page.click('#continueButton');
  const step = await activeStep(c.page);
  const msg = await wizardMessage(c.page);
  await c.context.close();
  return { ok: step === '4', msg };
}

test('DUPR 12 is not offered and cannot be reached by link', async () => {
  const { page, context } = await openRegistration(browser, base, { query: '?division=D12' });
  assert.strictEqual(await page.locator('#publicDivisionGrid .division-card').count(), 2);
  assert.strictEqual(await page.locator('#divisionPicker .division-option').count(), 2);
  assert.doesNotMatch(await page.locator('#publicDivisionGrid').innerText(), /DUPR\s*12|\b12\b.*Team/);
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('division-selected')), false);
  await context.close();
});

test('DUPR 12 appearing in the capacity feed does not open it', async () => {
  const { page, context } = await openRegistration(browser, base, {
    capacity: [{ division_id: 'D12', capacity: 8, confirmed: 0, under_review: 0 }, { division_id: 'D14', capacity: 16, confirmed: 0, under_review: 0 }, { division_id: 'D16', capacity: 12, confirmed: 0, under_review: 0 }]
  });
  await page.waitForFunction(() => /Live capacity/.test(document.querySelector('#availabilitySource').textContent));
  assert.strictEqual(await page.locator('#publicDivisionGrid .division-card').count(), 2);
  await context.close();
});

test('NR counts as the division equivalent in the team total (D14 = 3.50, D16 = 4.00)', async () => {
  let c = await openWithRoster('?division=D14', ['NR', '3.00', '3.00', '3.00']);
  assert.strictEqual(await teamTotal(c.page), '12.50');
  await c.context.close();
  c = await openWithRoster('?division=D16', ['NR', '3.00', '3.00', '3.00']);
  assert.strictEqual(await teamTotal(c.page), '13.00');
  await c.context.close();
});

test('NR team limits are exact at the boundary', async () => {
  assert.ok((await passes('?division=D14', ['NR', '3.99', '3.99', '2.52'])).ok);
  const over = await passes('?division=D14', ['NR', '3.99', '3.99', '2.53']);
  assert.ok(!over.ok); assert.match(over.msg, /Team DUPR is 14\.01; maximum is 14\.00/);
  assert.ok((await passes('?division=D16', ['NR', '4.49', '4.49', '3.02'])).ok);
  assert.ok(!(await passes('?division=D16', ['NR', '4.49', '4.49', '3.03'])).ok);
});

test('two NR players push a D14 team over the limit', async () => {
  const r = await passes('?division=D14', ['NR', 'NR', '3.99', '3.99']);
  assert.ok(!r.ok); assert.match(r.msg, /Team DUPR is 14\.98/);
});

test('sums that float arithmetic gets wrong are still exact', async () => {
  assert.ok((await passes('?division=D14', ['3.85', '3.85', '3.85', '2.45'])).ok);
  assert.ok(!(await passes('?division=D14', ['3.85', '3.85', '3.85', '2.46'])).ok);
  assert.ok((await passes('?division=D14', ['3.35', '3.35', '3.35', '3.95'])).ok);
});

test('ratings with more than two decimals, zero, or bad format are rejected, never rounded', async () => {
  for (const bad of ['3.999', '3.001', '0', '0.00', '3.', '.5', '9.5', '10']) {
    const r = await passes('?division=D14', [bad, '2.00', '2.00', '2.00']);
    assert.ok(!r.ok, `${bad} must be rejected`);
  }
  const c = await openWithRoster('?division=D14', ['3.999', '2.00', '2.00', '2.00']);
  await c.page.click('#continueButton');
  assert.match(await wizardMessage(c.page), /at most 2 decimal places/);
  await c.context.close();
});

test('letters and exponent notation cannot be typed into the rating', async () => {
  const { page, context } = await openRegistration(browser, base, { query: '?division=D14' });
  await page.fill('#teamName', 'Te'); await page.click('#continueButton');
  await openPlayer(page, 1);
  await page.type('[data-field="duprRating"][data-player="1"]', '1e-3,5abc');
  assert.strictEqual(await page.inputValue('[data-field="duprRating"][data-player="1"]'), '135');
  await context.close();
});

test('NR disables and clears the rating box; unticking requires a rating again', async () => {
  const { page, context } = await openRegistration(browser, base, { query: '?division=D14' });
  await page.fill('#teamName', 'Te'); await page.click('#continueButton');
  await openPlayer(page, 1);
  await page.fill('[data-field="duprRating"][data-player="1"]', '3.40');
  await page.check('[data-nr="1"]');
  assert.strictEqual(await page.inputValue('[data-field="duprRating"][data-player="1"]'), '');
  assert.ok(await page.locator('[data-field="duprRating"][data-player="1"]').isDisabled());
  assert.match(await page.locator('[data-nr-note="1"]').innerText(), /NR counts as 3\.50 toward the DUPR 14 team total/);
  await page.uncheck('[data-nr="1"]');
  assert.ok(await page.locator('[data-field="duprRating"][data-player="1"]').isEnabled());
  await context.close();
});

test('an NR player still needs a valid DUPR ID', async () => {
  const c = await openWithRoster('?division=D14', ['NR', '3.00', '3.00', '3.00']);
  await openPlayer(c.page, 1);
  await c.page.fill('[data-field="duprId"][data-player="1"]', '');
  await c.page.click('#continueButton');
  assert.strictEqual(await activeStep(c.page), '3');
  assert.match(await wizardMessage(c.page), /valid alphanumeric DUPR ID/);
  await c.context.close();
});

test('the same DUPR ID cannot be used twice on a roster, NR or not', async () => {
  const c = await openWithRoster('?division=D14', ['NR', '3.00', '3.00', '3.00']);
  await openPlayer(c.page, 2);
  await c.page.fill('[data-field="duprId"][data-player="2"]', 'TST001');
  await c.page.click('#continueButton');
  assert.strictEqual(await activeStep(c.page), '3');
  assert.match(await wizardMessage(c.page), /already assigned to another player/);
  await c.context.close();
});

test('NR is shown as NR in review and sent as isNr with no rating', async () => {
  const { page, calls, context } = await openWithRoster('?division=D14', ['NR', '3.40', '3.30', '3.20'], {
    functions: { 'submit-registration': { ok: true, reference: 'AOPL-TEST-0002', status: 'Under Review' } }
  });
  await page.click('#continueButton');
  assert.strictEqual(await activeStep(page), '4', await wizardMessage(page));
  const review = await page.locator('#reviewStack').innerText();
  assert.match(review, /DUPR NR \(counts as 3\.50\)/);
  assert.match(review, /DUPR 3\.40/);
  await page.check('#acknowledgeRules'); await page.check('#acknowledgeConsent');
  await page.click('#continueButton'); await page.click('#continueButton');
  await page.waitForSelector('#successPanel:not(.hidden)');
  const sent = calls.find(c => c.name === 'submit-registration').body;
  assert.strictEqual(sent.players[0].isNr, true);
  assert.strictEqual(sent.players[0].submittedDupr, null);
  assert.strictEqual(sent.players[0].duprId, 'TST001');
  assert.deepStrictEqual(sent.players.slice(1).map(p => p.submittedDupr), ['3.40', '3.30', '3.20']);
  assert.deepStrictEqual(sent.players.map(p => p.isNr), [true, false, false, false]);
  await context.close();
});

test('rating text is sent exactly as entered, not as a float', async () => {
  const { page, calls, context } = await openWithRoster('?division=D14', ['3.9', '3.10', '2.05', '3'], {
    functions: { 'submit-registration': { ok: true, reference: 'AOPL-TEST-0003' } }
  });
  await page.click('#continueButton');
  await page.check('#acknowledgeRules'); await page.check('#acknowledgeConsent');
  await page.click('#continueButton'); await page.click('#continueButton');
  await page.waitForSelector('#successPanel:not(.hidden)');
  assert.deepStrictEqual(calls.find(c => c.name === 'submit-registration').body.players.map(p => p.submittedDupr), ['3.9', '3.10', '2.05', '3']);
  await context.close();
});

test('drafts keep the NR flag and restoring one shows it', async () => {
  const { page, calls, context } = await openWithRoster('?division=D14', ['NR', '3.00', '3.00', '3.00'], {
    functions: {
      'save-draft': { ok: true, draftToken: 't', draftId: 'd' },
      'resume-draft-request': { challengeId: 'c1' }
    }
  });
  await page.click('#saveDraftButton'); await page.fill('#saveEmail', 'p1@example.test'); await page.click('#confirmSaveDraft');
  await page.waitForFunction(() => /saved/i.test(document.querySelector('#saveMessage').textContent));
  const saved = calls.find(c => c.name === 'save-draft').body.state;
  assert.deepStrictEqual(saved.players.map(p => p.isNr), [true, false, false, false]);
  assert.strictEqual(saved.players[0].duprRating, '');
  await context.close();

  const restored = await openRegistration(browser, base, {
    functions: {
      'resume-draft-request': { challengeId: 'c1' },
      'resume-draft-verify': { draftToken: 't', draftId: 'd', state: { ...saved, step: 3 } }
    }
  });
  await restored.page.click('[data-open-resume]:visible >> nth=0');
  await restored.page.fill('#resumeEmail', 'p1@example.test'); await restored.page.click('#resumeButton');
  await restored.page.fill('#resumeCode', '123456'); await restored.page.click('#resumeVerifyButton');
  await restored.page.waitForFunction(() => /restored/i.test(document.querySelector('#resumeMessage').textContent));
  await openPlayer(restored.page, 1);
  assert.ok(await restored.page.locator('[data-nr="1"]').isChecked());
  assert.strictEqual(await restored.page.locator('#teamDuprValue').innerText(), '12.50');
  await restored.context.close();
});

test('a restored draft cannot select the closed DUPR 12', async () => {
  const { page, context } = await openRegistration(browser, base, {
    functions: {
      'resume-draft-request': { challengeId: 'c1' },
      'resume-draft-verify': { draftToken: 't', draftId: 'd', state: { divisionId: 'D12', step: 3, teamName: 'X', players: [] } }
    }
  });
  await page.click('[data-open-resume]:visible >> nth=0');
  await page.fill('#resumeEmail', 'p1@example.test'); await page.click('#resumeButton');
  await page.fill('#resumeCode', '123456'); await page.click('#resumeVerifyButton');
  await page.waitForFunction(() => /restored/i.test(document.querySelector('#resumeMessage').textContent));
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('division-selected')), false);
  await context.close();
});

test('shirt size 2XS can be chosen and is submitted', async () => {
  const { page, calls, context } = await openWithRoster('?division=D14', ['3.40', '3.30', '3.20', '3.10'], {
    functions: { 'submit-registration': { ok: true, reference: 'AOPL-TEST-0004' } }
  });
  await openPlayer(page, 2);
  const options = await page.locator('[data-field="shirtSize"][data-player="2"] option').allInnerTexts();
  assert.ok(options.includes('2XS'));
  await page.selectOption('[data-field="shirtSize"][data-player="2"]', '2XS');
  await page.click('#continueButton');
  await page.check('#acknowledgeRules'); await page.check('#acknowledgeConsent');
  await page.click('#continueButton'); await page.click('#continueButton');
  await page.waitForSelector('#successPanel:not(.hidden)');
  assert.strictEqual(calls.find(c => c.name === 'submit-registration').body.players[1].shirtSize, '2XS');
  await context.close();
});
