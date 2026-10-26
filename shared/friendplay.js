// ===== FRIENDPLAY-BEGIN（元＝shared/friendplay.js。直すのは元のファイルで、`python shared/embed.py` で4つのページに配る）=====
// 友だちと対局：claude.ai の Artifact の db（見る人どうしで共有する記録）と user（いま見ている人）で、
// 対局の一覧・手の記録・レーティング（イロ式）を受け持つ。盤の描き方と手の正しさは各ゲームの adapter に任せる。
//   adapter = { id, sideLabel(side, handicap, rule), handicaps:[{id,label}], rules:[{id,label}]（任意）, initial(handicap, rule),
//               play(state, move)→新しい局面 or null, turn(state)→"first"|"second", result(state)→null | {winner:"first"|"second"|"draw", text} }
//   先手・後手は adapter の言い方で「first」「second」。handicaps と rules の先頭（id ""）が平手・既定。ハンデ戦はレーティングに入れない。
// 2026-10-26 Claude（Opus）。萩野「ログイン機能とかレーティングもつけて友達同士で対戦させると面白い」。
var FriendPlay = (function(){
  var K = 32, START = 1500, LEASE_MS = 3000;

  function now(){ return new Date().toISOString(); }
  function other(side){ return side === "first" ? "second" : "first"; }
  function fail(code, message){ var e = new Error(message); e.code = code; return e; }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function seatOf(g, key){ return !g || !g.seats ? null : g.seats.first === key ? "first" : g.seats.second === key ? "second" : null; }

  // 手の列を最初から並べ直す。返す：{state, bad（正しくない手の位置・無ければ -1）}
  function replay(adapter, g){
    var st = adapter.initial(g.handicap || "", g.rule || ""), moves = g.moves || [];
    for (var i = 0; i < moves.length; i++){
      var ns = adapter.play(st, moves[i]);
      if (!ns) return {state: st, bad: i};
      st = ns;
    }
    return {state: st, bad: -1};
  }

  // レーティング：終わった平手の対局を終わった順に並べ、毎回最初から数え直す（各自が点を書かない＝二重に数えない）
  function ratings(games){
    var done = games.filter(function(g){
      return g && g.status === "done" && g.rated && g.result && g.finishedAt && g.seats &&
        g.seats.first && g.seats.second && g.seats.first !== g.seats.second;
    }).slice().sort(function(a, b){
      if (a.finishedAt !== b.finishedAt) return a.finishedAt < b.finishedAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    var table = {}, delta = {};
    function get(k){ return table[k] || (table[k] = {r: START, n: 0, w: 0, l: 0, d: 0}); }
    done.forEach(function(g){
      var a = get(g.seats.first), b = get(g.seats.second);
      var ea = 1 / (1 + Math.pow(10, (b.r - a.r) / 400));
      var sa = g.result.winner === "first" ? 1 : g.result.winner === "second" ? 0 : 0.5;
      var da = K * (sa - ea);
      a.r += da; b.r -= da; a.n++; b.n++;
      if (sa === 1){ a.w++; b.l++; } else if (sa === 0){ a.l++; b.w++; } else { a.d++; b.d++; }
      delta[g.id] = {first: da, second: -da};
    });
    return {table: table, delta: delta};
  }

  // 同じ対局に2人が同時に書かないよう、短い札（lease）を取ってから最新を読み、書く
  async function withLease(ref, holder, fn){
    for (var t = 0; t < 8; t++){
      var l = await ref.acquire({holder: holder, ttlMs: LEASE_MS});
      if (l && l.acquired){
        var s = await ref.get();
        return await fn(s.exists ? s.data() : null);
      }
      await sleep(400 + Math.random() * 600);
    }
    throw fail("busy", "相手が書き込み中です。少し待ってからもう一度押してください。");
  }

  async function create(db, me, adapter, opt){
    var side = opt.side === "random" ? (Math.random() < 0.5 ? "first" : "second") : opt.side;
    var seats = {first: null, second: null}, t = now();
    seats[side] = me.key;
    var ref = db.collection("games").doc();
    await ref.set({v: 1, game: adapter.id, status: "open", createdBy: me.key, createdAt: t, updatedAt: t,
      seats: seats, handicap: opt.handicap || "", rule: opt.rule || "", rated: !opt.handicap, moves: [], result: null});
    return ref.id;
  }

  async function join(db, me, gid, holder){
    var ref = db.doc("games/" + gid);
    return withLease(ref, holder, async function(g){
      if (!g || g.status !== "open") throw fail("closed", "この対局はもう始まったか、なくなりました。");
      if (seatOf(g, me.key)) throw fail("self", "自分で作った対局です。相手が入るのを待ってください。");
      var side = g.seats.first ? "second" : "first", t = now(), patch = {status: "playing", startedAt: t, updatedAt: t, seats: {}};
      patch.seats[side] = me.key;
      await ref.update(patch);
      return side;
    });
  }

  async function move(db, me, adapter, gid, mv, holder){
    var ref = db.doc("games/" + gid);
    return withLease(ref, holder, async function(g){
      if (!g || g.status !== "playing") throw fail("closed", "この対局は終わっています。");
      var side = seatOf(g, me.key);
      if (!side) throw fail("notplayer", "あなたはこの対局の打ち手ではありません。");
      var rp = replay(adapter, g);
      if (rp.bad >= 0) throw fail("broken", "記録に正しくない手があります（" + (rp.bad + 1) + "手目）。");
      if (adapter.turn(rp.state) !== side) throw fail("notturn", "相手の番です。");
      var ns = adapter.play(rp.state, mv);
      if (!ns) throw fail("illegal", "その手は指せません。");
      var t = now(), res = adapter.result(ns), patch = {moves: (g.moves || []).concat([mv]), updatedAt: t};
      if (res){ patch.status = "done"; patch.finishedAt = t; patch.result = {winner: res.winner, reason: "end", text: res.text || ""}; }
      await ref.update(patch);
      return patch;
    });
  }

  async function resign(db, me, gid, holder){
    var ref = db.doc("games/" + gid);
    return withLease(ref, holder, async function(g){
      if (!g || g.status !== "playing") throw fail("closed", "この対局は終わっています。");
      var side = seatOf(g, me.key);
      if (!side) throw fail("notplayer", "あなたはこの対局の打ち手ではありません。");
      var t = now();
      await ref.update({status: "done", finishedAt: t, updatedAt: t, result: {winner: other(side), reason: "resign", text: ""}});
    });
  }

  async function cancel(db, me, gid, holder){
    var ref = db.doc("games/" + gid);
    return withLease(ref, holder, async function(g){
      if (!g || g.status !== "open") throw fail("closed", "もう始まった対局は取り消せません（投了はできます）。");
      if (g.createdBy !== me.key) throw fail("notmine", "作った人だけが取り消せます。");
      await ref.delete();
    });
  }

  // ===== 画面（一覧・自分の名前・新しい対局・レーティング・対局中の帯）=====
  function mount(opt){
    var adapter = opt.adapter, root = opt.root, onView = opt.onView || function(){};
    var tab = Math.random().toString(36).slice(2, 10);
    var db = null, me = null, holder = "", booted = false, readOnly = false;
    var games = [], names = {}, rate = {table: {}, delta: {}}, current = null, note = "", busy = false, resignArmed = null;

    function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function btn(text, fn, primary){ var b = el("button", primary ? "primary" : "", text); b.type = "button"; b.disabled = busy || readOnly; b.addEventListener("click", fn); return b; }
    function nameOf(key){ return !key ? "（空き）" : (names[key] || "名前なし") + (me && key === me.key ? "（あなた）" : ""); }
    function sideText(side, g){ return adapter.sideLabel(side, g ? g.handicap || "" : "", g ? g.rule || "" : ""); }
    function label(list, id){ var f = (list || []).filter(function(x){ return x.id === id; })[0]; return f ? f.label : ""; }
    function rr(key){ var x = rate.table[key]; return x ? Math.round(x.r) : START; }

    function localKey(){
      var k = null;
      try { k = localStorage.getItem("friendplay.key"); } catch (e) {}
      if (!k){ k = "g-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { localStorage.setItem("friendplay.key", k); } catch (e) {} }
      return k;
    }

    async function boot(){
      if (booted) return; booted = true;
      note = "つないでいます…"; draw();
      var c = typeof window !== "undefined" ? window.claude : null;
      if (!c || !c.use){ note = "友だちとの対局は、claude.ai でこのページを開いたときだけ使えます。"; draw(); return; }
      db = await c.use("db");
      var user = await c.use("user");
      if (!db){ note = "友だちとの対局は、claude.ai にログインして開いたときだけ使えます。"; draw(); return; }
      var id = user ? await user.id() : null;
      me = {key: id || localKey()};
      holder = me.key + ":" + tab;
      var w = user ? await user.can("data.write") : null;
      if (w === false) readOnly = true;
      note = "";
      db.collection("games").orderBy("createdAt", "desc").limit(1000).onSnapshot(function(snap){
        games = snap.docs.map(function(d){ var x = {}, b = d.data(); for (var k in b) x[k] = b[k]; x.id = d.id; return x; });
        rate = ratings(games);
        draw(); emit();
      }, function(e){ note = "記録を読めなくなりました（" + e.code + "）。ページを開き直してください。"; draw(); });
      db.collection("players").onSnapshot(function(snap){
        names = {};
        snap.docs.forEach(function(d){ var b = d.data(); if (b && typeof b.name === "string") names[d.id] = b.name.slice(0, 16); });
        draw(); emit();
      }, function(){});
    }

    async function run(fn){
      if (busy) return;
      busy = true; note = ""; draw();
      try { await fn(); }
      catch (e){
        if (e && e.code === "invalid_argument"){ readOnly = true; note = "この画面からは書き込めません（見るだけ）。対局するには、ページの持ち主に『編集者』としてメールで招いてもらってください。"; }
        else note = (e && e.message) || "うまくいきませんでした。";
      }
      busy = false; draw(); emit();
    }

    function view(){
      if (!current) return null;
      var g = games.filter(function(x){ return x.id === current; })[0];
      if (!g) return {gid: current, gone: true, statusText: "この対局は取り消されました。"};
      var rp = replay(adapter, g), side = me ? seatOf(g, me.key) : null, turn = adapter.turn(rp.state);
      var canMove = g.status === "playing" && side === turn && rp.bad < 0 && !busy && !readOnly;
      var t;
      if (rp.bad >= 0) t = "記録に正しくない手があります（" + (rp.bad + 1) + "手目）。この対局は続けられません。";
      else if (g.status === "open") t = side ? "相手を待っています。友だちがこのページを開いて『参加する』を押すと始まります。" : "まだ相手が決まっていません。";
      else if (g.status === "playing") t = canMove ? "あなたの番です：" + sideText(side, g) + "。" : side ? "相手の番です：" + nameOf(g.seats[other(side)]) + "。指されると盤が自動で進みます。" : "観戦中：" + sideText(turn, g) + "の番です。";
      else {
        var r = g.result || {}, wtxt = r.winner === "draw" ? "引き分け" : sideText(r.winner, g) + "・" + nameOf(g.seats[r.winner]) + "の勝ち";
        t = "終局" + (r.text ? "　" + r.text : "") + "　" + wtxt + (r.reason === "resign" ? "（投了）" : "");
        var d = rate.delta[g.id];
        if (d && side) t += "　レート " + (d[side] >= 0 ? "+" : "") + Math.round(d[side]);
        else if (!g.rated) t += "（ハンデ戦なのでレーティングには入れません）";
      }
      return {gid: g.id, game: g, state: rp.state, mySide: side, canMove: canMove, statusText: t,
        players: {first: nameOf(g.seats.first), second: nameOf(g.seats.second)}};
    }
    function emit(){ onView(current ? view() : null); }

    function row(g){
      var li = el("li", "fp-row"), side = me ? seatOf(g, me.key) : null;
      var who = sideText("first", g) + " " + nameOf(g.seats.first) + " ／ " + sideText("second", g) + " " + nameOf(g.seats.second);
      var extra = [g.rule ? label(adapter.rules, g.rule) : "", g.handicap ? label(adapter.handicaps, g.handicap) : ""].filter(Boolean).join("・");
      li.appendChild(el("span", "fp-who", who + (extra ? "（" + extra + "）" : "") + (g.status === "playing" ? "　" + (g.moves || []).length + "手" : "")));
      var acts = el("span", "fp-acts");
      if (g.status === "open"){
        if (side) acts.appendChild(btn("取り消す", function(){ run(function(){ return cancel(db, me, g.id, holder); }); }));
        else acts.appendChild(btn("参加する", function(){ run(async function(){ await join(db, me, g.id, holder); current = g.id; }); }, true));
        if (side){ var o = btn("開く", function(){ current = g.id; draw(); emit(); }); o.disabled = false; acts.appendChild(o); }
      } else {
        var b = btn(side && g.status === "playing" ? "続ける" : g.status === "playing" ? "観戦する" : "盤を見る", function(){ current = g.id; draw(); emit(); }, side && g.status === "playing");
        b.disabled = false; acts.appendChild(b);
      }
      li.appendChild(acts);
      return li;
    }

    function draw(){
      if (!root) return;
      root.textContent = "";
      var box = el("div", "fp-box"); // "fp" は将棋の図の CSS と同じ名前になるので使わない
      function pair(lab, ctl){ var s = el("span", "fp-pair"); s.appendChild(lab); s.appendChild(ctl); return s; }
      box.appendChild(el("h2", "fp-h", "友だちと対局"));
      if (note) box.appendChild(el("p", "fp-note", note));
      if (!db || !me){ root.appendChild(box); return; }
      if (readOnly) box.appendChild(el("p", "fp-note", "この画面からは書き込めません（見るだけ）。観戦とレーティングは見られます。"));

      if (current){
        var v = view(), bar = el("div", "fp-bar");
        if (v && v.game){
          bar.appendChild(el("p", "fp-who", sideText("first", v.game) + "：" + v.players.first + "（" + rr(v.game.seats.first) + "）"));
          bar.appendChild(el("p", "fp-who", sideText("second", v.game) + "：" + v.players.second + "（" + rr(v.game.seats.second) + "）"));
        }
        var acts = el("div", "fp-acts");
        if (v && v.game && v.game.status === "playing" && v.mySide){
          acts.appendChild(btn("投了する", function(){
            // 確認の窓（confirm）は出さない＝2度押しで投了
            if (resignArmed !== current){ resignArmed = current; note = "もう一度『投了する』を押すと投了します。"; draw(); return; }
            resignArmed = null; run(function(){ return resign(db, me, current, holder); });
          }));
        }
        var back = btn("一覧へ戻る", function(){ current = null; resignArmed = null; note = ""; draw(); emit(); });
        back.disabled = false; acts.appendChild(back);
        bar.appendChild(acts);
        box.appendChild(bar);
        root.appendChild(box);
        return;
      }

      // 自分の名前
      var nm = el("div", "fp-sec"), lab = el("label", "", "あなたの名前（相手に見えます）"), inp = el("input");
      inp.type = "text"; inp.maxLength = 16; inp.value = names[me.key] || ""; inp.id = "fp-name-" + tab; lab.htmlFor = inp.id;
      nm.appendChild(lab); nm.appendChild(inp);
      nm.appendChild(btn("名前を保存", function(){
        var s = inp.value.trim().slice(0, 16);
        if (!s){ note = "名前を入れてください。"; draw(); return; }
        run(function(){ return db.doc("players/" + me.key).set({name: s, updatedAt: now()}); });
      }));
      box.appendChild(nm);

      // 新しい対局
      var nw = el("div", "fp-sec");
      nw.appendChild(el("h3", "", "新しい対局を作って待つ"));
      var sideSel = el("select"); sideSel.id = "fp-side-" + tab;
      [["first", sideText("first", null)], ["second", sideText("second", null)], ["random", "おまかせ"]].forEach(function(o){ var op = el("option", "", o[1]); op.value = o[0]; sideSel.appendChild(op); });
      var sl = el("label", "", "あなたは"); sl.htmlFor = sideSel.id;
      nw.appendChild(pair(sl, sideSel));
      var hcSel = null, ruleSel = null;
      if (adapter.rules && adapter.rules.length){
        ruleSel = el("select"); ruleSel.id = "fp-rule-" + tab;
        adapter.rules.forEach(function(r){ var op = el("option", "", r.label); op.value = r.id; ruleSel.appendChild(op); });
        var rl = el("label", "", "ルール"); rl.htmlFor = ruleSel.id;
        nw.appendChild(pair(rl, ruleSel));
      }
      if (adapter.handicaps && adapter.handicaps.length){
        hcSel = el("select"); hcSel.id = "fp-hc-" + tab;
        adapter.handicaps.forEach(function(h){ var op = el("option", "", h.label); op.value = h.id; hcSel.appendChild(op); });
        var hl = el("label", "", "ハンデ"); hl.htmlFor = hcSel.id;
        nw.appendChild(pair(hl, hcSel));
        hcSel.addEventListener("change", function(){
          var h = hcSel.value;
          [].forEach.call(sideSel.options, function(op){ if (op.value !== "random") op.textContent = adapter.sideLabel(op.value, h, ruleSel ? ruleSel.value : ""); });
        });
      }
      nw.appendChild(btn("作って待つ", function(){
        if (!names[me.key]){ note = "先に、あなたの名前を保存してください。"; draw(); return; }
        var o = {side: sideSel.value, handicap: hcSel ? hcSel.value : "", rule: ruleSel ? ruleSel.value : ""};
        run(async function(){ current = await create(db, me, adapter, o); });
      }, true));
      box.appendChild(nw);

      // 一覧
      var open = games.filter(function(g){ return g.status === "open"; });
      var playing = games.filter(function(g){ return g.status === "playing"; });
      var done = games.filter(function(g){ return g.status === "done"; }).slice(0, 10);
      [["相手を待っている対局", open, "いまは、ありません。"], ["対局中", playing, "いまは、ありません。"], ["終わった対局（新しい順に10）", done, "まだ、ありません。"]].forEach(function(s){
        var sec = el("div", "fp-sec");
        sec.appendChild(el("h3", "", s[0]));
        if (!s[1].length) sec.appendChild(el("p", "fp-empty", s[2]));
        else { var ul = el("ul", "fp-list"); s[1].forEach(function(g){ ul.appendChild(row(g)); }); sec.appendChild(ul); }
        box.appendChild(sec);
      });

      // レーティング
      var rs = el("div", "fp-sec");
      rs.appendChild(el("h3", "", "レーティング"));
      var keys = Object.keys(rate.table).sort(function(a, b){ return rate.table[b].r - rate.table[a].r; });
      if (!keys.length) rs.appendChild(el("p", "fp-empty", "平手の対局が1局終わると出ます（はじめは全員 1500）。"));
      else {
        var tw = el("div", "fp-tablewrap"), tb = el("table", "fp-table"), hd = el("tr");
        ["順位", "名前", "レート", "成績"].forEach(function(h){ hd.appendChild(el("th", "", h)); });
        tb.appendChild(hd);
        keys.forEach(function(k, i){
          var x = rate.table[k], tr = el("tr");
          [String(i + 1), nameOf(k), String(Math.round(x.r)) + (x.n < 5 ? "（仮）" : ""), x.w + "勝" + x.l + "敗" + (x.d ? x.d + "分" : "")].forEach(function(c){ tr.appendChild(el("td", "", c)); });
          tb.appendChild(tr);
        });
        tw.appendChild(tb); rs.appendChild(tw);
      }
      rs.appendChild(el("p", "fp-empty", "イロ式（はじめは 1500・1局で最大 ±32 動く）。5局までは（仮）。ハンデ戦は入れません。"));
      box.appendChild(rs);

      var dt = el("details", "fp-sec"), sm = el("summary", "", "友だちと遊ぶための準備（ページの持ち主がすること）");
      dt.appendChild(sm);
      ["1. 友だちにも claude.ai のアカウントが要ります（無料でよい）。",
       "2. ページの右上の［共有］から、友だちのメールアドレスを『編集者』で招きます。招かれた人だけが手を指せます。",
       "3. 公開リンク（だれでも見られる共有）を同時に出すと、外から招いた人は書き込めなくなります。対局に使うページは、リンクで共有しないでください。",
       "4. 記録はこのページの中だけにあります。名前とレートは、ほかのゲームのページとは別です。"].forEach(function(s){ dt.appendChild(el("p", "", s)); });
      box.appendChild(dt);
      root.appendChild(box);
    }

    return {
      show: function(){ if (root) root.hidden = false; draw(); boot(); emit(); },
      hide: function(){ if (root) root.hidden = true; onView(null); },
      active: function(){ return !!current; },
      submit: function(mv){ if (!current || !db) return Promise.resolve(); var gid = current; return run(function(){ return move(db, me, adapter, gid, mv, holder); }); }
    };
  }

  var CSS = ".fp-h{font-size:18px;margin:2px 0 6px}.fp-box h3{font-size:16px;margin:10px 0 4px}" +
    ".fp-pair{display:inline-flex;align-items:center;gap:6px;max-width:100%;margin-right:8px}.fp-pair select{max-width:calc(100vw - 120px)}" +
    ".fp-note{margin:6px 0;padding:6px 8px;border:1px solid var(--line,currentColor);border-radius:8px}" +
    ".fp-sec{margin:8px 0}.fp-sec label{margin-right:6px}.fp-sec input{font:inherit;font-size:16px;min-height:44px;padding:4px 8px;border-radius:8px;border:1px solid var(--line,#999);background:transparent;color:inherit;max-width:100%}" +
    ".fp-sec select,.fp-sec button,.fp-acts button{margin:4px 6px 4px 0}" +
    ".fp-list{list-style:none;margin:0;padding:0}.fp-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px;padding:6px 0;border-top:1px solid var(--line,#ccc)}" +
    ".fp-who{margin:2px 0;overflow-wrap:anywhere}.fp-empty{margin:4px 0;font-size:14px;opacity:.85}" +
    ".fp-tablewrap{overflow-x:auto;max-width:100%}.fp-table{border-collapse:collapse;font-size:15px;width:100%}.fp-table th,.fp-table td{border-bottom:1px solid var(--line,#ccc);padding:4px 6px;text-align:left}.fp-table td:nth-child(3),.fp-table td:nth-child(4){white-space:nowrap}" +
    ".fp-bar{display:flex;flex-direction:column;gap:2px}";
  if (typeof document !== "undefined"){ var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); }

  return {mount: mount, replay: replay, ratings: ratings, create: create, join: join, move: move, resign: resign, cancel: cancel, START: START, K: K};
})();
// ===== FRIENDPLAY-END =====
