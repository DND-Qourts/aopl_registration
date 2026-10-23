'use strict';
// Confirmed capacities (23 Oct): D14 16, D16 4 (D12 8 but closed). The cards follow the live capacity feed.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, launch, openRegistration } = require('./helpers.cjs');

let server, browser, base;
test.before(async () => { server = await startServer(); base = 'http://127.0.0.1:' + server.address().port; browser = await launch(); });
test.after(async () => { await browser.close(); server.close(); });

const feed = (d16Reserved, d14Reserved = 0) => [
  { division_id: 'D12', capacity: 8, confirmed: 0, under_review: 0, is_open: false },
  { division_id: 'D14', capacity: 16, confirmed: 0, under_review: d14Reserved },
  { division_id: 'D16', capacity: 4, confirmed: 0, under_review: d16Reserved }
];
const card = (page, label) => page.locator('#publicDivisionGrid .division-card', { hasText: label }).innerText();

test('DUPR 16 with its 4th slot taken offers only the waitlist', async () => {
  const { page, context } = await openRegistration(browser, base, { capacity: feed(4) });
  await page.waitForFunction(() => document.querySelectorAll('#publicDivisionGrid .division-card').length === 2);
  assert.match(await card(page, 'DUPR 16'), /Waitlist Only/);
  assert.match(await card(page, 'DUPR 16'), /Join DUPR 16 Waitlist/);
  assert.doesNotMatch(await card(page, 'DUPR 14'), /Waitlist Only/);
  await context.close();
});

test('DUPR 16 with one slot left is still open for registration', async () => {
  const { page, context } = await openRegistration(browser, base, { capacity: feed(3) });
  await page.waitForFunction(() => document.querySelectorAll('#publicDivisionGrid .division-card').length === 2);
  assert.doesNotMatch(await card(page, 'DUPR 16'), /Waitlist Only/);
  assert.match(await card(page, 'DUPR 16'), /Register in DUPR 16/);
  await context.close();
});

test('DUPR 14 at 16 of 16 offers only the waitlist; D12 stays hidden even with capacity 8', async () => {
  const { page, context } = await openRegistration(browser, base, { capacity: feed(0, 16) });
  await page.waitForFunction(() => document.querySelectorAll('#publicDivisionGrid .division-card').length === 2);
  assert.match(await card(page, 'DUPR 14'), /Waitlist Only/);
  assert.doesNotMatch(await page.locator('#publicDivisionGrid').innerText(), /DUPR\s*12/);
  await context.close();
});
