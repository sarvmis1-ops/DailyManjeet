const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/chat-core.js');

test('initials takes up to two uppercase letters', () => {
  assert.equal(C.initials('Ravi Kumar'), 'RK');
  assert.equal(C.initials('ravi'), 'R');
  assert.equal(C.initials('  '), '?');
  assert.equal(C.initials(''), '?');
});

test('avatarColor is stable per id and from the palette', () => {
  assert.equal(C.avatarColor('abc'), C.avatarColor('abc'));
  assert.match(C.avatarColor('xyz'), /^#[0-9A-F]{6}$/i);
});

test('avatarColor spreads different users across colours', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
               '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
  assert.ok(new Set(ids.map(C.avatarColor)).size >= 3);
});

test('fileKind uses mime first, then extension', () => {
  assert.equal(C.fileKind('image/png', 'a.png'), 'image');
  assert.equal(C.fileKind('video/mp4', 'a.mp4'), 'video');
  assert.equal(C.fileKind('', 'song.mp3'), 'audio');
  assert.equal(C.fileKind('application/pdf', 'x.pdf'), 'file');
  assert.equal(C.fileKind('', 'noext'), 'file');
});

test('formatBytes', () => {
  assert.equal(C.formatBytes(0), '0 B');
  assert.equal(C.formatBytes(1536), '1.5 KB');
  assert.equal(C.formatBytes(12900000), '12.3 MB');
});

test('tickState: read only when every other member has read', () => {
  const msg = { sender_id: 'me', created_at: '2026-11-21T10:00:00Z' };
  const read = [{ user_id: 'me', last_read_at: '2026-11-21T09:00:00Z' }, { user_id: 'a', last_read_at: '2026-11-21T10:01:00Z' }, { user_id: 'b', last_read_at: '2026-11-21T10:05:00Z' }];
  const partly = [read[0], read[1], { user_id: 'b', last_read_at: '2026-11-21T09:59:00Z' }];
  assert.equal(C.tickState(msg, read, 'me'), 'read');
  assert.equal(C.tickState(msg, partly, 'me'), 'sent');
  assert.equal(C.tickState({ ...msg, sender_id: 'a' }, read, 'me'), null);
});

test('needsResign after 50 minutes', () => {
  assert.equal(C.needsResign(0, 49 * 60e3), false);
  assert.equal(C.needsResign(0, 51 * 60e3), true);
});

test('safeFileName', () => {
  assert.equal(C.safeFileName('my file?.pdf'), 'my_file_.pdf');
  assert.equal(C.safeFileName(''), 'file');
  assert.equal(C.safeFileName('a'.repeat(100) + '.png').length, 80);
  assert.ok(C.safeFileName('a'.repeat(100) + '.png').endsWith('.png'));
});

test('previewText per kind and deleted', () => {
  assert.equal(C.previewText({ last_kind: 'text', last_body: 'hi' }), 'hi');
  assert.equal(C.previewText({ last_kind: 'image' }), '📷 Photo');
  assert.equal(C.previewText({ last_kind: 'drawing' }), '✏️ Drawing');
  assert.equal(C.previewText({ last_kind: 'text', last_body: '', last_deleted: true }), 'This message was deleted');
  assert.equal(C.previewText({}), '');
});

test('renderSafe escapes html and links urls', () => {
  const x = C.renderSafe('<img src=x onerror=alert(1)>');
  assert.ok(!x.includes('<img'));
  assert.ok(x.includes('&lt;img'));
  const y = C.renderSafe('see https://a.com/x?y=1&z=2\nok');
  assert.ok(y.includes('href="https://a.com/x?y=1&amp;z=2"'));
  assert.ok(y.includes('rel="noopener"'));
  assert.ok(y.includes('<br>'));
  assert.ok(!C.renderSafe('javascript:alert(1)').includes('href'));
});

test('chatTime and dayLabel relative to now', () => {
  const now = new Date(2026, 10, 21, 18, 0);           // Sat 21 Nov 2026 18:00 local
  const iso = d => d.toISOString();
  assert.equal(C.chatTime(iso(new Date(2026, 10, 21, 14, 5)), now), '14:05');
  assert.equal(C.chatTime(iso(new Date(2026, 10, 20, 9, 0)), now), 'Yesterday');
  assert.equal(C.chatTime(iso(new Date(2026, 10, 17, 9, 0)), now), 'Tue');
  assert.equal(C.chatTime(iso(new Date(2026, 9, 1, 9, 0)), now), '01/10/26');
  assert.equal(C.dayLabel(iso(new Date(2026, 10, 21, 1, 0)), now), 'Today');
  assert.equal(C.dayLabel(iso(new Date(2026, 10, 20, 1, 0)), now), 'Yesterday');
  assert.equal(C.dayLabel(iso(new Date(2026, 10, 14, 1, 0)), now), 'Sat, 14 Nov');
});
