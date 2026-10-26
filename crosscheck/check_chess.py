#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""チェス道場のロジックを python-chess（1.11.2・GPL-3.0+）と突き合わせる（差分テスト）。

  python check_chess.py [--games N] [--seed S]   # 乱数の対局を N 局（dump_chess.js）→ 毎手の答えを python-chess と比べる
  python check_chess.py --controls               # わざと壊した版（dump_chess.js の BREAKS）を1つずつ当て、どれも食い違いが出るか

比べるもの（毎手）
  1. 合法手の集合（UCI。キャスリングはキングの2升＝python-chess の既定の書き方と同じ）
  2. 王手か
  3. 指した手の棋譜の書き方（SAN：あいまいさの書き分け・+ と #）
  4. 指したあとの盤（駒の置き方）・キャスリングの権利・50手の数え（halfmove）
  5. 終局：こちらの gameResult の種類が、python-chess で成り立っている条件の1つであること（成り立つ条件があるのに
     こちらが続けたら食い違い）。対応＝mate↔is_checkmate・stalemate↔is_stalemate・material↔is_insufficient_material・
     fifty↔is_fifty_moves・repetition↔is_repetition(3)。
     ★ こちらは 50手と同一局面3回を申し出なしで引き分けにしている。python-chess の is_game_over() の既定（75手・5回）とは
     比べず、「申し出られる条件」（is_fifty_moves・is_repetition(3)）と比べる。
python-chess で確かめたこと（site-packages/chess/__init__.py 1.11.2 の行番号）
  - is_checkmate 2093／is_stalemate 2100：王手かと合法手の有無だけ。
  - is_insufficient_material 2110 と has_insufficient_material 2117：両方の側が「駒で勝てない」とき。ナイトは1つだけで
    相手にキングとクイーン以外が無いとき、ビショップは全部が同じ色の升で、盤にポーンとナイトが無いとき。
  - is_fifty_moves 2182：halfmove_clock >= 100 で、合法手があるとき（詰みが先）。
  - is_repetition 2258：今の局面が前に（取り返しのつかない手の手前まで）合わせて count 回出たか。局面の同一は
    _transposition_key 3797（駒・手番・使えるキャスリングの権利・合法なアンパッサンがあるときだけその升）。
2026-10-26 Claude（Opus）。
"""
import argparse, json, os, subprocess, sys, time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import chess

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, "dump_chess.js")


def run_dump(games, seed, brk=None):
    cmd = ["node", DUMP, str(games), str(seed)] + (["--break", brk] if brk else [])
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        raise SystemExit("NG: dump が止まった（" + " ".join(cmd) + "）\n" + p.stderr)
    return [json.loads(x) for x in p.stdout.splitlines() if x.strip()]


def ref_end(b):
    """python-chess で成り立っている終局の条件（こちらの種類の名前で）。"""
    out = set()
    if b.is_checkmate():
        out.add("mate")
    if b.is_stalemate():
        out.add("stalemate")
    if not out:  # 詰み・ステイルメイトが先（こちらの gameResult も同じ順）
        if b.is_insufficient_material():
            out.add("material")
        if b.is_fifty_moves():
            out.add("fifty")
        if b.is_repetition(3):
            out.add("repetition")
    return out


def compare(games):
    st = {"局": 0, "手": 0, "打ち切り": 0}
    bad = {}
    first = []

    def ng(kind, g, ply, fen, detail):
        bad[kind] = bad.get(kind, 0) + 1
        if len(first) < 10:
            first.append(f"[{kind}] 局{g} {ply}手目の前 {fen}\n      {detail}")

    for G in games:
        st["局"] += 1
        st["打ち切り"] += 1 if G["capped"] else 0
        b = chess.Board(G["fen"])
        if not b.is_valid():
            ng("開始局面が不正", G["g"], 0, G["fen"], str(b.status()))
            continue
        stopped = False
        for i, (mv, legal, check, san, bfen, end, cas, half) in enumerate(G["plies"]):
            st["手"] += 1
            fen = b.fen()
            ours = set(legal.split(" ")) if legal else set()
            ref = {m.uci() for m in b.legal_moves}
            if ours != ref:
                ng("合法手", G["g"], i + 1, fen, f"こちらだけ={sorted(ours - ref)} 参照だけ={sorted(ref - ours)}")
            if bool(check) != b.is_check():
                ng("王手", G["g"], i + 1, fen, f"こちら={bool(check)} 参照={b.is_check()}")
            try:
                move = chess.Move.from_uci(mv)
                if move not in b.legal_moves:
                    raise ValueError("参照では合法でない")
            except ValueError as e:
                ng("指した手", G["g"], i + 1, fen, f"{mv}：{e}")
                stopped = True
                break
            rsan = b.san(move)
            if rsan != san:
                ng("棋譜(SAN)", G["g"], i + 1, fen, f"{mv} こちら={san} 参照={rsan}")
            b.push(move)
            if b.board_fen() != bfen:
                ng("指したあとの盤", G["g"], i + 1, fen, f"{mv} こちら={bfen} 参照={b.board_fen()}")
            rcas = b.fen().split(" ")[2]  # fen() の第3欄は clean_castling_rights（使える権利だけ）
            if rcas != cas:
                ng("キャスリングの権利", G["g"], i + 1, fen, f"{mv} のあと こちら={cas} 参照={rcas}")
            if b.halfmove_clock != half:
                ng("50手の数え", G["g"], i + 1, fen, f"{mv} のあと こちら={half} 参照={b.halfmove_clock}")
            re_ = ref_end(b)
            if end and end not in re_:
                ng("終局（こちらだけ）", G["g"], i + 1, b.fen(), f"こちら={end} 参照で成り立つ条件={sorted(re_) or 'なし'}")
            elif not end and re_:
                ng("終局（参照だけ）", G["g"], i + 1, b.fen(), f"参照で成り立つ条件={sorted(re_)}・こちらは続けた")
        if not stopped and G["end"] == "" and not G["capped"]:
            ng("終わり方", G["g"], len(G["plies"]), b.fen(), "終局でも打ち切りでもないのに止まった")
    return st, bad, first


def main():
    ap = argparse.ArgumentParser(description="チェス道場のロジックを python-chess と突き合わせる")
    ap.add_argument("--games", type=int, default=150)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--controls", action="store_true", help="わざと壊した版を1つずつ当て、捕まえるかを見る")
    a = ap.parse_args()
    t0 = time.time()
    if a.controls:
        names = json.loads(subprocess.run(["node", DUMP, "0", "0", "--list-breaks"], capture_output=True, text=True, encoding="utf-8").stdout)
        miss = 0
        print(f"━━ 対照：わざと壊した {len(names)} 通り（各 {a.games} 局・種 {a.seed}）━━")
        for n in names:
            st, bad, first = compare(run_dump(a.games, a.seed, n))
            caught = sum(bad.values())
            miss += 0 if caught else 1
            print(f"  {'✅ 捕まえた' if caught else '❌ 見逃した'}  {n}  食い違い {caught}（{'・'.join(f'{k} {v}' for k, v in bad.items()) or 'なし'}）")
        print(f"━━ {len(names) - miss}／{len(names)} を捕まえた・{time.time() - t0:.1f} 秒 ━━")
        sys.exit(1 if miss else 0)
    st, bad, first = compare(run_dump(a.games, a.seed))
    print(f"━━ チェス × python-chess {chess.__version__}：{st['局']} 局・{st['手']} 手（打ち切り {st['打ち切り']} 局）・種 {a.seed}・{time.time() - t0:.1f} 秒 ━━")
    if not bad:
        print("✅ 食い違い 0（合法手・王手・SAN・盤・キャスリングの権利・50手の数え・終局）")
        sys.exit(0)
    print("❌ 食い違い " + "・".join(f"{k} {v}" for k, v in bad.items()))
    for x in first:
        print("  " + x)
    sys.exit(1)


if __name__ == "__main__":
    main()
