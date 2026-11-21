/* LifeOS Chat — pure helpers (no DOM, no network). Unit-tested in tests/chat-core.test.js */
(function (root) {
  const AVATAR_COLORS = ['#FF9500', '#FF2D55', '#AF52DE', '#5856D6', '#007AFF', '#32ADE6', '#34C759', '#A2845E'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const RESIGN_AFTER_MS = 50 * 60 * 1000;
  const pad = n => String(n).padStart(2, '0');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function avatarColor(id) {
    let h = 2166136261;                                  /* FNV-1a: *31 mod 8 collapses repeated patterns */
    for (const ch of String(id || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function fileKind(mime, name) {
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    const ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1];
    const e = (ext || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'svg'].includes(e)) return 'image';
    if (['mp4', 'mov', 'webm', 'mkv', 'm4v', '3gp'].includes(e)) return 'video';
    if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'opus', 'flac'].includes(e)) return 'audio';
    return 'file';
  }

  function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = (d, now) => Math.round((startOfDay(now) - startOfDay(d)) / 864e5);

  function chatTime(iso, now = new Date()) {
    const d = new Date(iso), n = daysAgo(d, now);
    if (n <= 0) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (n === 1) return 'Yesterday';
    if (n < 7) return WEEKDAYS[d.getDay()];
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2);
  }

  function dayLabel(iso, now = new Date()) {
    const d = new Date(iso), n = daysAgo(d, now);
    if (n <= 0) return 'Today';
    if (n === 1) return 'Yesterday';
    return WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  /* 'read' once every other member's last_read_at is at/after the message */
  function tickState(msg, members, myId) {
    if (!msg || msg.sender_id !== myId) return null;
    const others = (members || []).filter(m => m.user_id !== myId);
    if (!others.length) return 'sent';
    const t = new Date(msg.created_at).getTime();
    return others.every(m => m.last_read_at && new Date(m.last_read_at).getTime() >= t) ? 'read' : 'sent';
  }

  function needsResign(signedAtMs, nowMs = Date.now()) { return nowMs - signedAtMs > RESIGN_AFTER_MS }

  function safeFileName(name) {
    const s = String(name || '').replace(/[^\w.\-]+/g, '_').slice(-80);
    return s || 'file';
  }

  function previewText(row) {
    if (!row) return '';
    if (row.last_deleted) return 'This message was deleted';
    switch (row.last_kind) {
      case 'image': return '📷 Photo';
      case 'video': return '🎥 Video';
      case 'audio': return '🎤 Audio';
      case 'file': return '📄 File';
      case 'drawing': return '✏️ Drawing';
      case 'text': return row.last_body || '';
      default: return '';
    }
  }

  /* escape first, then turn http(s) links into anchors — nothing user-typed becomes markup */
  function renderSafe(text) {
    return esc(text)
      .replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
      .replace(/\n/g, '<br>');
  }

  const api = { esc, initials, avatarColor, fileKind, formatBytes, chatTime, dayLabel, tickState, needsResign, safeFileName, previewText, renderSafe, AVATAR_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChatCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
