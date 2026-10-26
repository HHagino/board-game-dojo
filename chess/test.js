// node test.js ： index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込んで検査する（コピーではない）
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.log("NG: ロジックの区間が見つからない"); process.exit(1); }
const L = new Function(m[0] + "\nreturn {WHITE,BLACK,fromFEN,startState,legalMoves,makeMove,inCheck,perft,findMove,san,posKey,gameResult,chooseMove,sqOf,sqName,insufficient,handicapFEN,handicapState,FIGS,figInfo,PRACTICE,judgePractice};")();
const {WHITE, BLACK} = L;
let fail = 0;
function check(name, ok, extra) { console.log((ok ? "OK  " : "NG  ") + name + (extra ? "  " + extra : "")); if (!ok) fail++; }
const FAST = process.argv.includes("--fast");

// 1 perft
function pf(name, fen, expected) {
  const s = L.fromFEN(fen);
  for (const [d, e] of expected) {
    const t0 = Date.now(); const n = L.perft(s, d);
    check("perft " + name + " depth" + d + " = " + e, n === e, "得た=" + n + " (" + (Date.now() - t0) + "ms)");
  }
}
pf("初期局面", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", [[1,20],[2,400],[3,8902],[4,197281]]);
pf("Kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [[1,48],[2,2039],[3,97862]]);
pf("position3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [[1,14],[2,191],[3,2812],[4,43238]]);
// 追加の標準（position 4・5）
pf("position4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [[1,6],[2,264],[3,9467]]);
pf("position5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [[1,44],[2,1486],[3,62379]]);

// 2 詰み・ステイルメイト・特殊手
function play(s, list) { for (const mv of list) { const f = L.sqOf(mv.slice(0,2)), t = L.sqOf(mv.slice(2,4)); const p = mv[4] ? {q:5,r:4,b:3,n:2}[mv[4]] : 0; const x = L.findMove(s, f, t, p); if (!x) throw new Error("非合法 " + mv); s = L.makeMove(s, x); } return s; }
{
  let s = L.startState(), sans = [];
  for (const mv of ["f2f3","e7e5","g2g4","d8h4"]) {
    const f = L.sqOf(mv.slice(0,2)), t = L.sqOf(mv.slice(2,4)); const x = L.findMove(s, f, t, 0);
    sans.push(L.san(s, x)); s = L.makeMove(s, x);
  }
  const r = L.gameResult(s, [L.posKey(s)]);
  check("愚者のメイト：詰み・黒の勝ち・王手中", r && r.kind === "mate" && r.winner === BLACK && L.inCheck(s), sans.join(" "));
  check("愚者のメイト：最後の手の棋譜が Qh4#", sans[3] === "Qh4#");
}
{
  const s = L.fromFEN("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  const r = L.gameResult(s, [L.posKey(s)]);
  check("ステイルメイト：引き分け・王手ではない", r && r.kind === "stalemate" && r.winner === 0 && !L.inCheck(s));
}
{
  let s = L.fromFEN("rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  s = play(s, ["e2e4"]);
  const ep = L.legalMoves(s).filter(x => x.e);
  check("アンパッサン：d4 の黒ポーンが e3 に取れる", ep.length === 1 && L.sqName(ep[0].t) === "e3");
  const s2 = L.makeMove(s, ep[0]);
  check("アンパッサン：取られた白ポーン(e4)が消える", s2.b[L.sqOf("e4")] === 0 && s2.b[L.sqOf("e3")] === -1);
  check("アンパッサン：棋譜 dxe3", L.san(s, ep[0]) === "dxe3");
  const s3 = play(s, ["a7a6"]);
  check("アンパッサン：1手遅れると権利が消える", L.legalMoves(L.makeMove(L.fromFEN("rnbqkbnr/1pp1pppp/p7/8/3pP3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1"), L.findMove(L.fromFEN("rnbqkbnr/1pp1pppp/p7/8/3pP3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1"), L.sqOf("a2"), L.sqOf("a3"), 0))).filter(x => x.e).length === 0);
}
{
  const s = L.fromFEN("1n5k/P7/8/8/8/8/8/K7 w - - 0 1");
  const pm = L.legalMoves(s).filter(x => x.p);
  check("昇格：a8 へ4種＋b8 取りで4種＝8手", pm.length === 8, "得た=" + pm.length);
  const x = L.findMove(s, L.sqOf("a7"), L.sqOf("a8"), 2); const s2 = L.makeMove(s, x);
  check("昇格：ナイトを選ぶと a8 が白ナイト・棋譜 a8=N", s2.b[L.sqOf("a8")] === 2 && L.san(s, x) === "a8=N+" || L.san(s, x) === "a8=N", L.san(s, x));
  const y = L.findMove(s, L.sqOf("a7"), L.sqOf("b8"), 5);
  check("昇格：取りながらクイーン bxは axb8=Q", y && L.san(s, y).startsWith("axb8=Q"), y && L.san(s, y));
}
{
  const open = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
  const cs = x => L.legalMoves(L.fromFEN(x)).filter(m => m.cs).map(m => m.cs).sort().join();
  check("キャスリング：両側できる", cs(open) === "1,2");
  check("キャスリング：黒番でも両側", cs("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1") === "1,2");
  check("キャスリング：f1 に利きがあると K 側は不可（Q 側は可）", cs("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1") === "2");
  check("キャスリング：王手中は不可", cs("4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1") === "");
  check("キャスリング：b1 だけ利きがあっても Q 側は可", cs("1r4k1/8/8/8/8/8/8/R3K2R w KQ - 0 1") === "1,2");
  check("キャスリング：d1 に利きで Q 側不可", cs("3r2k1/8/8/8/8/8/8/R3K2R w KQ - 0 1") === "1");
  check("キャスリング：間に駒があると不可", cs("r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1") === "1");
  const s = L.fromFEN(open); const k = L.findMove(s, 4, 6, 0); const s2 = L.makeMove(s, k);
  check("キャスリング：実行後 ルークが f1・王が g1・権利が消える・棋譜 O-O", s2.b[5] === 4 && s2.b[6] === 6 && s2.b[7] === 0 && (s2.c & 3) === 0 && L.san(s, k) === "O-O");
  const s3 = play(L.fromFEN(open), ["h1h2","a8a7","h2h1","a7a8"]);
  check("キャスリング：ルークを動かすと K 側の権利が消える", L.legalMoves(s3).filter(x => x.cs).map(x => x.cs).join() === "2");
}
{
  const f = "4k3/8/8/8/8/8/4P3/4K3 w - - 100 80";
  const r = L.gameResult(L.fromFEN(f), []);
  check("50手ルール：半手100で引き分け", r && r.kind === "fifty");
  check("50手ルール：半手99ではまだ", L.gameResult(L.fromFEN("4k3/8/8/8/8/8/4P3/4K3 w - - 99 80"), []) === null);
  check("駒不足：K対K", L.gameResult(L.fromFEN("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), []).kind === "material");
  check("駒不足：K+B対K", L.gameResult(L.fromFEN("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1"), []).kind === "material");
  check("駒不足：K+N対K（黒側）", L.gameResult(L.fromFEN("4k3/8/8/8/8/8/8/4K1n1 w - - 0 1"), []).kind === "material");
  check("駒不足でない：K+P対K", L.gameResult(L.fromFEN("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"), []) === null);
  check("駒不足でない：K+N+N対K", L.gameResult(L.fromFEN("4k3/8/8/8/8/8/8/3NKN2 w - - 0 1"), []) === null);
  check("駒不足でない：K+R対K", L.gameResult(L.fromFEN("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"), []) === null);
  // 2026-10-26 python-chess との突き合わせで見つかった（同じ色の升のビショップどうしを続けていた）＝再発を防ぐ
  check("駒不足：K+B対K+B（同じ色の升＝c1 と f8 は暗い升）", (L.gameResult(L.fromFEN("5b2/4k3/8/8/8/8/8/2B1K3 w - - 0 1"), []) || {}).kind === "material");
  check("駒不足：K+B+B対K（同じ色の升＝c1 と e3）", (L.gameResult(L.fromFEN("4k3/8/8/8/8/4B3/8/2B1K3 w - - 0 1"), []) || {}).kind === "material");
  check("駒不足でない：K+B対K+B（違う色の升＝c1 と c8）", L.gameResult(L.fromFEN("2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1"), []) === null);
  check("駒不足でない：K+B対K+N", L.gameResult(L.fromFEN("4k1n1/8/8/8/8/8/8/2B1K3 w - - 0 1"), []) === null);
}
{
  let s = L.startState(), keys = [L.posKey(s)], res = null, at = -1;
  const seq = ["g1f3","g8f6","f3g1","f6g8","g1f3","g8f6","f3g1","f6g8"];
  for (let i = 0; i < seq.length; i++) {
    s = play(s, [seq[i]]); keys.push(L.posKey(s)); res = L.gameResult(s, keys); if (res && at < 0) at = i + 1;
  }
  check("同一局面3回：8手目（初期局面の3回目）で引き分け", res && res.kind === "repetition" && at === 8, "手=" + at);
  const s2 = play(L.startState(), ["g1f3","g8f6","f3g1","f6g8"]);
  check("同一局面3回：2回目ではまだ続く", L.gameResult(s2, [L.posKey(L.startState()), L.posKey(s2)]) === null);
}
{
  let s = L.startState(); const names = [];
  for (const mv of ["e2e4","e7e5","g1f3","b8c6","f1b5","a7a6","b5a4","g8f6","e1g1"]) {
    const x = L.findMove(s, L.sqOf(mv.slice(0,2)), L.sqOf(mv.slice(2,4)), 0); names.push(L.san(s, x)); s = L.makeMove(s, x);
  }
  check("棋譜：e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O", names.join(" ") === "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O", names.join(" "));
  const t = L.fromFEN("7k/8/8/8/8/8/8/R3R1K1 w - - 0 1");
  const a = L.findMove(t, L.sqOf("a1"), L.sqOf("c1"), 0);
  check("棋譜：同じ段のルークは筋で区別（Rac1）", L.san(t, a) === "Rac1", L.san(t, a));
  const u = L.fromFEN("4k3/8/8/R7/8/8/8/R3K3 w - - 0 1");
  const c = L.findMove(u, L.sqOf("a1"), L.sqOf("a3"), 0);
  check("棋譜：同じ筋のルークは段で区別（R1a3）", L.san(u, c) === "R1a3", L.san(u, c));
}

// 3 ランダム対ランダム
function playGame(cfgW, cfgB, maxPlies) {
  let s = L.startState(), keys = [L.posKey(s)], plies = 0, res;
  const kinds = {};
  while (!(res = L.gameResult(s, keys))) {
    const cfg = s.t === WHITE ? cfgW : cfgB;
    const mv = L.chooseMove(s, cfg.level, Object.assign({keys}, cfg.opts));
    if (!mv) throw new Error("合法手があるのに null");
    const legal = L.legalMoves(s);
    if (!legal.some(x => x.f === mv.f && x.t === mv.t && x.p === mv.p)) throw new Error("非合法手");
    s = L.makeMove(s, mv); keys.push(L.posKey(s)); plies++;
    if (plies > maxPlies) throw new Error("手数が多すぎる " + maxPlies);
  }
  return {res, plies, s};
}
{
  let ok = true, err = "", kinds = {}, maxP = 0;
  try {
    for (let g = 0; g < 50; g++) {
      const r = playGame({level: "weak"}, {level: "weak"}, 3000);
      kinds[r.res.kind] = (kinds[r.res.kind] || 0) + 1; maxP = Math.max(maxP, r.plies);
    }
  } catch (e) { ok = false; err = String(e); }
  check("ランダム対ランダム50局：全部終局・非合法手なし・例外なし", ok, JSON.stringify(kinds) + " 最長" + maxP + "手 " + err);
}

// 4 強 vs 弱
{
  const maxDepth = FAST ? 2 : 3;
  let sw = 0, ww = 0, dr = 0, kinds = {};
  const S = {level: "strong", opts: {maxDepth, timeMs: Infinity}}, Wk = {level: "weak"};
  const t0 = Date.now();
  for (let g = 0; g < 10; g++) {
    const sWhite = g % 2 === 0;
    const r = playGame(sWhite ? S : Wk, sWhite ? Wk : S, 1000);
    kinds[r.res.kind] = (kinds[r.res.kind] || 0) + 1;
    if (r.res.winner === 0) dr++; else if ((r.res.winner === WHITE) === sWhite) sw++; else ww++;
  }
  check("強(深さ" + maxDepth + ") vs 弱 10局で強の勝ちが多い", sw > ww, "強" + sw + " 弱" + ww + " 分" + dr + " " + JSON.stringify(kinds) + " " + ((Date.now() - t0) / 1000).toFixed(0) + "秒");
}
{
  let mw = 0, ww = 0, dr = 0;
  for (let g = 0; g < 10; g++) {
    const mWhite = g % 2 === 0;
    const r = playGame(mWhite ? {level: "mid"} : {level: "weak"}, mWhite ? {level: "weak"} : {level: "mid"}, 1000);
    if (r.res.winner === 0) dr++; else if ((r.res.winner === WHITE) === mWhite) mw++; else ww++;
  }
  check("ふつう vs 弱 10局でふつうの勝ちが多い", mw > ww, "ふつう" + mw + " 弱" + ww + " 分" + dr);
}

// 5 強の1手の時間（実際の設定：700ms 打ち切り・既定の深さ）
{
  const times = [], depthInfo = [];
  const fens = ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"];
  for (const f of fens) {
    const s = L.fromFEN(f);
    const t0 = process.hrtime.bigint(); const mv = L.chooseMove(s, "strong");
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (!mv) fail++;
  }
  // 実戦：強(700ms) vs 弱 の最初の30手
  let s = L.startState(), keys = [L.posKey(s)];
  for (let i = 0; i < 60 && !L.gameResult(s, keys); i++) {
    let mv;
    if (s.t === WHITE) { const t0 = process.hrtime.bigint(); mv = L.chooseMove(s, "strong", {keys}); times.push(Number(process.hrtime.bigint() - t0) / 1e6); }
    else mv = L.chooseMove(s, "weak");
    s = L.makeMove(s, mv); keys.push(L.posKey(s));
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length, mx = Math.max(...times);
  check("強の1手の時間（700ms で打ち切り）：最大が 900ms 以内", mx <= 900, "平均" + avg.toFixed(0) + "ms 最大" + mx.toFixed(0) + "ms 測定" + times.length + "手");
}

// 6 ハンデ・説明の図・練習問題
{
  const cnt = (s, ch) => s.b.filter(v => v === ch).length;
  const total = s => s.b.filter(v => v !== 0).length;
  // 5種×付ける側2（なしは1）の初期局面
  const spec = [
    // kind, giver, 駒の総数, 手番, 城(c: 1=白K 2=白Q 4=黒K 8=黒Q), 欠けている駒の位置
    ["none", WHITE, 32, WHITE, 15, null],
    ["pawn", WHITE, 31, BLACK, 15, "f2"], ["pawn", BLACK, 31, WHITE, 15, "f7"],
    ["knight", WHITE, 31, WHITE, 15, "b1"], ["knight", BLACK, 31, WHITE, 15, "b8"],
    ["rook", WHITE, 31, WHITE, 13, "a1"], ["rook", BLACK, 31, WHITE, 7, "a8"],
    ["queen", WHITE, 31, WHITE, 15, "d1"], ["queen", BLACK, 31, WHITE, 15, "d8"]];
  const full = L.startState();
  const expD1 = {none:20, pawn:20, knight:null, rook:20, queen:20};
  for (const [kind, giver, n, turn, c, gone] of spec) {
    const s = L.handicapState(kind, giver);
    const startPiece = gone ? full.b[L.sqOf(gone)] : 0;
    const okGone = !gone || (s.b[L.sqOf(gone)] === 0 && cnt(s, startPiece) === cnt(full, startPiece) - 1);
    check("ハンデ " + kind + "/" + (giver === WHITE ? "白が付ける" : "黒が付ける") + "：駒" + n + "・手番・城・欠け(" + gone + ")",
      total(s) === n && s.t === turn && s.c === c && okGone && s.kw === 4 && s.kb === 60,
      "駒=" + total(s) + " 手番=" + (s.t === WHITE ? "白" : "黒") + " 城=" + s.c);
    // 盤の他の駒は通常配置のまま（欠けた1升以外すべて同じ）
    let diff = 0; for (let i = 0; i < 64; i++) if (s.b[i] !== full.b[i]) diff++;
    check("  通常配置との違いは欠けた1升だけ（" + kind + "）", diff === (gone ? 1 : 0), "違う升=" + diff);
    // perft depth1〜2
    let d1 = -1, d2 = -1, err = null;
    try { d1 = L.perft(s, 1); d2 = L.perft(s, 2); } catch (e) { err = e.message; }
    check("  perft " + kind + "/" + (giver === WHITE ? "白" : "黒") + " depth1,2 が例外なく数えられる", !err && d1 > 0 && d2 > 0, "d1=" + d1 + " d2=" + d2 + (err ? " 例外=" + err : ""));
  }
  // 手計算の期待値：ナイト落ち＝ナイト2手を失いルークがb段に出られる(+1)＝19、受けた側の応手20＝19×20=380／クイーン落ち＝キングがクイーンの升に出られる(+1)＝21×20=420／ポーンと先手＝キングがf升に出られる＝19応手×20=380
  const exp = {"none-1":[20,400], "pawn-1":[20,380], "pawn--1":[20,380], "knight-1":[19,380], "knight--1":[20,380],
    "rook-1":[20,400], "rook--1":[20,400], "queen-1":[21,420], "queen--1":[20,420]};
  for (const [kind, giver] of spec) {
    const s = L.handicapState(kind, giver), e = exp[kind + "-" + giver];
    const d1 = L.perft(s, 1), d2 = L.perft(s, 2);
    check("  手計算の期待値と一致 " + kind + "/" + (giver === WHITE ? "白" : "黒"), d1 === e[0] && d2 === e[1], "得た=" + d1 + "/" + d2 + " 期待=" + e.join("/"));
  }
  // ルーク落ち：城を禁じた側は a 側へキャスリングできない（白: e1 が動けて c1 に行く手が無い）
  { const s = L.fromFEN("4k3/8/8/8/8/8/8/R3K2R w K - 0 1");
    check("ルーク落ち相当で白のクイーン側キャスリング権が無ければ e1→c1 は出ない", !L.legalMoves(s).some(m => m.f === 4 && m.t === 2) && L.legalMoves(s).some(m => m.f === 4 && m.t === 6)); }
  // ハンデ局面の城権が実際の手に効く：ルーク落ち（白）初期局面で、b1・c1・d1 を空けても白は c1 へ入城できない
  { const s = L.handicapState("rook", WHITE);
    check("ルーク落ち(白)：a1 が空でも a1 経由の入城は出ない（城権なし）", s.c === 13 && !L.legalMoves(s).some(m => m.cs === 2)); }
  // 全ハンデ局面から対コンピュータ（弱）で数手進められる
  for (const [kind, giver] of spec) {
    let s = L.handicapState(kind, giver), ok = true;
    for (let i = 0; i < 20 && !L.gameResult(s, null); i++) { const mv = L.chooseMove(s, "weak"); if (!mv) { ok = false; break; } s = L.makeMove(s, mv); }
    check("  " + kind + "/" + (giver === WHITE ? "白" : "黒") + "：弱で20手進められる", ok);
  }
}
{
  // 説明の図
  const F = L.FIGS, info = k => L.figInfo(F[k]), sqs = a => a.map(L.sqName).sort().join(",");
  const exact = {king: 8, queen: 27, rook: 14, bishop: 13, knight: 8, pawn: 2};
  for (const k in exact) { const i = info(k); check("図 " + k + "：動ける先が" + exact[k] + "（生成器で数えた）", i.dots.length + i.rings.length === exact[k], "得=" + (i.dots.length + i.rings.length)); }
  let i = info("capN"); check("図 capN：取れる駒（輪）は f6 の1つ", sqs(i.rings) === "f6", sqs(i.rings));
  i = info("capP"); check("図 capP：ポーンは前（e5）に進めず、斜め d5 だけ取れる", sqs(i.rings) === "d5" && sqs(i.dots) === "", "輪=" + sqs(i.rings) + " 点=" + sqs(i.dots));
  i = info("aim"); { const r = L.gameResult(i.s, null); check("図 aim：チェックメイト", r && r.kind === "mate" && i.chk === L.sqOf("h8")); }
  i = info("check"); check("図 check：王手、逃げ先は d8,f8,d7,f7", i.chk === L.sqOf("e8") && sqs(i.dots) === "d7,d8,f7,f8", sqs(i.dots));
  i = info("stale"); { const r = L.gameResult(i.s, null); check("図 stale：ステイルメイト（王手でない）", r && r.kind === "stalemate" && i.chk === -1); }
  i = info("castle"); check("図 castle：入城の行き先は c1,g1", sqs(i.dots) === "c1,g1", sqs(i.dots));
  i = info("ep"); check("図 ep：e6 に進む点と、d6 のアンパッサン（輪）", sqs(i.dots) === "e6" && sqs(i.rings) === "d6", "点=" + sqs(i.dots) + " 輪=" + sqs(i.rings));
  i = info("promo"); check("図 promo：行き先は e8 だけ（重複なし）", sqs(i.dots) === "e8", sqs(i.dots));
  i = info("draw"); check("図 draw：駒不足（K+B 対 K）で引き分け", L.gameResult(i.s, null) && L.gameResult(i.s, null).kind === "material");
  i = info("board"); check("図 board：初期局面・h1 は明るい升・d1 の白クイーンは明るい升", i.s.b[L.sqOf("d1")] === 5 && ((7 + 0) & 1) === 1 && ((3 + 0) & 1) === 1 && ((3 + 7) & 1) === 0);
  for (const k in F) { const s = L.figInfo(F[k]).s; check("図 " + k + "：FEN が読めて王が各1つ", s.kw >= 0 && s.kb >= 0); }
}
{
  // 練習問題
  const P = L.PRACTICE;
  const T = (id, from, to) => { const pz = P.find(p => p.id === id); return L.judgePractice(pz, L.fromFEN(pz.fen), L.sqOf(from), L.sqOf(to)); };
  check("練習 " + P.length + " 問（5前後）", P.length >= 5 && P.length <= 6);
  let r = T("knight", "e4", "f6"); check("練習① ナイトxf6 は合法で正解", r.ok && r.move && r.move.f === L.sqOf("e4"));
  r = T("knight", "e4", "d6"); check("練習① ナイトの別の手（d6）は不正解だが合法", !r.ok && !!r.move);
  r = T("knight", "e4", "e5"); check("練習① ナイトが動けない先は拒否", !r.ok && !r.move);
  { const pz = P.find(p => p.id === "escape"), s = L.fromFEN(pz.fen), ms = L.legalMoves(s);
    check("練習② 王手：合法手はキングの手だけ", L.inCheck(s) && ms.length > 0 && ms.every(m => m.f === L.sqOf("e1")), "手数=" + ms.length);
    r = T("escape", "e1", "e2"); check("練習② Ke2 は正解", r.ok);
    r = T("escape", "a2", "a3"); check("練習② ポーンa3 は王手が解けず拒否", !r.ok && !r.move && /王手/.test(r.msg));
    r = T("escape", "e1", "d1"); check("練習② Kd1（ルークの筋に残る）は拒否", !r.ok && !r.move); }
  { const pz = P.find(p => p.id === "mate"), s = L.fromFEN(pz.fen);
    const mates = L.legalMoves(s).filter(m => L.gameResult(L.makeMove(s, m), null) && L.gameResult(L.makeMove(s, m), null).kind === "mate");
    check("練習③ 詰ませる手はちょうど1つ（Ra8）", mates.length === 1 && L.sqName(mates[0].t) === "a8", "詰み手=" + mates.length);
    r = T("mate", "a1", "a8"); check("練習③ Ra8# は正解", r.ok);
    r = T("mate", "a1", "a7"); check("練習③ Ra7 は不正解（合法）", !r.ok && !!r.move); }
  r = T("castle", "e1", "g1"); check("練習④ O-O は合法で正解", r.ok && r.move.cs === 1);
  r = T("castle", "e1", "c1"); check("練習④ O-O-O も正解", r.ok && r.move.cs === 2);
  r = T("castle", "e1", "e2"); check("練習④ Ke2 は不正解", !r.ok && !!r.move);
  { const pz = P.find(p => p.id === "ep"), s = L.fromFEN(pz.fen);
    r = T("ep", "e5", "d6"); check("練習⑤ exd6 e.p. は合法で正解、d5 のポーンが消える", r.ok && r.move.e && r.next.b[L.sqOf("d5")] === 0 && r.next.b[L.sqOf("d6")] === 1);
    r = T("ep", "e5", "e6"); check("練習⑤ e6 は不正解（合法）", !r.ok && !!r.move);
    r = T("ep", "e1", "e2"); check("練習⑤ キング手も不正解（合法）", !r.ok && !!r.move); }
  for (const pz of P) { const s = L.fromFEN(pz.fen); check("練習 " + pz.id + "：白番・正解の手が少なくとも1つ", s.t === WHITE && L.legalMoves(s).some(m => pz.goal(s, m, L.makeMove(s, m)))); }
}

console.log(fail === 0 ? "\n全部通過" : "\n失敗 " + fail + " 件");
process.exit(fail ? 1 : 0);
