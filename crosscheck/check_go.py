#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""囲碁（9路）のロジックを sgfmill 1.1.1（MIT）と突き合わせる（差分テスト）。

  python check_go.py [--games N] [--seed S]   # 乱数の対局を N 局（dump_go.js）→ 毎手の答えを sgfmill と比べる
  python check_go.py --controls               # わざと壊した版（dump_go.js の BREAKS）を1つずつ当て、どれも食い違いが出るか

比べるもの（毎手）
  1. 合法手の集合（打つ前の局面。参照側の作り方は下）
  2. 打った手が参照でも合法か
  3. 手の呼び名（"E5"）と交点の番号の対応（参照側＝sgfmill common.move_from_vertex（GTP の書き方：列 A〜 で I を飛ばす・行は下から 1〜）。
     こちらの番号は上の行が 0 なので、row を 8−row に写すのは自前）
  4. 打ったあとの盤（取った石が盤から消えているか）
  5. コウの点（sgfmill の play() の戻り値 simple_ko_point と、こちらの st.ko）
  6. アゲハマの累計（参照側＝打つ前後の相手の石の数の差を自前で足す）
終局（打ち切りの局も、その時の盤で。盤の石は全部生き＝こちらの adapter と同じ前提）
  7. 中国ルール（area）：黒−白 ＝ sgfmill の area_score()。margin ＝ それ−コミ
  8. 純碁（stone）：石の数の差（参照側＝list_occupied_points() で数える）
  9. 日本ルール（japan）：地の差＋アゲハマの差。参照側の地の差 ＝ area_score() − 石数の差（ダメは両方に足されるので差で消える）、
     アゲハマの差＝6の自前の累計
 10. コミ（置き石なし：中国 7・日本 6.5・純碁 7／置き石あり：0）と、winner の符号・adapter の result の勝者
 11. 開始局面：置き石は星（3-3 の4隅と天元）に 右上→左下→右下→左上→天元 の順。期待値の出どころ＝日本棋院「囲碁の基本：対局のルール・流れ」
     https://www.nihonkiin.or.jp/teach/lesson/school/start.html の1図（images/okigo09.gif：1＝右上・2＝左下・3＝右下・4＝左上・9＝天元）と
     九路盤の図（images/okigo902〜905.gif）を 2026-10-26 に目で読んだもの（図に alt は無い）。同じ頁に「五子局（九路盤の特別な置き方）」
     （天元でなく右辺の星）もあるが、LOGIC と同じ「天元」の図を期待値にした。最初の手番は置き石があれば白。
     ★ LOGIC の HANDI_ORDER は 右下→左上→右上→左下→天元 で、2子・3子の置き場所が日本棋院の図と違う（4子・5子は同じ）＝食い違い「開始局面」として出る。
     開始局面が違っても、その局の手の突き合わせは dump の開始局面から続ける（置き石の順の違いで手の規則の検査を落とさない）

sgfmill で確かめたこと（site-packages/sgfmill/boards.py 1.1.1 の行番号）
  - play(row, col, colour) 173〜211：空点でなければ ValueError（189〜190）。呼吸点0の連を探して取る（193〜210）。
    ★ 自殺手（self-capture）を許す（180 の docstring・195〜199：呼吸点0の連が自分の連だけなら、それを盤から除く）。
    ★ コウは強制しない（180〜181 の docstring）。戻り値＝単純なコウで禁じられる点か None（183・200〜207：相手の連を1つだけ取り、
      それが1子で、置いた石の連（置いた時点で呼吸点0）が1子のとき、取った点を返す）。
  - area_score() 264〜290：全部の石を生きとして、石1つ＝1点、空点の領域は接する色ごとに加算（両方の色に接する領域＝ダメは両方に足す）。
    返すのは黒−白だけ。コミは入れない（269〜271）。
  - 色は 'b'／'w'、空点は None（common.py 12〜21 opponent_of）。盤は board[row][col] の配列で、上下の向きは論理に関係しない。
  - common.move_from_vertex 63〜96：GTP の呼び名（I を飛ばす・行は 1 から）→ (row, col)。

参照側の合法手の作り方（sgfmill は「合法か」を判定しない＝自前で足した部分）
  - 空点 かつ 直前の play() が返したコウの点でない かつ 写し（copy()）に play() して置いた石が残る点（置いた石が消える＝自殺手は除く）。
  - パスのあとはコウの点を消す（LOGIC の passMove が ko = -1 にするのと同じ。単純なコウ＝「取られた直後の取り返し」だけを禁じる）。
  - 自殺手を不合法にするのは、こちらの決め（日本囲碁規約の第三条・第四条＝報告_囲碁.md に原文）。

比べていないもの（比べたふりをしない）
  - スーパーコウ（同一局面の禁止）：LOGIC は単純なコウ（st.ko の1点）だけ。参照も同じにした。
  - 日本ルールの死活の判定・セキの目・終局後の手入れ：盤の石は全部生きとして数える（LOGIC の adapter と同じ前提）。
  - 数え方ごとの黒・白それぞれの点数：sgfmill は差しか返さない（ダメを両方に足す）ので、差（と margin）だけ比べる。
  - 置き石の順の一次資料。
2026-10-26 Claude（Fable）。
"""
import argparse, json, os, subprocess, sys, time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from sgfmill import boards, common
try:
    from importlib.metadata import version as _v
    SGFMILL_VER = _v("sgfmill")
except Exception:
    SGFMILL_VER = "?"

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, "dump_go.js")
SIZE, NN = 9, 81
COLS = "ABCDEFGHJ"
RULES = ("area", "stone", "japan")
KOMI_FLAT = {"area": 7, "japan": 6.5, "stone": 7}
HANDI_ORDER = [(2, 6), (6, 2), (6, 6), (2, 2), (4, 4)]   # 日本棋院の1図：右上・左下・右下・左上・天元（row 0 が上・col 0 が左）
CH = {"b": "X", "w": "O", None: "."}


def rc(i):
    return divmod(i, SIZE)


def name_of(i):
    r, c = rc(i)
    return COLS[c] + str(SIZE - r)


def run_dump(games, seed, brk=None):
    cmd = ["node", DUMP, str(games), str(seed)] + (["--break", brk] if brk else [])
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        raise SystemExit("NG: dump が止まった（" + " ".join(cmd) + "）\n" + p.stderr)
    return [json.loads(x) for x in p.stdout.splitlines() if x.strip()]


def board_str(b):
    return "".join(CH[b.get(r, c)] for r in range(SIZE) for c in range(SIZE))


def counts(b):
    n = {"b": 0, "w": 0}
    for colour, _pt in b.list_occupied_points():
        n[colour] += 1
    return n


def ref_legal(b, colour, ko):
    """参照側の合法手：空点・コウの点でない・写しに打って置いた石が残る（自殺手でない）。(一覧, 自殺手として除いた数)"""
    out, suicide = [], 0
    for i in range(NN):
        r, c = rc(i)
        if b.get(r, c) is not None:
            continue
        if ko is not None and (r, c) == ko:
            continue
        cp = b.copy()
        cp.play(r, c, colour)
        if cp.get(r, c) is None:
            suicide += 1
            continue
        out.append(i)
    return out, suicide


def dame_regions(bstr):
    """報告用（自前）：両方の色に接する空点の領域の数。判定には使わない。"""
    seen = [False] * NN
    n = 0
    for i in range(NN):
        if bstr[i] != "." or seen[i]:
            continue
        stack, tb, tw = [i], False, False
        seen[i] = True
        while stack:
            x = stack.pop()
            r, c = rc(x)
            for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if not (0 <= rr < SIZE and 0 <= cc < SIZE):
                    continue
                q = rr * SIZE + cc
                if bstr[q] == "X":
                    tb = True
                elif bstr[q] == "O":
                    tw = True
                elif not seen[q]:
                    seen[q] = True
                    stack.append(q)
        if tb and tw:
            n += 1
    return n


def show(bstr):
    rows = []
    for r in range(SIZE):
        rows.append("      %d %s" % (SIZE - r, " ".join(bstr[r * SIZE:(r + 1) * SIZE])))
    rows.append("        " + " ".join(COLS))
    return "\n".join(rows)


def sign(x):
    return 1 if x > 0 else (-1 if x < 0 else 0)


def compare(games):
    st = {"局": 0, "手": 0, "局面": 0, "終局": 0, "打ち切り": 0, "コウの点があった局面": 0, "取りのあった手": 0, "2子以上の取り": 0,
          "自殺手として除いた点(延べ)": 0, "パス": 0, "終局の盤にダメのある局": 0, "置き石の局": 0}
    bad, first, seen_detail = {}, {}, set()   # first＝種類ごとに最初の 10 件（出すときは種類をまたいで順に 10 件。同じ差分の文は1回だけ）

    def ng(kind, g, ply, bstr, detail):
        bad[kind] = bad.get(kind, 0) + 1
        lst = first.setdefault(kind, [])
        if len(lst) < 10 and (kind, detail) not in seen_detail:
            seen_detail.add((kind, detail))
            lst.append("[%s] 局%d %d手目の前（%s番）\n%s\n      %s" % (kind, g, ply, "黒" if ply_colour[0] == "b" else "白", show(bstr), detail))

    ply_colour = ["b"]
    for G in games:
        st["局"] += 1
        st["打ち切り"] += 1 if G["capped"] else 0
        st["終局"] += 1 if G["over"] else 0
        handi = G["handi"]
        st["置き石の局"] += 1 if handi else 0
        # 11. 開始局面（期待値＝日本棋院の図）。違っても、手の突き合わせは dump の開始局面から続ける
        b = boards.Board(SIZE)
        want = HANDI_ORDER[:handi] if 2 <= handi <= 5 else []
        b.apply_setup(want, [], [])
        ply_colour[0] = G["first"]
        if G["init"] != board_str(b) or G["first"] != ("w" if want else "b"):
            ng("開始局面", G["g"], 0, G["init"], "置き石 %d：こちら 黒=%s／日本棋院の図 黒=%s。最初の手番 こちら=%s 期待=%s" % (
                handi, [name_of(i) for i in range(NN) if G["init"][i] == "X"], [name_of(r * SIZE + c) for r, c in want], G["first"], "w" if want else "b"))
            b = boards.Board(SIZE)
            ok = b.apply_setup([rc(i) for i in range(NN) if G["init"][i] == "X"], [rc(i) for i in range(NN) if G["init"][i] == "O"], [])
            if not ok or board_str(b) != G["init"]:
                ng("開始局面", G["g"], 0, G["init"], "dump の開始局面が参照では成り立たない（呼吸点0の石がある）＝この局は飛ばす")
                continue
        colour, ko = G["first"], None
        cap = {"b": 0, "w": 0}
        stopped = False
        for i, (legal, mv, name, bstr_after, ko_ours, capB, capW) in enumerate(G["plies"]):
            st["手"] += 1
            st["局面"] += 1
            ply_colour[0] = colour
            before_str = board_str(b)
            if ko is not None:
                st["コウの点があった局面"] += 1
            # 1. 合法手
            ref, nsui = ref_legal(b, colour, ko)
            st["自殺手として除いた点(延べ)"] += nsui
            if legal != ref:
                so, ro = sorted(set(legal) - set(ref)), sorted(set(ref) - set(legal))
                ng("合法手", G["g"], i + 1, before_str, "こちらだけ=%s 参照だけ=%s（参照のコウの点=%s）" % (
                    [name_of(x) for x in so], [name_of(x) for x in ro], name_of(ko[0] * SIZE + ko[1]) if ko else "なし"))
            if mv == -1:
                st["パス"] += 1
                if name != "pass":
                    ng("呼び名", G["g"], i + 1, before_str, "パスの呼び名が %r" % name)
                ko = None
            else:
                # 3. 呼び名
                try:
                    v = common.move_from_vertex(name, SIZE)
                    idx_ref = (SIZE - 1 - v[0]) * SIZE + v[1]
                except ValueError as e:
                    idx_ref, v = -2, str(e)
                if idx_ref != mv:
                    ng("呼び名", G["g"], i + 1, before_str, "こちら %r=%d 参照の読み=%s→%s" % (name, mv, v, idx_ref))
                # 2. 打った手
                if mv not in ref:
                    ng("打った手", G["g"], i + 1, before_str, "%s（%d）は参照では合法でない" % (name, mv))
                    stopped = True
                    break
                n0 = counts(b)
                r, c = rc(mv)
                ko = b.play(r, c, colour)
                n1 = counts(b)
                opp = common.opponent_of(colour)
                taken = n0[opp] - n1[opp]
                if n1[colour] != n0[colour] + 1:
                    ng("参照の異常", G["g"], i + 1, before_str, "合法のはずの手で自分の石が消えた")
                    stopped = True
                    break
                if taken:
                    st["取りのあった手"] += 1
                    if taken >= 2:
                        st["2子以上の取り"] += 1
                cap[colour] += taken
            # 4. 盤
            after_ref = board_str(b)
            if bstr_after != after_ref:
                diff = [name_of(x) for x in range(NN) if bstr_after[x] != after_ref[x]]
                ng("盤", G["g"], i + 1, before_str, "%s のあと 違う点=%s\n      こちら=%s\n      参照  =%s" % (name, diff, bstr_after, after_ref))
            # 5. コウ
            ko_ref = -1 if ko is None else ko[0] * SIZE + ko[1]
            if ko_ours != ko_ref:
                ng("コウ", G["g"], i + 1, before_str, "%s のあと こちら=%s 参照=%s" % (name, name_of(ko_ours) if ko_ours >= 0 else "なし", name_of(ko_ref) if ko_ref >= 0 else "なし"))
            # 6. アゲハマ
            if (capB, capW) != (cap["b"], cap["w"]):
                ng("アゲハマ", G["g"], i + 1, before_str, "%s のあと こちら 黒%d 白%d 参照 黒%d 白%d" % (name, capB, capW, cap["b"], cap["w"]))
            colour = common.opponent_of(colour)
        if stopped:
            continue
        if G["reason"]:
            ng("終わり方", G["g"], len(G["plies"]), board_str(b), G["reason"])
            continue
        if not G["over"] and not G["capped"]:
            ng("終わり方", G["g"], len(G["plies"]), board_str(b), "終局でも打ち切りでもないのに止まった")
        # 終局の数え方（打ち切りの局もその盤で）
        fb = board_str(b)
        if dame_regions(fb):
            st["終局の盤にダメのある局"] += 1
        area = b.area_score()
        n = counts(b)
        stones = n["b"] - n["w"]
        pris = cap["b"] - cap["w"]
        ref_diff = {"area": area, "stone": stones, "japan": (area - stones) + pris}
        label = {"area": "中国ルール", "stone": "純碁", "japan": "日本ルール"}
        for rule in RULES:
            x = G["final"][rule]
            komi_want = 0 if handi else KOMI_FLAT[rule]
            if G["komi"][rule] != komi_want or x["komi"] != komi_want:
                ng("コミ", G["g"], len(G["plies"]), fb, "%s 置き石%d：こちら defaultKomi=%s finalResult.komi=%s 期待=%s" % (label[rule], handi, G["komi"][rule], x["komi"], komi_want))
            want_margin = ref_diff[rule] - komi_want
            if x["b"] - x["w"] != ref_diff[rule] or x["margin"] != want_margin:
                ng(label[rule], G["g"], len(G["plies"]), fb, "こちら 黒%s 白%s 差%s margin=%s／参照 差%s margin=%s（area_score=%s 石差=%s アゲハマ差=%s）" % (
                    x["b"], x["w"], x["b"] - x["w"], x["margin"], ref_diff[rule], want_margin, area, stones, pris))
            if x["winner"] != sign(want_margin):
                ng("勝者", G["g"], len(G["plies"]), fb, "%s こちら winner=%s 参照の margin=%s" % (label[rule], x["winner"], want_margin))
        if G["over"]:
            res = G["adapter"]
            wm = ref_diff[G["rule"]] - (0 if handi else KOMI_FLAT[G["rule"]])
            want_w = {1: "first", -1: "second", 0: "draw"}[sign(wm)]
            if not res or res.get("winner") != want_w:
                ng("勝者", G["g"], len(G["plies"]), fb, "adapter.result（%s）こちら=%s 参照の margin=%s→%s" % (G["rule"], res and res.get("winner"), wm, want_w))
        elif G["adapter"] is not None:
            ng("勝者", G["g"], len(G["plies"]), fb, "終局でないのに adapter.result が値を返した")
    return st, bad, first


def first_ten(first):
    """種類をまたいで順に（各種類の1件目→2件目→…）合わせて 10 件。"""
    out, k = [], 0
    while len(out) < 10:
        got = False
        for kind in first:
            if k < len(first[kind]) and len(out) < 10:
                out.append(first[kind][k])
                got = True
        if not got:
            break
        k += 1
    return out


def main():
    ap = argparse.ArgumentParser(description="囲碁（9路）のロジックを sgfmill と突き合わせる")
    ap.add_argument("--games", type=int, default=150, help="既定 150＝この PC（RAM 4GB）で約 35 秒。--controls はその 6 倍かかる")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--controls", action="store_true", help="わざと壊した版を1つずつ当て、捕まえるかを見る")
    a = ap.parse_args()
    t0 = time.time()
    if a.controls:
        names = json.loads(subprocess.run(["node", DUMP, "--list-breaks"], capture_output=True, text=True, encoding="utf-8").stdout)
        miss = 0
        print("━━ 対照：わざと壊した %d 通り（各 %d 局・種 %d）━━" % (len(names), a.games, a.seed))
        # 基準＝壊していない版の食い違い（置き石の開始局面など、壊す前からある食い違いを「捕まえた」に数えないため）
        _st, base, _f = compare(run_dump(a.games, a.seed))
        print("  基準（壊していない版）  食い違い %d（%s）" % (sum(base.values()), "・".join("%s %d" % (k, v) for k, v in base.items()) or "なし"))
        for n in names:
            t1 = time.time()
            st, bad, first = compare(run_dump(a.games, a.seed, n))
            extra = {k: v - base.get(k, 0) for k, v in bad.items() if v > base.get(k, 0)}   # 基準より増えた分だけ
            caught = sum(extra.values())
            miss += 0 if caught else 1
            print("  %s  %s  基準より増えた食い違い %d（%s）%.1f 秒" % ("✅ 捕まえた" if caught else "❌ 見逃した", n, caught, "・".join("%s %d" % (k, v) for k, v in extra.items()) or "なし", time.time() - t1))
        print("━━ %d／%d を捕まえた・%.1f 秒 ━━" % (len(names) - miss, len(names), time.time() - t0))
        sys.exit(1 if miss else 0)
    st, bad, first = compare(run_dump(a.games, a.seed))
    print("━━ 囲碁（9路）× sgfmill %s：%d 局・%d 手・%d 局面（終局 %d・打ち切り %d・置き石の局 %d）・種 %d・%.1f 秒 ━━" % (
        SGFMILL_VER, st["局"], st["手"], st["局面"], st["終局"], st["打ち切り"], st["置き石の局"], a.seed, time.time() - t0))
    print("   通った道：コウの点があった局面 %d・取りのあった手 %d（2子以上 %d）・自殺手として除いた点 %d・パス %d・終局の盤にダメのある局 %d" % (
        st["コウの点があった局面"], st["取りのあった手"], st["2子以上の取り"], st["自殺手として除いた点(延べ)"], st["パス"], st["終局の盤にダメのある局"]))
    if not bad:
        print("✅ 食い違い 0（合法手・打った手・呼び名・盤・コウ・アゲハマ・中国ルール・純碁・日本ルール・コミ・勝者・開始局面）")
        sys.exit(0)
    print("❌ 食い違い " + "・".join("%s %d" % (k, v) for k, v in bad.items()))
    moves_ok = [k for k in bad if k != "開始局面"]
    if not moves_ok:
        print("   （手の規則・取り・コウ・数え方の食い違いは 0。食い違いは置き石の開始局面だけ）")
    for x in first_ten(first):
        print("  " + x)
    sys.exit(1)


if __name__ == "__main__":
    main()
