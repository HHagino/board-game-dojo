// node test.js ： index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込んで検査する（コピーではない）
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.log("NG: ロジックの区間が見つからない"); process.exit(1); }
const L = new Function(m[0] + "\nreturn {BLACK,WHITE,initBoard,flipsFor,legalMoves,applyMove,countDiscs,nextPlayer,isGameOver,winner,coordName,chooseMove};")();
const {BLACK, WHITE} = L;
let fail = 0;
function check(name, ok, extra) { console.log((ok ? "OK  " : "NG  ") + name + (extra ? "  " + extra : "")); if (!ok) fail++; }

// 1 初期盤の黒の合法手
const b0 = L.initBoard();
const names = L.legalMoves(b0, BLACK).map(L.coordName).sort();
check("初期盤の黒の合法手が d3 c4 f5 e6 の4つ", names.join() === ["c4","d3","e6","f5"].sort().join(), names.join(" "));
check("初期盤の白の合法手も4つ", L.legalMoves(b0, WHITE).length === 4);
// 2 d3 で1枚返る
const d3 = 2 * 8 + 3;
const b1 = L.applyMove(b0, d3, BLACK);
const c1 = L.countDiscs(b1);
check("d3 で1枚返る（黒4・白1）", L.flipsFor(b0, d3, BLACK).length === 1 && c1.b === 4 && c1.w === 1, JSON.stringify(c1));
check("置けない所は null", L.applyMove(b0, 0, BLACK) === null);
// 全方向の返し：中央の十字・斜めを作る
{
  const b = new Array(64).fill(0);
  const at = (r, c) => r * 8 + c;
  b[at(3,3)] = BLACK;
  [[3,4],[3,2],[2,3],[4,3],[2,2],[4,4],[2,4],[4,2]].forEach(([r,c]) => b[at(r,c)] = WHITE);
  // 黒が at(3,3) の周りを挟むには外側に黒が必要：8方向に外側へ黒を置く
  [[3,5],[3,1],[1,3],[5,3],[1,1],[5,5],[1,5],[5,1]].forEach(([r,c]) => b[at(r,c)] = BLACK);
  b[at(3,3)] = 0; // 中央に黒を置く
  const f = L.flipsFor(b, at(3,3), BLACK).length;
  check("中央に置くと8方向で8枚返る", f === 8, "返った数=" + f);
}
// 盤の端で次の行へ回り込まない（2026-10-26：端の判定を外して次の行へ回り込む版を、この試験の前の test.js は見逃した。公表値との照合は7手目から捕まえる）
{
  const b = new Array(64).fill(0);
  b[8] = WHITE; b[9] = BLACK;   // a2 に白・b2 に黒。h1（7）の右隣は a2（8）と添字が続く
  check("h1 から右へ数えても a2 の白は返らない（端で止まる）", L.flipsFor(b, 7, BLACK).length === 0);
  const w = new Array(64).fill(0);
  w[15] = WHITE; w[14] = BLACK; // h2 に白・g2 に黒。a3（16）の左隣は h2（15）と添字が続く
  check("a3 から左へ数えても h2 の白は返らない（端で止まる）", L.flipsFor(w, 16, BLACK).length === 0);
  const e = new Array(64).fill(0);
  e[6] = WHITE; e[7] = WHITE; e[8] = BLACK; // g1・h1 に白・a2 に黒。白の列が h1 で終わったあと、挟む石を次の行に探さない
  check("f1 から右の白 g1・h1 は返らない（h1 の先は盤の外）", L.flipsFor(e, 5, BLACK).length === 0);
}
// 3 パスの局面
{
  const b = new Array(64).fill(0);
  b[0] = BLACK; b[1] = WHITE; // 白は挟めない／黒は c1 に置ける
  check("パス：白の合法手が0", L.legalMoves(b, WHITE).length === 0);
  check("パス：黒の合法手は c1 だけ", L.legalMoves(b, BLACK).join() === "2");
  check("パス：黒が打ったあと白番でなく…（白が打てないので黒が続ける局面の判定）",
    (() => { const b2 = new Array(64).fill(0); b2[0] = BLACK; b2[1] = WHITE; b2[10] = WHITE; b2[18]=BLACK;
             // 白が打った直後を想定：黒の相手(白)は…
             return L.nextPlayer(b, WHITE) === BLACK; })(), "白が打った直後の次は黒");
  check("パス：黒が c1 に打った直後は白は打てず黒も打てない→終局", (() => { const nb = L.applyMove(b, 2, BLACK); return L.nextPlayer(nb, BLACK) === 0 && L.isGameOver(nb); })());
  check("パス：黒が打ってもまだ黒が打てるなら黒が続く", (() => {
    const bb = new Array(64).fill(0); bb[0]=BLACK; bb[1]=WHITE; bb[2]=WHITE; bb[63]=BLACK; bb[62]=WHITE;
    const nb = L.applyMove(bb, 3, BLACK); // d1 で b1 c1 が返り、白は石が無く打てない。黒は f8 がまだ打てる
    return L.legalMoves(nb, WHITE).length === 0 && L.legalMoves(nb, BLACK).join() === "61" && L.nextPlayer(nb, BLACK) === BLACK;
  })());
  const full = new Array(64).fill(BLACK);
  check("全部黒なら終局で黒の勝ち", L.isGameOver(full) && L.winner(full) === BLACK);
}

// 4 ランダム対ランダム100局
function playGame(pBlack, pWhite) {
  let board = L.initBoard(), player = BLACK, moves = 0;
  while (player !== 0) {
    const cfg = player === BLACK ? pBlack : pWhite;
    const mv = L.chooseMove(board, player, cfg.level, cfg.opts);
    if (mv < 0) throw new Error("合法手があるのに -1");
    const nb = L.applyMove(board, mv, player);
    if (!nb) throw new Error("非合法手 " + mv);
    board = nb; moves++;
    player = L.nextPlayer(board, player);
    if (moves > 70) throw new Error("手数が多すぎる");
  }
  return {board, moves};
}
{
  let ok = true, err = "", maxTotal = 0, bw = 0, ww = 0, dr = 0;
  try {
    for (let g = 0; g < 100; g++) {
      const r = playGame({level: "weak"}, {level: "weak"});
      const c = L.countDiscs(r.board);
      maxTotal = Math.max(maxTotal, c.b + c.w);
      if (c.b + c.w > 64 || !L.isGameOver(r.board)) ok = false;
      const w = L.winner(r.board); if (w === BLACK) bw++; else if (w === WHITE) ww++; else dr++;
    }
  } catch (e) { ok = false; err = String(e); }
  check("ランダム対ランダム100局：全部正しく終局・石の合計≦64・例外なし", ok, "最大合計=" + maxTotal + " 黒勝" + bw + " 白勝" + ww + " 分" + dr + " " + err);
}

// 5 強 vs 弱 20局（色を交代）。テストでは深さ4・時間無制限で速く回す
{
  let strongWins = 0, weakWins = 0, draws = 0;
  const S = {level: "strong", opts: {maxDepth: 4, timeMs: Infinity}}, Wk = {level: "weak"};
  for (let g = 0; g < 20; g++) {
    const strongBlack = g % 2 === 0;
    const r = playGame(strongBlack ? S : Wk, strongBlack ? Wk : S);
    const w = L.winner(r.board);
    if (w === 0) draws++; else if ((w === BLACK) === strongBlack) strongWins++; else weakWins++;
  }
  check("強(深さ4) vs 弱 20局で強の勝ちが多い", strongWins > weakWins, "強" + strongWins + " 弱" + weakWins + " 分" + draws);
}
{
  let midWins = 0, weakWins = 0, draws = 0;
  for (let g = 0; g < 20; g++) {
    const mb = g % 2 === 0;
    const r = playGame(mb ? {level: "mid"} : {level: "weak"}, mb ? {level: "weak"} : {level: "mid"});
    const w = L.winner(r.board);
    if (w === 0) draws++; else if ((w === BLACK) === mb) midWins++; else weakWins++;
  }
  check("ふつう vs 弱 20局でふつうの勝ちが多い", midWins > weakWins, "ふつう" + midWins + " 弱" + weakWins + " 分" + draws);
}

// 6 1手の考える時間（実際の設定：強は既定の 深さ6・700ms 上限）
{
  function timeLevel(level) {
    let board = L.initBoard(), player = BLACK, worst = 0, sum = 0, n = 0;
    while (player !== 0) {
      const t0 = process.hrtime.bigint();
      const mv = L.chooseMove(board, player, level);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      worst = Math.max(worst, ms); sum += ms; n++;
      board = L.applyMove(board, mv, player);
      player = L.nextPlayer(board, player);
    }
    return {平均ms: +(sum / n).toFixed(2), 最大ms: +worst.toFixed(1), 手数: n};
  }
  // 弱・ふつう・強の1局分（自己対戦）の考える時間
  for (const lv of ["weak", "mid", "strong"]) console.log("時間 " + lv + " " + JSON.stringify(timeLevel(lv)));
}

console.log(fail === 0 ? "\n全部通過" : "\n失敗 " + fail + " 件");
process.exit(fail ? 1 : 0);
