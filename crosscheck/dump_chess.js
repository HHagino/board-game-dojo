// node dump_chess.js <局数> <種> [--break <名前>]
// チェス道場の index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込み（test.js と同じ）、乱数の対局を打って、
// 1局ごとに JSON を1行 stdout へ出す。突き合わせは check_chess.py（python-chess）が受け持つ。
// --break：LOGIC の文字列を1か所だけ置き換えてから読む（わざと壊した版＝突き合わせが本当に誤りを捕まえるかの対照）。
// 2026-10-26 Claude（Opus）。
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "chess", "index.html"), "utf8").replace(/\r\n/g, "\n");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.error("NG: ロジックの区間が見つからない"); process.exit(2); }

// わざと壊す置き換え（old はロジックの中にちょうど1回出ること）
const BREAKS = {
  "アンパッサンを生成しない": ["else if (t === s.e && b[t] === 0) out.push(mk(sq, t, 0, true));", "else if (false) out.push(mk(sq, t, 0, true));"],
  "通り道が利いていてもキャスリング": ["&& !attacked(b, base+5, -side) ", "&& true "],
  "王手されていてもキャスリング": ["(c & (kbit | qbit)) && !attacked(b, sq, -side)", "(c & (kbit | qbit))"],
  "成りはクイーンだけ": ["out.push(mk(f,t,5), mk(f,t,4), mk(f,t,3), mk(f,t,2));", "out.push(mk(f,t,5));"],
  "ルークを取られてもキャスリングの権利が残る": ["c: s.c & CM[m.f] & CM[m.t]", "c: s.c & CM[m.f]"],
  "ナイト1つを駒不足に数えない": ["(kind === 2 || kind === 3)", "(kind === 3)"],
  "50手を1手早く": ["if (s.h >= 100) return {kind: \"fifty\"", "if (s.h >= 99) return {kind: \"fifty\""],
  "同じ色の升のビショップを駒不足に数えない": ["return bishops === n && (light === 0 || light === n);", "return false;"],
};

const args = process.argv.slice(2);
const N = +(args[0] || 200), SEED = +(args[1] || 1);
let src = m[0];
const bi = args.indexOf("--break");
if (bi >= 0){
  const name = args[bi + 1], br = BREAKS[name];
  if (!br) { console.error("NG: 知らない --break：" + name + "（ある＝" + Object.keys(BREAKS).join("／") + "）"); process.exit(2); }
  const n = src.split(br[0]).length - 1;
  if (n !== 1) { console.error("NG: --break「" + name + "」の old が " + n + " 回出る（1回でなければ壊さない）"); process.exit(2); }
  src = src.replace(br[0], () => br[1]);
}
if (args.includes("--list-breaks")) { console.log(JSON.stringify(Object.keys(BREAKS))); process.exit(0); }
const L = new Function(src + "\nreturn {WHITE,BLACK,fromFEN,startState,legalMoves,makeMove,inCheck,san,posKey,gameResult,sqName,handicapFEN};")();

// 種つきの乱数（mulberry32）＝同じ種なら同じ対局
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(SEED);
const PC = " pnbrqk";
function boardFEN(b){ // 盤だけの FEN（python-chess の board_fen() と同じ形）
  const rows = [];
  for (let r = 7; r >= 0; r--){
    let row = "", e = 0;
    for (let f = 0; f < 8; f++){
      const p = b[r*8+f];
      if (!p) { e++; continue; }
      if (e) { row += e; e = 0; }
      const ch = PC.charAt(Math.abs(p)); row += p > 0 ? ch.toUpperCase() : ch;
    }
    if (e) row += e;
    rows.push(row);
  }
  return rows.join("/");
}
// キャスリングの権利（FEN の第3欄と同じ書き方。乱数の対局では権利の取り違えが合法手に現れにくいので、毎手そのまま比べる）
const castling = (c) => ((c & 1 ? "K" : "") + (c & 2 ? "Q" : "") + (c & 4 ? "k" : "") + (c & 8 ? "q" : "")) || "-";
const PROMO = {2: "n", 3: "b", 4: "r", 5: "q"};
const uci = (mv) => L.sqName(mv.f) + L.sqName(mv.t) + (mv.p ? PROMO[mv.p] : "");
// 開始局面：平手が多め・ハンデ8通り・キャスリングやアンパッサンや成りが起きやすい既知の局面（chessprogramming の perft の局面）
const TRICKY = [
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
  "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
  "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
];
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
function pickStart(i){
  const u = R();
  if (u < 0.6) return START;
  if (u < 0.8) { const k = ["pawn", "knight", "rook", "queen"][Math.floor(R() * 4)]; return L.handicapFEN(k, R() < 0.5 ? L.WHITE : L.BLACK); }
  return TRICKY[i % TRICKY.length];
}
const MAX_PLY = 1000;
for (let g = 0; g < N; g++){
  const fen = pickStart(g);
  let s = L.fromFEN(fen);
  const keys = [L.posKey(s)], plies = [];
  let res = L.gameResult(s, keys), capped = false;
  while (!res){
    if (plies.length >= MAX_PLY) { capped = true; break; }
    const ms = L.legalMoves(s);
    const mv = ms[Math.floor(R() * ms.length)];
    const legal = ms.map(uci).sort().join(" ");
    const rec = [uci(mv), legal, L.inCheck(s) ? 1 : 0, L.san(s, mv)];
    s = L.makeMove(s, mv);
    keys.push(L.posKey(s));
    res = L.gameResult(s, keys);
    rec.push(boardFEN(s.b), res ? res.kind : "", castling(s.c), s.h);
    plies.push(rec);
  }
  process.stdout.write(JSON.stringify({g: g, fen: fen, plies: plies, end: res ? res.kind : "", capped: capped}) + "\n");
}
