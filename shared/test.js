// 友だち対局の試験：node shared/test.js
// 偽の claude（fake-claude.js）で2人以上が1つの記録を共有する形を作り、オセロの adapter で通しで指す。
// 2026-10-26 Claude（Opus）。
var fs = require("fs"), path = require("path"), vm = require("vm");
var Fake = require("./fake-claude.js");

var ctx = {console: console, setTimeout: setTimeout, Math: Math, Date: Date, Promise: Promise, JSON: JSON, Object: Object, Error: Error};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "friendplay.js"), "utf8") + "\nthis.FriendPlay = FriendPlay;", ctx);
var html = fs.readFileSync(path.join(__dirname, "..", "othello", "index.html"), "utf8");
var logic = html.split("// ===== LOGIC-BEGIN")[1].split("// ===== LOGIC-END =====")[0];
vm.runInContext("//" + logic + "\nthis.A = OTHELLO_ADAPTER; this.legalMoves = legalMoves; this.coordName = coordName; this.winner = winner;", ctx);
var FP = ctx.FriendPlay, A = ctx.A;

var pass = 0, failN = 0;
function check(name, ok){ if (ok){ pass++; console.log("✅ " + name); } else { failN++; console.log("❌ " + name); } }
async function rejects(p, code){ try { await p; return false; } catch (e){ return e && e.code === code; } }

async function main(){
  var store = Fake.makeStore();
  var dbA = await Fake.makeClaude(store, {id: "u_a", canWrite: null}).use("db");
  var dbB = await Fake.makeClaude(store, {id: "u_b", canWrite: null}).use("db");
  var dbC = await Fake.makeClaude(store, {id: "u_c", canWrite: null}).use("db");
  var dbV = await Fake.makeClaude(store, {id: "u_v", canWrite: false}).use("db");
  var a = {key: "u_a"}, b = {key: "u_b"}, c = {key: "u_c"}, v = {key: "u_v"};
  function think(){ store.t += 5000; } // 相手が考える時間（札の期限 3 秒を過ぎる）

  // 作る・入る
  var g1 = await FP.create(dbA, a, A, {side: "first", handicap: ""});
  var d = (await dbA.doc("games/" + g1).get()).data();
  check("作った対局は open・黒の席に作った人・平手なのでレーティングに入る", d.status === "open" && d.seats.first === "u_a" && d.seats.second === null && d.rated === true);
  check("作った人は自分の対局に入れない", await rejects(FP.join(dbA, a, g1, "u_a:t1"), "self"));
  think();
  check("見るだけの人は入れない（invalid_argument）", await rejects(FP.join(dbV, v, g1, "u_v:t1"), "invalid_argument"));
  think();
  var side = await FP.join(dbB, b, g1, "u_b:t1");
  d = (await dbA.doc("games/" + g1).get()).data();
  check("相手は空いている白の席に入り、対局が始まる（入れ子の seats は混ぜて書く）", side === "second" && d.status === "playing" && d.seats.first === "u_a" && d.seats.second === "u_b");
  think();
  check("3人目は入れない（もう始まっている）", await rejects(FP.join(dbC, c, g1, "u_c:t1"), "closed"));

  // 手番と正しさ
  think();
  check("白は黒の番に指せない", await rejects(FP.move(dbB, b, A, g1, "c4", "u_b:t1"), "notturn"));
  think();
  check("打ち手でない人は指せない", await rejects(FP.move(dbC, c, A, g1, "d3", "u_c:t1"), "notplayer"));
  think();
  check("置けない所には指せない", await rejects(FP.move(dbA, a, A, g1, "a1", "u_a:t1"), "illegal"));
  check("座標でない手は指せない（対照）", await rejects(FP.move(dbA, a, A, g1, "z9", "u_a:t1"), "illegal"));
  think();
  await FP.move(dbA, a, A, g1, "d3", "u_a:t1");
  d = (await dbA.doc("games/" + g1).get()).data();
  check("黒の d3 が記録に入る", d.moves.length === 1 && d.moves[0] === "d3");
  think();
  check("黒は続けて指せない", await rejects(FP.move(dbA, a, A, g1, "c3", "u_a:t1"), "notturn"));

  // 同時に2つの窓から同じ人が指しても、記録に入るのは1手だけ（札の取り合い）
  store.tick = 1000; think();
  var r1 = FP.move(dbB, b, A, g1, "c3", "u_b:tabX").then(function(){ return "ok"; }, function(e){ return e.code; });
  var r2 = FP.move(dbB, b, A, g1, "e3", "u_b:tabY").then(function(){ return "ok"; }, function(e){ return e.code; });
  var rr = await Promise.all([r1, r2]);
  d = (await dbA.doc("games/" + g1).get()).data();
  check("2つの窓の同時の手：入るのは1手だけ・もう片方は相手の番と断られる（" + rr.join("／") + "）", d.moves.length === 2 && rr.filter(function(x){ return x === "ok"; }).length === 1 && rr.indexOf("notturn") >= 0);
  store.tick = 0;

  // 最後まで指す（両者とも、合法手の先頭を選ぶ）
  var st = FP.replay(A, d).state, guard = 0;
  while (!st.over && guard++ < 80){
    var mover = A.turn(st) === "first" ? [dbA, a, "u_a:t1"] : [dbB, b, "u_b:t1"];
    var mv = ctx.coordName(ctx.legalMoves(st.board, st.player)[0]);
    think();
    await FP.move(mover[0], mover[1], A, g1, mv, mover[2]);
    d = (await dbA.doc("games/" + g1).get()).data();
    st = FP.replay(A, d).state;
  }
  var w = ctx.winner(st.board), want = w === 1 ? "first" : w === -1 ? "second" : "draw";
  check("最後まで指すと done・勝ちは石の数どおり（" + d.result.text + "）", d.status === "done" && d.result.winner === want && !!d.finishedAt);
  check("パスのある局面も並べ直しで通る（記録の手 " + d.moves.length + "・置いた石 " + (d.moves.length + 4) + "）", FP.replay(A, d).bad === -1);
  think();
  check("終わった対局には指せない", await rejects(FP.move(dbA, a, A, g1, "a1", "u_a:t1"), "closed"));

  // 投了と取り消し
  think();
  var g2 = await FP.create(dbB, b, A, {side: "second", handicap: ""});
  think(); await FP.join(dbA, a, g2, "u_a:t1");
  think(); await FP.resign(dbA, a, g2, "u_a:t1");
  var d2 = (await dbA.doc("games/" + g2).get()).data();
  check("黒（a）が投了すると白（b）の勝ち", d2.status === "done" && d2.result.winner === "second" && d2.result.reason === "resign");
  think();
  var g3 = await FP.create(dbC, c, A, {side: "first", handicap: ""});
  think();
  check("作った人でない人は取り消せない", await rejects(FP.cancel(dbA, a, g3, "u_a:t1"), "notmine"));
  think(); await FP.cancel(dbC, c, g3, "u_c:t1");
  check("作った人は始まる前に取り消せる", !(await dbA.doc("games/" + g3).get()).exists);

  // 記録を書き換えられたら、並べ直しで止まる
  think();
  var g4 = await FP.create(dbA, a, A, {side: "first", handicap: ""});
  think(); await FP.join(dbB, b, g4, "u_b:t1");
  await dbB.doc("games/" + g4).update({moves: ["d3", "a1"]});
  think();
  check("正しくない手が記録にあると、続きは指せない（2手目で止まる）", await rejects(FP.move(dbA, a, A, g4, "c3", "u_a:t1"), "broken"));

  // レーティング
  function G(id, f, s, win, at, rated){ return {id: id, status: "done", rated: rated !== false, seats: {first: f, second: s}, result: {winner: win}, finishedAt: at}; }
  var R = FP.ratings([G("x1", "p", "q", "first", "2026-10-26T10:00:00Z")]);
  check("初めての1局：勝った人 1516・負けた人 1484", Math.round(R.table.p.r) === 1516 && Math.round(R.table.q.r) === 1484 && R.table.p.w === 1 && R.table.q.l === 1);
  R = FP.ratings([G("x1", "p", "q", "draw", "2026-10-26T10:00:00Z")]);
  check("同じ点どうしの引き分けは動かない", R.table.p.r === 1500 && R.table.q.r === 1500 && R.table.p.d === 1);
  R = FP.ratings([G("x2", "q", "p", "first", "2026-10-26T11:00:00Z"), G("x1", "p", "q", "first", "2026-10-26T10:00:00Z")]);
  check("終わった順に数える（並びが逆でも同じ）・1勝1敗でも順番で点が違う", Math.round(R.table.p.r) === 1499 && Math.round(R.table.q.r) === 1501);
  R = FP.ratings([G("x1", "p", "q", "first", "2026-10-26T10:00:00Z", false), G("x3", "p", "p", "first", "2026-10-26T12:00:00Z"),
    {id: "x4", status: "playing", rated: true, seats: {first: "p", second: "q"}, result: null}]);
  check("ハンデ戦・同じ人どうし・まだ終わっていない対局は数えない（対照）", Object.keys(R.table).length === 0);
  R = FP.ratings([]);
  check("対局が無ければ表は空", Object.keys(R.table).length === 0);
  var all = Object.keys(store.docs).filter(function(p){ return p.indexOf("games/") === 0; }).map(function(p){ var x = JSON.parse(JSON.stringify(store.docs[p])); x.id = p.split("/")[1]; return x; });
  R = FP.ratings(all);
  check("記録の上の2局（通しの1局と投了の1局）だけが数えられる", R.table.u_a.n === 2 && R.table.u_b.n === 2 && Math.abs(R.table.u_a.r + R.table.u_b.r - 3000) < 1e-9);

  console.log("\n" + (failN ? "❌ " + failN + " 件 落ちた" : "✅ 全部通過") + "（" + pass + " 件）");
  process.exit(failN ? 1 : 0);
}
main().catch(function(e){ console.log("❌ 例外：" + (e && e.stack || e)); process.exit(1); });
