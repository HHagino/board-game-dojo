// 将棋の友だち対局の試験：node shogi/test_friendplay.js
// index.html の LOGIC 区間（SHOGI_ADAPTER を含む）とshared/friendplay.js を読み込み、偽の claude（fake-claude.js）で2人が記録を共有して指す。
// 乱数は種を固定（結果が毎回同じ）。2026-10-26 Claude（Opus）。
var fs = require("fs"), path = require("path"), vm = require("vm");
var Fake = require(path.join(__dirname, "..", "shared", "fake-claude.js"));

function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
var rng = mulberry32(20261026);
var M = Object.create(Math); M.random = function(){ return rng(); };

var ctx = {console: console, setTimeout: setTimeout, Math: M, Date: Date, Promise: Promise, JSON: JSON, Object: Object, Error: Error};
vm.createContext(ctx);
var SRC = fs.readFileSync(path.join(__dirname, "..", "shared", "friendplay.js"), "utf8");
vm.runInContext(SRC + "\nthis.FriendPlay = FriendPlay;", ctx);
var html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
var logic = html.split("// ===== LOGIC-BEGIN")[1].split("// ===== LOGIC-END =====")[0];
vm.runInContext("//" + logic + "\nthis.A = SHOGI_ADAPTER; this.L = {parseSfen: parseSfen, posKey: posKey, legalMoves: legalMoves, genPseudo: genPseudo, inCheck: inCheck, hasLegal: hasLegal," +
  " newGameFrom: newGameFrom, gamePlay: gamePlay, chooseMove: chooseMove, HANDICAPS: HANDICAPS, handicapSfen: handicapSfen, START_SFEN: START_SFEN," +
  " usiSq: usiSq, usiToMove: usiToMove, moveToUsi: moveToUsi, shogiStateFrom: shogiStateFrom, copyGame: copyGame};", ctx);
var FP = ctx.FriendPlay, A = ctx.A, L = ctx.L;

var pass = 0, failN = 0;
function check(name, ok, extra){ if (ok){ pass++; console.log("✅ " + name + (extra ? "  " + extra : "")); } else { failN++; console.log("❌ " + name + (extra ? "  " + extra : "")); } }
async function rejects(p, code){ try { await p; return false; } catch (e){ return e && e.code === code; } }
var sq = function(r, c){ return r * 9 + c; };
var J = function(x){ return JSON.stringify(x); };
// 手の列を adapter で順に指す。途中で null なら {st: null, at: 何手目}
function line(st, moves){
  for (var i = 0; i < moves.length; i++){ var ns = A.play(st, moves[i]); if (!ns) return {st: null, at: i, prev: st}; st = ns; }
  return {st: st, at: -1};
}
var FROM = function(sfen, hc){ return L.shogiStateFrom(sfen, hc); };
// 横歩の出だし：両者の歩の交換と、歩を打つ手（△２三歩・▲８七歩）が2回入る
var YOKOFU = ["2g2f", "8c8d", "2f2e", "8d8e", "2e2d", "2c2d", "2h2d", "P*2c", "2d2f", "8e8f", "8g8f", "8b8f", "P*8g"];

async function main(){
  // ===== 1 手合割・先手と後手・初期局面 =====
  check("手合割は9種・先頭は id \"\" の平手・残り8種は既存の HANDICAPS の id と表示のまま",
    A.handicaps.length === 9 && A.handicaps[0].id === "" && A.handicaps[0].label === "平手" &&
    A.handicaps.slice(1).every(function(h, i){ return h.id === L.HANDICAPS[i + 1].id && h.label === L.HANDICAPS[i + 1].name; }),
    A.handicaps.map(function(h){ return (h.id || "\"\"") + "=" + h.label; }).join(" "));
  check("平手の呼び名：first＝先手（▲）・second＝後手（△）", A.sideLabel("first", "", "") === "先手（▲）" && A.sideLabel("second", "", "") === "後手（△）");
  check("駒落ちの呼び名：first＝下手（▲）・second＝上手（△・先に指す）（8種すべて）",
    A.handicaps.slice(1).every(function(h){ return A.sideLabel("first", h.id) === "下手（▲）" && A.sideLabel("second", h.id) === "上手（△・先に指す）"; }));
  (function(){
    var ok = true, why = [];
    L.HANDICAPS.forEach(function(h, i){
      var st = A.initial(i ? h.id : "", ""), ref = L.parseSfen(L.handicapSfen(h.id)), want = i ? "second" : "first";
      if (L.posKey(st.S) !== L.posKey(ref)) { ok = false; why.push(h.name + "の局面"); }
      if (A.turn(st) !== want){ ok = false; why.push(h.name + "の手番"); }
      if (A.result(st) !== null){ ok = false; why.push(h.name + "が終局扱い"); }
    });
    check("初期局面は既存の handicapSfen と同じ・最初の手番は平手＝first、駒落ち＝second（上手が先）", ok, why.join(" "));
  })();
  check("知らない手合割の id と \"hirate\" は平手として並べる（handicapOf と同じ扱い）",
    L.posKey(A.initial("foo").S) === L.posKey(L.parseSfen(L.START_SFEN)) && L.posKey(A.initial("hirate").S) === L.posKey(L.parseSfen(L.START_SFEN)) && A.turn(A.initial("foo")) === "first");

  // ===== 2 USI の書き方 =====
  check("升の名前：９一＝9a・１一＝1a・７七＝7g・１九＝1i", L.usiSq(0) === "9a" && L.usiSq(8) === "1a" && L.usiSq(sq(6, 2)) === "7g" && L.usiSq(80) === "1i");
  (function(){
    var n = 0, bad = 0, sts = A.handicaps.map(function(h){ return A.initial(h.id); });
    var r = line(A.initial(""), YOKOFU); sts.push(r.st);
    sts.push(FROM("k8/2G6/9/9/9/9/9/9/8K b P 1"), FROM("4k4/9/9/1S7/9/9/9/9/4K4 b - 1"), FROM("4k4/9/9/9/9/9/9/9/4K4 b PLNSGBR 1"));
    sts.forEach(function(st){
      L.legalMoves(L.copyGame(st).S).forEach(function(mv){
        n++;
        var u = L.moveToUsi(mv);
        if (L.usiToMove(u) !== mv || !A.play(st, u)) bad++;
      });
    });
    check("合法手はすべて USI の文字に直して戻すと同じ手になり、play が通る", n > 500 && bad === 0, n + "手中 不一致" + bad);
  })();
  (function(){
    var st = A.initial(""), before = J(st);
    var bads = ["", "7g", "7g7", "7g7f ", " 7g7f", "7g7f\n", "7G7F", "7g7f++", "+7g7f", "7g-7f", "7g*7f", "0g7f", "7j7f", "7g7g", "77", "7g7f+=",
      "P*5", "P*5e+", "p*5e", "K*5e", "+P*5e", "P5e", "P**5e", "P*0e", "Ｐ*5e", "７g７f"];
    var others = [null, undefined, 76, 7.6, {}, [], ["7g7f"], true];
    var allNull = bads.every(function(s){ return A.play(st, s) === null; }) && others.every(function(x){ return A.play(st, x) === null; });
    var shape = bads.every(function(s){ return L.usiToMove(s) === -1; });
    check("形の違う文字列（" + bads.length + "種）と文字列でないもの（" + others.length + "種）は null・局面は書き換わらない", allNull && shape && J(st) === before);
  })();
  (function(){
    var st = A.initial(""), ns = A.play(st, "7g7f");
    check("初手 7g7f（▲７六歩）が通り、歩が７六へ・手番は second・棋譜の字は ▲７六歩",
      !!ns && ns.S.b[sq(5, 2)] === 1 && ns.S.b[sq(6, 2)] === 0 && A.turn(ns) === "second" && ns.moves[0].text === "▲７六歩");
    check("相手の駒（3c3d）・空の升（5e5d）・動けない先（7g7e）・持っていない駒の打ち（P*5e）は null",
      A.play(st, "3c3d") === null && A.play(st, "5e5d") === null && A.play(st, "7g7e") === null && A.play(st, "P*5e") === null);
  })();

  // ===== 3 ルール（いまのエンジンが禁じるもの） =====
  (function(){
    var N = FROM("4k4/9/9/9/4P4/9/9/9/4K4 b P 1");
    check("二歩：自分の歩のある５筋への歩打ち（P*5g）は null・ほかの筋（P*4g）は通る", A.play(N, "P*5g") === null && !!A.play(N, "P*4g"));
    var r = line(A.initial(""), YOKOFU);
    check("二歩（初形からの手順）：横歩の出だしのあと、後手の歩が５筋にあるので △P*5e は null・歩の無い８筋の △P*8e は通る",
      !!r.st && A.turn(r.st) === "second" && r.st.S.h[1][1] === 1 && A.play(r.st, "P*5e") === null && !!A.play(r.st, "P*8e"));
  })();
  (function(){
    var U = FROM("k8/2G6/1S7/9/9/9/9/9/8K b P 1"), C = FROM("k8/2G6/9/9/9/9/9/9/8K b P 1");
    var c = A.play(C, "P*9b");
    check("打ち歩詰め：P*9b は null（詰みになる）・対照の局面（玉が歩を取れる）では通って王手", A.play(U, "P*9b") === null && !!c && L.inCheck(c.S, -1) && !c.over);
    check("打ち歩詰めの局面でも、ほかの升への歩打ち（P*4f）は通る", !!A.play(U, "P*4f"));
  })();
  (function(){
    var Z = FROM("4k4/9/9/9/9/9/9/9/4K4 b PLN 1");
    check("行き所のない駒の打ち：P*5a・L*5a・N*5a・N*5b は null／対照：P*5b・L*5b・N*5c は通る",
      ["P*5a", "L*5a", "N*5a", "N*5b"].every(function(m){ return A.play(Z, m) === null; }) && ["P*5b", "L*5b", "N*5c"].every(function(m){ return !!A.play(Z, m); }));
    var P1 = FROM("4k4/P8/9/9/9/9/9/9/4K4 b - 1"), np = A.play(P1, "9b9a+");
    check("行き所のない駒の移動：歩の 9b9a（不成）は null・9b9a+（成り）は通ってと金", A.play(P1, "9b9a") === null && !!np && np.S.b[0] === 9);
  })();
  (function(){
    var C = FROM("4k4/9/9/9/9/9/9/9/r3K4 b - 1");
    check("王手放置：飛車の横の王手のまま横へ動く 5i4i は null・逃げる 5i5h は通る", A.play(C, "5i4i") === null && !!A.play(C, "5i5h"));
    var Q = FROM("3kr4/9/9/9/9/9/9/4G4/4K4 b - 1");
    check("ピン：飛車に釘付けの金の横の手 5h4h は null・縦の 5h5g は通る", A.play(Q, "5h4h") === null && !!A.play(Q, "5h5g"));
  })();
  (function(){
    var r = line(A.initial(""), ["7g7f", "3c3d"]), st = r.st, before = J(st);
    var pr = A.play(st, "8h2b+"), np = A.play(st, "8h2b");
    check("成りと不成：7g7f 3c3d のあと 8h2b+ は馬（成り）・8h2b は角のまま、両方通る・角を取って持ち駒に",
      !!pr && !!np && pr.S.b[sq(1, 7)] === 14 && np.S.b[sq(1, 7)] === 6 && pr.S.h[0][6] === 1 && np.S.h[0][6] === 1 && /角成/.test(pr.moves[2].text), pr && pr.moves[2].text);
    check("敵陣に関わらない手に + を付けたもの（7f7e+）と、金の成り（6i5h+）は null", A.play(st, "7f7e+") === null && A.play(st, "6i5h+") === null && J(st) === before);
  })();

  // ===== 4 終局（ローカルの対局 updateResult と同じ） =====
  (function(){
    var st = FROM("4k4/9/3SG4/9/9/9/9/9/8K b - 1"), ns = A.play(st, "5c5b"), res = ns && A.result(ns);
    check("詰み（頭金）：▲5c5b で終局・勝ちは first・エンジンでも後手に合法手が無く王手",
      !!res && res.winner === "first" && /詰み/.test(res.text) && L.legalMoves(L.copyGame(ns).S).length === 0 && L.inCheck(ns.S, -1), res && res.text);
    var g = FROM("k8/9/9/9/9/9/4gs3/9/4K4 w - 1", "kaku"), gn = A.play(g, "5g5h"), gr = gn && A.result(gn);
    check("詰み（後手＝駒落ちなら上手が詰ませる）：△5g5h で勝ちは second", !!gr && gr.winner === "second" && /詰み/.test(gr.text), gr && gr.text);
  })();
  function repeat(st, seq, n){
    var out = {st: st, endAt: -1, err: ""};
    for (var k = 0; k < n; k++){
      var ns = A.play(out.st, seq[k % seq.length]);
      if (!ns){ out.err = (k + 1) + "手目 " + seq[k % seq.length] + " が null"; return out; }
      out.st = ns;
      if (A.result(ns)){ out.endAt = k + 1; return out; }
    }
    return out;
  }
  (function(){
    var r = repeat(A.initial(""), ["5i4h", "5a4b", "4h5i", "4b5a"], 20), res = r.st && A.result(r.st);
    // ローカルの対局で同じ手を指したとき
    var G = L.newGameFrom(L.START_SFEN), ply = 0;
    while (!G.over && ply < 20){ var u = ["5i4h", "5a4b", "4h5i", "4b5a"][ply % 4]; L.gamePlay(G, L.legalMoves(G.S).filter(function(mv){ return L.moveToUsi(mv) === u; })[0]); ply++; }
    check("千日手（初形から玉の往復）：同じ局面の4回目＝12手目で引き分け・ローカルの対局も同じ12手目・同じ理由",
      r.endAt === 12 && res.winner === "draw" && /^千日手/.test(res.text) && ply === 12 && G.winner === 0 && G.reason === r.st.reason, r.err || res.text);
    var stillLegal = L.legalMoves(L.copyGame(r.st).S).some(function(mv){ return L.moveToUsi(mv) === "5i4h"; });
    check("終わった局面には指せない：千日手のあと、盤の上では指せる 5i4h も null", stillLegal && A.play(r.st, "5i4h") === null);
  })();
  (function(){
    var r = repeat(FROM("k8/5R3/9/9/9/9/9/9/8K b - 1"), ["4b4a", "9a9b", "4a4b", "9b9a"], 20), res = r.st && A.result(r.st);
    check("連続王手の千日手：王手をかけ続けた先手（first）の負け＝勝ちは second（12手目）", r.endAt === 12 && res.winner === "second" && /連続王手/.test(res.text), r.err || res.text);
    var r2 = repeat(FROM("k8/9/9/9/9/9/9/3r5/8K w - 1"), ["6h6i", "1i1h", "6i6h", "1h1i"], 20), res2 = r2.st && A.result(r2.st);
    check("連続王手の千日手（向きを逆に）：王手をかけ続けた後手の負け＝勝ちは first", r2.endAt === 12 && res2.winner === "first" && /連続王手/.test(res2.text), r2.err || res2.text);
    // 王手2回のあと玉どうしの往復（王手でない手）を挟む：最初の局面が 0・4・8・12手目に現れる
    var r3 = repeat(FROM("k8/5R3/9/9/9/9/9/9/8K b - 1"), ["4b4a", "9a9b", "4a4b", "9b9a", "1i1h", "9a8a", "1h1i", "8a9a"], 40), res3 = r3.st && A.result(r3.st);
    check("対照：王手でない手が混ざる往復は、連続王手ではなく普通の千日手（12手目・引き分け）", r3.endAt === 12 && res3.winner === "draw" && !/連続王手/.test(res3.text), r3.err || (res3 && res3.text));
  })();

  // ===== 5 play は入力の局面を書き換えない =====
  (function(){
    var cases = [[A.initial(""), "7g7f"], [A.initial("kaku"), "3c3d"], [line(A.initial(""), ["7g7f", "3c3d"]).st, "8h2b+"], [line(A.initial(""), ["7g7f", "3c3d"]).st, "8h2b"],
      [line(A.initial(""), YOKOFU).st, "P*8e"], [line(A.initial(""), YOKOFU).st, "P*5e"], [FROM("k8/2G6/1S7/9/9/9/9/9/8K b P 1"), "P*9b"], [FROM("4k4/9/3SG4/9/9/9/9/9/8K b - 1"), "5c5b"],
      [A.initial(""), "xyz"], [A.initial(""), "3c3d"]];
    var ok = true, why = [];
    cases.forEach(function(c, i){
      var before = J(c[0]), ns = A.play(c[0], c[1]);
      if (J(c[0]) !== before){ ok = false; why.push(i + ":" + c[1]); }
      if (ns && (ns === c[0] || ns.S === c[0].S || ns.S.b === c[0].S.b || ns.S.h[0] === c[0].S.h[0] || ns.hist === c[0].hist || ns.moves === c[0].moves)){ ok = false; why.push(i + ":共有"); }
    });
    // 同じ局面から2通りに指しても、互いに混ざらない
    var base = line(A.initial(""), ["7g7f", "3c3d"]).st, x = A.play(base, "8h2b+"), y = A.play(base, "2g2f");
    check("play の前後で入力の局面の JSON が同じ（" + cases.length + "通り：通る手・断られる手・打つ・成る・詰み）・新しい局面は配列を共有しない", ok, why.join(" "));
    check("同じ局面から別の手を2つ指しても混ざらない", x.S.b[sq(1, 7)] === 14 && y.S.b[sq(1, 7)] === -6 && base.moves.length === 2 && x.moves.length === 3 && y.moves.length === 3);
  })();

  // ===== 6 偽の db で 作る→入る→指す→投了 =====
  var store = Fake.makeStore();
  var dbA = await Fake.makeClaude(store, {id: "u_a"}).use("db"), dbB = await Fake.makeClaude(store, {id: "u_b"}).use("db"), dbC = await Fake.makeClaude(store, {id: "u_c"}).use("db");
  var a = {key: "u_a"}, b = {key: "u_b"}, c = {key: "u_c"};
  function think(){ store.t += 5000; }
  async function doc(g){ return (await dbA.doc("games/" + g).get()).data(); }

  var g1 = await FP.create(dbA, a, A, {side: "first", handicap: ""});
  think(); await FP.join(dbB, b, g1, "u_b:t");
  var d = await doc(g1);
  check("平手の対局を作る→入る：A＝first（先手）・B＝second（後手）・レーティングに入る", d.status === "playing" && d.seats.first === "u_a" && d.seats.second === "u_b" && d.rated === true && d.handicap === "");
  think(); check("後手は先手の番に指せない（notturn）", await rejects(FP.move(dbB, b, A, g1, "3c3d", "u_b:t"), "notturn"));
  think(); check("打ち手でない人は指せない（notplayer）", await rejects(FP.move(dbC, c, A, g1, "7g7f", "u_c:t"), "notplayer"));
  think(); check("形の違う手（7g7f+ / xyz / P*5e）は illegal", await rejects(FP.move(dbA, a, A, g1, "7g7f+", "u_a:t"), "illegal") && await rejects(FP.move(dbA, a, A, g1, "xyz", "u_a:t"), "illegal") && await rejects(FP.move(dbA, a, A, g1, "P*5e", "u_a:t"), "illegal"));
  think(); await FP.move(dbA, a, A, g1, "7g7f", "u_a:t");
  think(); check("先手は続けて指せない", await rejects(FP.move(dbA, a, A, g1, "2g2f", "u_a:t"), "notturn"));
  think(); await FP.move(dbB, b, A, g1, "3c3d", "u_b:t");
  think(); await FP.move(dbA, a, A, g1, "8h2b+", "u_a:t");
  d = await doc(g1);
  check("記録は USI の文字のまま（7g7f・3c3d・8h2b+）・並べ直すと馬がいる", J(d.moves) === J(["7g7f", "3c3d", "8h2b+"]) && FP.replay(A, d).bad === -1 && FP.replay(A, d).state.S.b[sq(1, 7)] === 14);
  think(); await FP.resign(dbA, a, g1, "u_a:t");
  d = await doc(g1);
  check("先手（A）が投了すると後手（B）の勝ち", d.status === "done" && d.result.winner === "second" && d.result.reason === "resign");
  think(); check("終わった対局には指せない", await rejects(FP.move(dbB, b, A, g1, "3a2b", "u_b:t"), "closed"));

  // 打つ手を含む記録
  var g2 = await FP.create(dbB, b, A, {side: "second", handicap: ""});
  think(); await FP.join(dbA, a, g2, "u_a:t");
  for (var i = 0; i < YOKOFU.length; i++){ think(); await FP.move(i % 2 ? dbB : dbA, i % 2 ? b : a, A, g2, YOKOFU[i], i % 2 ? "u_b:t" : "u_a:t"); }
  d = await doc(g2);
  var rp = FP.replay(A, d);
  check("打つ手（P*2c・P*8g）を含む13手が記録に入り、記録から並べ直しても全部通る", d.moves.length === 13 && rp.bad === -1 && d.moves.filter(function(m){ return m.indexOf("*") > 0; }).length === 2 && rp.state.S.b[sq(6, 1)] === 1 && rp.state.S.b[sq(2, 7)] === -1);
  think(); check("記録からの局面でも二歩は断られる（後手の P*5e は illegal）", await rejects(FP.move(dbB, b, A, g2, "P*5e", "u_b:t"), "illegal"));
  think(); await FP.move(dbB, b, A, g2, "P*8e", "u_b:t");
  d = await doc(g2);
  check("記録からの局面で、二歩でない所への打ち（P*8e）は通る", d.moves.length === 14 && d.moves[13] === "P*8e" && FP.replay(A, d).bad === -1);
  await dbB.doc("games/" + g2).update({moves: d.moves.concat(["P*5e"])});
  think(); check("記録に二歩の手を書き足されたら、並べ直しで止まり続きは指せない（broken）", FP.replay(A, await doc(g2)).bad === 14 && await rejects(FP.move(dbA, a, A, g2, "2f2d", "u_a:t"), "broken"));

  // 駒落ち：上手が先
  var g3 = await FP.create(dbA, a, A, {side: "first", handicap: "kaku"});
  think(); await FP.join(dbB, b, g3, "u_b:t");
  d = await doc(g3);
  check("角落ちの対局：レーティングに入れない・A＝下手（first）・B＝上手（second）", d.rated === false && d.handicap === "kaku" && d.seats.first === "u_a" && d.seats.second === "u_b");
  think(); check("駒落ちは上手から：下手（A）の初手は notturn", await rejects(FP.move(dbA, a, A, g3, "7g7f", "u_a:t"), "notturn"));
  think(); check("角落ちの上手には角が無い（２二の角を動かす手 2b3c は illegal）", await rejects(FP.move(dbB, b, A, g3, "2b3c", "u_b:t"), "illegal"));
  think(); await FP.move(dbB, b, A, g3, "3c3d", "u_b:t");
  think(); await FP.move(dbA, a, A, g3, "7g7f", "u_a:t");
  d = await doc(g3);
  check("上手 3c3d → 下手 7g7f が記録に入り、棋譜の字は △３四歩・▲７六歩", J(d.moves) === J(["3c3d", "7g7f"]) && FP.replay(A, d).state.moves.map(function(m){ return m.text; }).join("") === "△３四歩▲７六歩");

  // 千日手を db で（初形から）
  var g4 = await FP.create(dbA, a, A, {side: "first", handicap: ""});
  think(); await FP.join(dbB, b, g4, "u_b:t");
  var rep = ["5i4h", "5a4b", "4h5i", "4b5a"];
  for (i = 0; i < 12; i++){ think(); await FP.move(i % 2 ? dbB : dbA, i % 2 ? b : a, A, g4, rep[i % 4], i % 2 ? "u_b:t" : "u_a:t"); }
  d = await doc(g4);
  check("db でも千日手（12手目）で終局・引き分け", d.status === "done" && d.result.winner === "draw" && d.result.reason === "end" && /千日手/.test(d.result.text), d.result && d.result.text);

  // 詰みを db で（初期局面を差し替えた adapter で、記録の流れだけを見る）
  function withStart(sfen){ var x = {}; for (var k in A) x[k] = A[k]; x.initial = function(){ return L.shogiStateFrom(sfen, ""); }; return x; }
  var AM = withStart("4k4/9/3SG4/9/9/9/9/9/8K b - 1");
  var g5 = await FP.create(dbA, a, AM, {side: "first", handicap: ""});
  think(); await FP.join(dbB, b, g5, "u_b:t");
  think(); await FP.move(dbA, a, AM, g5, "5c5b", "u_a:t");
  d = await doc(g5);
  check("db で詰み：指した手で done・勝ちは first（詰ませた側）・終わりの理由は end", d.status === "done" && d.result.winner === "first" && d.result.reason === "end" && /詰み/.test(d.result.text), d.result && d.result.text);
  var AM2 = withStart("k8/9/9/9/9/9/4gs3/9/4K4 w - 1");
  var g6 = await FP.create(dbA, a, AM2, {side: "first", handicap: ""});
  think(); await FP.join(dbB, b, g6, "u_b:t");
  think(); await FP.move(dbB, b, AM2, g6, "5g5h", "u_b:t");
  d = await doc(g6);
  check("db で詰み（後手が詰ませる）：勝ちは second", d.status === "done" && d.result.winner === "second");

  // ===== 7 合法手を選び続けて、終局か上限まで（例外が出ない・ローカルの対局と一致） =====
  (function(){
    var games = 30, cap = 400, err = "", mismatch = 0, mate = 0, draw = 0, capped = 0, plies = 0, drops = 0, promos = 0, t0 = Date.now();
    try {
      for (var k = 0; k < games; k++){
        var hc = A.handicaps[k % A.handicaps.length].id, st = A.initial(hc), G = L.newGameFrom(L.handicapSfen(hc || "hirate")), n = 0;
        while (!A.result(st) && n < cap){
          var mv = L.chooseMove(L.copyGame(st).S, "weak"), u = L.moveToUsi(mv), ns = A.play(st, u);
          if (!ns){ err += " " + k + "局" + n + "手目 " + u + " が null"; break; }
          L.gamePlay(G, mv);
          if (L.posKey(ns.S) !== L.posKey(G.S) || ns.over !== G.over || ns.winner !== G.winner || ns.reason !== G.reason) mismatch++;
          if (u.indexOf("*") > 0) drops++; if (u.slice(-1) === "+") promos++;
          st = ns; n++;
        }
        plies += n;
        var r = A.result(st);
        if (!r) capped++; else if (r.winner === "draw") draw++; else { mate++; if (r.winner !== (G.winner === 1 ? "first" : "second")) mismatch++; }
      }
    } catch (e){ err += " 例外 " + e; }
    check("adapter で" + games + "局（手合割を順に・弱いコンピュータの手）：例外なし・毎手ローカルの対局と局面と終局が一致", !err && mismatch === 0 && mate > 0,
      "決着" + mate + " 引分" + draw + " " + cap + "手で打切" + capped + " 計" + plies + "手（打つ" + drops + "・成る" + promos + "） " + (Date.now() - t0) + "ms" + err);
  })();
  await (async function(){
    var games = 4, cap = 120, err = "", mis = 0, done = 0, t0 = Date.now();
    try {
      for (var k = 0; k < games; k++){
        var hc = k === 3 ? "nimai" : "", gid = await FP.create(dbA, a, A, {side: k % 2 ? "second" : "first", handicap: hc});
        think(); await FP.join(dbB, b, gid, "u_b:t");
        var dd = await doc(gid), seatA = dd.seats.first === "u_a" ? "first" : "second", n = 0;
        while (dd.status === "playing" && n < cap){
          var st = FP.replay(A, dd).state, mv = L.chooseMove(L.copyGame(st).S, "weak"), mine = A.turn(st) === seatA;
          think(); await FP.move(mine ? dbA : dbB, mine ? a : b, A, gid, L.moveToUsi(mv), mine ? "u_a:t" : "u_b:t");
          dd = await doc(gid); n++;
        }
        var rp2 = FP.replay(A, dd), res = A.result(rp2.state);
        if (rp2.bad !== -1 || dd.moves.length !== n) mis++;
        if (dd.status === "done"){ done++; if (!res || res.winner !== dd.result.winner) mis++; }
        else if (res) mis++;
      }
    } catch (e){ err += " 例外 " + (e && e.message || e); }
    check("偽の db で" + games + "局（平手3・二枚落ち1）を合法手で" + cap + "手まで：例外なし・記録から並べ直しても全部通る・終局なら記録の勝ちと局面の勝ちが同じ", !err && mis === 0,
      "終局" + done + "局 " + (Date.now() - t0) + "ms" + err);
  })();

  // ===== 8 埋め込み：ページの中の写しが元と同じ =====
  var blk = html.replace(/\r\n/g, "\n").match(/\/\/ ===== FRIENDPLAY-BEGIN[\s\S]*?\/\/ ===== FRIENDPLAY-END =====/);
  check("ページの中の友だち対局の部品は元（shared/friendplay.js）と同じ", !!blk && blk[0] === SRC.replace(/\r\n/g, "\n").replace(/\n+$/, ""));
  check("ページは mode に net・#fpRoot・data-sq の升・持ち駒の hand- を持つ",
    /<option value="net">友だちと対局（オンライン）<\/option>/.test(html) && /id="fpRoot"/.test(html) && /data-sq/.test(html) && /hand-/.test(html) && /SHOGI_ADAPTER/.test(html.split("// ===== LOGIC-END =====")[1]));

  console.log("\n" + (failN ? "❌ " + failN + " 件 落ちた" : "✅ 全部通過") + "（" + pass + " 件）");
  process.exit(failN ? 1 : 0);
}
main().catch(function(e){ console.log("❌ 例外：" + (e && e.stack || e)); process.exit(1); });
