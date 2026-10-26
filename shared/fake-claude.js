// 試験用：claude.ai の db と user の代わり。1つの記録（store）を、何人かの「見る人」で共有する。本番のページには入れない。
// 本物の決まり（0.2.91 の db.d.ts）のうち、友だち対局が頼るところだけを写した：
//   set＝丸ごと置き換え／update＝無ければ invalid_argument・入れ子のオブジェクトは混ぜる・配列は丸ごと置き換え／
//   acquire＝期限内はほかの holder に渡さない（同じ holder は更新できる）／onSnapshot＝書かれるたびに全員へ／
//   書けない人の書き込み＝invalid_argument。時計は store.t（ミリ秒）で、試験が進める。
// 2026-10-26 Claude（Opus）。
(function(root){
  function clone(x){ return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function plain(x){ return x && typeof x === "object" && !Array.isArray(x); }
  function merge(a, b){ for (var k in b){ if (plain(b[k]) && plain(a[k])) merge(a[k], b[k]); else a[k] = clone(b[k]); } }
  function deny(){ var e = new Error("書けない人の書き込み"); e.code = "invalid_argument"; return e; }
  var seq = 0;

  function makeStore(){ return {docs: {}, leases: {}, subs: [], t: 0, tick: 0, writes: 0}; }

  function makeClaude(store, who){
    who = who || {};
    function notify(){ store.writes++; var subs = store.subs.slice(); setTimeout(function(){ subs.forEach(function(s){ if (s.alive) s.fire(); }); }, 0); }
    function snap(path){
      var d = store.docs[path], id = path.split("/").pop();
      return {id: id, exists: !!d, data: function(){ return d ? Object.freeze(clone(d)) : undefined; }, metadata: {fromCache: false, hasPendingWrites: false}};
    }
    function guard(){ if (who.canWrite === false) throw deny(); }
    function docRef(path){
      if (path.split("/").length % 2) throw new TypeError("文書の道は偶数の区切り：" + path);
      return {
        id: path.split("/").pop(), path: path,
        get: async function(){ return snap(path); },
        set: async function(data){ guard(); store.docs[path] = clone(data); notify(); },
        update: async function(data){ guard(); if (!store.docs[path]) throw deny(); merge(store.docs[path], data); notify(); },
        delete: async function(){ guard(); delete store.docs[path]; notify(); },
        acquire: async function(o){
          store.t += store.tick;
          var l = store.leases[path];
          if (l && l.exp > store.t && l.holder !== o.holder) return {acquired: false, expiresAt: String(l.exp)};
          store.leases[path] = {holder: o.holder, exp: store.t + (o.ttlMs || 30000)};
          return {acquired: true, holder: o.holder, version: 1};
        },
        onSnapshot: function(next){ var s = {alive: true, fire: function(){ next(snap(path)); }}; store.subs.push(s); setTimeout(s.fire, 0); return function(){ s.alive = false; }; },
        collection: function(sub){ return colRef(path + "/" + sub); }
      };
    }
    function colRef(path, q){
      if (path.split("/").length % 2 === 0) throw new TypeError("集まりの道は奇数の区切り：" + path);
      q = q || {f: [], o: null, n: null};
      function run(){
        var depth = path.split("/").length + 1, docs = [];
        Object.keys(store.docs).forEach(function(p){ if (p.indexOf(path + "/") === 0 && p.split("/").length === depth) docs.push(snap(p)); });
        q.f.forEach(function(f){ docs = docs.filter(function(d){ var v = d.data()[f[0]]; return f[1] === "==" ? v === f[2] : f[1] === "!=" ? v !== f[2] : true; }); });
        docs.sort(function(a, b){
          if (q.o){ var x = a.data()[q.o[0]], y = b.data()[q.o[0]]; if (x !== y) return (x < y ? -1 : 1) * (q.o[1] === "desc" ? -1 : 1); }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        if (q.n) docs = docs.slice(0, q.n);
        return {docs: docs, size: docs.length, empty: !docs.length, docChanges: function(){ return []; }, metadata: {fromCache: false, hasPendingWrites: false}};
      }
      var c = {
        path: path,
        where: function(f, op, v){ return colRef(path, {f: q.f.concat([[f, op, v]]), o: q.o, n: q.n}); },
        orderBy: function(f, dir){ return colRef(path, {f: q.f, o: [f, dir || "asc"], n: q.n}); },
        limit: function(n){ return colRef(path, {f: q.f, o: q.o, n: n}); },
        get: async function(){ return run(); },
        onSnapshot: function(next){ var s = {alive: true, fire: function(){ next(run()); }}; store.subs.push(s); setTimeout(s.fire, 0); return function(){ s.alive = false; }; },
        doc: function(id){ return docRef(path + "/" + (id || ("d" + (++seq).toString(36) + Math.random().toString(36).slice(2, 8)))); },
        add: async function(data){ var r = c.doc(); await r.set(data); return r; }
      };
      return c;
    }
    var db = {doc: docRef, collection: function(p){ return colRef(p); }};
    var user = {
      id: async function(){ return who.id === undefined ? null : who.id; },
      can: async function(n){ return n === "data.write" ? (who.canWrite === undefined ? null : who.canWrite) : null; },
      isOwner: async function(){ return !!who.owner; }, canEdit: async function(){ return !!who.owner; },
      me: async function(){ return {id: who.id || null, name: "", avatarUrl: "", color: "#888", email: null, isOwner: !!who.owner, canEdit: !!who.owner}; }
    };
    return {use: async function(name){ return name === "db" ? (who.noDb ? null : db) : name === "user" ? user : null; }};
  }

  var api = {makeStore: makeStore, makeClaude: makeClaude};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FakeClaude = api;
})(this);
