// 囲碁の友だち対局の試験：node go/test_friendplay.js
// index.html の LOGIC 区間（GO_ADAPTER）と、ページに埋め込んだ部品（FRIENDPLAY-BEGIN〜END）をそのまま読み込み、
// 偽の claude（../shared/fake-claude.js）で2人が1つの記録を共有して通しで打つ。手本＝../shared/test.js（オセロ）。
// 2026-10-26 Claude（Opus）。
var fs = require("fs"), path = require("path"), vm = require("vm");
var Fake = require(path.join(__dirname, "..", "shared", "fake-claude.js"));

var pass = 0, failN = 0;
function check(name, ok, extra){ if (ok){ pass++; console.log("✅ " + name + (extra ? "  " + extra : "")); } else { failN++; console.log("❌ " + name + (extra ? "  " + extra : "")); } }
async function rejects(p, code){ try { await p; return "通った"; } catch (e){ return e && e.code === code ? true : (e && e.code) || String(e); } }

var html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8").replace(/\r\n/g, "\n");
var src = fs.readFileSync(path.join(__dirname, "..", "shared", "friendplay.js"), "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
var fpm = html.match(/\/\/ ===== FRIENDPLAY-BEGIN[\s\S]*?\/\/ ===== FRIENDPLAY-END =====/);
check("ページに部品の写しが1つあり、元（shared/friendplay.js）と同じ", !!fpm && fpm[0] === src && html.split("FRIENDPLAY-BEGIN").length === 2 && html.indexOf("/*FRIENDPLAY*/") < 0);
if (!fpm){ console.log("❌ 部品の写しが無いので止める"); process.exit(1); }

var ctx = {console: console, setTimeout: setTimeout, Math: Math, Date: Date, Promise: Promise, JSON: JSON, Object: Object, Error: Error};
vm.createContext(ctx);
vm.runInContext(fpm[0] + "\nthis.FriendPlay = FriendPlay;", ctx);
var logic = html.split("// ===== LOGIC-BEGIN")[1].split("// ===== LOGIC-END =====")[0];
vm.runInContext("//" + logic + "\nthis.GO = GO_ADAPTER; this.L = {BLACK: BLACK, WHITE: WHITE, PASS: PASS, NN: NN, initState: initState, playMove: playMove," +
  " passMove: passMove, isOver: isOver, legalMoves: legalMoves, libertiesOf: libertiesOf, finalResult: finalResult, coordName: coordName," +
  " chooseMove: chooseMove, defaultKomi: defaultKomi, RULE_KOMI: RULE_KOMI, parseCoord: parseCoord};", ctx);
var FP = ctx.FriendPlay, GO = ctx.GO, L = ctx.L, BLACK = L.BLACK, WHITE = L.WHITE;
function at(r, c){ return r * 9 + c; }
function nm(r, c){ return L.coordName(at(r, c)); }
function J(x){ return JSON.stringify(x); }
// 手の列を adapter で順に打つ。途中で断られたら {bad: 位置}
function seq(st, moves){
  for (var i = 0; i < moves.length; i++){ var ns = GO.play(st, moves[i]); if (!ns) return {st: st, bad: i}; st = ns; }
  return {st: st, bad: -1};
}
function want(r){ return r.winner === BLACK ? "first" : r.winner === WHITE ? "second" : "draw"; }
function noDeadGroup(board){ for (var i = 0; i < 81; i++) if (board[i] !== 0 && L.libertiesOf(board, i) === 0) return false; return true; }

async function main(){
  // ---- 1 adapter の形：ルール・置き石・呼び名 ----
  var sel = function(id){ var m = html.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>')); return m ? m[1] : ""; };
  var ruleOpts = [], rm, re = /<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g, rs = sel("rule");
  while ((rm = re.exec(rs))) ruleOpts.push({id: rm[1], label: rm[3], selected: !!rm[2]});
  var mine = GO.rules.map(function(r){ return r.id + "=" + r.label; }).sort().join(",");
  check("rules の id と表示は本対局の「数え方」と同じ3つ（" + mine + "）", mine === ruleOpts.map(function(r){ return r.id + "=" + r.label; }).sort().join(",") && GO.rules.length === 3);
  check("rules の先頭（既定）は本対局の初期値と同じ中国ルール", GO.rules[0].id === "area" && ruleOpts.filter(function(r){ return r.selected; })[0].id === "area");
  var hs = sel("handi"), hloc = [], hm2; re = /<option value="([^"]*)"/g; while ((hm2 = re.exec(hs))) hloc.push(hm2[1]);
  check("handicaps は先頭が平手（id \"\"）・続いて本対局と同じ 2〜5子", J(GO.handicaps.map(function(h){ return h.id; })) === J(["", "2", "3", "4", "5"]) && J(hloc) === J(["0", "2", "3", "4", "5"]));
  check("sideLabel：平手は 黒（先番）／白、置き石は 黒（置き石 n子）／白",
    GO.sideLabel("first", "", "area") === "黒（先番）" && GO.sideLabel("second", "", "area") === "白" &&
    GO.sideLabel("first", "3", "japan") === "黒（置き石 3子）" && GO.sideLabel("second", "3", "japan") === "白");
  var names = [], round = true;
  for (var i = 0; i < 81; i++){ names.push(L.coordName(i)); if (L.parseCoord(L.coordName(i)) !== i) round = false; }
  check("手の呼び名＝coordName（81点が全部違う・呼び名→点→呼び名が戻る）", round && new Set(names).size === 81);
  check("呼び名の決まり：列 A〜J で I を飛ばす・行は下から 1〜9（天元 E5・左上 A9・右下 J1・左下 A1）",
    names.every(function(s){ return /^[A-HJ][1-9]$/.test(s); }) && names.join("").indexOf("I") < 0 &&
    nm(4, 4) === "E5" && nm(0, 0) === "A9" && nm(8, 8) === "J1" && nm(8, 0) === "A1");
  check("画面：盤の点に data-sq＝coordName・パスのボタンに data-sq=\"pass\"・mode に「友だちと対局（オンライン）」",
    html.indexOf('setAttribute("data-sq", coordName(') > 0 && html.indexOf('<button id="pass" data-sq="pass">') > 0 &&
    html.indexOf('<option value="net">友だちと対局（オンライン）</option>') > 0 && html.indexOf('id="fpRoot"') > 0);
  check("画面：手は記録へ送るだけ（net.submit(coordName(idx))・net.submit(\"pass\")）・部品に GO_ADAPTER を渡す",
    html.indexOf("net.submit(coordName(idx))") > 0 && html.indexOf('net.submit("pass")') > 0 && html.indexOf("FriendPlay.mount({adapter: GO_ADAPTER") > 0);

  // ---- 2 置き石とルールごとの初期局面・手番・コミ（本対局の initState・defaultKomi と同じ）----
  ["", "2", "3", "4", "5"].forEach(function(h){
    var n = +h || 0, ok = true, info = [];
    ["area", "stone", "japan"].forEach(function(r){
      var st = GO.initial(h, r);
      var same = J(st.board) === J(L.initState(n).board) && st.player === L.initState(n).player;
      var good = same && GO.turn(st) === (n ? "second" : "first") && st.komi === L.defaultKomi(r, n) && st.rule === r &&
        st.passes === 0 && st.capB === 0 && st.capW === 0 && st.passed === 0 && GO.result(st) === null;
      if (!good) ok = false;
      info.push(r + ":" + st.komi);
    });
    check((n ? n + "子：黒石は本対局と同じ星・白から・コミ0" : "平手：空の盤・黒から・コミは中国7 純碁7 日本6.5") + "（" + info.join(" ") + "）", ok);
  });
  var f1 = GO.initial("", ""), f2 = GO.initial("", "xyz"), f3 = GO.initial("1", "area"), f4 = GO.initial("6", "japan");
  check("知らないルールは中国ルールに・範囲外の置き石（1・6）は置かない（本対局の handiPoints と同じ）",
    f1.rule === "area" && f1.komi === 7 && f2.rule === "area" && GO.turn(f3) === "first" && f3.board.every(function(v){ return v === 0; }) && GO.turn(f4) === "first" && f4.komi === 6.5);

  // ---- 3 手の正しさ（禁じ手の判定は本対局の playMove のまま）----
  var s0 = GO.initial("", "area");
  var cap = seq(s0, [nm(3,4), nm(4,4), nm(5,4), nm(0,8), nm(4,3), nm(0,7), nm(4,5)]);
  check("石を取る：E5 の白1子を黒が F5 で取る（アゲハマ 黒1）", cap.bad < 0 && cap.st.board[at(4,4)] === 0 && cap.st.capB === 1 && cap.st.last === at(4,5) && cap.st.passed === 0);
  check("石のある所には打てない", GO.play(cap.st, nm(3,4)) === null && GO.play(cap.st, nm(0,8)) === null);
  var sui = seq(s0, ["J1", "B9", "H1", "A8"]);
  check("自殺手（隅の A9・四方が白と盤の端）は断る＝本対局の playMove と同じ", sui.bad < 0 && GO.play(sui.st, "A9") === null && L.playMove(sui.st, at(0,0)) === null);
  var ko = seq(s0, [nm(3,4), nm(4,4), nm(5,4), nm(3,3), nm(4,5), nm(5,3), "J1", nm(4,2), nm(4,3)]);
  check("コウ：黒が D5 で E5 の1子を取ると、白はすぐ E5 に取り返せない", ko.bad < 0 && ko.st.ko === at(4,4) && ko.st.board[at(4,4)] === 0 && GO.play(ko.st, "E5") === null);
  var ko2 = seq(ko.st, ["J9", "A1", "E5"]);
  check("コウ：1手ずつ別の所に打てば取り返せる（白のアゲハマ1）", ko2.bad < 0 && ko2.st.board[at(4,3)] === 0 && ko2.st.board[at(4,4)] === WHITE && ko2.st.capW === 1);
  var badShapes = ["e5", "I5", "Z1", "A10", "A0", "E05", " E5", "E5 ", "", "PASS", "Pass", "pass ", "resign", null, undefined, 42, {}, ["E5"]];
  var shapeOk = badShapes.every(function(m){ return GO.play(s0, m) === null && GO.play(cap.st, m) === null; });
  check("形の違う手（小文字・I・範囲外・空白つき・PASS・数・配列など " + badShapes.length + " 種）は断る", shapeOk);

  // ---- 4 パス：passed（直前にパスした色）・2回続けて終局 ----
  var p1 = GO.play(s0, "pass");
  check("黒のパス：passed＝黒・白の番・まだ終わらない・盤は同じ形の写し", p1 && p1.passed === BLACK && p1.passes === 1 && GO.turn(p1) === "second" && GO.result(p1) === null && J(p1.board) === J(s0.board) && p1.board !== s0.board && p1.last === -1);
  var p2 = GO.play(p1, "E5");
  check("パスのあとに石を打つと passed は 0・パスの数も 0", p2 && p2.passed === 0 && p2.passes === 0 && GO.turn(p2) === "first");
  var p3 = GO.play(GO.play(p2, "pass"), "pass");
  check("2回続けてパスで終局（passed＝あとからパスした白）", p3 && L.isOver(p3) && p3.passed === WHITE && GO.result(p3) !== null);
  check("終わった局面には石もパスも打てない", GO.play(p3, "A1") === null && GO.play(p3, "pass") === null);
  check("黒・白・黒とパスしても、間に石があれば終わらない（続けて2回だけが終局）", (function(){ var x = seq(s0, ["pass", "E5", "pass"]); return x.bad < 0 && !L.isOver(x.st) && GO.result(x.st) === null; })());

  // ---- 5 終局の数え方：本対局の finalResult（死に石なし＝盤の石は全部生き）と同じ ----
  function wall(cb, cw){ var mv = []; for (var r = 0; r < 9; r++){ mv.push(nm(r, cb)); mv.push(nm(r, cw)); } return mv.concat(["pass", "pass"]); }
  var FIG = [
    {name: "図A（黒の壁 E・白の壁 F）", h: "", moves: wall(4, 5), exp: {area: [45, 36, "first", 2], japan: [36, 27, "first", 2.5], stone: [9, 9, "second", 7]}},
    {name: "図C（ダメ9点：黒の壁 D・白の壁 F）", h: "", moves: wall(3, 5), exp: {area: [36, 36, "second", 7], japan: [27, 27, "second", 6.5], stone: [9, 9, "second", 7]}},
    // 2子（G7・C3＝日本棋院の1図の順。2026-10-26 に前の G3・C7 から直し、手順は上下を鏡に写した）。
    // 白は G7 の黒を取ってから F の壁、黒は E の壁。白の陣に白石が3つ（日本ルールでは1つ1目減る）
    {name: "置き石2子の図（白が G7 の置き石を取る・コミ0）", h: "2",
      moves: [nm(2,5), nm(8,4), nm(3,6), nm(7,4), nm(1,6), nm(6,4), nm(2,7), nm(5,4), nm(8,5), nm(4,4), nm(7,5), nm(3,4), nm(6,5), nm(2,4),
        nm(5,5), nm(1,4), nm(4,5), nm(0,4), nm(3,5), "pass", nm(1,5), "pass", nm(0,5), "pass", "pass"],
      exp: {area: [45, 36, "first", 9], japan: [35, 25, "first", 10], stone: [10, 12, "second", 2]}}
  ];
  FIG.forEach(function(f){
    ["area", "japan", "stone"].forEach(function(rule){
      var x = seq(GO.initial(f.h, rule), f.moves), e = f.exp[rule], res = x.bad < 0 ? GO.result(x.st) : null;
      var fr = x.bad < 0 ? L.finalResult(x.st.board, null, rule, {komi: L.defaultKomi(rule, +f.h || 0), capB: x.st.capB, capW: x.st.capW}) : null;
      var ok = res && fr && fr.b === e[0] && fr.w === e[1] && res.winner === e[2] && res.winner === want(fr) && Math.abs(fr.margin) === e[3] &&
        res.text.indexOf("黒 " + e[0] + " − 白 " + e[1]) >= 0 && res.text.indexOf(e[3] + "目差") >= 0 && res.text.indexOf("全部生き") >= 0;
      check(f.name + "・" + rule + "：黒 " + e[0] + " − 白 " + e[1] + " → " + e[2] + "（" + e[3] + "目差）", ok, res ? "「" + res.text + "」" : "手 " + (x.bad + 1) + " が断られた");
    });
  });
  var dz = GO.initial("2", "stone"), drawSt = {};
  for (var k in dz) drawSt[k] = dz[k];
  drawSt.board = new Array(81).fill(0); for (var r = 0; r < 9; r++){ drawSt.board[at(r,4)] = BLACK; drawSt.board[at(r,5)] = WHITE; } drawSt.passes = 2;
  var dres = GO.result(drawSt);
  check("差が0（置き石・コミ0・純碁 9対9）は draw（本対局の finalResult の winner 0＝引き分けのまま）", dres && dres.winner === "draw" && dres.text.indexOf("目差") < 0, dres && dres.text);

  // ---- 6 play は入力の局面を書き換えない（前後の JSON 比較）----
  var states = [s0, GO.initial("3", "japan"), cap.st, ko.st, sui.st, p1, p3], tries = names.concat(["pass"]).concat(badShapes), pure = true, fresh = true, cnt = 0;
  states.forEach(function(st){
    var before = J(st);
    tries.forEach(function(m){ var ns = GO.play(st, m); cnt++; if (ns && (ns === st || ns.board === st.board)) fresh = false; });
    GO.turn(st); GO.result(st);
    if (J(st) !== before) pure = false;
  });
  check("play・turn・result は入力の局面を書き換えない（" + states.length + " 局面 × " + tries.length + " 手＝" + cnt + " 回）", pure);
  check("play が返す局面は、入力と盤を共有しない（パスも写す）", fresh);

  // ---- 7 偽の db で通し：作る（ルールと置き石つき）→入る→打つ→投了 ----
  var store = Fake.makeStore();
  var dbA = await Fake.makeClaude(store, {id: "u_a"}).use("db");
  var dbB = await Fake.makeClaude(store, {id: "u_b"}).use("db");
  var dbC = await Fake.makeClaude(store, {id: "u_c"}).use("db");
  var a = {key: "u_a"}, b = {key: "u_b"}, c = {key: "u_c"};
  function think(){ store.t += 5000; } // 相手が考える時間（札の期限 3 秒を過ぎる）
  async function doc(g){ return (await dbA.doc("games/" + g).get()).data(); }
  async function mv(who, g, m){ think(); return FP.move(who === a ? dbA : dbB, who, GO, g, m, who.key + ":t1"); }

  var g1 = await FP.create(dbA, a, GO, {side: "first", handicap: "3", rule: "japan"});
  var d = await doc(g1);
  check("置き石3子・日本ルールで作る：記録に rule と handicap・ハンデ戦なのでレーティングに入れない", d.status === "open" && d.rule === "japan" && d.handicap === "3" && d.rated === false && d.seats.first === "u_a" && d.game === "go9");
  think(); var side = await FP.join(dbB, b, g1, "u_b:t1");
  check("相手は白の席に入る", side === "second" && (await doc(g1)).status === "playing");
  var rj = await rejects(mv(a, g1, "E5"), "notturn");
  check("置き石の対局：黒（作った人）は最初に打てない＝白から", rj === true, String(rj));
  await mv(b, g1, "E5");
  d = await doc(g1);
  var rp = FP.replay(GO, d);
  check("白の E5 が記録に入り、並べ直すと 置き石3つ＋白1つ・黒の番・コミ0・日本ルール", J(d.moves) === J(["E5"]) && rp.bad === -1 &&
    rp.state.board.filter(function(v){ return v === BLACK; }).length === 3 && rp.state.board[at(4,4)] === WHITE && GO.turn(rp.state) === "first" && rp.state.komi === 0 && rp.state.rule === "japan");
  think(); await FP.resign(dbB, b, g1, "u_b:t1");
  d = await doc(g1);
  check("白が投了すると黒の勝ち", d.status === "done" && d.result.winner === "first" && d.result.reason === "resign");

  // 平手（中国ルール）：取る手・断られる手・2回パスで終局
  think(); var g2 = await FP.create(dbA, a, GO, {side: "first", handicap: "", rule: "area"});
  think(); await FP.join(dbB, b, g2, "u_b:t1");
  var capSeq = [nm(3,4), nm(4,4), nm(5,4), nm(0,8), nm(4,3), nm(0,7), nm(4,5)];
  for (var q = 0; q < capSeq.length; q++) await mv(q % 2 ? b : a, g2, capSeq[q]);
  d = await doc(g2); rp = FP.replay(GO, d);
  check("石を取る手が記録から並べ直しても通り、直接打った局面と同じ（アゲハマ 黒1）", rp.bad === -1 && J(rp.state) === J(cap.st) && rp.state.capB === 1 && rp.state.board[at(4,4)] === 0);
  rj = await rejects(mv(a, g2, "J8"), "notturn");
  check("相手の番の手は断る（notturn）", rj === true, String(rj));
  think(); rj = await rejects(FP.move(dbC, c, GO, g2, "J8", "u_c:t1"), "notplayer");
  check("打ち手でない人の手は断る（notplayer）", rj === true, String(rj));
  var shapeRes = [];
  for (var s of ["e5", "I5", "A10", "", "PASS"]) shapeRes.push(await rejects(mv(b, g2, s), "illegal"));
  check("形の違う手（e5・I5・A10・空・PASS）は断る（illegal）", shapeRes.every(function(x){ return x === true; }), shapeRes.join(","));
  rj = await rejects(mv(b, g2, nm(3,4)), "illegal");
  check("石のある所への手は断る（illegal）", rj === true, String(rj));
  check("断られた手は記録に入らない（手数 7 のまま）", (await doc(g2)).moves.length === 7);

  think(); var g3 = await FP.create(dbB, b, GO, {side: "second", handicap: "", rule: "stone"});
  think(); await FP.join(dbA, a, g3, "u_a:t1");
  var koSeq = [nm(3,4), nm(4,4), nm(5,4), nm(3,3), nm(4,5), nm(5,3), "J1", nm(4,2), nm(4,3)];
  for (q = 0; q < koSeq.length; q++) await mv(q % 2 ? b : a, g3, koSeq[q]);
  rj = await rejects(mv(b, g3, "E5"), "illegal");
  check("コウ：記録を通しても、白はすぐ E5 に取り返せない（illegal）", rj === true, String(rj));
  await mv(b, g3, "J9"); await mv(a, g3, "A1"); await mv(b, g3, "E5");
  d = await doc(g3); rp = FP.replay(GO, d);
  check("コウ：1手ずつ別の所に打てば取り返せる（白のアゲハマ1）", rp.bad === -1 && rp.state.capW === 1 && rp.state.board[at(4,3)] === 0);
  await mv(a, g3, "H1"); await mv(b, g3, "B9"); await mv(a, g3, "G1"); await mv(b, g3, "A8");
  rj = await rejects(mv(a, g3, "A9"), "illegal");
  check("自殺手（A9）は記録を通しても断る（illegal）", rj === true, String(rj));
  await mv(a, g3, "pass");
  d = await doc(g3); rp = FP.replay(GO, d);
  check("黒のパスが記録に入る：passed＝黒・白の番・まだ対局中", d.status === "playing" && d.moves[d.moves.length - 1] === "pass" && rp.state.passed === BLACK && GO.turn(rp.state) === "second");
  await mv(b, g3, "pass");
  d = await doc(g3); rp = FP.replay(GO, d);
  var exp3 = GO.result(rp.state);
  check("2回続けてパスで done・勝ちと text は adapter の数え方どおり（" + d.result.text + "）", d.status === "done" && d.result.reason === "end" && !!d.finishedAt &&
    d.result.winner === exp3.winner && d.result.text === exp3.text && d.result.text.indexOf("純碁") === 0);
  rj = await rejects(mv(a, g3, "C3"), "closed");
  check("終わった対局には打てない（closed）", rj === true, String(rj));

  // 3つのルールそれぞれ：図A を記録で打って2回パス → 既存の数え方と同じ結果
  for (var rule of ["area", "japan", "stone"]){
    think(); var gf = await FP.create(dbA, a, GO, {side: "first", handicap: "", rule: rule});
    think(); await FP.join(dbB, b, gf, "u_b:t1");
    var wm = wall(4, 5);
    for (q = 0; q < wm.length; q++) await mv(q % 2 ? b : a, gf, wm[q]);
    d = await doc(gf); rp = FP.replay(GO, d);
    var e = FIG[0].exp[rule], fr = L.finalResult(rp.state.board, null, rule, {komi: L.defaultKomi(rule, 0), capB: rp.state.capB, capW: rp.state.capW});
    check("記録で図A・" + rule + "：done・黒 " + e[0] + " − 白 " + e[1] + "・" + e[2] + " の勝ち（" + d.result.text + "）",
      d.status === "done" && d.result.winner === e[2] && d.result.winner === want(fr) && fr.b === e[0] && fr.w === e[1]);
  }

  // 合法手を選び続けて2回パスまで（記録を通して・上限つき）：ルールと置き石の組を3つ
  var combos = [["", "area"], ["3", "japan"], ["5", "stone"]], natural = 0, errs = "", lens = [];
  try {
    for (var ci = 0; ci < combos.length; ci++){
      think(); var gr = await FP.create(dbA, a, GO, {side: "first", handicap: combos[ci][0], rule: combos[ci][1]});
      think(); await FP.join(dbB, b, gr, "u_b:t1");
      d = await doc(gr); var st = FP.replay(GO, d).state, steps = 0;
      while (d.status === "playing" && steps < 260){
        var who = GO.turn(st) === "first" ? a : b, m;
        if (Math.random() < 0.25){ var lm = L.legalMoves(st); m = lm.length ? L.coordName(lm[(Math.random() * lm.length) | 0]) : "pass"; }
        else { var cm = L.chooseMove(st, "weak"); m = cm === L.PASS ? "pass" : L.coordName(cm); }
        await mv(who, gr, m); steps++;
        d = await doc(gr); st = FP.replay(GO, d).state;
      }
      if (d.status === "done") natural++;
      while (d.status === "playing"){ await mv(GO.turn(st) === "first" ? a : b, gr, "pass"); d = await doc(gr); st = FP.replay(GO, d).state; }
      rp = FP.replay(GO, d);
      if (rp.bad !== -1 || d.result.winner !== GO.result(rp.state).winner || d.result.text !== GO.result(rp.state).text) errs += " 結果が並べ直しと違う(" + ci + ")";
      lens.push(d.moves.length);
    }
  } catch (ex){ errs += " 例外：" + (ex && ex.stack || ex); }
  check("合法手を選び続けて2回パスまで、記録を通して例外なし・結果は並べ直しと同じ（3局）", !errs, "手数 " + lens.join("／") + "・上限前に自然に終局 " + natural + "／3" + errs);

  // レーティング：平手で終わった対局だけ（置き石の対局 g1 は入れない）
  var all = Object.keys(store.docs).filter(function(p){ return p.indexOf("games/") === 0; }).map(function(p){ var x = JSON.parse(J(store.docs[p])); x.id = p.split("/")[1]; return x; });
  var R = FP.ratings(all), done = all.filter(function(g){ return g.status === "done"; }), ratedDone = done.filter(function(g){ return g.rated; });
  check("レーティング：数えるのは平手の終局だけ（終局 " + done.length + "・うち平手 " + ratedDone.length + "）", R.table.u_a && R.table.u_a.n === ratedDone.length && R.table.u_b.n === ratedDone.length && !R.delta[g1]);

  // ---- 8 adapter だけで大量に：置き石5通り × ルール3つ × 2局（不変条件つき）----
  var games = 0, nat = 0, ok8 = true, why = "";
  for (var h of ["", "2", "3", "4", "5"]) for (var rl of ["area", "japan", "stone"]) for (var t = 0; t < 2; t++){
    var x = GO.initial(h, rl), n8 = 0; games++;
    while (!L.isOver(x) && n8 < 400){
      var m8;
      if (Math.random() < 0.25){ var lm8 = L.legalMoves(x); m8 = lm8.length ? L.coordName(lm8[(Math.random() * lm8.length) | 0]) : "pass"; }
      else { var c8 = L.chooseMove(x, "weak"); m8 = c8 === L.PASS ? "pass" : L.coordName(c8); }
      var nx = GO.play(x, m8);
      if (!nx){ ok8 = false; why = "合法のはずの手 " + m8 + " が断られた"; break; }
      if (GO.turn(nx) === GO.turn(x)){ ok8 = false; why = "手番が変わらない"; break; }
      if (!noDeadGroup(nx.board)){ ok8 = false; why = "呼吸点0の連が残った"; break; }
      x = nx; n8++;
    }
    if (!ok8) break;
    if (L.isOver(x)){
      nat++;
      var r8 = GO.result(x), f8 = L.finalResult(x.board, null, rl, {komi: L.defaultKomi(rl, +h || 0), capB: x.capB, capW: x.capW});
      if (!r8 || r8.winner !== want(f8)){ ok8 = false; why = "結果が finalResult と違う"; break; }
    }
  }
  check("adapter だけで " + games + " 局：合法手は断られない・手番は毎手交代・呼吸点0の連は残らない・結果は finalResult と同じ", ok8, "上限400手の前に2回パスで終局 " + nat + "／" + games + " " + why);

  console.log("\n" + (failN ? "❌ " + failN + " 件 落ちた" : "✅ 全部通過") + "（" + pass + " 件）");
  process.exit(failN ? 1 : 0);
}
main().catch(function(e){ console.log("❌ 例外：" + (e && e.stack || e)); process.exit(1); });
