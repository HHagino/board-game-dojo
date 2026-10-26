// node perft_othello.js [深さ（既定 9）] [--controls]
// オセロ道場の index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込み（test.js と同じ）、n 手目を打ち終えた時点の
// 対局の数を数えて、公表値 OEIS A124004「Number of possible Reversi games at the end of the n-th ply」と照合する。
//   数え方：パスも1手に数える・n 手より前に終わった対局は n 手目に数えない。
//   ★ 2026-10-26：パスを数えない取り決めでは深さ 9 が 3005320（公表値 3005288）。深さ 9 までにパスの局面が 24 あり、
//   パスを1手に数えると一致した（終わった対局の扱いは深さ 9 までは結果に響かない＝4通りの取り決めで数えて確かめた）。
//   --controls：LOGIC をわざと1か所だけ壊した版で数え、どれも公表値と食い違うこと（照合が誤りを捕まえること）を確かめる。
// 公表値は https://oeis.org/A124004 （2026-10-26 に原文で確かめた・a(0) から）。
// 2026-10-26 Claude（Opus）。
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "othello", "index.html"), "utf8").replace(/\r\n/g, "\n");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.log("NG: ロジックの区間が見つからない"); process.exit(1); }
const A124004 = [1, 4, 12, 56, 244, 1396, 8200, 55092, 390216, 3005288, 24571056, 212258216];

// わざと壊す置き換え（old はロジックの中にちょうど1回出ること）
const BREAKS = {
  "右下の斜めを見ない": ["[1,-1],[1,0],[1,1]];", "[1,-1],[1,0],[1,0]];"],
  // ★「if (line.length && …」の line.length を外す置き換えは、壊れない（挟む石が0枚なら何も返さない＝等価ミュータント）ので使わない
  "返すのは最初の1枚だけ": ["for (var i = 0; i < line.length; i++) out.push(line[i]);", "out.push(line[0]);"],
  // ★ 列の端の判定は2か所（while と、そのあとの挟む石の判定）。while の側だけを外しても壊れない（あとの判定が端で止める＝
  //   等価ミュータント）。あとの判定の側だけを外す版は、白の列が h 列まで並ぶ形でしか現れず、9手目までの数えでは捕まらない。
  //   2か所とも外す版（下）は7手目から食い違う。前の test.js はどちらも見逃した＝2026-10-26 に端の試験を3つ足した（オセロの test.js）。
  "行の端で次の行へ回り込む（2か所）": [["while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r*8+c] === -player){", "while (r >= 0 && r < 8 && board[r*8+c] === -player){"],
                                ["if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r*8+c] === player){", "if (line.length && r >= 0 && r < 8 && board[r*8+c] === player){"]],
  "最初の並びが逆": ["b[27] = WHITE; b[36] = WHITE; // d4, e5", "b[27] = BLACK; b[36] = BLACK; // d4, e5"],
};

function load(src){
  return new Function(src + "\nreturn {BLACK,WHITE,initBoard,legalMoves,applyMove};")();
}
function counter(L){
  return function perft(board, player, d){
    if (d === 0) return 1;
    const ms = L.legalMoves(board, player);
    if (!ms.length){
      if (!L.legalMoves(board, -player).length) return 0; // 両者打てない＝n 手目より前に終わった
      return perft(board, -player, d - 1); // パス（1手に数える）
    }
    let n = 0;
    for (const i of ms) n += perft(L.applyMove(board, i, player), -player, d - 1);
    return n;
  };
}
function run(L, D){
  const perft = counter(L), out = [];
  for (let d = 1; d <= D; d++) out.push(perft(L.initBoard(), L.BLACK, d));
  return out;
}

const args = process.argv.slice(2);
const D = Math.min(+(args.find(a => /^\d+$/.test(a)) || 9), A124004.length - 1);
if (args.includes("--controls")){
  let miss = 0;
  const DC = Math.min(D, 8); // 盤の端の誤りは、浅い数え（6手目まで）では端に届かず見逃した＝8手目まで数える
  console.log("━━ 対照：わざと壊した " + Object.keys(BREAKS).length + " 通り（深さ 1〜" + DC + "）━━");
  for (const [name, br] of Object.entries(BREAKS)){
    let src = m[0];
    for (const [o, n] of (Array.isArray(br[0]) ? br : [br])){ // 置き換えは1組か、組の並び
      const k = src.split(o).length - 1;
      if (k !== 1) { console.log("NG: 「" + name + "」の old が " + k + " 回出る"); process.exit(1); }
      src = src.replace(o, () => n);
    }
    const got = run(load(src), DC);
    const caught = got.some((v, i) => v !== A124004[i + 1]);
    if (!caught) miss++;
    console.log("  " + (caught ? "✅ 捕まえた" : "❌ 見逃した") + "  " + name + "  " + got.join(" / "));
  }
  console.log("━━ " + (Object.keys(BREAKS).length - miss) + "／" + Object.keys(BREAKS).length + " を捕まえた ━━");
  process.exit(miss ? 1 : 0);
}
const L = load(m[0]), perft = counter(L);
let fail = 0;
for (let d = 1; d <= D; d++){
  const t0 = Date.now(), n = perft(L.initBoard(), L.BLACK, d);
  const ok = n === A124004[d];
  if (!ok) fail++;
  console.log((ok ? "OK  " : "NG  ") + "深さ " + d + " = " + n + "（OEIS A124004 は " + A124004[d] + "）" + (Date.now() - t0) + "ms");
}
console.log(fail ? "失敗 " + fail + " 件" : "全部一致");
process.exit(fail ? 1 : 0);
