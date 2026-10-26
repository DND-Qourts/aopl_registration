'use strict';
// Players are told where emails come from and to check Spam/Junk, on the success screen and wherever a code is entered.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('success screen and review step show a notice naming the sender and the spam folder', () => {
  const html = read('register/index.html');
  assert.match(html, /id="successMailNote"[^>]*>.*Check your email, and your Spam or Junk folder.*<b>aopl\.dnd@gmail\.com<\/b>.*Not spam/);
  assert.match(html, /id="reviewMailNote"[^>]*>.*After you submit, check your email.*<b>aopl\.dnd@gmail\.com<\/b>.*Spam or Junk.*Not spam/);
});

test('the notice is visible on the review step and on the success screen', async () => {
  const { startServer, launch, openRegistration, fillRoster } = require('./helpers.cjs');
  const server = await startServer(); const base = 'http://127.0.0.1:' + server.address().port; const browser = await launch();
  try {
    const { page, context } = await openRegistration(browser, base, { query: '?division=D14' });
    await page.waitForFunction(() => /Live capacity/.test(document.querySelector('#availabilitySource').textContent));
    await fillRoster(page, ['3.00', '3.00', '3.00', '3.00']);
    await page.click('#continueButton');
    await page.waitForFunction(() => document.querySelector('.wizard-step.active')?.dataset.step === '4');
    assert.ok(await page.locator('#reviewMailNote').isVisible());
    await page.evaluate(() => { document.getElementById('successPanel').classList.remove('hidden'); });
    assert.ok(await page.locator('#successMailNote').isVisible());
    await context.close();
  } finally { await browser.close(); server.close(); }
});

test('every place that asks for an emailed code mentions the sender and Spam or Junk', () => {
  for (const f of ['register/index.html', 'index.html', 'track/index.html']) {
    const html = read(f);
    const notes = html.match(/<p class="resume-code-note">[^<]*<\/p>/g) || [];
    assert.ok(notes.length >= 1, f);
    for (const n of notes) assert.match(n, /Check Spam or Junk for aopl\.dnd@gmail\.com/, f);
  }
  assert.match(read('track/index.html'), /It comes from <b>aopl\.dnd@gmail\.com<\/b>; if you do not see it, check Spam or Junk/);
});
