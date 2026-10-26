// node test.js ： index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込んで検査する（コピーではない）
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.log("NG: ロジックの区間が見つからない"); process.exit(1); }
const L = new Function(m[0] + "\nreturn {START_SFEN,parseSfen,copyState,legalMoves,perft,hasLegal,inCheck,doMove,undoMove,newGameFrom,gamePlay,gameUndo,chooseMove,moveText,posKey,HANDICAPS,handicapSfen,PUZZLES,judgePuzzle,explainIllegal};")();
let fail = 0;
function check(name, ok, extra) { console.log((ok ? "OK  " : "NG  ") + name + (extra ? "  " + extra : "")); if (!ok) fail++; }
const P = (sfen) => L.parseSfen(sfen);
const from = (mv) => mv & 255, to = (mv) => (mv >> 8) & 255, pro = (mv) => (mv >> 16) & 1;
const sq = (r, c) => r * 9 + c;

// 1 perft（平手の初期局面）
{
  const S = P(L.START_SFEN);
  const exp = [30, 900, 25470];
  for (let d = 1; d <= 3; d++) {
    const t0 = Date.now(), n = L.perft(S, d);
    check("perft depth" + d + " = " + exp[d - 1], n === exp[d - 1], "実測=" + n + " (" + (Date.now() - t0) + "ms)");
  }
  const t0 = Date.now(), n4 = L.perft(S, 4);
  check("perft depth4 = 719731", n4 === 719731, "実測=" + n4 + " (" + (Date.now() - t0) + "ms)");
  check("perft のあと盤が元に戻っている", L.posKey(S) === L.posKey(P(L.START_SFEN)));
  // SFEN の往復の簡単な確認：持ち駒つき
  const H = P("k8/2G6/9/9/9/9/9/9/8K b 2Pr 1");
  check("SFEN：持ち駒 先手歩2・後手飛1", H.h[0][1] === 2 && H.h[1][7] === 1 && H.turn === 1);
}

// 2 個別ルール
const dropsTo = (S, t, sqi) => L.legalMoves(S).filter(mv => from(mv) === 100 + t && to(mv) === sqi);
{
  // 打ち歩詰め
  const A = P("k8/2G6/1S7/9/9/9/9/9/8K b P 1");
  check("打ち歩詰め：９二への歩打ちは合法手に入らない（詰みになる）", dropsTo(A, 1, sq(1, 0)).length === 0);
  const ctl = P("k8/2G6/9/9/9/9/9/9/8K b P 1");
  check("対照：玉が歩を取れる局面なら同じ歩打ちは合法", dropsTo(ctl, 1, sq(1, 0)).length === 1);
  check("打ち歩詰め：他の場所への歩打ちは入る", dropsTo(A, 1, sq(5, 5)).length === 1);
  // 二歩
  const N = P("4k4/9/9/9/4P4/9/9/9/4K4 b P 1");
  const pd = L.legalMoves(N).filter(mv => from(mv) === 101);
  check("二歩：同じ筋への歩打ちが無い・他の筋は 8筋×8段=64", pd.every(mv => to(mv) % 9 !== 4) && pd.length === 64, "歩打ち=" + pd.length);
  const N2 = P("4k4/9/9/9/+P8/9/9/9/4K4 b P 1".replace("+P8", "2+P6"));
  check("成った歩（と）のある筋には歩を打てる", dropsTo(N2, 1, sq(5, 2)).length === 1);
  // 行き所のない駒の打ち
  const Z = P("4k4/9/9/9/9/9/9/9/4K4 b PLN 1");
  const zd = L.legalMoves(Z).filter(mv => from(mv) >= 100);
  check("行き所のない打ち：歩・香は１段目、桂は１〜２段目に打てない（先手）",
    zd.filter(mv => from(mv) <= 102 && Math.floor(to(mv) / 9) === 0).length === 0 &&
    zd.filter(mv => from(mv) === 103 && Math.floor(to(mv) / 9) <= 1).length === 0);
  check("対照：桂は３段目には打てる／歩は２段目に打てる",
    dropsTo(Z, 3, sq(2, 0)).length === 1 && dropsTo(Z, 1, sq(1, 0)).length === 1);
  const ZG = P("4k4/9/9/9/9/9/9/9/4K4 w pln 1");
  const zg = L.legalMoves(ZG).filter(mv => from(mv) >= 100);
  check("行き所のない打ち（後手）：９段目に歩・香、８〜９段目に桂は打てない",
    zg.filter(mv => from(mv) <= 102 && Math.floor(to(mv) / 9) === 8).length === 0 &&
    zg.filter(mv => from(mv) === 103 && Math.floor(to(mv) / 9) >= 7).length === 0);
  // 成り：行き所のない駒は必ず成る
  const f1 = L.legalMoves(P("4k4/P8/9/9/9/9/9/9/4K4 b - 1")).filter(mv => from(mv) === sq(1, 0));
  check("歩が１段目へ：成りのみ（不成は入らない）", f1.length === 1 && pro(f1[0]) === 1);
  const f2 = L.legalMoves(P("4k4/9/9/N8/9/9/9/9/4K4 b - 1")).filter(mv => from(mv) === sq(3, 0));
  check("桂が２段目へ：成りのみ", f2.length === 1 && to(f2[0]) === sq(1, 1) && pro(f2[0]) === 1);
  const f3 = L.legalMoves(P("4k4/9/9/9/N8/9/9/9/4K4 b - 1")).filter(mv => from(mv) === sq(4, 0));
  check("桂が３段目へ：成り・不成の両方", f3.length === 2);
  const f4 = L.legalMoves(P("4k4/9/P8/9/9/9/9/9/4K4 b - 1")).filter(mv => from(mv) === sq(2, 0));
  check("歩が２段目から敵陣内へ（２段目）：成り・不成の両方", f4.length === 2);
  const f5 = L.legalMoves(P("4k4/9/9/1S7/9/9/9/9/4K4 b - 1")).filter(mv => from(mv) === sq(3, 1) && to(mv) === sq(2, 2));
  check("銀が敵陣に入る手は成り・不成の両方", f5.length === 2);
  const f6 = L.legalMoves(P("4k4/9/1B7/9/9/9/9/9/4K4 b - 1")).filter(mv => from(mv) === sq(2, 1) && to(mv) === sq(4, 3));
  check("敵陣の中から出る手でも成れる（角）", f6.length === 2);
  const f7 = L.legalMoves(P("4k4/9/9/9/9/9/9/p8/4K4 w - 1")).filter(mv => from(mv) === sq(7, 0));
  check("後手の歩が９段目へ：成りのみ", f7.length === 1 && pro(f7[0]) === 1);
  const f8 = L.legalMoves(P("4k4/9/9/9/9/9/9/9/4K1G2 b - 1")).filter(mv => pro(mv));
  check("金・玉は成れない", f8.length === 0);
  // 王手の放置は不可：飛車に王手されている、飛車を取れないなら逃げる手か合駒のみ
  {
    const C = P("4k4/9/9/9/9/9/9/9/r3K4 b - 1");
    const ls = L.legalMoves(C);
    check("王手放置は不可：横から飛車の王手を受けたら、玉が逃げる手のみ（４筋・８段を避ける）",
      L.inCheck(C, 1) && ls.length > 0 && ls.every(mv => from(mv) === sq(8, 4) && Math.floor(to(mv) / 9) !== 8), ls.length + "手");
    // ピン：金が飛車に釘付けのとき、横には動けない
    const Q = P("3kr4/9/9/9/9/9/9/4G4/4K4 b - 1");
    const gm = L.legalMoves(Q).filter(mv => from(mv) === sq(7, 4));
    check("ピンされた金は縦（飛車の筋）にしか動けない", gm.length > 0 && gm.every(mv => to(mv) % 9 === 4), gm.length + "手");
  }
  // 詰み
  const M = P("4k4/4G4/3S5/9/9/9/9/9/8K w - 1");
  check("詰みの判定：頭金で後手に合法手が無く、王手されている", L.legalMoves(M).length === 0 && L.inCheck(M, -1) && !L.hasLegal(M));
  const G = L.newGameFrom("4k4/9/3SG4/9/9/9/9/9/8K b - 1");
  const mm = L.legalMoves(G.S).filter(mv => from(mv) === sq(2, 4) && to(mv) === sq(1, 4))[0];
  L.gamePlay(G, mm);
  check("対局：頭金で終局・先手の勝ち・理由は詰み", G.over && G.winner === 1 && G.reason === "詰み", G.reason + " " + G.moves[0].text);
  L.gameUndo(G);
  check("待った：終局が解除され盤が戻る", !G.over && L.legalMoves(G.S).length > 0 && G.moves.length === 0);
  // 千日手（王手なし）：玉の往復
  {
    const g = L.newGameFrom("k8/9/9/9/9/9/9/9/8K b - 1");
    const seq = [[sq(8, 8), sq(7, 8)], [0, sq(1, 0)], [sq(7, 8), sq(8, 8)], [sq(1, 0), 0]];
    let ply = 0, endAt = -1;
    for (let k = 0; k < 16 && endAt < 0; k++) {
      const [f, t] = seq[k % 4];
      const mv = L.legalMoves(g.S).find(x => from(x) === f && to(x) === t);
      L.gamePlay(g, mv); ply++;
      if (g.over) endAt = ply;
    }
    check("千日手：同一局面の4回目（12手目）で引き分け", endAt === 12 && g.winner === 0 && g.reason === "千日手", "終局=" + endAt + "手目 " + g.reason);
  }
  // 連続王手の千日手：王手をかけ続けた側（先手）の負け
  {
    const g = L.newGameFrom("k8/5R3/9/9/9/9/9/9/8K b - 1");
    const seq = [[sq(1, 5), sq(0, 5)], [0, sq(1, 0)], [sq(0, 5), sq(1, 5)], [sq(1, 0), 0]];
    let ply = 0, endAt = -1;
    for (let k = 0; k < 16 && endAt < 0; k++) {
      const [f, t] = seq[k % 4];
      const mv = L.legalMoves(g.S).find(x => from(x) === f && to(x) === t && !pro(x)); // 飛車は不成で往復
      L.gamePlay(g, mv); ply++;
      if (g.over) endAt = ply;
    }
    check("連続王手の千日手：王手をかけ続けた先手の負け（後手の勝ち）", endAt === 12 && g.winner === -1 && /連続王手/.test(g.reason), "終局=" + endAt + "手目 勝者=" + g.winner + " " + g.reason);
  }
  // 棋譜の字
  {
    const S = P(L.START_SFEN);
    const mv = L.legalMoves(S).find(x => from(x) === sq(6, 2) && to(x) === sq(5, 2));
    check("棋譜の字：▲７六歩", L.moveText(S, mv) === "▲７六歩", L.moveText(S, mv));
  }
}

// 2b 練習問題：正解手が合法で期待どおり／間違いの手は ng／全問に正解が存在
{
  check("練習問題は5問以上", L.PUZZLES.length >= 5, L.PUZZLES.length + "問");
  const R = {};
  for (const Pz of L.PUZZLES) {
    const S = P(Pz.sfen), ls = L.legalMoves(S), before = L.posKey(S);
    const oks = ls.filter(mv => L.judgePuzzle(Pz, S, mv) === "ok");
    check("練習「" + Pz.title + "」：正解の手が合法手の中にあり、判定のあとも盤が元のまま", oks.length >= 1 && L.posKey(S) === before, "正解" + oks.length + "手／合法" + ls.length + "手");
    if (Pz.goal === "exact") {
      check("  exact：正解は答えの手と完全に一致", oks.length === Pz.ans.length && oks.every(mv => Pz.ans.some(a => a.f === from(mv) && a.t === to(mv) && a.p === pro(mv))));
    }
    R[Pz.id] = {S, ls, oks};
  }
  const ke = R.keima;
  check("桂：取れるのは歩のある升（５七→６五）だけが正解・もう一方の跳び先は不正解",
    ke.oks.length === 1 && to(ke.oks[0]) === sq(4, 3) && ke.ls.some(mv => from(mv) === sq(6, 4) && to(mv) === sq(4, 5) && L.judgePuzzle(L.PUZZLES[0], ke.S, mv) === "ng"));
  const na = R.naru;
  const naPlain = na.ls.filter(mv => from(mv) === sq(3, 1) && to(mv) === sq(2, 1) && !pro(mv))[0];
  check("成る：正解は「成る」の手のみ。同じ升への不成は near（行き先は合っている）", na.oks.length === 1 && pro(na.oks[0]) === 1 && L.judgePuzzle(L.PUZZLES[1], na.S, naPlain) === "near");
  const ck = R.check;
  check("王手：金を打って王手になる手が複数あり、遠い升への打ちは不正解",
    ck.oks.length >= 2 && ck.ls.filter(mv => from(mv) === 100 + 5 && to(mv) === sq(8, 0)).every(mv => L.judgePuzzle(L.PUZZLES[2], ck.S, mv) === "ng"), "王手になる打ち=" + ck.oks.length);
  const nf = R.nifu;
  check("二歩：５筋には歩を打つ手が合法手に無い・ほかの筋には打てる", nf.ls.filter(mv => from(mv) === 101 && to(mv) % 9 === 4).length === 0 && nf.oks.length > 0 && nf.oks.every(mv => to(mv) % 9 !== 4), "歩打ち=" + nf.oks.length);
  check("二歩の理由の文：５筋へ打とうとすると「二歩」と説明される",
    /二歩/.test(L.explainIllegal(nf.S, 101, sq(2, 4))) && !/二歩/.test(L.explainIllegal(nf.S, 101, sq(0, 4))));
  check("理由の文：打ち歩詰め／行き所のない駒／駒のある所／王手放置",
    /打ち歩詰め/.test(L.explainIllegal(P("k8/2G6/1S7/9/9/9/9/9/8K b P 1"), 101, sq(1, 0))) &&
    /行き所/.test(L.explainIllegal(P("4k4/9/9/9/9/9/9/9/4K4 b L 1"), 102, sq(0, 0))) &&
    /駒のある/.test(L.explainIllegal(nf.S, 101, sq(6, 4))) &&
    /王手/.test(L.explainIllegal(P("4k4/9/9/9/9/9/9/9/r3K4 b - 1"), sq(8, 4), sq(8, 5))));
  const ts = R.tsume;
  check("1手詰め：正解は玉の真下への金打ち（９…５二金）ただ1手", ts.oks.length === 1 && from(ts.oks[0]) === 105 && to(ts.oks[0]) === sq(1, 4), "正解=" + ts.oks.length);
  const ag = R.aigoma;
  check("合駒：正解は金を飛車と玉の間（５筋の２〜８段）に打つ手のみ・玉の移動は不正解",
    ag.oks.length >= 1 && ag.oks.every(mv => from(mv) === 105 && to(mv) % 9 === 4) && ag.ls.filter(mv => from(mv) === sq(8, 4)).every(mv => L.judgePuzzle(L.PUZZLES[5], ag.S, mv) === "ng"), "合駒=" + ag.oks.length);
}

// 2c 手合割（駒落ち）：公式の定義（日本将棋連盟 6.実戦）どおりの初期局面
{
  // 公式の定義を、index.html とは別に test 側で書く（上手＝後手から見た落とす駒の種類と枚数）
  const DEF = {
    hirate: {}, kyo: {L: 1}, kaku: {B: 1}, hisha: {R: 1}, hikyo: {R: 1, L: 1}, nimai: {R: 1, B: 1},
    yonmai: {R: 1, B: 1, L: 2}, rokumai: {R: 1, B: 1, L: 2, N: 2}, hachimai: {R: 1, B: 1, L: 2, N: 2, S: 2}
  };
  const FULL = {P: 9, L: 2, N: 2, S: 2, G: 2, B: 1, R: 1, K: 1};
  const LET = "PLNSGBRK";
  check("手合割は9種類（右香落ち・十枚落ちは一次資料で確かめられず入れない）", L.HANDICAPS.length === 9 && L.HANDICAPS.every(h => DEF[h.id]), L.HANDICAPS.map(h => h.name).join("・"));
  check("平手の初期局面は START_SFEN のまま", L.handicapSfen("hirate") === L.START_SFEN);
  for (const h of L.HANDICAPS) {
    const S = P(L.handicapSfen(h.id));
    const cnt = {1: {}, "-1": {}};
    for (let i = 0; i < 81; i++) { const p = S.b[i]; if (p) { const sg = p > 0 ? 1 : -1, ch = LET[Math.abs(p) - 1]; cnt[sg][ch] = (cnt[sg][ch] || 0) + 1; } }
    let ok = true, why = "";
    for (const k of LET) {
      if ((cnt[1][k] || 0) !== FULL[k]) { ok = false; why += " 下手" + k; }                       // 下手（先手側）は全駒
      if ((cnt[-1][k] || 0) !== FULL[k] - (DEF[h.id][k] || 0)) { ok = false; why += " 上手" + k; } // 上手は定義どおり落とす
    }
    const nGote = Object.values(cnt[-1]).reduce((a, b) => a + b, 0), nSente = Object.values(cnt[1]).reduce((a, b) => a + b, 0);
    const nDrop = Object.values(DEF[h.id]).reduce((a, b) => a + b, 0);
    check("手合割「" + h.name + "」：下手20枚・上手" + (20 - nDrop) + "枚（落とす" + nDrop + "枚）・種類も定義どおり・持ち駒なし",
      ok && nSente === 20 && nGote === 20 - nDrop && S.h[0].every(x => x === 0) && S.h[1].every(x => x === 0), why);
    const expectTurn = h.id === "hirate" ? 1 : -1;
    check("  最初の手番：" + (expectTurn === 1 ? "平手は先手" : "駒落ちは上手（後手側）から"), S.turn === expectTurn);
    check("  玉は両方とも定位置（下手５九・上手５一）", S.b[sq(8, 4)] === 8 && S.b[sq(0, 4)] === -8 && S.kp[0] === sq(8, 4) && S.kp[1] === sq(0, 4));
  }
  {
    // 香落ちは「角のある側」の香：上手の角(２二=列7)と同じ側＝１一（列8）が消え、９一（列0）は残る
    const S = P(L.handicapSfen("kyo"));
    check("香落ち：落ちるのは上手の１一の香（角と同じ側）。９一の香は残る", S.b[sq(0, 8)] === 0 && S.b[sq(0, 0)] === -2 && S.b[sq(1, 7)] === -6);
    const S2 = P(L.handicapSfen("hikyo"));
    check("飛香落ち：上手の飛(８二)と、角と同じ側の香(１一)が落ちる", S2.b[sq(1, 1)] === 0 && S2.b[sq(0, 8)] === 0 && S2.b[sq(1, 7)] === -6 && S2.b[sq(0, 0)] === -2);
    const S3 = P(L.handicapSfen("hachimai"));
    check("八枚落ち：上手に残るのは玉・金2・歩9だけ（２二・８二・段目の駒が全部無い）", S3.b[sq(0, 4)] === -8 && S3.b[sq(0, 3)] === -5 && S3.b[sq(0, 5)] === -5 && S3.b.filter(p => p < 0).length === 12);
  }
  // perft depth1〜2：例外なく数えられ、平手は 30・900
  const out = [];
  for (const h of L.HANDICAPS) {
    const S = P(L.handicapSfen(h.id)), before = L.posKey(S);
    let n1, n2, err = "";
    try { n1 = L.perft(S, 1); n2 = L.perft(S, 2); } catch (e) { err = String(e); }
    const okp = !err && n1 > 0 && n2 > 0 && L.posKey(S) === before && (h.id !== "hirate" || (n1 === 30 && n2 === 900));
    out.push(h.name + " " + n1 + "/" + n2);
    check("perft 手合割「" + h.name + "」depth1=" + n1 + " depth2=" + n2 + (h.id === "hirate" ? "（既存の 30・900 と一致）" : ""), okp, err);
  }
  // 駒落ちの対局：上手が先に指し、駒の数が保たれ、棋譜の最初の手は △
  {
    let ok = true, why = "";
    for (const h of L.HANDICAPS.slice(1)) {
      const g = L.newGameFrom(L.handicapSfen(h.id));
      const first = L.chooseMove(g.S, "weak");
      L.gamePlay(g, first);
      const nDrop = Object.values(DEF[h.id]).reduce((a, b) => a + b, 0);
      if (!/^△/.test(g.moves[0].text)) { ok = false; why += " " + h.name + "初手" + g.moves[0].text; }
      for (let k = 0; k < 3; k++) {
        const r = playGame([{level: "weak"}, {level: "weak"}], 300, L.handicapSfen(h.id));
        if (countPieces(r.g.S) !== 40 - nDrop) { ok = false; why += " " + h.name + "駒数" + countPieces(r.g.S); }
        if (r.g.moves.length && !/^△/.test(r.g.moves[0].text)) { ok = false; why += " " + h.name + "初手が△でない"; }
      }
    }
    check("駒落ちの対局（各3局・ランダム）：例外なし・駒数は 40−落とした枚数のまま・最初の手は上手（△）", ok, why);
  }
  // コンピュータ（ふつう）の駒落ち初手も合法
  {
    let ok = true;
    for (const h of L.HANDICAPS) { const S = P(L.handicapSfen(h.id)); const mv = L.chooseMove(S, "mid"); if (!L.legalMoves(S).includes(mv)) ok = false; }
    check("ふつうのコンピュータの駒落ち初手は全手合割で合法", ok);
  }
  console.log("perft まとめ(depth1/depth2)：" + out.join(" ／ "));
}

// 3 ランダム対ランダム30局
function countPieces(S) {
  let n = 0; for (const p of S.b) if (p) n++;
  for (let s = 0; s < 2; s++) for (let t = 1; t <= 7; t++) n += S.h[s][t];
  return n;
}
function playGame(cfgs, cap, sfen) {
  const g = L.newGameFrom(sfen);
  let plies = 0;
  while (!g.over && plies < cap) {
    const cfg = g.S.turn === 1 ? cfgs[0] : cfgs[1];
    const mv = L.chooseMove(g.S, cfg.level, cfg.opts);
    if (mv < 0) throw new Error("合法手があるのに -1 / または終局判定漏れ");
    if (!L.legalMoves(g.S).includes(mv)) throw new Error("非合法手が選ばれた");
    L.gamePlay(g, mv); plies++;
  }
  return {g, plies};
}
{
  let ok = true, err = "", mate = 0, draw = 0, capped = 0, maxPlies = 0;
  const t0 = Date.now();
  try {
    for (let k = 0; k < 30; k++) {
      const r = playGame([{level: "weak"}, {level: "weak"}], 400);
      if (countPieces(r.g.S) !== 40) { ok = false; err += " 駒数" + countPieces(r.g.S); }
      if (r.g.S.kp[0] < 0 || r.g.S.kp[1] < 0 || r.g.S.b[r.g.S.kp[0]] !== 8 || r.g.S.b[r.g.S.kp[1]] !== -8) { ok = false; err += " 玉の位置"; }
      maxPlies = Math.max(maxPlies, r.plies);
      if (!r.g.over) capped++; else if (r.g.winner === 0) draw++; else mate++;
    }
  } catch (e) { ok = false; err += " " + e; }
  check("ランダム対ランダム30局：例外なし・駒は常に40枚・玉は盤上（400手で打ち切り）", ok, "決着(詰み等)" + mate + " 引分" + draw + " 400手で打切り" + capped + " 最大" + maxPlies + "手 " + (Date.now() - t0) + "ms " + err);
}

// 4 ふつう vs 弱 10局、強 vs 弱 10局（色を交代）
function match(label, strongCfg, n, cap) {
  let sw = 0, ww = 0, dr = 0, un = 0;
  const t0 = Date.now();
  for (let k = 0; k < n; k++) {
    const sb = k % 2 === 0;
    const r = playGame(sb ? [strongCfg, {level: "weak"}] : [{level: "weak"}, strongCfg], cap);
    if (!r.g.over) { un++; continue; }
    if (r.g.winner === 0) dr++; else if ((r.g.winner === 1) === sb) sw++; else ww++;
  }
  return {sw, ww, dr, un, ms: Date.now() - t0};
}
{
  const r = match("mid", {level: "mid"}, 10, 300);
  check("ふつう vs 弱 10局でふつうの勝ちが多い（300手で打ち切り）", r.sw > r.ww, "ふつう" + r.sw + " 弱" + r.ww + " 引分" + r.dr + " 未了" + r.un + " " + r.ms + "ms");
}
{
  const r = match("strong", {level: "strong", opts: {timeMs: 100}}, 10, 300);
  check("強(1手100msに短縮) vs 弱 10局で強の勝ちが多い（300手で打ち切り）", r.sw > r.ww, "強" + r.sw + " 弱" + r.ww + " 引分" + r.dr + " 未了" + r.un + " " + r.ms + "ms");
}
// 強の1手の考える時間（実際の設定：既定 1000ms 上限）
{
  const g = L.newGameFrom();
  const times = [];
  for (let k = 0; k < 24 && !g.over; k++) {
    let mv;
    if (g.S.turn === 1) {
      const t0 = process.hrtime.bigint();
      mv = L.chooseMove(g.S, "strong");
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    } else mv = L.chooseMove(g.S, "weak");
    L.gamePlay(g, mv);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length, mx = Math.max(...times);
  check("強の1手の時間（既定1000ms上限・序盤12手）", mx < 1300, "平均" + avg.toFixed(0) + "ms 最大" + mx.toFixed(0) + "ms");
}

console.log(fail === 0 ? "\n全部通過" : "\n失敗 " + fail + " 件");
process.exit(fail ? 1 : 0);
