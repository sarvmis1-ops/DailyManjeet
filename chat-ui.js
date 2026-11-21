/* LifeOS Chat — screens + realtime. Uses globals from db.js (sb, dbUser, toast) and app.js (openSheet, closeSheet, openDrawPad). */
(function () {
  const C = window.ChatCore, A = window.ChatApi;
  const $ = (q, r = document) => r.querySelector(q), $$ = (q, r = document) => Array.from(r.querySelectorAll(q));

  const chatState = { list: [], people: [], room: null, myName: '', search: '', replyTo: null, pending: [] };
  window.chatState = chatState;
  const me = () => (dbUser && dbUser.id) || null;

  let inboxCh = null, roomCh = null, seenTimer = null, refreshTimer = null, readTimer = null;
  let typingSentAt = 0, typingOffTimer = null;

  /* ---------- small renderers ---------- */
  function avatar(id, name, cls = '') {
    return `<div class="av ${cls}" style="background:${C.avatarColor(id)}" aria-hidden="true">${C.esc(C.initials(name))}</div>`;
  }
  const convName = cv => cv ? (cv.type === 'direct' ? (cv.other_name || 'Unknown') : (cv.title || 'Group')) : '';
  const convAvatarId = cv => cv.type === 'direct' ? (cv.other_id || cv.id) : cv.id;
  const nameOf = uid => {
    if (uid === me()) return 'You';
    const m = chatState.room && chatState.room.members.find(x => x.user_id === uid);
    return m ? m.display_name : 'Unknown';
  };
  const fileIcon = name => {
    const e = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    if (/pdf/i.test(e)) return 'fa-file-pdf';
    if (/docx?|odt|rtf/i.test(e)) return 'fa-file-word';
    if (/xlsx?|csv|ods/i.test(e)) return 'fa-file-excel';
    if (/pptx?|odp/i.test(e)) return 'fa-file-powerpoint';
    if (/zip|rar|7z|tar|gz/i.test(e)) return 'fa-file-zipper';
    return 'fa-file-lines';
  };

  /* ---------- open / close ---------- */
  function showView(v) {
    $('#chatListView').classList.toggle('hidden', v !== 'list');
    $('#chatRoomView').classList.toggle('hidden', v !== 'room');
  }
  async function openChats() {
    if (!me()) return toast('⚠️ Please sign in');
    $('#chatCover').classList.add('on');
    document.body.classList.add('chat-open');
    showView('list');
    renderList();
    await refreshChatList();
  }
  function closeChats() {
    leaveRoom();
    $('#chatCover').classList.remove('on');
    document.body.classList.remove('chat-open');
  }

  /* ---------- chats list ---------- */
  async function refreshChatList() {
    if (!me()) return;
    const r = await A.chatList(sb);
    if (!r.ok) { toast('❌ ' + r.error); return }
    chatState.list = r.data || [];
    if (chatState.room) {
      const cv = chatState.list.find(x => x.id === chatState.room.id);
      if (!cv) { toast('You are no longer in this chat'); leaveRoom(); showView('list') }
      else { chatState.room.conv = cv; renderRoomHeader() }
    }
    renderList();
    updateBadge();
  }
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshChatList, 300) }

  function updateBadge() {
    const n = chatState.list.reduce((s, c) => s + (c.unread || 0), 0);
    const b = $('#chatBadge');
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', !n);
  }

  function renderList() {
    $('#chatMyName').textContent = chatState.myName || '';
    const q = chatState.search.toLowerCase();
    const rows = chatState.list.filter(cv => !q || convName(cv).toLowerCase().includes(q));
    const el = $('#chatRows');
    if (!chatState.list.length) {
      el.innerHTML = `<div class="empty"><i class="fa-regular fa-comments"></i>No chats yet.<br>Tap <b>New chat</b> to message someone.</div>`;
      return;
    }
    if (!rows.length) { el.innerHTML = `<div class="empty">No chats match “${C.esc(chatState.search)}”.</div>`; return }
    el.innerHTML = rows.map(cv => {
      const prev = C.previewText(cv);
      const who = cv.last_sender === me() && prev && !cv.last_deleted ? 'You: ' : '';
      return `<button class="chat-row" data-conv="${cv.id}">
        ${avatar(convAvatarId(cv), convName(cv))}
        <div class="chat-row-main">
          <div class="chat-row-top"><span class="chat-row-name">${cv.type === 'group' ? '<i class="fa-solid fa-user-group" aria-hidden="true"></i> ' : ''}${C.esc(convName(cv))}</span><span class="chat-row-time${cv.unread ? ' on' : ''}">${cv.last_message_at ? C.esc(C.chatTime(cv.last_message_at)) : ''}</span></div>
          <div class="chat-row-bottom"><span class="chat-row-prev${cv.last_deleted ? ' del' : ''}">${prev ? C.esc(who + prev) : '<i>No messages yet</i>'}</span>${cv.unread ? `<span class="chat-unread" aria-label="${cv.unread} unread">${cv.unread > 99 ? '99+' : cv.unread}</span>` : ''}</div>
        </div></button>`;
    }).join('');
    $$('.chat-row', el).forEach(b => b.onclick = () => openRoom(b.dataset.conv));
  }

  async function loadMyName() {
    const r = await (async () => {
      try { const { data, error } = await sb.from('profiles').select('display_name').eq('id', me()).maybeSingle(); return error ? null : data } catch { return null }
    })();
    chatState.myName = (r && r.display_name) || '';
    if ($('#chatCover').classList.contains('on')) renderList();
  }

  function editMyName() {
    openSheet(`<h3>Your name</h3><div class="sub" style="margin:-8px 0 12px;color:var(--muted);font-size:15px">This is how people see you in chats.</div>
      <div class="field"><div class="col"><label>Name</label><input id="cnName" maxlength="40" value="${C.esc(chatState.myName)}"></div></div>
      <button class="btn block mt-16" id="cnSave">Save</button>`);
    $('#cnName').focus();
    $('#cnSave').onclick = () => withLoading($('#cnSave'), async () => {
      const r = await A.chatSetName(sb, me(), $('#cnName').value);
      if (!r.ok) return toast('❌ ' + r.error);
      chatState.myName = $('#cnName').value.trim(); closeSheet(); renderList(); toast('Saved');
    });
  }

  /* ---------- new chat / new group ---------- */
  async function loadPeople() {
    const r = await A.chatPeople(sb);
    if (!r.ok) { toast('❌ ' + r.error); return false }
    chatState.people = r.data || [];
    return true;
  }

  function peopleRows(list, selectable, selected) {
    if (!list.length) return `<div class="empty">No one found.</div>`;
    return list.map(p => `<button class="person-row" data-uid="${p.id}">
        ${avatar(p.id, p.display_name, 'sm')}
        <div class="person-main"><div class="person-name">${C.esc(p.display_name)}</div><div class="person-mail">${C.esc(p.email || '')}</div></div>
        ${selectable ? `<span class="person-check${selected.has(p.id) ? ' on' : ''}" aria-hidden="true"><i class="fa-solid fa-check"></i></span>` : '<i class="fa-solid fa-chevron-right person-go" aria-hidden="true"></i>'}
      </button>`).join('');
  }

  async function openNewChat() {
    openSheet(`<h3>New chat</h3><div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading people…</div>`);
    if (!(await loadPeople())) return closeSheet();
    let group = false, q = '';
    const selected = new Set();
    const draw = () => {
      const list = chatState.people.filter(p => !q || (p.display_name + ' ' + (p.email || '')).toLowerCase().includes(q));
      $('#ncList').innerHTML = peopleRows(list, group, selected);
      $('#ncGroupBox').classList.toggle('hidden', !group);
      $('#ncMode').innerHTML = group ? '<i class="fa-solid fa-user" aria-hidden="true"></i> One-to-one' : '<i class="fa-solid fa-user-group" aria-hidden="true"></i> New group';
      $('#ncCreate').textContent = `Create group${selected.size ? ' (' + selected.size + ')' : ''}`;
      $$('.person-row', $('#ncList')).forEach(b => b.onclick = () => {
        const uid = b.dataset.uid;
        if (!group) return startDirect(uid);
        selected.has(uid) ? selected.delete(uid) : selected.add(uid);
        draw();
      });
    };
    openSheet(`<h3>New chat</h3>
      <div class="field compact"><i class="fa-solid fa-magnifying-glass" style="color:var(--muted)" aria-hidden="true"></i><input id="ncSearch" placeholder="Search name or email" aria-label="Search people"></div>
      <button class="btn ghost sm mt-12" id="ncMode"></button>
      <div id="ncGroupBox" class="hidden mt-12">
        <div class="field"><div class="col"><label>Group name</label><input id="ncTitle" maxlength="60" placeholder="e.g. Study group"></div></div>
        <div class="sub mt-8" style="color:var(--muted);font-size:13px">Select people below, then create.</div>
      </div>
      <div class="people-list mt-12" id="ncList"></div>
      <div id="ncGroupFoot" class="hidden"><button class="btn block mt-16" id="ncCreate">Create group</button></div>`);
    $('#ncSearch').oninput = e => { q = e.target.value.trim().toLowerCase(); draw() };
    $('#ncMode').onclick = () => { group = !group; $('#ncGroupFoot').classList.toggle('hidden', !group); draw() };
    $('#ncCreate').onclick = () => withLoading($('#ncCreate'), async () => {
      const title = $('#ncTitle').value.trim();
      if (!title) return toast('Enter a group name');
      if (!selected.size) return toast('Select at least one person');
      const r = await A.chatCreateGroup(sb, title, [...selected]);
      if (!r.ok) return toast('❌ ' + r.error);
      closeSheet(); await refreshChatList(); openRoom(r.data);
    }, 'Creating…');
    draw();
  }

  async function startDirect(uid) {
    toast('Opening chat…');
    const r = await A.chatStartDirect(sb, uid);
    if (!r.ok) return toast('❌ ' + r.error);
    closeSheet(); await refreshChatList(); openRoom(r.data);
  }

  /* ---------- room ---------- */
  async function openRoom(id) {
    leaveRoom();
    const conv = chatState.list.find(x => x.id === id);
    if (!conv) { await refreshChatList(); if (!chatState.list.find(x => x.id === id)) return toast('Chat not found') }
    chatState.room = { id, conv: chatState.list.find(x => x.id === id), members: [], messages: [], hasMore: true, loading: false, online: new Set(), typing: new Set() };
    chatState.replyTo = null; chatState.pending = [];
    showView('room');
    renderReplyBar();
    renderRoomHeader();
    $('#msgs').innerHTML = `<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading…</div>`;
    const [mr, ms] = await Promise.all([A.chatMembers(sb, id), A.chatMessages(sb, id)]);
    if (!chatState.room || chatState.room.id !== id) return;
    if (!mr.ok || !ms.ok) { $('#msgs').innerHTML = `<div class="empty">Couldn't load this chat.<br>${C.esc((mr.error || ms.error) || '')}</div>`; return }
    chatState.room.members = mr.data;
    chatState.room.messages = ms.data;
    chatState.room.hasMore = ms.data.length >= 50;
    renderRoomHeader();
    renderRoom({ toBottom: true });
    markReadSoon(0);
    roomJoin(id);
    if (window.matchMedia('(pointer:fine)').matches) $('#msgInput').focus();
  }

  function leaveRoom() {
    if (roomCh) { sb.removeChannel(roomCh); roomCh = null }
    chatState.room = null; chatState.pending = []; chatState.replyTo = null;
  }

  function renderRoomHeader() {
    const room = chatState.room; if (!room || !room.conv) return;
    const cv = room.conv;
    $('#roomAv').innerHTML = avatar(convAvatarId(cv), convName(cv), 'sm');
    $('#roomTitle').textContent = convName(cv);
    const others = [...room.typing].filter(u => u !== me());
    let sub = '';
    if (others.length) sub = cv.type === 'group' ? `${nameOf(others[0])} is typing…` : 'typing…';
    else if (cv.type === 'direct') sub = room.online.has(cv.other_id) ? 'online' : '';
    else sub = `${cv.member_count || room.members.length} members`;
    const s = $('#roomSub');
    s.textContent = sub;
    s.classList.toggle('typing', !!others.length);
    s.classList.toggle('online', sub === 'online');
  }

  function quoteHtml(id) {
    const m = chatState.room.messages.find(x => x.id === id);
    if (!m) return `<div class="bub-quote"><span>Original message</span></div>`;
    const t = m.deleted_at ? 'This message was deleted' : (m.kind === 'text' ? m.body : C.previewText({ last_kind: m.kind }) + (m.file_name && m.kind === 'file' ? ' · ' + m.file_name : ''));
    return `<div class="bub-quote" style="border-color:${C.avatarColor(m.sender_id || '')}"><b>${C.esc(nameOf(m.sender_id))}</b><span>${C.esc(t.slice(0, 120))}</span></div>`;
  }

  function contentHtml(m) {
    if (m.deleted_at) return `<div class="bub-del"><i class="fa-solid fa-ban" aria-hidden="true"></i> This message was deleted</div>`;
    const cap = m.kind !== 'text' && m.body ? `<div class="bub-text">${C.renderSafe(m.body)}</div>` : '';
    switch (m.kind) {
      case 'image': case 'drawing':
        return `<img class="bub-img${m.kind === 'drawing' ? ' drawing' : ''}" data-path="${C.esc(m.file_path)}" alt="${C.esc(m.file_name || 'Photo')}" loading="lazy">${cap}`;
      case 'video':
        return `<video class="bub-video" data-path="${C.esc(m.file_path)}" controls preload="metadata" playsinline></video>${cap}`;
      case 'audio':
        return `<audio class="bub-audio" data-path="${C.esc(m.file_path)}" controls preload="none"></audio>${cap}`;
      case 'file':
        return `<a class="bub-file" data-path="${C.esc(m.file_path)}" target="_blank" rel="noopener"><i class="fa-solid ${fileIcon(m.file_name)}" aria-hidden="true"></i><div><b>${C.esc(m.file_name || 'File')}</b><small>${C.esc(C.formatBytes(m.file_size))}</small></div><i class="fa-solid fa-arrow-down bub-dl" aria-hidden="true"></i></a>${cap}`;
      default:
        return `<div class="bub-text">${C.renderSafe(m.body)}</div>`;
    }
  }

  function ticks(m) {
    const t = C.tickState(m, chatState.room.members, me());
    if (!t || m.deleted_at) return '';
    return t === 'read'
      ? '<span class="tick read" aria-label="Read"><i class="fa-solid fa-check-double"></i></span>'
      : '<span class="tick" aria-label="Sent"><i class="fa-solid fa-check"></i></span>';
  }

  function renderRoom(opt = {}) {
    const room = chatState.room; if (!room) return;
    const box = $('#msgs');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    const group = room.conv && room.conv.type === 'group';
    let html = room.hasMore ? `<div class="msgs-more">${room.loading ? '<i class="fa-solid fa-spinner fa-spin"></i>' : 'Scroll up for earlier messages'}</div>` : '';
    if (!room.messages.length && !chatState.pending.length) html += `<div class="empty"><i class="fa-regular fa-hand"></i>Say hello 👋</div>`;
    let lastDay = '', lastSender = null;
    room.messages.forEach(m => {
      const day = C.dayLabel(m.created_at);
      if (day !== lastDay) { html += `<div class="day-sep"><span>${C.esc(day)}</span></div>`; lastDay = day; lastSender = null }
      const mine = m.sender_id === me();
      const showName = group && !mine && m.sender_id !== lastSender;
      const media = !m.deleted_at && ['image', 'drawing', 'video'].includes(m.kind);
      html += `<div class="msg-row ${mine ? 'me' : 'them'}${m.sender_id === lastSender ? ' cont' : ''}">
        <div class="bub ${mine ? 'me' : 'them'}${media ? ' media' : ''}" data-mid="${m.id}" role="button" tabindex="0">
          ${showName ? `<div class="bub-name" style="color:${C.avatarColor(m.sender_id || '')}">${C.esc(nameOf(m.sender_id))}</div>` : ''}
          ${m.reply_to && !m.deleted_at ? quoteHtml(m.reply_to) : ''}
          ${contentHtml(m)}
          <div class="bub-meta">${new Date(m.created_at).toTimeString().slice(0, 5)}${mine ? ticks(m) : ''}</div>
        </div></div>`;
      lastSender = m.sender_id;
    });
    chatState.pending.forEach(p => {
      html += `<div class="msg-row me"><div class="bub me pending${p.failed ? ' failed' : ''}" data-pid="${p.pid}">
        <div class="bub-file"><i class="fa-solid ${p.failed ? 'fa-circle-exclamation' : 'fa-spinner fa-spin'}" aria-hidden="true"></i><div><b>${C.esc(p.name)}</b><small>${p.failed ? C.esc(p.error || 'Failed') : 'Sending… ' + C.esc(C.formatBytes(p.file.size))}</small></div></div>
        ${p.failed ? `<div class="pending-act"><button data-retry="${p.pid}">Retry</button><button data-remove="${p.pid}">Remove</button></div>` : ''}
      </div></div>`;
    });
    box.innerHTML = html;
    if (opt.keepTop) box.scrollTop = box.scrollHeight - prevH + prevTop;
    else if (opt.toBottom || nearBottom) box.scrollTop = box.scrollHeight;
    $$('.bub[data-mid]', box).forEach(b => {
      b.onclick = e => { if (e.target.closest('a,video,audio')) return; messageActions(b.dataset.mid) };
      b.onkeydown = e => { if (e.key === 'Enter') messageActions(b.dataset.mid) };
    });
    $$('[data-retry]', box).forEach(b => b.onclick = () => retryPending(b.dataset.retry));
    $$('[data-remove]', box).forEach(b => b.onclick = () => { chatState.pending = chatState.pending.filter(p => p.pid !== b.dataset.remove); renderRoom() });
    fillFileUrls(box);
  }

  async function fillFileUrls(root) {
    for (const el of $$('[data-path]', root)) {
      const path = el.dataset.path; if (!path || el.dataset.ready) continue;
      el.dataset.ready = '1';
      const url = await A.chatFileUrl(sb, path);
      if (!url) continue;
      if (el.tagName === 'A') el.href = url;
      else el.src = url;
      if (el.tagName === 'IMG') el.onload = () => { const b = $('#msgs'); if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 400) b.scrollTop = b.scrollHeight };
    }
  }

  async function loadEarlier() {
    const room = chatState.room;
    if (!room || room.loading || !room.hasMore || !room.messages.length) return;
    room.loading = true; renderRoom({ keepTop: true });
    const r = await A.chatMessages(sb, room.id, room.messages[0].created_at);
    room.loading = false;
    if (!chatState.room || chatState.room !== room) return;
    if (r.ok) { room.messages = r.data.concat(room.messages); room.hasMore = r.data.length >= 50 }
    renderRoom({ keepTop: true });
  }

  /* ---------- message actions ---------- */
  function messageActions(mid) {
    const m = chatState.room && chatState.room.messages.find(x => x.id === mid); if (!m) return;
    const mine = m.sender_id === me();
    const acts = [];
    if (!m.deleted_at) acts.push(['reply', 'fa-reply', 'Reply']);
    if (!m.deleted_at && m.file_path) acts.push(['open', 'fa-arrow-up-right-from-square', 'Open']);
    if (!m.deleted_at && (m.kind === 'text' || m.body)) acts.push(['copy', 'fa-copy', 'Copy text']);
    if (mine && !m.deleted_at) acts.push(['delete', 'fa-trash', 'Delete for everyone', 'danger']);
    if (!acts.length) return;
    openSheet(`<div class="action-list">${acts.map(a => `<button class="action-item ${a[3] || ''}" data-act="${a[0]}"><i class="fa-solid ${a[1]}" aria-hidden="true"></i>${a[2]}</button>`).join('')}</div>`);
    $$('[data-act]', $('#sheetBody')).forEach(b => b.onclick = async () => {
      const act = b.dataset.act; closeSheet();
      if (act === 'reply') { chatState.replyTo = m.id; renderReplyBar(); $('#msgInput').focus() }
      if (act === 'open') { const u = await A.chatFileUrl(sb, m.file_path); if (u) window.open(u, '_blank', 'noopener') }
      if (act === 'copy') { try { await navigator.clipboard.writeText(m.body); toast('Copied') } catch { toast('Copy not allowed here') } }
      if (act === 'delete') {
        if (!confirm('Delete this message for everyone?')) return;
        const r = await A.chatDelete(sb, m.id, m.file_path);
        if (!r.ok) return toast('❌ ' + r.error);
        Object.assign(m, { deleted_at: new Date().toISOString(), body: '', file_path: null, file_name: null });
        renderRoom(); refreshSoon();
      }
    });
  }

  function renderReplyBar() {
    const bar = $('#replyBar'), id = chatState.replyTo;
    if (!id || !chatState.room) { bar.classList.add('hidden'); bar.innerHTML = ''; return }
    bar.classList.remove('hidden');
    bar.innerHTML = `${quoteHtml(id)}<button class="reply-x" id="replyX" aria-label="Cancel reply"><i class="fa-solid fa-xmark"></i></button>`;
    $('#replyX').onclick = () => { chatState.replyTo = null; renderReplyBar() };
  }

  /* ---------- sending ---------- */
  function appendMessage(m) {
    const room = chatState.room;
    if (!room || m.conversation_id !== room.id) return;
    if (room.messages.some(x => x.id === m.id)) return;          /* realtime + API both deliver */
    room.messages.push(m);
    room.messages.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    renderRoom();
  }

  async function sendText() {
    const room = chatState.room; if (!room) return;
    const input = $('#msgInput'), text = input.value;
    if (!text.trim()) return;
    input.value = ''; autoGrow();
    const replyTo = chatState.replyTo; chatState.replyTo = null; renderReplyBar();
    typingOff();
    const r = await A.chatSendText(sb, room.id, text, replyTo);
    if (!r.ok) { input.value = text; autoGrow(); toast('❌ ' + r.error); return }
    appendMessage(r.data);
    refreshSoon();
  }

  async function sendFiles(files, kind) {
    const room = chatState.room; if (!room) return;
    for (const f of files) {
      if (f.size > A.MAX_BYTES) { toast(`❌ ${f.name || 'File'} is larger than 50 MB`); continue }
      const p = { pid: 'p' + Date.now() + Math.random().toString(36).slice(2, 7), file: f, name: f.name || (kind === 'drawing' ? 'Drawing.png' : 'file'), kind, convId: room.id, replyTo: chatState.replyTo, failed: false };
      chatState.replyTo = null; renderReplyBar();
      chatState.pending.push(p);
      renderRoom({ toBottom: true });
      runPending(p);
    }
  }

  async function runPending(p) {
    p.failed = false; renderRoom();
    const r = await A.chatSendFile(sb, p.convId, p.file, { name: p.name, kind: p.kind, replyTo: p.replyTo });
    if (!chatState.room || chatState.room.id !== p.convId) return;
    if (!r.ok) { p.failed = true; p.error = r.error; renderRoom(); return }
    chatState.pending = chatState.pending.filter(x => x.pid !== p.pid);
    appendMessage(r.data);
    renderRoom();
    refreshSoon();
  }
  function retryPending(pid) { const p = chatState.pending.find(x => x.pid === pid); if (p) runPending(p) }

  function chatSendDrawing(blob) {
    if (!chatState.room) return toast('Open a chat first');
    sendFiles([new File([blob], 'Drawing-' + Date.now() + '.png', { type: 'image/png' })], 'drawing');
  }

  function attachMenu() {
    openSheet(`<div class="action-list">
      <button class="action-item" data-att="media"><i class="fa-solid fa-image" aria-hidden="true"></i>Photo or video</button>
      <button class="action-item" data-att="file"><i class="fa-solid fa-file" aria-hidden="true"></i>Document or any file</button>
      <button class="action-item" data-att="audio"><i class="fa-solid fa-music" aria-hidden="true"></i>Audio</button>
      <button class="action-item" data-att="draw"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i>Drawing</button>
    </div>`);
    $$('[data-att]', $('#sheetBody')).forEach(b => b.onclick = () => {
      const a = b.dataset.att; closeSheet();
      if (a === 'draw') { window.drawSendTarget = chatState.room && chatState.room.id; openDrawPad(); return }
      const input = $('#chatFilePick');
      input.accept = a === 'media' ? 'image/*,video/*' : a === 'audio' ? 'audio/*' : '';
      input.value = ''; input.click();
    });
  }

  function autoGrow() {
    const t = $('#msgInput'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px';
    $('#msgSend').disabled = !t.value.trim();
  }

  /* ---------- read receipts ---------- */
  function markReadSoon(delay = 600) {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      const room = chatState.room;
      if (!room || document.visibilityState !== 'visible' || !$('#chatCover').classList.contains('on')) return;
      await A.chatMarkRead(sb, room.id);
      const cv = chatState.list.find(x => x.id === room.id);
      if (cv && cv.unread) { cv.unread = 0; updateBadge(); renderList() }
    }, delay);
  }

  /* ---------- group / chat info ---------- */
  async function openInfo() {
    const room = chatState.room; if (!room || !room.conv) return;
    const cv = room.conv;
    if (cv.type === 'direct') {
      openSheet(`<div class="info-head">${avatar(cv.other_id || cv.id, convName(cv), 'lg')}<h3>${C.esc(convName(cv))}</h3><div class="person-mail">${C.esc(cv.other_email || '')}</div></div>`);
      return;
    }
    const mr = await A.chatMembers(sb, room.id);
    if (mr.ok) room.members = mr.data;
    const amAdmin = room.members.some(m => m.user_id === me() && m.role === 'admin');
    openSheet(`<div class="info-head">${avatar(cv.id, convName(cv), 'lg')}<h3>${C.esc(convName(cv))}</h3><div class="person-mail">${room.members.length} members</div></div>
      ${amAdmin ? `<div class="field mt-12"><div class="col"><label>Group name</label><input id="giTitle" maxlength="60" value="${C.esc(cv.title || '')}"></div><button class="btn sm" id="giRename">Save</button></div>` : ''}
      <div class="card"><div class="row"><h3 style="font-size:17px">Members</h3>${amAdmin ? '<button class="btn sm ghost" id="giAdd"><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Add</button>' : ''}</div>
      ${room.members.map(m => `<div class="item">${avatar(m.user_id, m.display_name, 'sm')}<div style="flex:1;min-width:0"><div class="t">${C.esc(m.user_id === me() ? m.display_name + ' (You)' : m.display_name)}</div>${m.role === 'admin' ? '<div class="m"><span class="chip acc">Admin</span></div>' : ''}</div>${amAdmin && m.user_id !== me() ? `<div class="actions"><button data-rm="${m.user_id}" aria-label="Remove ${C.esc(m.display_name)}"><i class="fa-solid fa-user-minus"></i></button></div>` : ''}</div>`).join('')}</div>
      <button class="btn block mt-16 danger-btn" id="giLeave"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Leave group</button>`);
    if (amAdmin) {
      $('#giRename').onclick = () => withLoading($('#giRename'), async () => {
        const r = await A.chatRename(sb, room.id, $('#giTitle').value);
        if (!r.ok) return toast('❌ ' + r.error);
        toast('Renamed'); await refreshChatList(); openInfo();
      }, '');
      $('#giAdd').onclick = () => addMembersSheet();
      $$('[data-rm]', $('#sheetBody')).forEach(b => b.onclick = async () => {
        if (!confirm('Remove this person from the group?')) return;
        const r = await A.chatRemoveMember(sb, room.id, b.dataset.rm);
        if (!r.ok) return toast('❌ ' + r.error);
        toast('Removed'); await refreshChatList(); openInfo();
      });
    }
    $('#giLeave').onclick = async () => {
      if (!confirm('Leave this group? You will lose access to its messages and files.')) return;
      const r = await A.chatLeave(sb, room.id);
      if (!r.ok) return toast('❌ ' + r.error);
      closeSheet(); leaveRoom(); showView('list'); await refreshChatList(); toast('You left the group');
    };
  }

  async function addMembersSheet() {
    if (!(await loadPeople())) return;
    const room = chatState.room;
    const inGroup = new Set(room.members.map(m => m.user_id));
    const list = chatState.people.filter(p => !inGroup.has(p.id));
    const selected = new Set();
    const draw = () => {
      $('#amList').innerHTML = peopleRows(list, true, selected);
      $('#amSave').textContent = `Add${selected.size ? ' (' + selected.size + ')' : ''}`;
      $$('.person-row', $('#amList')).forEach(b => b.onclick = () => { const u = b.dataset.uid; selected.has(u) ? selected.delete(u) : selected.add(u); draw() });
    };
    openSheet(`<h3>Add people</h3><div class="people-list" id="amList"></div><button class="btn block mt-16" id="amSave">Add</button>`);
    $('#amSave').onclick = () => withLoading($('#amSave'), async () => {
      if (!selected.size) return toast('Select at least one person');
      const r = await A.chatAddMembers(sb, room.id, [...selected]);
      if (!r.ok) return toast('❌ ' + r.error);
      toast('Added'); await refreshChatList(); openInfo();
    }, 'Adding…');
    draw();
  }

  /* ---------- realtime ---------- */
  function onNewMessage(m) {
    if (chatState.room && m.conversation_id === chatState.room.id) {
      appendMessage(m);
      if (m.sender_id !== me()) markReadSoon();
    }
    refreshSoon();
  }

  function roomJoin(id) {
    if (!sb.channel) return;
    const ch = sb.channel('room:' + id, { config: { presence: { key: me() } } });
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + id }, p => {
      const room = chatState.room; if (!room || room.id !== id) return;
      const i = room.messages.findIndex(x => x.id === p.new.id);
      if (i >= 0) { room.messages[i] = p.new; renderRoom() }
    });
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: 'conversation_id=eq.' + id }, p => {
      const room = chatState.room; if (!room || room.id !== id) return;
      const mm = room.members.find(x => x.user_id === p.new.user_id);
      if (mm) { mm.last_read_at = p.new.last_read_at; mm.role = p.new.role; renderRoom() }
    });
    ch.on('presence', { event: 'sync' }, () => {
      const room = chatState.room; if (!room || room.id !== id) return;
      const st = ch.presenceState();
      room.online = new Set(); room.typing = new Set();
      Object.values(st).forEach(list => list.forEach(x => { room.online.add(x.user_id); if (x.typing) room.typing.add(x.user_id) }));
      renderRoomHeader();
    });
    ch.subscribe(async status => { if (status === 'SUBSCRIBED') await ch.track({ user_id: me(), typing: false }) });
    roomCh = ch;
  }

  function typingOn() {
    if (!roomCh) return;
    const now = Date.now();
    if (now - typingSentAt > 2000) { typingSentAt = now; roomCh.track({ user_id: me(), typing: true }) }
    clearTimeout(typingOffTimer);
    typingOffTimer = setTimeout(typingOff, 4000);
  }
  function typingOff() {
    clearTimeout(typingOffTimer);
    if (roomCh && typingSentAt) { typingSentAt = 0; roomCh.track({ user_id: me(), typing: false }) }
  }

  function chatConnect() {
    if (!me() || inboxCh || !sb.channel) return;
    loadMyName();
    inboxCh = sb.channel('chat-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onNewMessage(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: 'user_id=eq.' + me() }, () => refreshSoon())
      .subscribe();
    refreshChatList();
    A.chatSeen(sb, me());
    seenTimer = setInterval(() => { if (document.visibilityState === 'visible') A.chatSeen(sb, me()) }, 60e3);
  }

  function chatDisconnect() {
    closeChats();
    if (inboxCh) { sb.removeChannel(inboxCh); inboxCh = null }
    clearInterval(seenTimer); seenTimer = null;
    chatState.list = []; chatState.people = []; chatState.myName = '';
    updateBadge();
  }

  /* ---------- wire up ---------- */
  function initChatUi() {
    $('#btnChat').onclick = openChats;
    $('#chatClose').onclick = closeChats;
    $('#chatNew').onclick = openNewChat;
    $('#chatNameEdit').onclick = editMyName;
    $('#chatSearch').oninput = e => { chatState.search = e.target.value.trim(); renderList() };
    $('#roomBack').onclick = () => { leaveRoom(); showView('list'); refreshChatList() };
    $('#roomInfo').onclick = openInfo;
    $('#roomHead').onclick = openInfo;
    $('#msgAttach').onclick = attachMenu;
    $('#msgSend').onclick = sendText;
    const input = $('#msgInput');
    input.oninput = () => { autoGrow(); if (input.value.trim()) typingOn(); else typingOff() };
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); sendText() }
    };
    $('#chatFilePick').onchange = e => { const files = Array.from(e.target.files || []); if (files.length) sendFiles(files) };
    $('#msgs').addEventListener('scroll', () => { if ($('#msgs').scrollTop < 60) loadEarlier() });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && chatState.room) markReadSoon() });
    autoGrow();
  }

  Object.assign(window, { openChats, closeChats, openRoom, refreshChatList, renderRoom, chatSendDrawing, chatConnect, chatDisconnect });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChatUi); else initChatUi();
})();
