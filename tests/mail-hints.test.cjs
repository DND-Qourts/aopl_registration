'use strict';
// Players are told where emails come from and to check Spam/Junk, on the success screen and wherever a code is entered.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('success screen names the sender and the spam folder', () => {
  const html = read('register/index.html');
  assert.match(html, /id="successMailNote">We email a confirmation to every player from <b>aopl\.dnd@gmail\.com<\/b>[^<]*Spam or Junk[^<]*Not spam/);
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
