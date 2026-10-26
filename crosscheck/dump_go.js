// node dump_go.js <局数> <種> [--break <名前>]
// 囲碁（9路）の index.html の LOGIC-BEGIN〜LOGIC-END をそのまま読み込み（test.js と同じ new Function）、乱数の対局を打って、
// 1局ごとに JSON を1行 stdout へ出す。突き合わせは check_go.py（sgfmill 1.1.1）が受け持つ。
// --break：LOGIC の文字列を1か所だけ置き換えてから読む（わざと壊した版＝突き合わせが本当に誤りを捕まえるかの対照）。
// 手は本対局と同じ playMove／passMove ではなく、友だち対局の adapter（GO_ADAPTER.play に "E5"／"pass" の文字列）で打つ
// ＝座標の呼び名（coordName／parseCoord）も一緒に試す。合法手の一覧は legalMoves（＝playMove が null でない点）。
// 2026-10-26 Claude（Fable）。
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "go", "index.html"), "utf8").replace(/\r\n/g, "\n");
const m = html.match(/\/\/ ===== LOGIC-BEGIN[\s\S]*?\/\/ ===== LOGIC-END =====/);
if (!m) { console.error("NG: ロジックの区間が見つからない"); process.exit(2); }

// わざと壊す置き換え（old はロジックの中にちょうど1回出ること）。実際にありそうな誤りだけ。
const BREAKS = {
  // playMove の入口でコウの点を弾かない＝取られた直後に取り返せる
  "コウをすぐ取り返せる": ["st.board[idx] !== 0 || idx === st.ko", "st.board[idx] !== 0"],
  // 置いた石の呼吸点が0でも戻さない＝自殺手を許す（呼吸点0の石が盤に残る）
  "自殺手を許す": ["if (libs === 0){ board[idx] = 0; return null; }", "if (false){ board[idx] = 0; return null; }"],
  // 取った石を caps に数えるだけで盤から除かない
  "取った石を盤から除かない": ["for (s = 0; s < _g.length; s++){ board[_g[s]] = 0; caps.push(_g[s]); }", "for (s = 0; s < _g.length; s++){ caps.push(_g[s]); }"],
  // コウの条件から「置いた石の呼吸点が1」を落とす＝1子取るたびにコウにする（取り返せる訳でもない所を禁じる）
  "1子取るたびにコウ": ["var ko = (caps.length === 1 && _ownSize === 1 && _ownLibs === 1) ? caps[0] : -1;", "var ko = (caps.length === 1) ? caps[0] : -1;"],
  // 両方の色に接する空点（ダメ）を黒の地に数える
  "ダメを黒の地に数える": ["var o = (tb && !tw) ? BLACK : ((tw && !tb) ? WHITE : 0);", "var o = tb ? BLACK : (tw ? WHITE : 0);"],
  // アゲハマの色を取り違える（白が取った石を黒のアゲハマに）
  "アゲハマの色を取り違える": ["capB: st.capB + (st.player === BLACK ? caps.length : 0),", "capB: st.capB + (st.player === WHITE ? caps.length : 0),"],
};

const args = process.argv.slice(2);
if (args.includes("--list-breaks")) { console.log(JSON.stringify(Object.keys(BREAKS))); process.exit(0); }
const N = +(args[0] || 30), SEED = +(args[1] || 1);
let src = m[0];
const bi = args.indexOf("--break");
if (bi >= 0){
  const name = args[bi + 1], br = BREAKS[name];
  if (!br) { console.error("NG: 知らない --break：" + name + "（ある＝" + Object.keys(BREAKS).join("／") + "）"); process.exit(2); }
  const n = src.split(br[0]).length - 1;
  if (n !== 1) { console.error("NG: --break「" + name + "」の old が " + n + " 回出る（1回でなければ壊さない）"); process.exit(2); }
  src = src.replace(br[0], () => br[1]);
}
const L = new Function(src + "\nreturn {BLACK,WHITE,PASS,NN,SIZE,NB,initState,playMove,passMove,isOver,legalMoves,coordName,parseCoord,finalResult,defaultKomi,RULE_KOMI,GO_ADAPTER};")();
const {BLACK, WHITE, NN} = L;

// 種つきの乱数（mulberry32）＝同じ種なら同じ対局。局ごとに別の流れ（種×局）にして、1局の長さが次の局に響かないように
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 盤を 81 字の文字列に（上の行から・左から。X=黒 O=白 .=空）＝check_go.py はこの向きで読む
function boardStr(b){ let s = ""; for (let i = 0; i < NN; i++) s += b[i] === BLACK ? "X" : b[i] === WHITE ? "O" : "."; return s; }
// 乱打ちの方針（dump だけの自前の定義・LOGIC の isOwnEye は使わない）：上下左右が全部自分の石（盤の端は数えない）の空点＝自分の眼は埋めない
function ownEye(b, i, p){ const nb = L.NB[i]; for (let k = 0; k < nb.length; k++) if (b[nb[k]] !== p) return false; return true; }

const HANDIS = [0, 0, 2, 3, 4, 5];        // 局番号 % 6 で回す（平手が 2/6）
const RULES = ["area", "stone", "japan"]; // adapter の rule は局番号 % 3 で回す（結果の文字列を出すため。数え方3つの数字は毎局 finalResult で出す）
const MAX_PLY = 300, PASS_RATE = 0.03;    // 乱打ちは終わらないことがある＝300手で打ち切り（capped: true）。3% で理由なくパス（パス後のコウの解除・ダメの残る終局を起こすため）
for (let g = 0; g < N; g++){
  const R = rng((SEED * 1000003 + g) >>> 0);
  const handi = HANDIS[g % HANDIS.length], rule = RULES[g % RULES.length];
  let st = L.GO_ADAPTER.initial(handi ? String(handi) : "", rule);
  const init = boardStr(st.board), first = st.player === BLACK ? "b" : "w";
  const plies = [];
  let capped = false, reason = "";
  while (!L.isOver(st)){
    if (plies.length >= MAX_PLY) { capped = true; break; }
    const legal = L.legalMoves(st);                       // 昇順（legalMoves は 0..80 の順に調べる）
    const p = st.player, cand = legal.filter(i => !ownEye(st.board, i, p));
    let mv;                                               // 交点の番号か -1（パス）
    if (!cand.length || R() < PASS_RATE) mv = -1;
    else mv = cand[Math.floor(R() * cand.length)];
    const name = mv < 0 ? "pass" : L.coordName(mv);
    const ns = L.GO_ADAPTER.play(st, name);
    if (!ns) { reason = "adapter が手を断った " + name; break; }
    st = ns;
    // [合法手の一覧（打つ前）, 打った手の番号, 打った手の呼び名, 打ったあとの盤, コウの点, 黒のアゲハマ, 白のアゲハマ]
    plies.push([legal, mv, name, boardStr(st.board), st.ko, st.capB, st.capW]);
  }
  const komi = {}, fin = {};
  for (const r of RULES){
    komi[r] = L.defaultKomi(r, handi);
    const x = L.finalResult(st.board, null, r, {komi: komi[r], capB: st.capB, capW: st.capW});  // 盤の石は全部生き（死に石は選ばない）
    fin[r] = {b: x.b, w: x.w, komi: x.komi, margin: x.margin, winner: x.winner, stB: x.stB, stW: x.stW, terrB: x.terrB, terrW: x.terrW, prisB: x.prisB, prisW: x.prisW};
  }
  const res = L.GO_ADAPTER.result(st);                   // 終局なら {winner, text}、まだなら null
  process.stdout.write(JSON.stringify({g: g, handi: handi, rule: rule, first: first, init: init, plies: plies, over: L.isOver(st), capped: capped,
    reason: reason, komi: komi, final: fin, adapter: res}) + "\n");
}
