# board-game-dojo

Four board games (Othello, chess, shogi, 9x9 Go), each in a single HTML file that runs on a phone. The interesting part is how they were checked: the move rules are compared, move by move, against established libraries (python-chess, python-shogi, sgfmill) and against published counts (perft, OEIS A124004). The code was written by a generative AI (Anthropic's Claude); this repository is mostly about what was done to make that code trustworthy, and what that process found.

Language of the rest of this file: Japanese.

## これは何か

オセロ・チェス・将棋・囲碁（9路）の4つを、それぞれ1枚の HTML で動くようにしたもの。携帯で遊べる。

- コンピュータと対戦できる。
- 初心者向けの説明、練習問題、用語集がある。
- ハンデがある。チェスは4種（根拠は英語版 Wikipedia "Handicap (chess)"。FIDE の規定ではない）。将棋は手合割9種（日本将棋連盟 https://www.shogi.or.jp/knowledge/shogi/06.php 。上手から指す）。囲碁は置き石2〜5子（日本棋院 https://www.nihonkiin.or.jp/teach/lesson/school/start.html ）。
- 囲碁は、純碁・中国ルール・日本ルールの3つの数え方を切り替えられる。
- 友だちと対局し、イロ式のレーティングを付けられる（下に書く）。

## 遊び方

`othello/index.html`、`chess/index.html`、`shogi/index.html`、`go/index.html` のどれかをブラウザで開く。サーバーも依存も要らない。

友だちとの対局は、claude.ai の Artifact として開いたときだけ使える。Artifact の共有の記録（db）と、見ている人（user）の情報で動く。ふつうのブラウザで開いたときは、その欄に「claude.ai で開いたときだけ使えます」と出て、一人で遊ぶ部分はそのまま動く（`shared/friendplay.js` の `boot` で、`window.claude` が無いときの振る舞いを確かめた）。

友だち対局の部品は `shared/friendplay.js` に1つだけあり、`shared/embed.py` が4つのページに埋め込む。`python shared/embed.py --check` で、埋め込んだ写しと元の食い違いを検出する。`shared/fake-claude.js` は偽の claude で、2人の対局を通しで試すのに使う（対局を作る、入る、指す、投了する、レートが ±16 動く、相手の番の手は記録に入らない、まで）。

## どう確かめたか

ゲームのルールは間違えやすい。しかも、ロジックを書いたのは AI である。そこで、確かめ方を5つの層に分けた。

| 層 | 何をするか | 主な数字 |
|---|---|---|
| 1 仕様 | ルールを一次資料で確かめる | 日本将棋連盟（手合割、対局規則 第8条）、日本棋院（日本囲碁規約）、FIDE Laws of Chess |
| 2 公表値 | perft（n 手目までの局面の数）を公表値と比べる | チェス 20/400/8902/197281、Kiwipete 48/2039/97862。将棋 30/900/25470/719731。オセロ OEIS A124004 の深さ1〜9（9手目 3,005,288） |
| 3 差分テスト | 乱数の対局を JS で打ち、毎手の答えを参照の実装に同じ手順で入れて比べる | 下の表 |
| 4 網を試す | ロジックを1か所ずつわざと壊した版（ミュータント）を流し、食い違いを出せるか見る | チェス 8/8、将棋 6/6、囲碁 6/6、オセロ 4/4 を捕まえた |
| 5 CI | GitHub Actions で node の試験と突き合わせを回す | `.github/workflows/test.yml` |

一次資料は次のとおり。FIDE の公式の日本語版は見つからなかったので、英語版で確かめた。

- 日本将棋連盟 対局規則（第8条＝千日手。連続王手の千日手は反則）: https://www.shogi.or.jp/match/taikyoku_rules/
- 日本棋院 日本囲碁規約: https://www.nihonkiin.or.jp/match/kiyaku/zenbun.html
- FIDE Laws of Chess（2023年1月1日施行）: https://handbook.fide.com/chapter/E012023
- OEIS A124004: https://oeis.org/A124004

### 差分テスト（層3）の規模

| ゲーム | 参照の実装 | 局数・手数 | 食い違い |
|---|---|---|---|
| チェス | python-chess 1.11.2（GPL-3.0+） | 300局・97,756手（種2でも300局・98,610手） | 0 |
| 将棋 | python-shogi 1.1.1（GPL-3.0-only） | 138局・24,553手（合法手のべ 1,271,795） | 0 |
| 囲碁 | sgfmill 1.1.1（MIT） | 150局・17,905手 | 0（直したあと） |

乱数の対局は種つきで、同じ種なら同じ対局になる。食い違いが出たら、同じ入力でもう一度試せる。

表の数字は次のコマンドで出る（種は既定の 1）。`python crosscheck/check_chess.py --games 300`（種2は `--seed 2` を足す）／`python crosscheck/check_shogi.py --games 138`／`python crosscheck/check_go.py`（既定 150局）。

比べているもの。

- チェス: 合法手の集合、王手、棋譜（SAN）、盤、キャスリングの権利、50手の数え、終局。
- 将棋: 合法手の集合、王手、盤・手番・持ち駒、終局。連続王手の千日手は、参照に判定が無いので、連盟の定義で判定し直した補助の判定と比べる。まれな終わり方（1000局で4〜10局）だけを多くの局から拾う道（`--only-end`）もある。
- 囲碁: 合法手、盤、コウの点、アゲハマ、中国ルール・純碁・日本ルールの差、コミ、勝者、開始局面。通った道は、コウの局面 1,910、取り 4,166、自殺手として除いた点 50,065。

## 見つかったこと

突き合わせは、自前の試験が見逃していた誤りを捕まえた。逆に、参照の側の限界も見つかった。

1. 本物の誤り（チェス）。同じ色の升のビショップだけが残った局面を、引き分けにせず続けていた。FIDE 5.2.2（dead position、"This immediately ends the game"）に反する。python-chess との突き合わせが捕まえた。直して、再発を防ぐ試験を4件足した（古い版では 2件が落ちることを確かめた）。
2. 本物の誤り（囲碁）。置き碁の石を置く順が、日本棋院の図（右上、左下、右下、左上、天元）と、2子・3子で左右逆だった。突き合わせの開始局面で見つかり、直した。
3. 参照の限界（将棋）。python-shogi は、打ち歩詰めの判定で、歩を取れる駒が釘付けかを見ない（例 SFEN `7nk/7g1/9/5B2L/9/9/9/9/4K4 b P 1` で P*1b を合法手に入れる）。連続王手の千日手も判定しない。こちらは正しく扱っている。参照も間違えるので、食い違いは誰の誤りかを一次資料で裁く。
4. 数え方の取り決めの違い（オセロ）。OEIS は、パスも1手に数える。パスを数えないと9手目は 3,005,320 になり、OEIS の 3,005,288 と合わない。4通りの取り決めで数え比べて特定した。誤りではなく定義の違い。
5. 網の穴（チェス）。「ルークを取られてもキャスリングの権利が残る」誤りは、合法手の比較だけでは捕まらなかった（乱数の対局ではその局面がまず起きない）。権利と50手の数えを毎手そのまま比べるようにして、捕まえた。
6. 等価ミュータント（オセロ）。壊したつもりで動きが変わらない置き換えが2つあった。挟む石が0枚なら何も返さないので、その条件を外しても動きは同じ。列の端の判定は2か所あり、片方だけ外しても止まる。「捕まえられなかった」ので網の穴かと思ったが、読むと壊れていなかった。2か所とも外した本当に壊れた版は、7手目から公表値と食い違い、以前の試験は見逃していた。端の試験を3つ足した。
7. 規則の解釈の差は、明記して残した。チェスは、50手と同じ局面3回を申し出なしで自動で引き分けにしている。FIDE 9.2・9.3 は手番の側の申し出で、自動なのは 9.6 の75手と5回。そこで突き合わせは「申し出られる条件」と比べている。囲碁の置き碁の持碁は、説明（白の勝ち）と動き（引き分け）が食い違っていた。日本棋院の説明は「一般的にはジゴは白勝ち」、日本囲碁規約 第十条は「同数の場合は引き分け」。作者が規約に合わせて引き分けと決め、説明を動きに揃えた。説明と動きが揃っていることは go/test.js が確かめる。

## 動かし方

node（24 で確認）と python 3 が要る。

```
node othello/test.js
node chess/test.js
node chess/test_friendplay.js
node shogi/test.js
node shogi/test_friendplay.js
node go/test.js
node go/test_friendplay.js
node shared/test.js
python shared/embed.py --check

pip install -r requirements-crosscheck.txt
python crosscheck/check_chess.py            # --games N --seed S で局数と種を変える
python crosscheck/check_shogi.py
python crosscheck/check_go.py
python crosscheck/check_chess.py --controls # わざと壊した版を捕まえるか（shogi・go も同じ）
node crosscheck/perft_othello.js 9
node crosscheck/perft_othello.js --controls
```

各ゲームのロジックは、`index.html` の中の `// ===== LOGIC-BEGIN` から `LOGIC-END` までの区間にある。試験（`test.js`）と突き合わせは、この区間をそのまま読み込む。写しではないので、試験とページが食い違わない。

## 比べていないこと・限界

- 参照の実装も全部は判定しない。参照の側に自前で足したものと、比べていないものがある。
  - 囲碁: コウは単純なコウ（直前に取られた1子をすぐ取り返せない）だけを扱い、スーパーコウ（同一局面の禁止）は扱わない。参照も同じ。日本ルールの死活とセキは、盤の石を全部生きとして数える。セキの目も地に数えてしまうが、参照も同じ式なので、この突き合わせでは見えない（日本囲碁規約 第八条ではセキの目は地ではない）。
  - 将棋: 入玉と持将棋は比べていない。
- 乱数の対局は、起きにくい局面を踏まない。権利の数えのように、局面を直接比べて補ったものがあるが、全部ではない。
- 突き合わせの相手（参照）が正しいことは前提にしている。見つけた限りでは、将棋の参照に限界があった（見つかったこと 3）。
- 試験と突き合わせが通ることは、誤りが無い証明ではない。形式的な証明はしていない。
- コンピュータの強さ、性能、練習問題の中身は、この突き合わせの対象外。

## 作り方

コードは、生成 AI（Anthropic の Claude）が書いた。作者は、作るものと水準（ルールの切り替え、経験者がいなくても分かる説明、友だちとの対局）を決め、確かめ方の規律を運用し、公開を判断した。規律は、次の3つ。

- 一次資料を開いてから書く。
- 0件や緑は、対照を通すまで疑う。
- わざと鳴る入力を1つ通して、検査が効いているかを先に確かめる。

元は別の場所で管理していて、そこから写す道具でこのリポジトリに写している。

## ライセンス

本体は MIT（`LICENSE`）。突き合わせの相手（python-chess、python-shogi、sgfmill）は、このリポジトリに含めていない。`requirements-crosscheck.txt` に版を固定して書き、CI で pip により入れる。`check_chess.py` と `check_shogi.py` は python-chess と python-shogi を import している（どちらも GPL）。ゲームのロジックは JS で、node の別のプロセスで動く。
