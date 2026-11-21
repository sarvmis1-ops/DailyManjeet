/* LifeOS Chat — Supabase calls. Every function takes the client first (tests pass a fake)
   and returns {ok:true,data} or {ok:false,error:'readable text'}, like js/db.js. */
(function (root) {
  const Core = typeof module !== 'undefined' && module.exports ? require('./chat-core.js') : root.ChatCore;
  const BUCKET = 'chat';
  const MAX_BYTES = 52428800;              /* 50 MB */
  const URL_TTL_S = 3600;                  /* signed URLs live 1 hour */
  const PAGE = 50;
  let urlCache = new Map();                /* path → {url, at} */

  async function wrap(p) {
    try {
      const { data, error } = await p;
      if (error) return { ok: false, error: error.message || String(error) };
      return { ok: true, data };
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) } }
  }
  const rpc = (c, name, args) => wrap(args === undefined ? c.rpc(name) : c.rpc(name, args));
  const uuid = () => (root.crypto || globalThis.crypto).randomUUID();

  const chatPeople = c => rpc(c, 'people');
  const chatList = c => rpc(c, 'my_conversations');
  const chatStartDirect = (c, other) => rpc(c, 'start_direct', { other });
  const chatCreateGroup = (c, title, ids) => rpc(c, 'create_group', { p_title: title, member_ids: ids });
  const chatAddMembers = (c, convId, ids) => rpc(c, 'add_members', { c: convId, member_ids: ids });
  const chatRemoveMember = (c, convId, userId) => rpc(c, 'remove_member', { c: convId, member: userId });
  const chatLeave = (c, convId) => rpc(c, 'leave_group', { c: convId });
  const chatRename = (c, convId, title) => rpc(c, 'rename_group', { c: convId, p_title: title });
  const chatMarkRead = (c, convId) => rpc(c, 'mark_read', { c: convId });

  /* storage file goes first so a failed delete never leaves a file behind a "deleted" message */
  async function chatDelete(c, msgId, filePath) {
    if (filePath) {
      const r = await wrap(c.storage.from(BUCKET).remove([filePath]));
      if (!r.ok) return r;
      urlCache.delete(filePath);
    }
    return rpc(c, 'delete_message', { m: msgId });
  }

  async function chatMembers(c, convId) {
    const r = await wrap(c.from('conversation_members')
      .select('user_id,role,last_read_at,profiles(display_name)')
      .eq('conversation_id', convId));
    if (!r.ok) return r;
    return { ok: true, data: (r.data || []).map(m => ({ user_id: m.user_id, role: m.role, last_read_at: m.last_read_at, display_name: (m.profiles && m.profiles.display_name) || 'Unknown' })) };
  }

  async function chatMessages(c, convId, beforeIso) {
    let q = c.from('messages').select('*').eq('conversation_id', convId);
    if (beforeIso) q = q.lt('created_at', beforeIso);
    const r = await wrap(q.order('created_at', { ascending: false }).limit(PAGE));
    if (!r.ok) return r;
    return { ok: true, data: (r.data || []).slice().reverse() };
  }

  async function chatSendText(c, convId, body, replyTo) {
    const text = String(body || '').trim();
    if (!text) return { ok: false, error: 'Message is empty' };
    return wrap(c.from('messages').insert({ conversation_id: convId, kind: 'text', body: text, reply_to: replyTo || null }).select().single());
  }

  /* upload first; the message row exists only once the file does */
  async function chatSendFile(c, convId, file, opts = {}) {
    const name = opts.name || file.name || 'file';
    if (!file || !(file.size >= 0)) return { ok: false, error: 'No file' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'File is larger than 50 MB' };
    const mime = file.type || 'application/octet-stream';
    const path = `${convId}/${uuid()}_${Core.safeFileName(name)}`;
    const up = await wrap(c.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false }));
    if (!up.ok) return up;
    if (opts.onProgress) opts.onProgress(1);
    const ins = await wrap(c.from('messages').insert({
      conversation_id: convId,
      kind: opts.kind || Core.fileKind(mime, name),
      body: opts.caption || '',
      file_path: path, file_name: name, file_size: file.size, mime_type: mime,
      reply_to: opts.replyTo || null
    }).select().single());
    if (!ins.ok) await wrap(c.storage.from(BUCKET).remove([path]));
    return ins;
  }

  async function chatFileUrl(c, path, nowMs = Date.now(), force = false) {
    const hit = urlCache.get(path);
    if (hit && !force && !Core.needsResign(hit.at, nowMs)) return hit.url;
    const r = await wrap(c.storage.from(BUCKET).createSignedUrl(path, URL_TTL_S));
    if (!r.ok || !r.data) return '';
    urlCache.set(path, { url: r.data.signedUrl, at: nowMs });
    return r.data.signedUrl;
  }

  function chatSetName(c, userId, name) {
    const n = String(name || '').trim();
    if (!n || n.length > 40) return Promise.resolve({ ok: false, error: 'Name must be 1–40 characters' });
    return wrap(c.from('profiles').update({ display_name: n }).eq('id', userId));
  }

  const chatSeen = (c, userId) => wrap(c.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId));

  const api = {
    MAX_BYTES, chatPeople, chatList, chatStartDirect, chatCreateGroup, chatAddMembers, chatRemoveMember,
    chatLeave, chatRename, chatMarkRead, chatDelete, chatMembers, chatMessages, chatSendText, chatSendFile,
    chatFileUrl, chatSetName, chatSeen, _resetUrlCache: () => { urlCache = new Map() }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChatApi = api;
})(typeof window !== 'undefined' ? window : globalThis);
