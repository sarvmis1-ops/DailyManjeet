const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/chat-api.js');
const { fakeClient, ops, arg } = require('./fake-supabase.js');

const file = (size, name = 'report.pdf', type = 'application/pdf') => ({ size, name, type });

test('chatSendFile uploads to <conv>/<uuid>_<safe name> then inserts the message', async () => {
  const c = fakeClient({ 'messages.insert': { data: { id: 'm1' }, error: null } });
  const r = await A.chatSendFile(c, 'conv1', file(1000), { name: 'report.pdf' });
  assert.equal(r.ok, true);
  const up = c.storageCalls.find(s => s.op === 'upload');
  assert.equal(up.bucket, 'chat');
  assert.match(up.path, /^conv1\/[0-9a-f-]{36}_report\.pdf$/);
  const ins = c.calls.find(q => q.table === 'messages');
  const row = arg(ins, 'insert')[0];
  assert.equal(row.file_path, up.path);
  assert.equal(row.kind, 'file');
  assert.equal(row.file_size, 1000);
  assert.equal(row.conversation_id, 'conv1');
});

test('chatSendFile refuses files over 50 MB without uploading', async () => {
  const c = fakeClient();
  const r = await A.chatSendFile(c, 'conv1', file(60 * 1024 * 1024), { name: 'big.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'File is larger than 50 MB');
  assert.equal(c.storageCalls.length, 0);
  assert.equal(c.calls.length, 0);
});

test('chatSendFile: failed upload creates no message', async () => {
  const c = fakeClient({ upload: { data: null, error: { message: 'boom' } } });
  const r = await A.chatSendFile(c, 'conv1', file(10), { name: 'a.pdf' });
  assert.equal(r.ok, false);
  assert.equal(c.calls.filter(q => q.table === 'messages').length, 0);
});

test('chatSendFile: failed insert removes the uploaded file', async () => {
  const c = fakeClient({ 'messages.insert': { data: null, error: { message: 'denied' } } });
  const r = await A.chatSendFile(c, 'conv1', file(10), { name: 'a.pdf' });
  assert.equal(r.ok, false);
  const up = c.storageCalls.find(s => s.op === 'upload');
  const rm = c.storageCalls.find(s => s.op === 'remove');
  assert.deepEqual(rm.paths, [up.path]);
});

test('chatSendFile picks kind from mime unless given', async () => {
  const c = fakeClient({ 'messages.insert': { data: {}, error: null } });
  await A.chatSendFile(c, 'c', file(5, 'p.png', 'image/png'), { name: 'p.png' });
  await A.chatSendFile(c, 'c', file(5, 'd.png', 'image/png'), { name: 'd.png', kind: 'drawing' });
  const kinds = c.calls.filter(q => q.table === 'messages').map(q => arg(q, 'insert')[0].kind);
  assert.deepEqual(kinds, ['image', 'drawing']);
});

test('chatSendText trims and rejects empty text', async () => {
  const c = fakeClient({ 'messages.insert': { data: { id: 'm' }, error: null } });
  assert.equal((await A.chatSendText(c, 'c', '   ')).ok, false);
  const r = await A.chatSendText(c, 'c', '  hi  ', 'm0');
  assert.equal(r.ok, true);
  const row = arg(c.calls.find(q => q.table === 'messages'), 'insert')[0];
  assert.deepEqual({ body: row.body, kind: row.kind, reply_to: row.reply_to }, { body: 'hi', kind: 'text', reply_to: 'm0' });
});

test('chatFileUrl caches the signed URL (1 hour) and re-signs after 50 min', async () => {
  const c = fakeClient();
  A._resetUrlCache();
  const u1 = await A.chatFileUrl(c, 'p/1', 0);
  const u2 = await A.chatFileUrl(c, 'p/1', 10 * 60e3);
  assert.equal(u1, u2);
  assert.equal(c.storageCalls.filter(s => s.op === 'sign').length, 1);
  assert.equal(c.storageCalls[0].secs, 3600);
  await A.chatFileUrl(c, 'p/1', 51 * 60e3);
  assert.equal(c.storageCalls.filter(s => s.op === 'sign').length, 2);
});

test('chatMessages loads newest 50 before a time, returned oldest-first', async () => {
  const c = fakeClient({ 'messages.select': { data: [{ id: 3 }, { id: 2 }, { id: 1 }], error: null } });
  const r = await A.chatMessages(c, 'conv1', '2026-11-21T10:00:00Z');
  assert.deepEqual(r.data.map(m => m.id), [1, 2, 3]);
  const q = c.calls[0];
  assert.deepEqual(arg(q, 'eq'), ['conversation_id', 'conv1']);
  assert.deepEqual(arg(q, 'lt'), ['created_at', '2026-11-21T10:00:00Z']);
  assert.deepEqual(arg(q, 'limit'), [50]);
  assert.deepEqual(arg(q, 'order'), ['created_at', { ascending: false }]);
});

test('chatMessages without "before" has no lt filter', async () => {
  const c = fakeClient();
  await A.chatMessages(c, 'conv1');
  assert.ok(!ops(c.calls[0]).includes('lt'));
});

test('chatMembers flattens profile names', async () => {
  const c = fakeClient({ 'conversation_members.select': { data: [{ user_id: 'u1', role: 'admin', last_read_at: 't', profiles: { display_name: 'Ravi' } }], error: null } });
  const r = await A.chatMembers(c, 'conv1');
  assert.deepEqual(r.data, [{ user_id: 'u1', role: 'admin', last_read_at: 't', display_name: 'Ravi' }]);
});

test('RPC wrappers pass named args and surface errors as text', async () => {
  const c = fakeClient({ 'rpc.start_direct': { data: 'cid', error: null }, 'rpc.leave_group': { data: null, error: { message: "Direct chats can't be left" } } });
  assert.deepEqual(await A.chatStartDirect(c, 'u2'), { ok: true, data: 'cid' });
  assert.deepEqual(await A.chatLeave(c, 'c1'), { ok: false, error: "Direct chats can't be left" });
  await A.chatCreateGroup(c, 'Study', ['a', 'b']);
  await A.chatRemoveMember(c, 'c1', 'u3');
  assert.deepEqual(c.calls.find(x => x.rpc === 'create_group').args, { p_title: 'Study', member_ids: ['a', 'b'] });
  assert.deepEqual(c.calls.find(x => x.rpc === 'remove_member').args, { c: 'c1', member: 'u3' });
});

test('chatDelete removes the file first, then clears the message', async () => {
  const c = fakeClient();
  await A.chatDelete(c, 'm1', 'conv1/x_a.pdf');
  assert.deepEqual(c.storageCalls[0].paths, ['conv1/x_a.pdf']);
  assert.deepEqual(c.calls[0], { rpc: 'delete_message', args: { m: 'm1' } });
});
