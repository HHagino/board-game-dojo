#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""shared/friendplay.js を、*/index.html の中へそのまま写す（Artifact は1枚の HTML なので、部品を中に入れて配る）。

使い方
  python shared/embed.py          # 写す（ページの中の FRIENDPLAY-BEGIN〜END、または /*FRIENDPLAY*/ の印を置き換える）
  python shared/embed.py --check  # 写さずに、どのページが元と食い違っているかだけ出す（食い違いがあれば終了コード 1）
★ 直すのはいつも元（friendplay.js）。ページの中の写しを直接直さない（次に写したときに消える）。
2026-10-26 Claude（Opus）。
"""
import glob, io, os, re, sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "friendplay.js")
BLOCK = re.compile(r"// ===== FRIENDPLAY-BEGIN.*?// ===== FRIENDPLAY-END =====", re.S)
MARK = "/*FRIENDPLAY*/"


def main():
    check = "--check" in sys.argv
    mod = io.open(SRC, encoding="utf-8", newline="").read().replace("\r\n", "\n").rstrip("\n")
    pages = sorted(glob.glob(os.path.join(os.path.dirname(HERE), "*", "index.html")))
    stale = 0
    for p in pages:
        raw = io.open(p, encoding="utf-8", newline="").read()
        crlf = "\r\n" in raw
        txt = raw.replace("\r\n", "\n")
        name = os.path.basename(os.path.dirname(p))
        n_block, n_mark = len(BLOCK.findall(txt)), txt.count(MARK)
        if n_block + n_mark == 0:
            print(f"  ・{name}：印が無い（まだつないでいない）＝そのまま")
            continue
        if n_block + n_mark > 1:
            print(f"  ⚠️ {name}：印が {n_block + n_mark} 個ある＝写さない（1つにしてから）")
            stale += 1
            continue
        new = BLOCK.sub(lambda m: mod, txt) if n_block else txt.replace(MARK, mod)
        if new == txt:
            print(f"  ✅ {name}：元と同じ")
            continue
        stale += 1
        if check:
            print(f"  ⚠️ {name}：元と食い違う（写していない）")
            continue
        io.open(p, "w", encoding="utf-8", newline="").write(new.replace("\n", "\r\n") if crlf else new)
        print(f"  ✍️ {name}：写した")
    if check and stale:
        sys.exit(1)


if __name__ == "__main__":
    main()
