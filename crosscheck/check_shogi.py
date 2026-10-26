#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将棋道場のロジックを python-shogi（1.1.1・GPL-3.0-only）と突き合わせる（差分テスト）。

  python check_shogi.py [--games N] [--seed S]   # 乱数の対局を N 局（既定 30＝この PC で約 50 秒）→ 毎手の答えを python-shogi と比べる
  python check_shogi.py --controls               # わざと壊した版（dump_shogi.js の BREAKS）を1つずつ当て、どれも食い違いが出るか
                                                 #（各 最大 100 局・最初の食い違いで次へ）
  python check_shogi.py --games 1500 --seed 7 --only-end perpetual
                                                 # こちらの終局が連続王手の千日手の局だけを拾って突き合わせる（まれな終局の確かめ）
python は sys.executable のまま動く（CI では素の python に pip install python-shogi==1.1.1）。node は PATH の "node"。

比べるもの（毎手）
  1. 合法手の集合（USI。成る手は末尾に +、打つ手は P*5e）
  2. 王手か（手番の側の玉）
  3. 指した手が参照で合法か（合法でなければその局はそこで止める＝参照の盤は push で検査しないため）
  4. 指したあとの局面（盤・手番・持ち駒。SFEN の手数を除いた3つ）
  5. 終局：こちら mate↔参照 is_checkmate（合法手0・王手）／nomove↔合法手0・王手なし（is_stalemate）／
     sennichite・perpetual↔is_fourfold_repetition（参照は連続王手を区別しないので、ここは両方「同一局面4回」として比べる）。
  6. 連続王手の千日手（補助の判定）：参照の実装に判定が無いので、参照の is_check() の列から、日本将棋連盟の定義で判定し直して
     こちらの勝ち負けと比べる。範囲は「今の局面が初めて出た所から今まで」（こちらの updateResult と同じ取り方）。
     ★ これは参照の実装の答えではない（参照の王手の判定と局面の同一の判定だけを借りた、こちらの書き直し）。

python-shogi で確かめたこと（.venv/Lib/site-packages/shogi/__init__.py 1.1.1 の行番号）
  - generate_pseudo_legal_moves 730–811：盤上の手は can_move_without_promotion（485–499：先手の歩・香は1段目、桂は1〜2段目へ
    不成では行けない。後手は逆）なら不成の手、can_promote（476–482：歩香桂銀角飛だけ・移動元か移動先が敵陣3段）なら成る手を出す。
    打つ手は空き升で can_move_without_promotion を満たし、is_double_pawn（1090–1093：成っていない自分の歩が同じ筋にある＝二歩。
    と金は数えない）でないとき。
  - generate_legal_moves 934–972：擬似合法手から is_suicide_or_check_by_dropping_pawn（879–889）を除く。
    was_suicide 891–896：指した側の玉に相手の利きがあれば違法（王手放置・利きに玉を動かす・釘付けの駒を動かすを、この一つで扱う）。
    was_check_by_dropping_pawn 898–932：打ち歩詰め＝歩を打って王手（916–918）→ 玉の行き先（歩を取るのも含む）が全部相手に
    利かれている（921–926）→ 玉以外に歩に利いている駒が無い（929–930）。
    ★ 限界：929 は「玉以外で歩に利く駒があるか」だけを見て、その駒が釘付け（歩を取ると自玉に王手がかかる）かを見ない
    （900–901 のコメント「we don't consider suicide of a king」）。釘付けの駒しか歩を取れないときは、本当は打ち歩詰めなのに
    参照は合法手に入れる。899 で「最後の審判」（Nuita 1997）の場合も考えないと書いてある。
  - is_check 837–838／is_checkmate 1054–1063／is_stalemate 1065–1074（どちらも王手かと合法手の有無だけ）。
  - is_fourfold_repetition 1076–1088：transpositions[zobrist] >= 4（どこで出てもよい・続けてでなくてよい）。transpositions は
    set_sfen（1385）で開始局面を1回と数え、push（1172–1173）で足す。zobrist_hash 1507–1537＝盤・手番・先手の持ち駒
    （後手の持ち駒は、駒の総数が一定なので盤と先手の持ち駒から決まる）。
  - is_game_over 1036–1052：合法手0か同一局面4回だけ。連続王手の千日手・入玉宣言・持将棋は無い（こちらも入玉宣言・持将棋は無い）。
  - 升の番号（Move.py 12–22 SQUARE_NAMES・__init__.py 106–116 SQUARES）：0＝9a … 80＝1i で、こちらの盤の添字（段*9＋列、列0＝９筋）と同じ。
  - push 1127–1173 は検査をしない（「No validation is performed」1132）。だから指した手は先に参照の合法手にあるかを見る。

日本将棋連盟の定義（一次資料・2026-10-26 に本文を取って語を当てた）
  - 対局規則 https://www.shogi.or.jp/match/taikyoku_rules/ 第8条第1項「千日手とは、盤面（盤上の駒の配置）・双方の持ち駒・
    手番のすべてが同一となる局面（同一局面）が4回発生した場合を指す。」／第8項「連続王手の千日手は反則である（第10条1項の五参照）。」
    第10条第1項「以下に該当する反則を対局中に犯した場合、反則を犯した対局者は即負けとなる。」三「打ち歩詰め（持ち駒の歩を打って
    解除不能な王手をかける行為）」。
  - よくある質問 https://www.shogi.or.jp/faq/rules/「王手をかけつづけて、同一局面が四回生じた場合は、王手をかけ続けたほうの負け
    となります。全部の手が王手でない場合は、通常の千日手と同様に引き分けとなります。」
    ★「王手をかけつづけて」がどこから数えるかは、どちらの頁にも書いていない（確かめられなかった）。補助の判定は
    「今の局面が初めて出た所から」で数える（こちらの実装と同じ。ここは定義の取り方の違いになりうる）。

除くもの（名前つき・件数を出す・黙って捨てない）
  - 「参照の限界：打ち歩詰めで歩を取れる駒が釘付けかを見ない」：参照だけにある P*xx のうち、参照の盤でその歩を打つと
    相手に参照の合法手が0で王手（＝本当に打ち歩詰め）になるもの。これだけを除く。
2026-10-26 Claude（Opus）。
"""
import argparse, json, os, subprocess, sys, time
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import shogi

try:
    from importlib.metadata import version as _ver
    SHOGI_VER = _ver("python-shogi")
except Exception:
    SHOGI_VER = "?"

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, "dump_shogi.js")
HC_NAME = {"hirate": "平手", "kyo": "香落ち", "kaku": "角落ち", "hisha": "飛車落ち", "hikyo": "飛香落ち",
           "nimai": "二枚落ち", "yonmai": "四枚落ち", "rokumai": "六枚落ち", "hachimai": "八枚落ち"}
END_NAME = {"mate": "詰み", "nomove": "指す手がない", "sennichite": "千日手", "perpetual": "連続王手の千日手"}
PIECE_JA = {"P": "歩", "L": "香", "N": "桂", "S": "銀", "G": "金", "B": "角", "R": "飛"}
EXCL_PIN = "参照の限界：打ち歩詰めで歩を取れる駒が釘付けかを見ない（__init__.py 929）"


def run_dump(games, seed, brk=None, only_end=None):
    cmd = ["node", DUMP, str(games), str(seed)] + (["--break", brk] if brk else []) + (["--only-end", only_end] if only_end else [])
    return cmd, subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", cwd=HERE)


def finish(cmd, p, stopped_early):
    if stopped_early and p.poll() is None:
        p.kill()
    _, err = p.communicate()
    if not stopped_early and p.returncode != 0:
        raise SystemExit("NG: dump が止まった（" + " ".join(cmd) + "）\n" + (err or ""))


def sfen3(b):
    return " ".join(b.sfen().split(" ")[:3])


def legal_set(b):
    return {m.usi() for m in b.legal_moves}


def kind_of(b, u):
    """食い違った手の分類（どこが怪しいかの見当をつけるため）。"""
    if u[1] == "*":
        return "打つ（" + PIECE_JA.get(u[0], u[0]) + "）"
    if u.endswith("+"):
        return "成る"
    try:
        pt = b.piece_type_at(shogi.Move.from_usi(u).from_square)
    except Exception:
        return "盤上"
    if pt == shogi.KING:
        return "玉"
    if pt in (shogi.PAWN, shogi.LANCE, shogi.KNIGHT):
        return "不成（歩香桂）"
    return "盤上"


def is_true_pawn_drop_mate(b, u):
    """参照の盤で u（P*xx）を打つと、相手に参照の合法手が0で王手か（＝本当の打ち歩詰め）。"""
    m = shogi.Move.from_usi(u)
    b.push(m)
    try:
        return b.is_check() and not b.legal_moves
    finally:
        b.pop()


def pawn_check_square(b):
    """手番の側が歩を打てば相手の玉に王手になる升（盤の外なら None）。"""
    ks = b.king_squares[b.turn ^ 1]
    if ks is None:
        return None
    sq = ks + 9 if b.turn == shogi.BLACK else ks - 9  # 先手の歩は上（添字が小さい側）に利く
    return sq if 0 <= sq < 81 else None


def perpetual_aux(hist):
    """連続王手の千日手の補助の判定。hist＝[(局面の鍵, 手番, 手番の玉が王手か)]。返り値＝勝った側（1 先手／-1 後手）か 0。"""
    key = hist[-1][0]
    i0 = next(j for j, h in enumerate(hist) if h[0] == key)
    for X, win in ((shogi.BLACK, -1), (shogi.WHITE, 1)):  # X が王手をかけ続けたら X の負け（こちらと同じく先手から見る）
        after = [h for h in hist[i0:] if h[1] == X ^ 1]  # X が指した直後の局面
        if after and all(h[2] for h in after):
            return win
    return 0


def compare(games, stop_at_first=False):
    st = Counter()
    cov = Counter()
    bad = Counter()
    excl = Counter()
    excl_ex = []
    first = []
    hcs = Counter()
    ends = Counter()

    def ng(kind, g, ply, sfen, detail):
        bad[kind] += 1
        if len(first) < 10:
            first.append(f"[{kind}] 局{g} {ply}手目の前 {sfen}\n      {detail}")

    for G in games:
        st["局"] += 1
        hcs[G["hc"]] += 1
        ends["打ち切り" if G["capped"] else END_NAME.get(G["end"], G["end"] or "（なし）")] += 1
        b = shogi.Board(G["sfen"])
        ref = legal_set(b)
        hist = [(b.zobrist_hash(), b.turn, b.is_check())]
        stopped = False
        for i, (mv, legal, check, sfen_after, end) in enumerate(G["plies"]):
            st["手"] += 1
            st["合法手のべ"] += len(ref)
            sfen = b.sfen()
            # 網にかかった局面（参照で数える。0 件の結論を空振りにしないための目安）
            if b.is_check():
                cov["王手の局面"] += 1
            if b.has_piece_in_hand(shogi.PAWN, b.turn):
                pawn_files = {sq % 9 for sq in range(81) if b.piece_type_at(sq) == shogi.PAWN and b.piece_at(sq).color == b.turn}
                if pawn_files:
                    cov["二歩で打てない筋があった局面"] += 1
                pc = pawn_check_square(b)
                if pc is not None:
                    pm = shogi.Move(None, pc, False, shogi.PAWN)
                    if b.is_pseudo_legal(pm):
                        cov["歩を打てば王手になる局面"] += 1
                        if pm.usi() not in ref:
                            b.push(pm)
                            uchi = (not b.was_suicide()) and b.was_check_by_dropping_pawn(pm)
                            b.pop()
                            if uchi:
                                cov["参照が打ち歩詰めで外した局面"] += 1
            for u in ref:
                if u.endswith("+"):
                    cov["成り・不成を選べる手" if u[:-1] in ref else "成るしかない手"] += 1
                elif u[1] == "*":
                    cov["打つ手"] += 1
            # 1 合法手
            ours = set(legal.split(" ")) if legal else set()
            if ours != ref:
                ours_only, ref_only = ours - ref, ref - ours
                ex = [u for u in sorted(ref_only) if u.startswith("P*") and is_true_pawn_drop_mate(b, u)]
                if ex:
                    excl[EXCL_PIN] += len(ex)
                    if len(excl_ex) < 5:
                        excl_ex.append(f"局{G['g']} {i + 1}手目の前 {sfen}  {ex}")
                    ref_only -= set(ex)
                if ours_only or ref_only:
                    kinds = {"こちらだけ・" + kind_of(b, u) for u in ours_only} | {"参照だけ・" + kind_of(b, u) for u in ref_only}
                    for k in sorted(kinds):
                        ng("合法手（" + k + "）", G["g"], i + 1, sfen, f"こちらだけ={sorted(ours_only)} 参照だけ={sorted(ref_only)}")
            # 2 王手か
            if bool(check) != b.is_check():
                ng("王手", G["g"], i + 1, sfen, f"こちら={bool(check)} 参照={b.is_check()}")
            # 3 指した手
            if mv not in ref:
                ng("指した手が参照で合法でない", G["g"], i + 1, sfen, f"{mv}（ここでこの局の突き合わせを止める）")
                stopped = True
                break
            b.push(shogi.Move.from_usi(mv))
            ref = legal_set(b)
            hist.append((b.zobrist_hash(), b.turn, b.is_check()))
            # 4 指したあとの局面
            if sfen3(b) != sfen_after:
                ng("指したあとの局面", G["g"], i + 1, sfen, f"{mv} こちら={sfen_after} 参照={sfen3(b)}")
            # 5 終局
            if not ref:
                re_ = "mate" if b.is_check() else "nomove"
            elif b.is_fourfold_repetition():
                re_ = "repetition"
            else:
                re_ = ""
            oe = "repetition" if end in ("sennichite", "perpetual") else end
            if oe != re_:
                ng("終局", G["g"], i + 1, b.sfen(), f"{mv} のあと こちら={end or 'なし'} 参照={re_ or 'なし'}")
            elif re_ == "repetition":
                # 6 連続王手（補助の判定）。こちらの勝ち負けは局の最後にしか無いので、最後の手のときだけ比べる
                aux = perpetual_aux(hist)
                cov["同一局面4回（参照）"] += 1
                if aux:
                    cov["そのうち連続王手（補助の判定）"] += 1
                if i == len(G["plies"]) - 1:
                    ow = G["winner"] if end == "perpetual" else 0
                    if ow != aux:
                        ng("終局（連続王手・補助の判定）", G["g"], i + 1, b.sfen(), f"こちら={END_NAME.get(end)} 勝者={ow} 補助の判定の勝者={aux}")
        if not stopped and G.get("error"):
            ng("dump の例外", G["g"], len(G["plies"]), b.sfen(), G["error"])
        elif not stopped and G["end"] == "" and not G["capped"]:
            ng("終わり方", G["g"], len(G["plies"]), b.sfen(), "終局でも打ち切りでもないのに止まった")
        if stop_at_first and bad:
            break
    return st, cov, bad, excl, excl_ex, first, hcs, ends


def main():
    ap = argparse.ArgumentParser(description="将棋道場のロジックを python-shogi と突き合わせる")
    ap.add_argument("--games", type=int, default=None, help="局数（既定 30／--controls は各 最大 100）")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--controls", action="store_true", help="わざと壊した版を1つずつ当て、捕まえるかを見る（最初の食い違いで次へ）")
    ap.add_argument("--only-end", choices=["mate", "nomove", "sennichite", "perpetual"], help="こちらの終局がその種類の局だけを突き合わせる")
    a = ap.parse_args()
    games = a.games or (100 if a.controls else 30)
    t0 = time.time()
    if a.controls:
        names = json.loads(subprocess.run(["node", DUMP, "0", "0", "--list-breaks"], capture_output=True, text=True, encoding="utf-8", cwd=HERE).stdout)
        miss = 0
        print(f"━━ 対照：わざと壊した {len(names)} 通り（各 最大 {games} 局・種 {a.seed}・最初の食い違いで次へ）━━")
        for n in names:
            t1 = time.time()
            cmd, p = run_dump(games, a.seed, n)
            st, cov, bad, excl, excl_ex, first, hcs, ends = compare((json.loads(x) for x in p.stdout if x.strip()), stop_at_first=True)
            finish(cmd, p, stopped_early=bool(bad))
            caught = sum(bad.values())
            miss += 0 if caught else 1
            where = f"{st['局']} 局目・のべ {st['手']} 手で" if caught else f"{st['局']} 局・{st['手']} 手を見て"
            print(f"  {'✅ 捕まえた' if caught else '❌ 見逃した'}  {n}  {where}（{'・'.join(f'{k} {v}' for k, v in bad.items()) or '食い違いなし'}・{time.time() - t1:.1f} 秒）")
            if first:
                print("      " + first[0].replace("\n", "\n      "))
        print(f"━━ {len(names) - miss}／{len(names)} を捕まえた・{time.time() - t0:.1f} 秒 ━━")
        sys.exit(1 if miss else 0)
    cmd, p = run_dump(games, a.seed, only_end=a.only_end)
    st, cov, bad, excl, excl_ex, first, hcs, ends = compare(json.loads(x) for x in p.stdout if x.strip())
    finish(cmd, p, stopped_early=False)
    only = f"（{games} 局のうち、こちらの終局が {a.only_end} の局だけ）" if a.only_end else ""
    print(f"━━ 将棋 × python-shogi {SHOGI_VER}：{st['局']} 局{only}・{st['手']} 手（＝突き合わせた局面）・合法手のべ {st['合法手のべ']}・種 {a.seed}・{time.time() - t0:.1f} 秒 ━━")
    print("  開始局面：" + "・".join(f"{HC_NAME.get(k, k)} {v}" for k, v in sorted(hcs.items(), key=lambda x: -x[1])))
    print("  終わり方（こちら）：" + "・".join(f"{k} {v}" for k, v in ends.items()))
    print("  網にかかった数（参照で数えた）：" + "・".join(f"{k} {v}" for k, v in cov.items()))
    if excl:
        print("  除いたもの（名前つき）：" + "・".join(f"{k} {v} 件" for k, v in excl.items()))
        for x in excl_ex:
            print("      " + x)
    else:
        print("  除いたもの：なし")
    if not bad:
        print("✅ 食い違い 0（合法手・王手・指した手・指したあとの局面・終局・連続王手の補助の判定）")
        sys.exit(0)
    print("❌ 食い違い " + "・".join(f"{k} {v}" for k, v in bad.items()))
    for x in first:
        print("  " + x)
    sys.exit(1)


if __name__ == "__main__":
    main()
