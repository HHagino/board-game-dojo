// node dump_shogi.js <局数> <種> [--break <名前>] [--only-end <mate|nomove|sennichite|perpetual>]
// 将棋道場の index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込み（test.js と同じ）、乱数の対局を打って、
// 1局ごとに JSON を1行 stdout へ出す。突き合わせは check_shogi.py（python-shogi）が受け持つ。
// --break：LOGIC の文字列を1か所だけ置き換えてから読む（わざと壊した版＝突き合わせが本当に誤りを捕まえるかの対照）。
// --only-end：こちらの終局がその種類の局だけを出す（連続王手の千日手のようなまれな終局を、多くの局から拾って突き合わせる用。
//   局の番号 g は通しのまま＝同じ種で出し直せる）。
// 1局の JSON：{g, hc, sfen（開始局面）, bias:[往復, 王手, 王手の側], plies:[[指した手 USI, その局面の合法手（USI・並べ替えて空白区切り）,
//   王手か 0/1, 指したあとの局面（SFEN の手数を除いた3つ）, 指したあとの終局（""／mate／nomove／sennichite／perpetual）], …],
//   end, winner（1＝先手・-1＝後手・0）, capped（手数の上限で打ち切り）, error（例外の文字。あれば）}
// 2026-10-26 Claude（Opus）。
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "shogi", "index.html"), "utf8").replace(/\r\n/g, "\n");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.error("NG: ロジックの区間が見つからない"); process.exit(2); }

// わざと壊す置き換え（old はロジックの中にちょうど1回出ること）。どれも1行の書き間違いで起こりうる誤り。
const BREAKS = {
  "二歩を許す": ["if (t === 1 && (pawnCol[to2 % 9] || (s === 1 ? r3 === 0 : r3 === 8))) continue;", "if (t === 1 && (s === 1 ? r3 === 0 : r3 === 8)) continue;"],
  "打ち歩詰めを許す": ["if ((mv & 255) === 101 && inCheck(S, -s) && !hasLegal(S))", "if (false && inCheck(S, -s) && !hasLegal(S))"],
  "成れる段を1段ずらす": ["z1 = s === 1 ? r1 <= 2 : r1 >= 6", "z1 = s === 1 ? r1 <= 3 : r1 >= 5"],
  "桂が不成で２段目へ行ける": ["(t === 3 && (s === 1 ? r1 <= 1 : r1 >= 7))", "(t === 3 && (s === 1 ? r1 <= 0 : r1 >= 8))"],
  "桂の王手を見落とす": ["var r2 = kr + 2 * e;", "var r2 = kr - 2 * e;"],
  "千日手を3回で": ["if (idx.length >= 4){", "if (idx.length >= 3){"],
};

const args = process.argv.slice(2);
if (args.includes("--list-breaks")) { console.log(JSON.stringify(Object.keys(BREAKS))); process.exit(0); }
const N = +(args[0] || 30), SEED = +(args[1] || 1);
const oi = args.indexOf("--only-end"), ONLY_END = oi >= 0 ? args[oi + 1] : null;
let src = m[0];
const bi = args.indexOf("--break");
if (bi >= 0){
  const name = args[bi + 1], br = BREAKS[name];
  if (!br) { console.error("NG: 知らない --break：" + name + "（ある＝" + Object.keys(BREAKS).join("／") + "）"); process.exit(2); }
  const n = src.split(br[0]).length - 1;
  if (n !== 1) { console.error("NG: --break「" + name + "」の old が " + n + " 回出る（1回でなければ壊さない）"); process.exit(2); }
  src = src.replace(br[0], () => br[1]);
}
const L = new Function(src + "\nreturn {START_SFEN,parseSfen,legalMoves,inCheck,doMove,undoMove,newGameFrom,gamePlay,HANDICAPS,handicapSfen,moveToUsi};")();

// 種つきの乱数（mulberry32）＝同じ種なら同じ対局
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(SEED);

// 局面の SFEN（手数を除く「盤 手番 持ち駒」。持ち駒の順は python-shogi の sfen() と同じ＝先手 RBGSNLP → 後手 rbgsnlp）
const LET = "PLNSGBRK";
function sfen3(S){
  const rows = [];
  for (let r = 0; r < 9; r++){
    let row = "", e = 0;
    for (let c = 0; c < 9; c++){
      const p = S.b[r * 9 + c];
      if (!p) { e++; continue; }
      if (e) { row += e; e = 0; }
      const t = Math.abs(p), ch = t > 8 ? "+" + LET.charAt(t - 9) : LET.charAt(t - 1);
      row += p > 0 ? ch : ch.toLowerCase();
    }
    if (e) row += e;
    rows.push(row);
  }
  let hand = "";
  for (let si = 0; si < 2; si++) for (let t = 7; t >= 1; t--){
    const n = S.h[si][t];
    if (n > 0) hand += (n > 1 ? n : "") + (si === 0 ? LET.charAt(t - 1) : LET.charAt(t - 1).toLowerCase());
  }
  return rows.join("/") + " " + (S.turn === 1 ? "b" : "w") + " " + (hand || "-");
}
const END = {"詰み": "mate", "指す手がない": "nomove", "千日手": "sennichite"};
function endCode(G){ return !G.over ? "" : END[G.reason] || (/連続王手/.test(G.reason) ? "perpetual" : "other:" + G.reason); }

// 開始局面：平手を多め（6割）・残りは手合割8種を等しく
function pickStart(){
  if (R() < 0.6) return "hirate";
  return L.HANDICAPS[1 + Math.floor(R() * (L.HANDICAPS.length - 1))].id;
}
// 指し方の癖（局ごとに乱数で決める）：往復＝自分の前の手を戻す手を選ぶ確率（千日手を起こす）／王手＝王手になる手を選ぶ確率
// （詰み・打ち歩詰め・連続王手の局面を増やす）／王手の側＝王手の癖を付ける側（0＝両方・1＝先手だけ・-1＝後手だけ）。
// どちらも 0 の局は、取る手を3倍に重みづけしたランダム（道場の「弱い」と同じ）。
// ★ 連続王手の千日手はこの癖でもまれ（2026-10-26 実測：1000局で 4〜10局。癖を強めても差は見えなかった）＝
//   確かめるときは check_shogi.py --games 1500 --seed 7 --only-end perpetual で拾う。
const BACK = [0, 0, 0.5, 0.9], CHK = [0, 0.3, 0.6, 0.95], CHK_SIDE = [0, 0, 1, -1];
function givesCheck(S, mv){ const cap = L.doMove(S, mv), c = L.inCheck(S, S.turn); L.undoMove(S, mv, cap); return c; }
function choose(S, ms, prevOwn, bias){
  let cand = ms;
  if (bias[1] > 0 && (bias[2] === 0 || bias[2] === S.turn) && R() < bias[1]){
    const ch = ms.filter(mv => givesCheck(S, mv));
    if (ch.length) cand = ch;
  }
  if (bias[0] > 0 && prevOwn >= 0 && (prevOwn & 255) < 100 && !((prevOwn >> 16) & 1) && R() < bias[0]){
    const rev = ((prevOwn >> 8) & 255) | ((prevOwn & 255) << 8);
    if (cand.includes(rev)) return rev;
  }
  let wsum = 0; const ws = cand.map(mv => { const w = S.b[(mv >> 8) & 255] !== 0 ? 3 : 1; wsum += w; return w; });
  let x = R() * wsum;
  for (let i = 0; i < cand.length; i++){ x -= ws[i]; if (x < 0) return cand[i]; }
  return cand[cand.length - 1];
}

const MAX_PLY = 256;
for (let g = 0; g < N; g++){
  const hc = pickStart(), sfen = L.handicapSfen(hc);
  const bias = [BACK[Math.floor(R() * BACK.length)], CHK[Math.floor(R() * CHK.length)], CHK_SIDE[Math.floor(R() * CHK_SIDE.length)]];
  const plies = [];
  let G = null, capped = false, error = "";
  try {
    G = L.newGameFrom(sfen);
    const played = []; // 両方の手を順に（2つ前＝手番の側の前の手）
    while (!G.over){
      if (plies.length >= MAX_PLY) { capped = true; break; }
      const S = G.S, ms = L.legalMoves(S);
      if (!ms.length) { error = "終局になっていないのに合法手が0"; break; }
      const mv = choose(S, ms, played.length >= 2 ? played[played.length - 2] : -1, bias);
      const legal = ms.map(L.moveToUsi).sort().join(" ");
      const rec = [L.moveToUsi(mv), legal, L.inCheck(S, S.turn) ? 1 : 0];
      L.gamePlay(G, mv);
      played.push(mv);
      rec.push(sfen3(G.S), endCode(G));
      plies.push(rec);
    }
  } catch (e) { error = String(e && e.stack || e).split("\n").slice(0, 2).join(" "); }
  const out = {g: g, hc: hc, sfen: sfen, bias: bias, plies: plies, end: G ? endCode(G) : "", winner: G ? G.winner : 0, capped: capped};
  if (error) out.error = error;
  if (ONLY_END && out.end !== ONLY_END && !error) continue;
  process.stdout.write(JSON.stringify(out) + "\n");
}
