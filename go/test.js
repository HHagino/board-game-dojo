// node test.js ： index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込んで検査する（コピーではない）
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.log("NG: ロジックの区間が見つからない"); process.exit(1); }
const L = new Function(m[0] + "\nreturn {BLACK,WHITE,PASS,RESIGN,KOMI,initState,playMove,passMove,isOver,legalMoves,groupOf,libertiesOf,coordName,scoreArea,finalResult,chooseMove,PRACTICE,practiceState,judgePractice,idxOf,handiPoints,defaultKomi,RULE_KOMI,getStats:()=>lastStats};")();
const {BLACK, WHITE, PASS} = L;
let fail = 0;
function check(name, ok, extra) { console.log((ok ? "OK  " : "NG  ") + name + (extra ? "  " + extra : "")); if (!ok) fail++; }
const at = (r, c) => r * 9 + c;
// 手作りの局面：blacks / whites は [r,c] の配列
function mk(blacks, whites, player) {
  const st = L.initState();
  blacks.forEach(([r, c]) => st.board[at(r, c)] = BLACK);
  whites.forEach(([r, c]) => st.board[at(r, c)] = WHITE);
  st.player = player || BLACK;
  return st;
}

// ---- 1 取る・自殺手・コウ・パス ----
{
  const s = L.playMove(mk([[3,4],[5,4],[4,3]], [[4,4]]), at(4,5));
  check("1子を取る", s && s.board[at(4,4)] === 0 && s.capB === 1);
}
{
  const s = L.playMove(mk([[3,4],[3,5],[5,4],[5,5],[4,3]], [[4,4],[4,5]]), at(4,6));
  check("2子の連を取る", s && s.board[at(4,4)] === 0 && s.board[at(4,5)] === 0 && s.capB === 2);
}
{
  const s = L.playMove(mk([[0,1]], [[0,0]]), at(1,0));
  check("隅の石を取る", s && s.board[at(0,0)] === 0 && s.capB === 1);
  const e = L.playMove(mk([[0,3],[1,4]], [[0,4]]), at(0,5));
  check("辺の石を取る", e && e.board[at(0,4)] === 0);
}
{
  const st = mk([], [[3,4],[5,4],[4,3],[4,5],[2,4],[6,4],[4,2],[4,6]]); // 4つの白は他にも呼吸点あり
  const stSuicide = mk([], [[0,1],[1,0]]);
  check("自殺手は合法手に入らない（隅）", L.legalMoves(stSuicide).indexOf(at(0,0)) < 0 && L.playMove(stSuicide, at(0,0)) === null);
  const st2 = mk([], [[3,4],[5,4],[4,3],[4,5]]);
  check("自殺手は合法手に入らない（中央・四方が白）", L.legalMoves(st2).indexOf(at(4,4)) < 0 && L.playMove(st2, at(4,4)) === null);
  const cap = mk([[0,2],[1,1],[2,0]], [[0,1],[1,0]]);
  const r = L.playMove(cap, at(0,0));
  check("相手を取れる自殺に見える手は合法（2子取る）", L.legalMoves(cap).indexOf(at(0,0)) >= 0 && r && r.capB === 2 && r.board[at(0,1)] === 0 && r.board[at(1,0)] === 0);
}
{
  // コウ：A=(4,3) に黒が打って B=(4,4) の白1子を取る
  const st = mk([[3,4],[5,4],[4,5]], [[4,4],[3,3],[5,3],[4,2]]);
  const s1 = L.playMove(st, at(4,3));
  check("コウ：黒が1子を取る", s1 && s1.board[at(4,4)] === 0 && s1.ko === at(4,4));
  check("コウ：直後の取り返しは不合法", L.playMove(s1, at(4,4)) === null && L.legalMoves(s1).indexOf(at(4,4)) < 0);
  const s2 = L.playMove(s1, at(0,0));
  const s3 = L.playMove(s2, at(8,8));
  const s4 = L.playMove(s3, at(4,4));
  check("コウ：1手あけたら取り返せる", s4 && s4.board[at(4,3)] === 0 && s4.capW === 1);
  const g = L.passMove(L.passMove(L.initState()));
  check("パス2回で終局", L.isOver(g) && !L.isOver(L.passMove(L.initState())));
}

// ---- 2 数え方：手作りの終局図を3つの数え方で ----
{
  // 図A：c=4 が黒の壁(9)・c=5 が白の壁(9)・左 c0〜3 が黒の陣36・右 c6〜8 が白の陣27
  const A = new Array(81).fill(0);
  for (let r = 0; r < 9; r++) { A[at(r,4)] = BLACK; A[at(r,5)] = WHITE; }
  const a = L.finalResult(A, null, "area", {komi: 7});
  check("図A 中国：黒45 白36 コミ7 → 黒2目勝ち", a.b === 45 && a.w === 36 && a.margin === 2 && a.winner === BLACK, JSON.stringify([a.b, a.w, a.margin]));
  const j = L.finalResult(A, null, "japan", {komi: 6.5});
  check("図A 日本：地 黒36 白27 コミ6.5 → 黒2.5目勝ち", j.b === 36 && j.w === 27 && j.margin === 2.5 && j.winner === BLACK, JSON.stringify([j.b, j.w, j.margin]));
  const p = L.finalResult(A, null, "stone", {komi: 7});
  check("図A 純碁：石 黒9 白9 コミ7 → 白7目勝ち", p.b === 9 && p.w === 9 && p.margin === -7 && p.winner === WHITE, JSON.stringify([p.b, p.w, p.margin]));

  // 図B：図Aの陣の中に死に石（白(4,1)・黒(4,7)）
  const B = A.slice(); B[at(4,1)] = WHITE; B[at(4,7)] = BLACK;
  const dead = new Array(81).fill(false);
  L.groupOf(B, at(4,1)).forEach(i => dead[i] = true);
  L.groupOf(B, at(4,7)).forEach(i => dead[i] = true);
  check("死に石の連の取り方：壁は9子の連・死に石は1子", L.groupOf(B, at(0,4)).length === 9 && L.groupOf(B, at(4,1)).length === 1);
  const bn = L.finalResult(B, null, "area", {komi: 7});
  check("図B 死に石を選ばない中国：黒10 白10 → 白7目勝ち（陣が両色に接して数えられない）", bn.b === 10 && bn.w === 10 && bn.margin === -7, JSON.stringify([bn.b, bn.w]));
  const ba = L.finalResult(B, dead, "area", {komi: 7});
  check("図B 死に石を選んだ中国：黒45 白36 → 黒2目勝ち（図Aと同じ）", ba.b === 45 && ba.w === 36 && ba.margin === 2, JSON.stringify([ba.b, ba.w]));
  const bj = L.finalResult(B, dead, "japan", {komi: 7, capB: 0, capW: 0});
  check("図B 日本：地 黒36 白27＋死に石 黒1 白1 → 黒37 白28 コミ7 → 黒2目勝ち", bj.b === 37 && bj.w === 28 && bj.margin === 2, JSON.stringify([bj.b, bj.w, bj.margin]));
  const bj2 = L.finalResult(B, dead, "japan", {komi: 7, capB: 3, capW: 0});
  check("図B 日本：対局中のアゲハマ（黒3）が足される → 黒40 白28", bj2.b === 40 && bj2.w === 28, JSON.stringify([bj2.b, bj2.w]));
  const bp = L.finalResult(B, dead, "stone", {komi: 7});
  check("図B 純碁：死に石を除いて 黒9 白9 → 白7目勝ち", bp.b === 9 && bp.w === 9 && bp.margin === -7, JSON.stringify([bp.b, bp.w]));
  const bpn = L.finalResult(B, null, "stone", {komi: 7});
  check("図B 純碁：死に石を選ばないと 黒10 白10（選ぶ意味がある）", bpn.b === 10 && bpn.w === 10);

  // 図C：ダメのある図。黒の壁 c=3・白の壁 c=5・c=4 が全部ダメ(9点)・黒の陣 c0〜2(27)・白の陣 c6〜8(27)
  const C = new Array(81).fill(0);
  for (let r = 0; r < 9; r++) { C[at(r,3)] = BLACK; C[at(r,5)] = WHITE; }
  const ca = L.finalResult(C, null, "area", {komi: 7});
  const cj = L.finalResult(C, null, "japan", {komi: 7, capB: 3, capW: 0});
  const cp = L.finalResult(C, null, "stone", {komi: 7});
  check("図C ダメ9点：中国は 黒36 白36（ダメは数えない）", ca.b === 36 && ca.w === 36 && ca.margin === -7, JSON.stringify([ca.b, ca.w]));
  check("図C ダメ9点：日本は 地 黒27 白27 ＋ アゲハマ黒3 → 黒30 白27（ダメも石も数えない）", cj.b === 30 && cj.w === 27 && cj.terrB === 27 && cj.terrW === 27, JSON.stringify([cj.b, cj.w]));
  let dame = 0; for (let r = 0; r < 9; r++) if (cj.own[at(r,4)] === 0) dame++;
  check("図C ダメの9点はどちらの地でもない（own=0）", dame === 9);
  check("図C 純碁は 黒9 白9", cp.b === 9 && cp.w === 9);
  const ck = L.finalResult(C, null, "japan", {});
  check("コミの既定値：日本 6.5・中国 7・純碁 7", ck.komi === 6.5 && L.finalResult(C, null, "area", {}).komi === 7 && L.finalResult(C, null, "stone", {}).komi === 7);
}

// ---- 3 練習問題 ----
{
  const P = {}; L.PRACTICE.forEach(p => P[p.id] = p);
  const pz1 = P.capture, s1 = L.practiceState(pz1);
  let j = L.judgePractice(pz1, s1, at(1,2), 0);
  check("練習1 正解手 (1,2) が合法で白石が取れる", L.legalMoves(s1).indexOf(at(1,2)) >= 0 && j.ok && j.st.board[at(1,1)] === 0 && j.st.capB === 1);
  check("練習1 ほかの手は不正解", !L.judgePractice(pz1, s1, at(3,3), 0).ok);

  const pz2 = P.escape, s2 = L.practiceState(pz2);
  check("練習2 逃げる前は黒石の呼吸点が1つ", L.libertiesOf(s2.board, at(1,1)) === 1);
  j = L.judgePractice(pz2, s2, at(2,1), 0);
  check("練習2 正解手 (2,1) で呼吸点が増える", j.ok && L.libertiesOf(j.st.board, at(1,1)) >= 2, "呼吸点=" + L.libertiesOf(j.st.board, at(1,1)));
  check("練習2 ほかの手（遠く）は不正解", !L.judgePractice(pz2, s2, at(4,4), 0).ok);

  const pz3 = P.suicide, s3 = L.practiceState(pz3);
  check("練習3 隅 (0,0) は不合法（自殺手）", L.playMove(s3, at(0,0)) === null && L.judgePractice(pz3, s3, at(0,0), 0).ok);
  check("練習3 ほかの空点は合法で不正解", L.playMove(s3, at(4,4)) !== null && !L.judgePractice(pz3, s3, at(4,4), 0).ok);

  const pz4 = P.ko, s4 = L.practiceState(pz4);
  j = L.judgePractice(pz4, s4, at(2,0), 0);
  check("練習4 1手目 (2,0) で白1子を取り、コウの点が (2,1)", j.next && j.st.board[at(2,1)] === 0 && j.st.ko === at(2,1) && j.st.capB === 1);
  const j2 = L.judgePractice(pz4, j.st, at(2,1), 1);
  check("練習4 白が (2,1) で取り返すのは不合法（コウ）", j2.ok && L.playMove(j.st, at(2,1)) === null);
  const t1 = L.playMove(j.st, at(8,8)), t2 = L.playMove(t1, at(0,8)), t3 = L.playMove(t2, at(2,1));
  check("練習4 1手あけて（白・黒の順で別の所に打つと）取り返せる", t3 && t3.board[at(2,0)] === 0 && t3.capW === 1);

  const pz5 = P.eyes, s5 = L.practiceState(pz5);
  check("練習5 白の目 (0,0)・(0,2) はどちらも黒には不合法", L.playMove(s5, at(0,0)) === null && L.playMove(s5, at(0,2)) === null
    && L.judgePractice(pz5, s5, at(0,0), 0).ok && L.judgePractice(pz5, s5, at(0,2), 0).ok);
  check("練習5 白グループの呼吸点は目の2つだけ", L.libertiesOf(s5.board, at(1,1)) === 2);
  check("練習5 ほかの合法な手では白は取れない", L.playMove(s5, at(4,4)).board[at(1,1)] === WHITE);
}

// ---- 4 ランダム対ランダム50局 ----
function noDeadGroup(board) {
  for (let i = 0; i < 81; i++) if (board[i] !== 0 && L.libertiesOf(board, i) === 0) return false;
  return true;
}
function playGame(cfgB, cfgW, maxMoves, checkInv) {
  let st = L.initState(), moves = 0, capped = false;
  maxMoves = maxMoves || 250;
  while (!L.isOver(st)) {
    const cfg = st.player === BLACK ? cfgB : cfgW;
    const mv = L.chooseMove(st, cfg.level, cfg.opts);
    let ns;
    if (mv === PASS) ns = L.passMove(st);
    else if (mv === L.RESIGN) throw new Error("テスト中に投了");
    else ns = L.playMove(st, mv);
    if (!ns) throw new Error("非合法手 " + mv + " " + L.coordName(mv));
    st = ns; moves++;
    if (checkInv && !noDeadGroup(st.board)) throw new Error("呼吸点0の連が盤に残った");
    if (moves >= maxMoves) { capped = true; break; }
  }
  return {st, moves, capped};
}
{
  let ok = true, err = "", capped = 0, maxMoves = 0, sumMoves = 0;
  try {
    for (let g = 0; g < 50; g++) {
      const r = playGame({level: "weak"}, {level: "weak"}, 250, true);
      if (r.capped) capped++;
      if (!r.capped && !L.isOver(r.st)) ok = false;
      maxMoves = Math.max(maxMoves, r.moves); sumMoves += r.moves;
    }
  } catch (e) { ok = false; err = String(e && e.stack || e); }
  check("ランダム対ランダム50局：例外なく終局（上限250手）・盤に呼吸点0の連が残らない", ok, "上限到達=" + capped + " 最大手数=" + maxMoves + " 平均手数=" + (sumMoves / 50).toFixed(1) + " " + err);
}

// ---- 5 強 vs 弱 10局（色を交代）。終局図の石は全部生きとして中国ルール・コミ7で数える ----
{
  let sw = 0, ww = 0, dr = 0, capped = 0, errs = "";
  const S = {level: "strong", opts: {timeMs: 150, resign: false}}, Wk = {level: "weak"};
  try {
    for (let g = 0; g < 10; g++) {
      const sb = g % 2 === 0;
      const r = playGame(sb ? S : Wk, sb ? Wk : S, 250, false);
      if (r.capped) capped++;
      const res = L.finalResult(r.st.board, null, "area", {komi: 7});
      if (res.winner === 0) dr++; else if ((res.winner === BLACK) === sb) sw++; else ww++;
    }
  } catch (e) { errs = String(e && e.stack || e); }
  check("強(150ms/手) vs 弱 10局で強の勝ちが多い", !errs && sw > ww, "強" + sw + " 弱" + ww + " 分" + dr + " 上限到達" + capped + " " + errs);
}
{
  let mw = 0, ww = 0, dr = 0;
  for (let g = 0; g < 10; g++) {
    const mb = g % 2 === 0;
    const r = playGame(mb ? {level: "mid"} : {level: "weak"}, mb ? {level: "weak"} : {level: "mid"}, 250, false);
    const res = L.finalResult(r.st.board, null, "area", {komi: 7});
    if (res.winner === 0) dr++; else if ((res.winner === BLACK) === mb) mw++; else ww++;
  }
  check("ふつう vs 弱 10局でふつうの勝ちが多い（参考）", mw > ww, "ふつう" + mw + " 弱" + ww + " 分" + dr);
}

// ---- 6 強の1手の考える時間（既定 1000ms 上限）。ランダムに20手進めた局面で5手 ----
{
  const times = [], plays = [];
  for (let k = 0; k < 5; k++) {
    let st = L.initState();
    for (let i = 0; i < 20; i++) { const mv = L.chooseMove(st, "weak"); st = mv === PASS ? L.passMove(st) : L.playMove(st, mv); }
    const t0 = process.hrtime.bigint();
    const mv = L.chooseMove(st, "strong", {resign: false});
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    plays.push(L.getStats().playouts);
    if (mv !== PASS && !L.playMove(st, mv)) { check("強の手が合法", false); }
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log("強の考える時間(既定1000ms) 平均=" + avg.toFixed(0) + "ms 最大=" + Math.max(...times).toFixed(0) + "ms  試行回数=" + plays.join(","));
  check("強の1手は 1100ms 以内", Math.max(...times) < 1100);
}

// ---- 7 置き石（9路）：2〜5子の初期局面・最初の手番・コミの既定・置き石ありの勝敗 ----
{
  // 日本棋院の1図の順：右上 (2,6)→左下 (6,2)→右下 (6,6)→左上 (2,2)→天元 (4,4)（2026-10-26 に前の 右下→左上→… から直した）
  const want = {
    2: [[2,6],[6,2]], 3: [[2,6],[6,2],[6,6]], 4: [[2,6],[6,2],[6,6],[2,2]], 5: [[2,6],[6,2],[6,6],[2,2],[4,4]]
  };
  for (const n of [2, 3, 4, 5]) {
    const st = L.initState(n);
    const blacks = st.board.map((v, i) => v === BLACK ? i : -1).filter(i => i >= 0).sort((a, b) => a - b);
    const exp = want[n].map(([r, c]) => at(r, c)).sort((a, b) => a - b);
    check(n + "子：黒石の位置と数が星どおり", JSON.stringify(blacks) === JSON.stringify(exp) && st.board.filter(v => v === WHITE).length === 0, blacks.join(","));
    check(n + "子：最初の手番は白・パス0・取った石0", st.player === WHITE && st.passes === 0 && st.capB === 0 && st.capW === 0);
    check(n + "子：コミの既定は全部の数え方で0", ["area", "japan", "stone"].every(r => L.defaultKomi(r, n) === 0));
    check(n + "子：白が打ったあと黒番になる", L.playMove(st, at(4, 3) === at(4,4) ? at(3,3) : at(4, 3)).player === BLACK || n === 5);
  }
  check("置き石なし：黒番・空・コミは数え方ごとの既定（中国7 日本6.5 純碁7）", (() => { const st = L.initState(); return st.player === BLACK && st.board.every(v => v === 0) && L.defaultKomi("area", 0) === 7 && L.defaultKomi("japan", 0) === 6.5 && L.defaultKomi("stone", 0) === 7; })());
  check("置き石の順は日本棋院の1図どおり（右上 G7→左下 C3→右下 G3→左上 C7→天元 E5）", L.handiPoints(5).map(L.coordName).join(" ") === "G7 C3 G3 C7 E5", L.handiPoints(5).map(L.coordName).join(" "));
  check("置き石の範囲外（1・6）は置かない", L.handiPoints(1).length === 0 && L.handiPoints(6).length === 0 && L.initState(1).player === BLACK);
  // 手計算の図：2子（右上 (2,6)＝G7 と 左下 (6,2)＝C3）＋ 黒の壁 c=4（9子）＋ 白の壁 c=5（9子）、(2,6) は白の陣の中の死に石
  // （置き石の順を日本棋院の1図に直した 2026-10-26 に、死に石を (6,6) から (2,6) に。上下を鏡に写した形なので目数は前と同じ）
  const D = L.initState(2).board.slice();
  for (let r = 0; r < 9; r++) { D[at(r,4)] = BLACK; D[at(r,5)] = WHITE; }
  const dead = new Array(81).fill(false); dead[at(2,6)] = true;
  const a = L.finalResult(D, dead, "area", {komi: 0});
  check("置き石の図 中国：黒 石10＋空点35＝45、白 石9＋空点27＝36、コミ0 → 黒9目勝ち", a.b === 45 && a.w === 36 && a.margin === 9 && a.winner === BLACK, JSON.stringify([a.b, a.w, a.margin]));
  const j = L.finalResult(D, dead, "japan", {komi: 0, capB: 0, capW: 0});
  check("置き石の図 日本：黒 地35、白 地27＋死に石のアゲハマ1＝28、コミ0 → 黒7目勝ち", j.b === 35 && j.w === 28 && j.margin === 7 && j.winner === BLACK, JSON.stringify([j.b, j.w, j.margin]));
  const p = L.finalResult(D, dead, "stone", {komi: 0});
  check("置き石の図 純碁：黒10 白9 コミ0 → 黒1目勝ち", p.b === 10 && p.w === 9 && p.margin === 1 && p.winner === BLACK, JSON.stringify([p.b, p.w, p.margin]));
  // 置き石の局面から、ランダムに終局まで例外なく打てる（各5局）
  let okAll = true;
  for (const n of [2, 3, 4, 5]) for (let g = 0; g < 5; g++) {
    let st = L.initState(n), steps = 0;
    while (!L.isOver(st) && steps++ < 400) {
      const lm = L.legalMoves(st);
      const mv = lm.length && Math.random() < 0.97 ? lm[(Math.random() * lm.length) | 0] : PASS;
      st = mv === PASS ? L.passMove(st) : L.playMove(st, mv);
      if (!st) { okAll = false; break; }
    }
    if (!st) break;
  }
  check("置き石2〜5子から各5局、終局まで例外なく打てる", okAll);
}

console.log(fail === 0 ? "\n全部通過" : "\n失敗 " + fail + " 件");
process.exit(fail ? 1 : 0);
