/* LifeOS — Supabase data layer.
   Keeps the old Sheets API shape ({ok,data}) so app.js is unchanged:
   rows come back camelCase with string values, exactly like the Sheet did. */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const DB_BUCKET = 'lifeos';
let dbUser = null;

/* app sheet name → table */
const DB_TABLES = { Tasks:'tasks', Projects:'projects', Notes:'notes', Images:'images', Finance:'finance', Accounts:'accounts', Learning:'learning', Syllabus:'syllabus', Health:'health', Office:'office', Journal:'journal', Quotes:'quotes', Calc:'calc', Focus:'focus', Habits:'habits', Pins:'pins', Drawings:'drawings', Locations:'locations', DashImage:'dash_images', Recordings:'recordings', VocabDone:'vocab_done', Alarms:'alarms' };

/* app field → column, where it is not a plain camelCase → snake_case */
const DB_RENAME = { created:'created_at', updated:'updated_at', completed:'completed_at', timestamp:'recorded_at', fileId:'file_path', imageFileId:'image_file_path', audioFileId:'audio_path' };
const DB_RENAME_BACK = Object.fromEntries(Object.entries(DB_RENAME).map(([a, b]) => [b, a]));

/* column types that need converting (everything else is plain text) */
const DB_TYPES = {
  tasks:      { due:'date', completed_at:'ts' },
  projects:   { remarks:'json' },
  notes:      { attachments:'json' },
  finance:    { amount:'num', date:'date' },
  accounts:   { balance:'num' },
  learning:   { start_date:'date', review_dates:'list', done_dates:'list' },
  health:     { meal:'opt', date:'date' },
  office:     { date:'date', in_time:'ts', out_time:'ts', total_minutes:'int' },
  journal:    { date:'date' },
  focus:      { duration:'int', started_at:'ts', completed_at:'ts' },
  habits:     { start_date:'date', days:'json', streak:'int' },
  pins:       { pinned:'bool' },
  locations:  { lat:'num', lng:'num', recorded_at:'ts' },
  recordings: { recorded_at:'ts' },
  vocab_done: { date:'date', words:'list', score:'int' },
  alarms:     { time:'time', active:'bool' }
};

/* columns holding a storage path — the file is removed with the row */
const DB_FILE_COLS = { images:'file_path', dash_images:'file_path', recordings:'file_path', pins:'image_file_path', alarms:'audio_path' };

const toCol = k => DB_RENAME[k] || k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const toKey = c => DB_RENAME_BACK[c] || c.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function toDbVal(kind, v) {
  const blank = v === null || v === undefined || v === '';
  switch (kind) {
    case 'bool': return v === true || v === 'true';
    case 'json': return typeof v === 'string' ? safeParse(v || '[]', []) : (v ?? []);
    case 'list': return Array.isArray(v) ? v : String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);
    case 'int':  return blank ? null : parseInt(v, 10);
    case 'num':  return blank ? null : Number(v);
    case 'date': case 'ts': case 'time': case 'opt': return blank ? null : v;
    default: return v ?? '';
  }
}

function fromDbVal(kind, v) {
  if (v === null || v === undefined) return '';
  switch (kind) {
    case 'bool': return v ? 'true' : 'false';
    case 'json': return JSON.stringify(v);
    case 'list': return v.join(',');
    case 'int': case 'num': return String(v);
    case 'time': return String(v).slice(0, 5);          /* '06:30:00' → '06:30' (alarm check compares HH:MM) */
    default: return v;
  }
}

function toDbRow(table, row) {
  const types = DB_TYPES[table] || {}, out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k === 'id' || k.startsWith('_')) continue;       /* id is generated; _fired etc. are UI-only */
    const c = toCol(k);
    if (c === 'user_id' || c === 'created_at' || c === 'updated_at') continue;
    out[c] = toDbVal(types[c], v);
  }
  return out;
}

function fromDbRow(table, row) {
  const types = DB_TYPES[table] || {}, out = {};
  for (const [c, v] of Object.entries(row)) {
    if (c === 'user_id') continue;
    out[toKey(c)] = fromDbVal(types[c], v);
  }
  return out;
}

function dbTable(sheet) {
  const t = DB_TABLES[sheet];
  if (!t) throw new Error('Unknown sheet ' + sheet);
  return t;
}

function dbFail(e, msg) {
  console.error('[LifeOS db]', e);
  toast(msg || ('❌ ' + (e && e.message ? e.message : 'Database error')));
  return { ok: false, error: e && e.message };
}

function isAuthed() { return !!dbUser }

/* ---------- same API the app used with Apps Script ---------- */

async function apiList(sheet) {
  if (!isAuthed()) return { ok: false };
  try {
    const t = dbTable(sheet), rows = [], page = 1000;
    for (let from = 0; ; from += page) {                 /* PostgREST caps a request at 1000 rows */
      const { data, error } = await sb.from(t).select('*').order('created_at', { ascending: true }).range(from, from + page - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < page) break;
    }
    return { ok: true, data: rows.map(r => fromDbRow(t, r)) };
  } catch (e) { return dbFail(e, '❌ Could not load ' + sheet) }
}

async function apiAll() {
  if (!isAuthed()) return { ok: false };
  const sheets = Object.keys(DB_TABLES), res = await Promise.all(sheets.map(apiList));
  if (res.some(r => !r.ok)) return { ok: false };
  const data = {};
  sheets.forEach((s, i) => data[s] = res[i].data);
  return { ok: true, data };
}

async function apiAdd(sheet, row) {
  if (!isAuthed()) return dbFail(null, '⚠️ Please sign in');
  try {
    const t = dbTable(sheet);
    const { data, error } = await sb.from(t).insert(toDbRow(t, row)).select().single();
    if (error) throw error;
    return { ok: true, data: fromDbRow(t, data) };
  } catch (e) { return dbFail(e) }
}

async function apiUpdate(sheet, id, patch) {
  if (!isAuthed()) return dbFail(null, '⚠️ Please sign in');
  try {
    const t = dbTable(sheet);
    const { data, error } = await sb.from(t).update(toDbRow(t, patch)).eq('id', id).select().single();
    if (error) throw error;
    return { ok: true, data: fromDbRow(t, data) };
  } catch (e) { return dbFail(e) }
}

async function apiDelete(sheet, id) {
  if (!isAuthed()) return dbFail(null, '⚠️ Please sign in');
  try {
    const t = dbTable(sheet), fileCol = DB_FILE_COLS[t];
    let path = null;
    if (fileCol) {
      const { data } = await sb.from(t).select(fileCol).eq('id', id).maybeSingle();
      path = data && data[fileCol];
    }
    const { error } = await sb.from(t).delete().eq('id', id);
    if (error) throw error;
    if (path) {
      const { error: se } = await sb.storage.from(DB_BUCKET).remove([path]);
      if (se) console.warn('[LifeOS db] file not removed', path, se);
    }
    return { ok: true };
  } catch (e) { return dbFail(e) }
}

/* base64 (no data: prefix) → private bucket under <user_id>/ ; returns {url, fileId}
   url is a long-lived signed URL so <img>/<audio> tags work like the old Drive links */
async function apiUpload(base64, mimeType, filename) {
  if (!isAuthed()) return dbFail(null, '⚠️ Please sign in');
  try {
    const bin = atob(base64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const safe = String(filename || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${dbUser.id}/${Date.now()}_${safe}`;
    const { error } = await sb.storage.from(DB_BUCKET).upload(path, bytes, { contentType: mimeType || 'application/octet-stream', upsert: false });
    if (error) throw error;
    const { data, error: ue } = await sb.storage.from(DB_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (ue) throw ue;
    return { ok: true, data: { url: data.signedUrl, fileId: path } };
  } catch (e) { return dbFail(e, '❌ Upload failed') }
}

/* ---------- auth ---------- */

function showLogin(msg) {
  const c = $('#authCover');
  c.classList.add('on');
  $('#authMsg').textContent = msg || '';
  setTimeout(() => $('#auEmail').focus(), 50);
}

function hideLogin() { $('#authCover').classList.remove('on') }

function clearCache() { Object.keys(state.cache).forEach(k => state.cache[k] = []) }

async function authSubmit(mode) {
  const email = $('#auEmail').value.trim(), password = $('#auPass').value;
  if (!email || !password) return ($('#authMsg').textContent = 'Enter email and password');
  if (password.length < 6) return ($('#authMsg').textContent = 'Password must be at least 6 characters');
  const display_name = $('#auName').value.trim();
  if (mode === 'up') {
    const nameRow = $('#auNameRow');
    if (nameRow.classList.contains('hidden')) {             /* first tap on Create account reveals the Name field */
      nameRow.classList.remove('hidden'); $('#auName').focus();
      return ($('#authMsg').textContent = 'Enter your name, then tap Create account again');
    }
    if (!display_name || display_name.length > 40) return ($('#authMsg').textContent = 'Name must be 1–40 characters');
  }
  $('#authMsg').textContent = '';
  const btn = mode === 'up' ? $('#auUp') : $('#auIn');
  await withLoading(btn, async () => {
    const { data, error } = mode === 'up'
      ? await sb.auth.signUp({ email, password, options: { data: { display_name } } })
      : await sb.auth.signInWithPassword({ email, password });
    if (error) { $('#authMsg').textContent = error.message; return }
    if (!data.session) { $('#authMsg').textContent = '📧 Account created. Confirm the link in your email, then sign in.'; return }
  }, mode === 'up' ? 'Creating…' : 'Signing in…');
}

async function signOut() {
  if (!confirm('Sign out?')) return;
  await sb.auth.signOut();
}

/* resolves once the stored session (if any) is known */
async function initAuth() {
  $('#auIn').onclick = () => authSubmit('in');
  $('#auUp').onclick = () => authSubmit('up');
  $('#auPass').onkeydown = e => { if (e.key === 'Enter') authSubmit('in') };
  $('#btnLogout').onclick = signOut;

  const { data: { session } } = await sb.auth.getSession();
  dbUser = session ? session.user : null;

  /* callback must stay sync — calling sb.* inside it can deadlock, so defer the work */
  sb.auth.onAuthStateChange((event, session) => {
    const was = dbUser && dbUser.id;
    dbUser = session ? session.user : null;
    if (event === 'SIGNED_OUT') { setTimeout(() => { chatDisconnect(); clearCache(); renderScreen(); showLogin('Signed out') }, 0); return }
    if (event === 'SIGNED_IN' && dbUser && dbUser.id !== was) {
      setTimeout(() => { hideLogin(); clearCache(); chatDisconnect(); chatConnect(); sync() }, 0);
    }
  });
  if (dbUser) setTimeout(() => chatConnect(), 0);
  return dbUser;
}
