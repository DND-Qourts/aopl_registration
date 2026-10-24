'use strict';
// No payment deadline (organizer decision 23 Oct): no page states a 24-hour window, a due date or a countdown,
// and the tracker says there is no deadline even if an older backend still sends a due date.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, launch, openRegistration } = require('./helpers.cjs');

let server, browser, base;
test.before(async () => { server = await startServer(); base = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

const PAGES = ['index.html', 'register/index.html', 'track/index.html', 'payment/index.html', 'payment/demo/index.html'];
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('no page mentions a 24-hour payment window or a payment due date', () => {
  for (const f of PAGES) {
    const s = read(f);
    assert.doesNotMatch(s, /24-hour payment|24-hour window|Payment is due by|Due in \d+h/i, f);
    assert.doesNotMatch(s, /paymentDueAt|formatDue\(/, f);
  }
  for (const f of ['payment/index.html', 'payment/demo/index.html']) assert.match(read(f), /<span>Payment deadline<\/span><b>No deadline<\/b>/, f);
});

const record = (status, paymentStatus) => ({ registration: {
  reference: 'AOPL-TEST-0001', teamName: 'Deadline Test', divisionId: 'D14', status, paymentStatus,
  paymentDueAt: '2026-10-24T02:00:00Z', submittedAt: '2026-10-20T02:00:00Z' } });

async function track(page, url, body) {
  await page.goto(base + url);
  await page.evaluate(() => {
    document.querySelector('#trackReference').value = 'AOPL-TEST-0001';
    document.querySelector('#trackEmail').value = 'captain@example.test';
    document.querySelector('#trackContinue').click();
  });
  await page.waitForFunction(() => document.querySelector('#trackVerifyStep').classList.contains('active'));
  await page.evaluate(() => { document.querySelector('#trackCode').value = '123456'; document.querySelector('#trackVerify').click(); });
  await page.waitForFunction(() => !document.querySelector('#trackResult').classList.contains('hidden'));
  return page.evaluate(() => ({
    note: document.querySelector('#trackPaymentNote').textContent,
    next: document.querySelector('#trackNextActionTitle').textContent + ' ' + document.querySelector('#trackNextActionCopy').textContent,
    timeline: document.querySelector('#trackTimeline').textContent }));
}

for (const url of ['/', '/register/', '/track/']) {
  test(`tracker on ${url}: approved for payment shows no deadline, even if a due date is sent`, async () => {
    let body = record('Approved for Payment', 'Requested');
    const { page, context, errors } = await openRegistration(browser, base, { functions: { 'track-request': { challengeId: 'c1' }, 'track-verify': () => body } });
    const r = await track(page, url, body);
    assert.match(r.note, /No payment deadline/);
    assert.match(r.next, /No payment deadline/);
    assert.match(r.timeline, /no deadline/);
    assert.doesNotMatch(r.note + r.next + r.timeline, /Due |24-hour|due by/i);
    assert.deepStrictEqual(errors, []);
    await context.close();
  });
}

test('tracker: a team overdue under the earlier rules is told the organizer will follow up, slot still held', async () => {
  const { page, context } = await openRegistration(browser, base, { functions: { 'track-request': { challengeId: 'c1' }, 'track-verify': record('Payment Overdue', 'Overdue') } });
  const r = await track(page, '/track/');
  assert.match(r.next, /organizer will reopen payment or contact you/);
  assert.match(r.next, /slot is still held/);
  assert.doesNotMatch(r.next, /extend the deadline|release the slot/);
  await context.close();
});
