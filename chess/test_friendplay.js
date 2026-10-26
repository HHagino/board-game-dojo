// 友だち対局（チェス）の試験：node chess/test_friendplay.js
// 前半＝index.html の LOGIC 区間の CHESS_ADAPTER を、偽の claude（shared/fake-claude.js）の記録で2人が共有して通しで指す（shared/test.js にならう）。
// 後半＝ブラウザを開かずに、小さな偽の DOM でページ全体（UI）を2枚動かし、盤の [data-sq] の升を押して指す（親が回す2人の試験の下見）。
// 2026-10-26 Claude（Opus）。
var fs = require("fs"), path = require("path"), vm = require("vm");
var Fake = require("../shared/fake-claude.js");

var SRC = fs.readFileSync(path.join(__dirname, "..", "shared", "friendplay.js"), "utf8");
var html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
var lm = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!lm){ console.log("❌ LOGIC の区間が見つからない"); process.exit(1); }

// 部品は vm で（shared/test.js と同じ）。LOGIC は test.js と同じく new Function で読む（vm の中だと大域の変数の読み出しが遅く、終局までの試験が数十秒かかる）
var ctx = {console: console, setTimeout: setTimeout, Math: Math, Date: Date, Promise: Promise, JSON: JSON, Object: Object, Error: Error};
vm.createContext(ctx);
vm.runInContext(SRC + "\nthis.FriendPlay = FriendPlay;", ctx);
var L = new Function(lm[0] + "\nreturn {A: CHESS_ADAPTER, WHITE: WHITE, BLACK: BLACK, startState: startState, fromFEN: fromFEN, handicapState: handicapState," +
  " legalMoves: legalMoves, makeMove: makeMove, gameResult: gameResult, posKey: posKey, sqOf: sqOf, sqName: sqName, moveUCI: moveUCI, netState: netState, chooseMove: chooseMove};")();
var FP = ctx.FriendPlay, A = L.A;

var pass = 0, failN = 0;
function check(name, ok, extra){ if (ok){ pass++; console.log("✅ " + name + (extra ? "  " + extra : "")); } else { failN++; console.log("❌ " + name + (extra ? "  " + extra : "")); } }
async function rejects(p, code){ try { await p; return false; } catch (e){ return !!e && e.code === code; } }
function J(x){ return JSON.stringify(x); }
function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function seq(list, hc){
  var st = A.initial(hc || "");
  for (var i = 0; i < list.length; i++){ var ns = A.play(st, list[i]); if (!ns) throw new Error((i + 1) + "手目 " + list[i] + " が通らない"); st = ns; }
  return st;
}
function last(a){ return a[a.length - 1]; }

var FOOL = ["f2f3", "e7e5", "g2g4", "d8h4"];
var SCHOLAR = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
// 白のポーンを e7 まで進め、黒は O-O で e8 を空ける（e7e8 で成れる局面）
var PRE = ["d2d4", "e7e5", "d4e5", "g8h6", "a2a3", "f8c5", "a3a4", "e8g8", "e5e6", "a7a6", "e6e7", "a6a5"];
// アンパッサン（e5d6）・白の O-O（e1g1）・黒の O-O-O（e8c8）
var CEP = ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6", "e7d6", "g1f3", "b8c6", "f1e2", "c8f5", "e1g1", "d8d7", "b1c3", "e8c8"];
var LOYD = ["e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "h2h4", "a6h6", "a5c7", "f7f6", "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6"];
var SHUFFLE = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];

async function main(){
  // ===== 0 埋め込み =====
  var blk = html.match(/\/\/ ===== FRIENDPLAY-BEGIN[\s\S]*?\/\/ ===== FRIENDPLAY-END =====/g) || [];
  check("ページの中の部品は1つで、元（shared/friendplay.js）と同じ", blk.length === 1 && blk[0].replace(/\r\n/g, "\n") === SRC.replace(/\r\n/g, "\n").replace(/\n+$/, ""));
  check("埋め込みの印（/*FRIENDPLAY*/）が残っていない・部品は LOGIC 区間の外", html.indexOf("/*FRIENDPLAY*/") < 0 && lm[0].indexOf("FRIENDPLAY-BEGIN") < 0);

  // ===== 1 adapter：手の書き方・終局 =====
  var st0 = A.initial("");
  check("id は chess・ハンデの先頭は平手（id ''）・9種", A.id === "chess" && A.handicaps[0].id === "" && A.handicaps.length === 9);
  check("平手の初期局面＝ローカルの startState・first の番・終局でない", J(st0.s) === J(L.startState()) && A.turn(st0) === "first" && A.result(st0) === null);
  check("平手の席：first＝白（先手）・second＝黒（後手）", A.sideLabel("first", "") === "白（先手）" && A.sideLabel("second", "") === "黒（後手）");

  var fm = seq(FOOL), rfm = A.result(fm);
  check("フールズメイト f2f3 e7e5 g2g4 d8h4 → second（黒）の勝ち・チェックメイト・棋譜 Qh4#", !!rfm && rfm.winner === "second" && rfm.text === "チェックメイト" && last(fm.sans) === "Qh4#", J(rfm));
  var sch = seq(SCHOLAR);
  check("対照：スカラーズメイト（白が詰ます）→ first の勝ち・棋譜 Qxf7#", J(A.result(sch)) === J({winner: "first", text: "チェックメイト"}) && last(sch.sans) === "Qxf7#");
  var badForm = ["e2-e4", "E2E4", "e2e4 ", " e2e4", "e2", "e2e4qq", "e2e4Q", "e2e4k", "i2i4", "e0e4", "e2e9", "", "e2e4\n", "1. e4", "Ne2"];
  check("形の違う文字列は null（" + badForm.length + "種）", badForm.every(function(m){ return A.play(st0, m) === null; }));
  check("文字列でない手は null（null・undefined・数・配列・オブジェクト）", [null, undefined, 42, ["e2e4"], {f: 12, t: 28}].every(function(m){ return A.play(st0, m) === null; }));
  check("合法でない手は null（e2e5・g1g3・e1g1・黒の e7e5・空き升 e4e5・成れない所の e2e4q）", ["e2e5", "g1g3", "e1g1", "e7e5", "e4e5", "e2e4q"].every(function(m){ return A.play(st0, m) === null; }));
  check("対照：合法な e2e4・g1f3 は通る", !!A.play(st0, "e2e4") && !!A.play(st0, "g1f3"));

  var pre = seq(PRE), pq = A.play(pre, "e7e8q"), pn = A.play(pre, "e7e8n");
  check("成り：e7e8q と e7e8n の両方が通り、e8 の駒が白クイーン（5）と白ナイト（2）", !!pq && !!pn && pq.s.b[L.sqOf("e8")] === 5 && pn.s.b[L.sqOf("e8")] === 2 && pq.s.b[L.sqOf("e7")] === 0 && pn.s.b[L.sqOf("e7")] === 0);
  check("成り：棋譜は e8=Q と e8=N", !!pq && !!pn && /^e8=Q/.test(last(pq.sans)) && /^e8=N/.test(last(pn.sans)), pq && pn && last(pq.sans) + " / " + last(pn.sans));
  check("成り：駒の文字なし（e7e8）・k（e7e8k）・大文字（e7e8Q）は null", A.play(pre, "e7e8") === null && A.play(pre, "e7e8k") === null && A.play(pre, "e7e8Q") === null);
  var pr = A.play(pre, "e7f8r"), pdq = A.play(pre, "e7d8q");
  check("成り：取りながら（e7d8q・e7f8r）も通り、取った駒が数えられる", !!pr && !!pdq && pr.s.b[L.sqOf("f8")] === 4 && pdq.s.b[L.sqOf("d8")] === 5 && last(pr.capW) === 4 && last(pdq.capW) === 5);

  var cep = seq(CEP), cb = cep.s.b, Q = function(n){ return cb[L.sqOf(n)]; };
  check("アンパッサン e5d6：d5 の黒ポーンが消えて、棋譜 exd6", seq(CEP.slice(0, 5)).s.b[L.sqOf("d5")] === 0 && cep.sans[4] === "exd6");
  check("キャスリング e1g1・e8c8：王 g1／c8・ルーク f1／d8・棋譜 O-O と O-O-O", Q("g1") === 6 && Q("f1") === 4 && Q("h1") === 0 && Q("e1") === 0 && Q("c8") === -6 && Q("d8") === -4 && Q("a8") === 0 &&
    cep.sans[10] === "O-O" && cep.sans[13] === "O-O-O", cep.sans.join(" "));
  check("キャスリングの UCI はキングの2升だけ（e1h1 は null）", A.play(seq(CEP.slice(0, 10)), "e1h1") === null && !!A.play(seq(CEP.slice(0, 10)), "e1g1"));

  // ===== 2 引き分け（ローカルの gameResult と同じもの）=====
  var stale = seq(LOYD), rep = seq(SHUFFLE);
  check("ステイルメイト（ロイドの10手）→ draw・ステイルメイト", J(A.result(stale)) === J({winner: "draw", text: "ステイルメイト"}));
  check("同じ局面が3回（ナイトの往復8手）→ draw・7手目まではまだ続く", J(A.result(rep)) === J({winner: "draw", text: "同じ局面が3回"}) && A.result(seq(SHUFFLE.slice(0, 7))) === null);
  check("引き分けで終わった局面にも指せない（g1f3 はふつうなら合法）", A.play(rep, "g1f3") === null && A.play(fm, "a2a3") === null);
  var mat = A.play(L.netState(L.fromFEN("4k3/8/8/8/8/8/3r4/1N2K3 w - - 0 1")), "b1d2");
  check("駒不足（取って K+N 対 K）→ draw・駒不足", !!mat && J(A.result(mat)) === J({winner: "draw", text: "駒不足"}));
  var ff = A.play(L.netState(L.fromFEN("4k3/8/8/8/8/8/8/R3K3 w - - 99 80")), "a1a2");
  check("50手ルール（半手99から静かな1手）→ draw・50手ルール／対照：ポーンを動かせば続く", !!ff && J(A.result(ff)) === J({winner: "draw", text: "50手ルール"}) &&
    A.result(A.play(L.netState(L.fromFEN("4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80")), "e2e3")) === null);
  check("判定はローカルの gameResult（keys は初期局面から全部）と同じ", [[stale, "stalemate"], [rep, "repetition"], [mat, "material"], [ff, "fifty"], [fm, "mate"]].every(function(x){ var r = L.gameResult(x[0].s, x[0].keys); return r && r.kind === x[1]; }));

  // ===== 3 ハンデ（ローカルの handicapState と同じ局面・先に指す側）=====
  var expL = {"": ["白（先手）", "黒（後手）"],
    "pawn:1": ["黒（先手）", "白（f ポーン落ち・後手）"], "pawn:-1": ["白（先手）", "黒（f ポーン落ち・後手）"],
    "knight:1": ["白（ナイト落ち・先手）", "黒（後手）"], "knight:-1": ["白（先手）", "黒（ナイト落ち・後手）"],
    "rook:1": ["白（ルーク落ち・先手）", "黒（後手）"], "rook:-1": ["白（先手）", "黒（ルーク落ち・後手）"],
    "queen:1": ["白（クイーン落ち・先手）", "黒（後手）"], "queen:-1": ["白（先手）", "黒（クイーン落ち・後手）"]};
  var localName = {pawn: "ポーンと先手", knight: "ナイト落ち", rook: "ルーク落ち", queen: "クイーン落ち"};
  A.handicaps.forEach(function(h){
    var m = /^(pawn|knight|rook|queen):(-?1)$/.exec(h.id), ref = m ? L.handicapState(m[1], +m[2]) : L.startState(), st = A.initial(h.id);
    var lab = !m ? "なし" : localName[m[1]] + "・" + (m[2] === "1" ? "白" : "黒") + "が付ける";
    check("ハンデ " + (h.id || "平手") + "（" + h.label + "）：局面＝ローカルの handicapState・first が先に指す・first の色＝ローカルの手番・席の名前",
      J(st.s) === J(ref) && A.turn(st) === "first" && A.color(st, "first") === ref.t && h.label === lab &&
      A.sideLabel("first", h.id) === expL[h.id][0] && A.sideLabel("second", h.id) === expL[h.id][1],
      A.sideLabel("first", h.id) + " ／ " + A.sideLabel("second", h.id));
  });
  check("白が付けるポーンと先手：黒が先（e7e5 は通り e2e4 は通らない）・f2 が空", !!A.play(A.initial("pawn:1"), "e7e5") && A.play(A.initial("pawn:1"), "e2e4") === null && A.initial("pawn:1").s.b[L.sqOf("f2")] === 0);
  check("ルーク落ち（白）は白のクイーン側の城の権利が無い（ローカルと同じ c=13）／知らない id は平手", A.initial("rook:1").s.c === 13 && J(A.initial("bogus").s) === J(L.startState()) && A.sideLabel("first", "bogus") === "白（先手）");

  // ===== 4 play は純粋 =====
  function pure(st, mv){
    var before = J(st), ns = A.play(st, mv);
    return J(st) === before && (!ns || (ns !== st && ns.s !== st.s && ns.s.b !== st.s.b && ns.keys !== st.keys && ns.sans !== st.sans && ns.capW !== st.capW && ns.capB !== st.capB));
  }
  var cases = [[st0, "e2e4"], [seq(CEP.slice(0, 4)), "e5d6"], [seq(CEP.slice(0, 10)), "e1g1"], [seq(CEP.slice(0, 13)), "e8c8"], [pre, "e7e8q"], [pre, "e7d8n"],
    [seq(FOOL.slice(0, 3)), "d8h4"], [seq(SCHOLAR.slice(0, 6)), "h5f7"], [st0, "e2e5"], [st0, "E2E4"], [fm, "a2a3"], [A.initial("pawn:1"), "e7e5"]];
  check("play は入力の局面を書き換えない（前後の JSON が同じ・新しい配列）" + cases.length + "通り", cases.every(function(c){ return pure(c[0], c[1]); }));

  // ===== 5 合法手を選び続けて終局まで（adapter だけ・上限つき）=====
  var seed = 20261026;
  function rnd(){ seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  var kinds = {}, maxPly = 0, errs = [], t0 = Date.now(), uciOk = true;
  for (var g = 0; g < 30; g++){
    var hc = A.handicaps[g % A.handicaps.length].id, st = A.initial(hc), ply = 0;
    try {
      while (!A.result(st) && ply < 1500){
        var ms = L.legalMoves(st.s);
        if (g === 0){ // 1局目は、すべての合法手が UCI で通ることと、UCI が重ならないことも確かめる
          var names = ms.map(L.moveUCI), uniq = {};
          names.forEach(function(n){ uniq[n] = 1; });
          if (Object.keys(uniq).length !== names.length || !names.every(function(n){ return !!A.play(st, n); })) uciOk = false;
        }
        var ns = A.play(st, L.moveUCI(ms[Math.floor(rnd() * ms.length)]));
        if (!ns) throw new Error("合法手が null");
        st = ns; ply++;
      }
      var r = A.result(st);
      if (!r) throw new Error(hc + " で 1500 手まで終わらない");
      var k = r.winner === "draw" ? r.text : "勝ち";
      kinds[k] = (kinds[k] || 0) + 1; maxPly = Math.max(maxPly, ply);
    } catch (e){ errs.push(String(e && e.message || e)); }
  }
  check("合法手を選び続けて30局（9種のハンデを順に）：全部終局・例外なし", errs.length === 0, J(kinds) + " 最長" + maxPly + "手 " + ((Date.now() - t0) / 1000).toFixed(1) + "秒 " + errs.join("／"));
  check("1局目の全局面：合法手はすべて UCI で通り、UCI が重ならない（成りの4種も別の文字）", uciOk);

  // ===== 6 偽の db：作る→入る→指す→投了 =====
  var store = Fake.makeStore(); store.tick = 5000; // 札を取るたびに時計を 5 秒進める（相手の札の期限 3 秒が切れる）
  var dbA = await Fake.makeClaude(store, {id: "u_a"}).use("db"), dbB = await Fake.makeClaude(store, {id: "u_b"}).use("db"), dbC = await Fake.makeClaude(store, {id: "u_c"}).use("db");
  var who = {a: [dbA, {key: "u_a"}, "u_a:t1"], b: [dbB, {key: "u_b"}, "u_b:t1"], c: [dbC, {key: "u_c"}, "u_c:t1"]};
  function mv(w, gid, m){ return FP.move(who[w][0], who[w][1], A, gid, m, who[w][2]); }
  function create(w, side, hc){ return FP.create(who[w][0], who[w][1], A, {side: side, handicap: hc || ""}); }
  function join(w, gid){ return FP.join(who[w][0], who[w][1], gid, who[w][2]); }
  async function doc(gid){ return (await dbA.doc("games/" + gid).get()).data(); }

  var g1 = await create("a", "first"), d = await doc(g1);
  check("作った対局は open・白（first）に作った人・平手なのでレーティングに入る", d.status === "open" && d.seats.first === "u_a" && d.rated === true && d.game === "chess");
  var side = await join("b", g1); d = await doc(g1);
  check("相手は黒（second）に入り、対局が始まる", side === "second" && d.status === "playing" && d.seats.second === "u_b");
  check("黒（b）は白の番に指せない", await rejects(mv("b", g1, "e7e5"), "notturn"));
  check("打ち手でない人（c）は指せない", await rejects(mv("c", g1, "e2e4"), "notplayer"));
  check("合法でない手は断られる（e2e5・e1g1）", await rejects(mv("a", g1, "e2e5"), "illegal") && await rejects(mv("a", g1, "e1g1"), "illegal"));
  check("形の違う手は断られる（e2-e4・E2E4・e2e4q・数）", await rejects(mv("a", g1, "e2-e4"), "illegal") && await rejects(mv("a", g1, "E2E4"), "illegal") &&
    await rejects(mv("a", g1, "e2e4q"), "illegal") && await rejects(mv("a", g1, 1234), "illegal"));
  await mv("a", g1, "f2f3"); d = await doc(g1);
  check("白の f2f3 が UCI のまま記録に入る・白は続けて指せない", J(d.moves) === J(["f2f3"]) && await rejects(mv("a", g1, "e2e4"), "notturn"));
  await mv("b", g1, "e7e5"); await mv("a", g1, "g2g4"); await mv("b", g1, "d8h4"); d = await doc(g1);
  check("フールズメイト（記録で）：done・second の勝ち・理由 end・チェックメイト", d.status === "done" && d.result.winner === "second" && d.result.reason === "end" && d.result.text === "チェックメイト" && J(d.moves) === J(FOOL) && !!d.finishedAt);
  check("終わった対局には指せない", await rejects(mv("a", g1, "a2a3"), "closed"));

  var g2 = await create("b", "second"); await join("a", g2); // b＝黒・a＝白
  for (var i = 0; i < CEP.length; i++) await mv(i % 2 ? "b" : "a", g2, CEP[i]);
  d = await doc(g2); var rp = FP.replay(A, d);
  check("キャスリング（O-O・O-O-O）とアンパッサン（exd6）が記録から並べ直しても通り、1手ずつの局面と同じ", rp.bad === -1 && J(rp.state) === J(seq(CEP)) && J(d.moves) === J(CEP));

  var g3 = await create("a", "first"); await join("b", g3);
  for (i = 0; i < PRE.length; i++) await mv(i % 2 ? "b" : "a", g3, PRE[i]);
  check("記録で成り：駒の文字のない e7e8 は断られる", await rejects(mv("a", g3, "e7e8"), "illegal"));
  await mv("a", g3, "e7e8n"); d = await doc(g3); rp = FP.replay(A, d);
  check("記録で成り：e7e8n が入り、並べ直すと e8 は白ナイト", rp.bad === -1 && last(d.moves) === "e7e8n" && rp.state.s.b[L.sqOf("e8")] === 2);
  await FP.resign(dbB, who.b[1], g3, who.b[2]); d = await doc(g3);
  check("黒（b）が投了すると白（a・first）の勝ち・理由 resign", d.status === "done" && d.result.winner === "first" && d.result.reason === "resign");

  var g4 = await create("a", "first", "pawn:1"); d = await doc(g4);
  check("ハンデ戦（白が付けるポーンと先手）は rated=false・ハンデの id が残る", d.rated === false && d.handicap === "pawn:1");
  await join("b", g4); // a＝first＝黒（先に指す）・b＝second＝白（付ける側）
  check("ハンデ戦：白（b・second）の e2e4 は相手の番と断られる", await rejects(mv("b", g4, "e2e4"), "notturn"));
  await mv("a", g4, "e7e5"); await mv("b", g4, "e2e4"); d = await doc(g4); rp = FP.replay(A, d);
  check("ハンデ戦：黒の e7e5 → 白の e2e4 が通り、f2 は空のまま", rp.bad === -1 && J(d.moves) === J(["e7e5", "e2e4"]) && rp.state.s.b[L.sqOf("f2")] === 0 && rp.state.s.b[L.sqOf("e4")] === 1);
  await FP.resign(dbB, who.b[1], g4, who.b[2]);

  // 合法手（弱いコンピュータの選び方）で記録を通して最後まで（上限 400 手・届かなければ投了）
  var g5 = await create("b", "first"); await join("a", g5); // b＝白・a＝黒
  var cur = A.initial(""), n5 = 0, t5 = Date.now();
  while (!A.result(cur) && n5 < 400){
    var m5 = L.moveUCI(L.chooseMove(cur.s, "weak"));
    await mv(A.turn(cur) === "first" ? "b" : "a", g5, m5);
    cur = A.play(cur, m5); n5++;
  }
  if (!A.result(cur)) await FP.resign(dbA, who.a[1], g5, who.a[2]);
  d = await doc(g5); rp = FP.replay(A, d);
  check("記録を通して合法手で最後まで：例外なし・done・並べ直しの局面と1手ずつの局面が同じ", d.status === "done" && rp.bad === -1 && J(rp.state) === J(cur) &&
    (d.result.reason === "resign" || J({winner: d.result.winner, text: d.result.text}) === J(A.result(cur))), n5 + "手 " + (d.result.text || d.result.reason) + " " + ((Date.now() - t5) / 1000).toFixed(1) + "秒");

  var all = Object.keys(store.docs).filter(function(p){ return p.indexOf("games/") === 0; }).map(function(p){ var x = JSON.parse(JSON.stringify(store.docs[p])); x.id = p.split("/")[1]; return x; });
  var R = FP.ratings(all), ratedDone = all.filter(function(x){ return x.status === "done" && x.rated; }).length;
  check("レーティング：終わった平手の " + ratedDone + " 局だけ数える（ハンデ戦は入れない）", ratedDone === 3 && R.table.u_a.n === 3 && R.table.u_b.n === 3 && Math.abs(R.table.u_a.r + R.table.u_b.r - 3000) < 1e-9);

  // ===== 7 ページ全体を偽の DOM で2枚動かす（ブラウザは開かない）=====
  await uiTest();

  console.log("\n" + (failN ? "❌ " + failN + " 件 落ちた" : "✅ 全部通過") + "（" + pass + " 件）");
  process.exit(failN ? 1 : 0);
}

// ---- 小さな偽の DOM：このページが使う所だけ（getElementById・createElement・appendChild・textContent・innerHTML・classList・クリックの伝わり方）----
function El(tag){
  this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.on = {};
  this.style = {setProperty: function(){}}; this._t = ""; this._h = ""; this.className = ""; this.hidden = false; this.disabled = false; this.id = ""; this._v = undefined;
}
El.prototype = {
  constructor: El,
  appendChild: function(c){ c.parentNode = this; this.children.push(c); return c; },
  get textContent(){ return this._t + this.children.map(function(c){ return c.textContent; }).join(""); },
  set textContent(v){ this.children = []; this._t = String(v); this._h = ""; },
  get innerHTML(){ return this._h; },
  set innerHTML(v){
    var self = this; this.children = []; this._h = String(v); this._t = String(v).replace(/<[^>]*>/g, ""); this._v = undefined;
    if (this.tagName === "SELECT"){ this._t = ""; String(v).replace(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g, function(_, val, txt){ var o = new El("option"); o.attrs.value = val; o._t = txt; self.appendChild(o); }); }
  },
  get firstChild(){ return this.children[0] || this._fc || (this._fc = new El("#text")); },
  get options(){ return this.children.filter(function(c){ return c.tagName === "OPTION"; }); },
  get value(){
    if (this.tagName === "SELECT"){ if (this._v !== undefined) return this._v; var o = this.options, s = o.filter(function(x){ return x.selected; })[0] || o[0]; return s ? s.value : ""; }
    return this._v !== undefined ? this._v : (this.attrs.value !== undefined ? this.attrs.value : "");
  },
  set value(v){ this._v = String(v); },
  get classList(){
    var self = this, list = function(){ return self.className.split(/\s+/).filter(Boolean); };
    return {
      contains: function(c){ return list().indexOf(c) >= 0; },
      add: function(c){ if (list().indexOf(c) < 0) self.className = list().concat([c]).join(" "); },
      remove: function(c){ self.className = list().filter(function(x){ return x !== c; }).join(" "); },
      toggle: function(c, on){ if (on === undefined) on = list().indexOf(c) < 0; if (on) this.add(c); else this.remove(c); return on; }
    };
  },
  get clientWidth(){ return 358; },
  setAttribute: function(k, v){ this.attrs[k] = String(v); if (k === "id") this.id = String(v); },
  getAttribute: function(k){ return k in this.attrs ? this.attrs[k] : null; },
  addEventListener: function(t, f){ (this.on[t] = this.on[t] || []).push(f); },
  dispatchEvent: function(ev){ ev.target = ev.target || this; for (var n = this; n; n = n.parentNode) (n.on[ev.type] || []).slice().forEach(function(f){ f.call(n, ev); }); return true; },
  click: function(){ if (!this.disabled) this.dispatchEvent({type: "click", target: this}); },
  matches: function(sel){
    if (sel.charAt(0) === ".") return this.classList.contains(sel.slice(1));
    if (sel.charAt(0) === "#") return this.id === sel.slice(1);
    var m = /^\[([\w-]+)\]$/.exec(sel); return m ? m[1] in this.attrs : false;
  },
  closest: function(sel){ for (var n = this; n; n = n.parentNode) if (n.matches && n.matches(sel)) return n; return null; }
};
function makePage(claude){
  var body = html.split("<body>")[1], byId = {};
  body.replace(/<(\w+)\b([^>]*?)\bid="([^"]+)"([^>]*)>/g, function(all, tag, a1, id, a2){
    var e = new El(tag), attrs = a1 + " " + a2; e.id = id; e.attrs.id = id;
    if (/\bhidden\b/.test(attrs)) e.hidden = true;
    if (/\bopen\b/.test(attrs)) e.open = true;
    var cm = /class="([^"]*)"/.exec(attrs); if (cm) e.className = cm[1];
    byId[id] = e;
  });
  body.replace(/<select id="([^"]+)">([\s\S]*?)<\/select>/g, function(all, id, inner){
    inner.replace(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g, function(_, val, selected, txt){ var o = new El("option"); o.attrs.value = val; o.selected = !!selected; o._t = txt; byId[id].appendChild(o); });
  });
  var doc = {getElementById: function(id){ return byId[id] || null; }, createElement: function(t){ return new El(t); }, createElementNS: function(ns, t){ return new El(t); },
    querySelectorAll: function(){ return []; }, head: new El("head"), body: new El("body")}; // 説明の図（[data-fig]）は描かない
  var win = {claude: claude, addEventListener: function(){}};
  var script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function("document", "window", "localStorage", script)(doc, win, {getItem: function(){ return null; }, setItem: function(){}}); // ページ1枚ぶん（大域を分ける）
  return {byId: byId, win: win};
}
function find(root, pred){ if (pred(root)) return root; for (var i = 0; i < root.children.length; i++){ var r = find(root.children[i], pred); if (r) return r; } return null; }
function cellOf(P, sq){ return find(P.byId.board, function(e){ return e.attrs["data-sq"] === sq; }); }
function fpBtn(P, text){ return find(P.byId.fpRoot, function(e){ return e.tagName === "BUTTON" && e.textContent === text; }); }
function msg(P){ return P.byId.msg.textContent; }
function setMode(P, v){ P.byId.mode.value = v; P.byId.mode.dispatchEvent({type: "change"}); }
async function press(P, list){ for (var i = 0; i < list.length; i++){ var e = cellOf(P, list[i]); if (!e) throw new Error("升が見つからない " + list[i]); e.click(); await wait(5); } await wait(60); }
async function playUCI(PA, PB, aIsFirst, moves, from){ // from 手目（0 始まり・既定 0）から交互に、UCI を升2つの押し方にして押す
  from = from || 0;
  for (var i = 0; i < moves.length; i++){ var P = ((from + i) % 2 === 0) === aIsFirst ? PA : PB; await press(P, [moves[i].slice(0, 2), moves[i].slice(2, 4)]); }
}

async function uiTest(){
  var store = Fake.makeStore(); store.tick = 5000;
  var PA = makePage(Fake.makeClaude(store, {id: "u_a"})), PB = makePage(Fake.makeClaude(store, {id: "u_b"}));
  function games(){ return Object.keys(store.docs).filter(function(p){ return p.indexOf("games/") === 0; }).map(function(p){ return store.docs[p]; }).sort(function(x, y){ return x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0; }); }
  function lastGame(){ return last(games()); }

  var sqs = PA.byId.board.children.map(function(c){ return c.attrs["data-sq"]; }), u = {};
  sqs.forEach(function(s){ u[s] = 1; });
  check("UI：盤の64升すべてに data-sq（UCI の升の名前・重なりなし）・白から見て左上 a8／右下 h1", sqs.length === 64 && Object.keys(u).length === 64 && sqs.every(function(s){ return /^[a-h][1-8]$/.test(s); }) && sqs[0] === "a8" && sqs[63] === "h1");
  var pzSq = (PA.byId.pboard.innerHTML.match(/data-sq="[^"]*"/g) || []);
  check("UI：練習の盤（説明の図と同じ描き方）の data-sq は数字だけ＝升の名前の querySelector と重ならない", pzSq.length === 64 && pzSq.every(function(x){ return /^data-sq="\d+"$/.test(x); }), pzSq.length + " 個");
  check("UI：はじめはコンピュータと対戦・ハンデの行と待った／最初からが見える・一覧の枠は隠れている", PA.byId.hcRow.style.display === "" && PA.byId.localBtns.style.display === "" && PA.byId.fpRoot.hidden === true);

  setMode(PA, "net"); setMode(PB, "net"); await wait(60);
  check("UI：オンラインにすると、コンピュータの設定・ハンデの行・待った／最初からが隠れ、一覧の枠が出る",
    PA.byId.cpuOpts.style.display === "none" && PA.byId.hcRow.style.display === "none" && PA.byId.localBtns.style.display === "none" && PA.byId.fpRoot.hidden === false && !!fpBtn(PA, "作って待つ"));
  check("UI：一覧の間のメッセージ", /一覧から対局を選ぶ/.test(msg(PA)), msg(PA));
  await press(PA, ["e2"]);
  check("UI：一覧の間は盤を押しても駒が選ばれない", !find(PA.byId.board, function(e){ return / sel\b/.test(e.className); }));

  function setName(P, n){ var i = find(P.byId.fpRoot, function(e){ return e.tagName === "INPUT"; }); i.value = n; fpBtn(P, "名前を保存").click(); }
  setName(PA, "たろう"); setName(PB, "はなこ"); await wait(60);
  fpBtn(PA, "作って待つ").click(); await wait(60);
  check("UI：A が作ると、A は相手を待つ", /相手を待っています/.test(msg(PA)), msg(PA));
  var j = fpBtn(PB, "参加する");
  check("UI：B の一覧に『参加する』がある", !!j);
  j.click(); await wait(80);
  check("UI：B が入ると A（白）は自分の番・B（黒）は相手の番", /あなたの番です：白（先手）/.test(msg(PA)) && /相手の番です/.test(msg(PB)), msg(PA) + " ／ " + msg(PB));
  check("UI：B（黒）の盤は裏返る（左上 h1・右下 a8）・升の名前は付け直される", PB.byId.board.children[0].attrs["data-sq"] === "h1" && PB.byId.board.children[63].attrs["data-sq"] === "a8");
  await press(PB, ["e2", "e4"]);
  check("UI（対照）：B が A の番に e2,e4 を押しても記録は 0 手", lastGame().moves.length === 0);
  await press(PA, ["e2", "e4"]);
  check("UI：A が e2,e4 を押すと記録に e2e4・両方の盤の e4 に駒・e2 は空", J(lastGame().moves) === J(["e2e4"]) && cellOf(PA, "e4").innerHTML !== "" && cellOf(PA, "e2").innerHTML === "" && cellOf(PB, "e4").innerHTML !== "" && cellOf(PB, "e2").innerHTML === "");
  check("UI：A は相手の番・B は自分の番（黒（後手））", /相手の番です/.test(msg(PA)) && /あなたの番です：黒（後手）/.test(msg(PB)), msg(PB));
  await playUCI(PA, PB, true, SCHOLAR.slice(1), 1);
  var g = lastGame();
  check("UI：スカラーズメイトまで押すと done・first（白・たろう）の勝ち・A のメッセージにチェックメイト", g.status === "done" && g.result.winner === "first" && J(g.moves) === J(SCHOLAR) && /チェックメイト/.test(msg(PA)) && /たろう（あなた）の勝ち/.test(msg(PA)), msg(PA));
  check("UI：棋譜の欄に Qxf7# が出る", /Qxf7#/.test(PA.byId.moves.innerHTML));
  await press(PB, ["e8", "f7"]);
  check("UI：終わったあとは押しても記録は増えない", lastGame().moves.length === SCHOLAR.length);

  // 2局目：王手の一言と、成りの選び方（既存の昇格の窓を通す）・投了
  fpBtn(PA, "一覧へ戻る").click(); fpBtn(PB, "一覧へ戻る").click(); await wait(40);
  fpBtn(PA, "作って待つ").click(); await wait(60); fpBtn(PB, "参加する").click(); await wait(80);
  await playUCI(PA, PB, true, ["e2e4", "f7f6", "d1h5"]);
  check("UI：王手の局面では『王手です！』が先頭に付く（受けた B も、かけた A も＝ローカルと同じく盤の事実）・B は自分の番", /^王手です！/.test(msg(PB)) && /あなたの番です/.test(msg(PB)) && /^王手です！/.test(msg(PA)), msg(PB));
  await press(PB, ["g7", "g6"]);
  check("UI：王手を受けた B が g7,g6 で受けると記録に入り、王手の一言は消える", last(lastGame().moves) === "g7g6" && !/王手/.test(msg(PA)) && !/王手/.test(msg(PB)));
  fpBtn(PA, "一覧へ戻る").click(); fpBtn(PB, "一覧へ戻る").click(); await wait(40);
  fpBtn(PA, "作って待つ").click(); await wait(60); fpBtn(PB, "参加する").click(); await wait(80);
  await playUCI(PA, PB, true, PRE);
  check("UI：成りの前までの12手が記録に入る", J(lastGame().moves) === J(PRE), J(lastGame().moves));
  await press(PA, ["e7", "e8"]);
  check("UI：e7,e8 を押すと昇格の窓が出て、まだ記録しない", PA.byId.promo.classList.contains("on") && /昇格する駒を選んでください/.test(msg(PA)) && lastGame().moves.length === PRE.length, msg(PA));
  var kn = find(PA.byId.promoBtns, function(e){ return e.tagName === "BUTTON" && e.textContent === "ナイト"; });
  kn.click(); await wait(80);
  check("UI：『ナイト』を押すと e7e8n が記録に入り、e8 に駒・窓が閉じる", last(lastGame().moves) === "e7e8n" && cellOf(PA, "e8").innerHTML.indexOf("♞") >= 0 && !PA.byId.promo.classList.contains("on"), last(lastGame().moves));
  fpBtn(PB, "投了する").click(); await wait(20); fpBtn(PB, "投了する").click(); await wait(80);
  check("UI：B が投了を2回押すと first（A）の勝ち", lastGame().status === "done" && lastGame().result.winner === "first" && lastGame().result.reason === "resign" && /投了/.test(msg(PA)), msg(PA));

  // 3局目：ハンデ戦（白が付けるポーンと先手）＝A は first で黒、先に指す・盤は裏返る
  fpBtn(PA, "一覧へ戻る").click(); fpBtn(PB, "一覧へ戻る").click(); await wait(40);
  var hcSel = find(PA.byId.fpRoot, function(e){ return e.tagName === "SELECT" && /^fp-hc-/.test(e.id); });
  hcSel.value = "pawn:1"; fpBtn(PA, "作って待つ").click(); await wait(60); fpBtn(PB, "参加する").click(); await wait(80);
  check("UI：ハンデ戦は A（first）が黒で先に指す・A の盤は裏返る・f2 が空", lastGame().handicap === "pawn:1" && /あなたの番です：黒（先手）/.test(msg(PA)) && PA.byId.board.children[0].attrs["data-sq"] === "h1" && cellOf(PA, "f2").innerHTML === "", msg(PA));
  await press(PA, ["e7", "e5"]);
  check("UI：ハンデ戦で A の e7,e5 が記録に入り、B（白・f ポーン落ち）の番", J(lastGame().moves) === J(["e7e5"]) && /あなたの番です：白（f ポーン落ち・後手）/.test(msg(PB)), msg(PB));

  // ローカルに戻すと、ふだんの対局に戻る
  setMode(PA, "two"); await wait(20);
  check("UI：2人で1台に戻すと、ハンデの行と待った／最初からが戻り、一覧の枠が隠れ、初期局面", PA.byId.hcRow.style.display === "" && PA.byId.localBtns.style.display === "" && PA.byId.fpRoot.hidden === true && cellOf(PA, "e2").innerHTML !== "" && cellOf(PA, "f2").innerHTML !== "");
  var nBefore = lastGame().moves.length;
  await press(PA, ["e2", "e4"]);
  check("UI：ローカルではその場で進み（黒の番）、記録には書かない", /黒の番です/.test(msg(PA)) && cellOf(PA, "e4").innerHTML !== "" && lastGame().moves.length === nBefore, msg(PA));
}

main().catch(function(e){ console.log("❌ 例外：" + (e && e.stack || e)); process.exit(1); });
