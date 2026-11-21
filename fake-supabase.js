/* Minimal recording stand-in for the supabase-js client used by js/chat-api.js */
function fakeClient(results = {}) {
  const calls = [];
  const pick = (key, fallback) => (key in results ? results[key] : fallback);
  function builder(table) {
    const q = { table, ops: [] };
    const chain = new Proxy({}, {
      get(_, op) {
        if (op === 'then') {
          calls.push(q);
          const kind = q.ops.find(o => ['insert', 'update', 'delete'].includes(o.op));
          const r = pick(`${table}.${kind ? kind.op : 'select'}`, { data: [], error: null });
          return (res, rej) => Promise.resolve(r).then(res, rej);
        }
        return (...args) => { q.ops.push({ op, args }); return chain };
      }
    });
    return chain;
  }
  const storageCalls = [];
  return {
    calls, storageCalls,
    from: builder,
    rpc: (name, args) => { calls.push({ rpc: name, args }); return Promise.resolve(pick(`rpc.${name}`, { data: null, error: null })) },
    storage: {
      from: bucket => ({
        upload: (path, file, opts) => { storageCalls.push({ op: 'upload', bucket, path, opts }); return Promise.resolve(pick('upload', { data: { path }, error: null })) },
        createSignedUrl: (path, secs) => { storageCalls.push({ op: 'sign', bucket, path, secs }); return Promise.resolve({ data: { signedUrl: 'https://signed/' + path }, error: null }) },
        remove: paths => { storageCalls.push({ op: 'remove', bucket, paths }); return Promise.resolve({ data: [], error: null }) }
      })
    }
  };
}
const ops = q => q.ops.map(o => o.op);
const arg = (q, op) => (q.ops.find(o => o.op === op) || {}).args;
module.exports = { fakeClient, ops, arg };
