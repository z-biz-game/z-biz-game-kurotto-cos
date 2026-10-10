# クロット · Kurotto — 零猜测黑块推理

圈里的数字数的不是"旁边有几个黑格"，而是**贴着这个圈的黑块一共有几格**。
每一局都只有一个答案，而且每一局都能只用六条命名规则（K1–K6）从空盘推到底，一次都不猜。
这两句不是宣传语：它们是本仓两条互不复用代码的验收路，每张出货盘都要同时过（`DESIGN.md §2`）。

在线：<https://z-biz-game.github.io/z-biz-game-kurotto-cos/>（零构建、零运行时依赖，纯 ES 模块直接发布）

---

## 玩法

- **选一档**：6×6 / 7×7 / 8×8 / 9×9。档名（初/中/高）旁边印的是**实测链长**与**实测线索格数**，
  不是形容词，也不印耗时（同一份代码在 CI 那台机器上量到本机的 2.4 倍，秒数没有一台机器能替它签字）。
- **点一格**循环 未定 → 黑 → 白；也可以用右边的「黑 / 白 / 清」三个键直接定格。
- **数字圈永远不能涂黑**，**空圈**（没有数字的圈）也一样不能黑，但它不限制任何事。
  页面上圈格点不动不是 bug：那是规则，`hint` 腿专门断言"提示从不落在圈格上"。
- **提示**只说当前用六条规则之一就能推得出的那一格，并说出它依据哪条。它不会替你做猜的决定，
  所以按到底就是"这盘能被推完"的证明。
- **换一局 / 回选档 / 撤销**：牌头印的 `seed` 就是这一盘的 seed，同一个 (档位, seed) 在任何机器上
  画同一张盘（`DESIGN.md §3` 末段）。
- **纪录**按同档比：先比提示次数，再比步数，最后比用时；前两项一样才算时间纪录。
- **键盘**：方向键移动 · 回车/空格循环 · `B` 黑 · `W` 白 · `0`/退格清 · `H` 提示 · `Z` 撤销 · `N` 换一局。
- 深色/浅色主题、存档续局都在 `localStorage`（键名 `kurotto.save` / `kurotto.records` / `kurotto.prefs`）。

## 规则：数字数的是黑块的格数

设一个数字圈的四个正交邻格里贴着若干黑格，把这些黑格所在的**连通黑块**（四向连通）的格子数相加；
**同一个块不管被几条臂摸到都只数一次**。数字超过这个和就是违规，等于就是这条账对上了。

没有 2×2 规矩，没有"黑格必须全连通"，没有"白格必须全连通"——三家原文一个都没写，我们也不加
（`DESIGN.md §1` 记录了为什么舍掉"邻格黑格数""四向射线长""相邻黑格对数"这三种读法）。

推理用的六条命名规则（与 `js/engine/pencil.js` 的 `RULES` 逐字相同，顺序就是难度深度的顺序）：

| 规则 | 说的是什么 |
| --- | --- |
| `K1_圈格不黑` | 有圈的格（含空圈）一律白。 |
| `K2_数满邻白` | 已经数够了的圈，身边未定的邻格全部钉白（再黑一格就多一格）。 |
| `K3_块封顶` | 计入某圈的黑块最多只能长到那个圈剩下的名额；长满了，它的门口全白。 |
| `K4_单门必黑` | 还差格子，而能让账变大的入口只剩一个 ⇒ 那格必黑。 |
| `K5_候选和恰好` | 这个圈能拿到的格子总数刚好等于数字 ⇒ 全部涂黑。 |
| `K6_单块必长` | 只有一个计入块、身边再无未定邻格 ⇒ 那块必须长到数字那么多格。 |

## 难点在哪里

- **账是"块"的，不是"格"的**。同一个块被一个圈从两条臂各摸到一次，只数一遍；一个块同时服务两个圈，
  名额要一起算。想成"邻格数"就推不动（这正是被官方例题否掉的那三种读法）。
- **减法比加法难**：`K3` 与 `K6` 都是"这块最多还能长几格 / 必须长到几格"，它们给的是白格，
  而白格不直接进任何人的账，只通过"门口变少"反过来卡住别人。
- **空圈是陷阱也是空气**：它不能涂黑（占位），除此之外什么都不是。把它当 0 就错了。
- **唯一解不告诉你**：盘面不会显示"还剩几个解"。本仓的承诺是每张出货盘都被穷举计数器在节点预算内
  数到恰好 1 解——你推不动的时候，问题在推法不在题面。

## 菜单四档（链长与线索密度是量出来的）

`| 档 | 尺寸 | 实测链长 | 实测线索 | 本机出题耗时 |` —— 链长与线索那两列是**等式**（B5 每次复跑逐档核对，
漂了就红，因为它们只由盘面与 seed 决定）；耗时那一列只是这台机器的读数，闸只卡"逐档变慢"这个方向（B5b），
它也不印到选档页上。下面这张表逐字等于 `js/engine/generate.js:17 的 TIERS`：

| 档 | 尺寸 | 实测链长 | 实测线索 | 本机出题耗时 |
| --- | --- | --- | --- | --- |
| 初 | 6×6 | 链长 med 8 轮 | 线索 med 10/36 格 | 出题 med 9 ms |
| 中 | 7×7 | 链长 med 11 轮 | 线索 med 13/49 格 | 出题 med 26 ms |
| 中 | 8×8 | 链长 med 12 轮 | 线索 med 17/64 格 | 出题 med 72 ms |
| 高 | 9×9 | 链长 med 14 轮 | 线索 med 20/81 格 | 出题 med 215 ms |

**10×10、12×12、14×14 被请出菜单**，理由印在选档页上、由 B7 逐条与本次实测对账（`DESIGN.md §5`）。
每条理由自己带着分母（"同一批 N 张"），而且比较对象是末档在**同一批张数**上的重算值——链长中位随张数漂
（9×9 在 5 张流上读 18 轮，在菜单那 20 张里读 14 轮），拿两条不同分母的流相比就造得出假话：

- 10×10 不在菜单里：同一批 20 张里链长 med 18 轮确实比末档量到的 14 轮多出 4 轮，深度是买到了；但题面没有变薄（线索 25/100 格，末档同批 20/81），每张的出题节点 med 28146 是末档同批的 2.6 倍，挖线索的每盘预算还掐了 1/20 盘——按一次的搜索量付账买到的不是更薄的盘，而我们没法对一台猜不到的机器承诺这一档的等待
- 12×12 不在菜单里：同一批 5 张里链长 med 19 轮只比末档多 1 轮，线索还有 38/144 格，密度不降反升，出题节点 med 36250 是末档同批的 2.0 倍——盘大了一圈，买到的是一张更厚的题面和成倍的搜索量，而不是更长的推理
- 14×14 不在菜单里：同一批 5 张里挖预算掐了 4/5 盘，出的是没挖开的厚线索盘（53/196 格，密度比末档同批还高）；链长 med 20 轮只比末档多 2 轮，出题节点 med 124727 却是末档同批的 6.9 倍——深度只挪了一点，成本却要看预算脸色

等待的承诺是「换一局之后 p95 ≤ 4000 ms」（B1 的绝对线）。10×10 就是被这一条请出去的：它在本机没过线，
在 CI 那台 2 vCPU 上 p95 过线了。**这条线本身一个字不挪**——挪线就是拿玩家的等待换尺寸（线有没有被挪，
由 D5d 拿文档那句与 `COST_MS` 对账）。

## 测试过程与结果

四道闸，全部可复跑；每一道都先被证明"会红"，再谈它的绿：

| 闸 | 挡在哪 | 没挡住什么 |
| --- | --- | --- |
| `node tools/engine-test.mjs` | 288 条等式：唯一解、0 猜推满、两路逐格会合、R4 三遍写法对账、计数器 vs 傻跑、seed 跨速度确定性、预算、两路独立性、提示逐格。条数钉在 `tools/engine-test.mjs:272 的 EXPECT_TOTAL` | 它跑在 node 里：页面接线、DOM 文案、画布像素错了它照样绿——那一段归 `core/play/win` 三条腿 |
| `node tools/balance.mjs` | 四档 × 20 张的实测：等待（B1）、出货率（B2）、阶梯（B3/B3b）、页面数字（B5/B5b）、规则开火（B6）、排除档位（B7）。那条等待线写在 `tools/balance.mjs:43 的 COST_MS` | 它自己从不撒车，所以"多解盘上铅笔不许自称推满"这条要靠 `B4` 自带的那台撒车反面样本机（`B4-guard` 就是数它到底撒了几盘）；难度读数再准也不知道渲染对不对 |
| `bash tools/verify.sh` | 真 Chrome + 裸 CDP：DOM 文本、几何、画布像素、真输入事件、存档与续局。条数逐份登记在 `tools/verify.sh:82 的 EXPECTS` | 它只认这台 Chrome：别的引擎的字体度量/滚动条不在射程内；也不知道这一盘"难不难"（那是 balance 的话） |
| `node tools/doctest.mjs` | 本文档与 `DESIGN.md` 里每个"现值"的等式（D1–D15） | 它只比"文档 vs 代码常数 / 脚本现值"，不复测任何墙钟读数；散文里那句"为什么"它管不着——那些理由各自的台架写在 `DESIGN.md §7`。行号引用那一族它按排版现推：文档里印了 6 处 `path:NN` 引用，其中现推锚点 5 条（有一处是同一锚点的重复提及），每一条都要回数被指的那几行里真坐着那个名字。两处口径写清楚。**其一：锚点认整词，不认子串**——名字两侧再是字母、数字、下划线、美元符就不是这个标识符本身；子串口径比它替掉的手抄清单**更弱**（`EXPECT` 坐在声明 `EXPECTS` 的那一行上也算命中，于是把一次真的漂读成绿）。这一格自己带一把截前缀的刀：现挑一条真引用的锚点、把最后一格削掉，要求削出来的串仍是被指那几行的子串、却不是完整标识符，整词必须判它红——口径哪天退回子串，那一天正是所有候选都"过"、这把刀挑不出红、D14 当场红的日子，不会静默跳过。**其二：被指的那几行整段是空白即红**——"在界内"不等于"指到了代码"，一条引用落在第 1 行与文件行数之间可能只是指着一片行距；带名字的那条腿本来就核不住空行（空行里坐不住任何标识符），所以这一道补的正是裸引用那一格。它的靶子由本闸自己那份文件现量（第一处整行空白），行号不写死：写死的那个数会在有人把那一行填上代码之后悄悄地不再测任何东西，量不出靶子（blankAt 为零）就当场红。两把刀各有牙，四腿都跑在盘上的同名副本里（真仓一个字节没动）：把整词那行改回 `.includes`、把空行那一道删掉、把一句真引用的锚点名截成前缀、把一句真引用挪到现量出来的空行上，四次都只红一条、红的就是点名它的那一条，复原回绿；判词 `TEETH_OK` 与四条读数在 `_tmp-kurotto-blank-word-teeth.log`。本轮这 6 处没有一条整段落空行、也没有一条锚点因整词变红，这两道是加严，不是修一处已经存在的漂。**这条腿没覆盖什么也写在这里**：本仓这 6 处今天全带名字，所以暂时没有"只过范围与空行这两道、内容没人核"的裸引用；哪天写成裸引用，D14a 那一句会把它算进"不带名字的裸引用 N 处"里点名，而那条腿对裸引用只核行号在不在、整段空不空——指向同一文件里另一处**非空**的行，这一格看不见，只有句子里贴了名字的才核得到 |

浏览器那份逐报告的条数（与 `tools/verify.sh:82 的 EXPECTS` 一格一格相同，闸跑完当场对数）：
engine 21 / gen 38 / play 30 / hint 16 / win 20 / layout 26 / mouseleg 41 / touchleg 44 / keysleg 26 / save 22 / fragleg 4 / resume 15 / reloadleg 4 / corrupt 16，
每形态 323 条 · 合计 646 条。

`balance.mjs` 的红线（每条都是实测，不是文案）：

| 红线 | 咬的是什么 |
| --- | --- |
| `B1` | 每张 p95 ≤ 4000 ms：承诺给玩家的是"按换一局之后最多等多久"，所以咬 p95 不咬中位 |
| `B2` | 出货率 100%：菜单里的一档必须每一张都出得来，"偶尔出不了盘"不是这一档的承诺 |
| `B3` | 链长 med 逐档不减，且首档 < 末档（阶梯不能是平的） |
| `B3b` | 末档的 p95 比首档**最长的那一张**还长，且链长 p95 逐档严格变长：往上一档买到的东西要能量到（10×10 下来之后这句靠尾巴撑着，不靠 med） |
| `B4` | 铅笔不说谎：在证过多解的盘上，铅笔声称"推满"的次数必须为 0 |
| `B4-guard` | 反面样本 ≥ 3 盘：没有多解样本时 `B4` 是一盏常绿的灯 |
| `B5` | 选档页印的链长 med 与线索 med == 本次实测（等式，逐档；这两个数只由盘与 seed 决定） |
| `B5b` | 页印耗时只卡方向：逐档变慢（ms 是机器速度，写成等式就会随负载变红；它现在也不印到页面上） |
| `B6` | 六条命名规则每一档都真的开过火：挂着名字但整档不开火的规则是装饰 |
| `B6-guard` | 规则表 6 条，与本文的六条一致 |
| `B7` | 请出菜单的档位：obs 读数逐条等式 + 末档在**同一批张数**上重测，理由句里"同一批 N 张""多 N 轮""末档同批的 X.X 倍""掐了 k/N 盘"逐条回到重算值；句子里出现墙钟（毫秒或"几秒"）即红 |

**阴性自证**：`GATE_SELFTEST=1 bash tools/verify.sh` 给每份报告种一条注定错的期望，必须 rc 非 0
并且 28/28 份报告点名吃下自己那条红（对数分母由 `LEGS` 推出来，"腿没跑"与"跑了没红"分得开）。
未知腿名（`LEGS=hint`）同样必须红。

## 承诺表（谁在守这句话，破了谁会红）

| 承诺 | 闸 | 破了会怎样 |
| --- | --- | --- |
| 每一局恰好一个答案 | `engine-test` · `verify.sh:gen` | 出货那一轮就红，红字点名 seed |
| 每一局都能 0 猜推满 | `engine-test` · `verify.sh:gen` · `B4` | 同上；`B4` 管的是反面：多解盘上铅笔不许自称推满 |
| 判据 1 的预算是 2000000 节点，单次计数调用 5000 节点，每盘挖线索 120000 节点 | `engine-test` · `D5` | 文档抄的数与代码里的常数分家即红 |
| 提示只给推得出的那一步 | `engine-test` · `verify.sh:hint` | 按了不落子、或说不出依据哪条规则，即红 |
| 同一 (档位, seed) 任何机器同一张盘 | `engine-test` · `verify.sh:gen` | 慢机器对照与跨引擎 golden 哈希任一处即红 |
| 换一局 p95 等待 ≤ 4000 ms | `B1` | 那一档请出菜单，线不挪；线有没有被挪由 `D5d` 拿文档那句与 `COST_MS` 对账 |
| 菜单四档的链长阶梯是真的 | `B3` · `B3b` · `B5` | 实测与页印分家、或阶梯被压平即红 |
| 选档页那句排除理由今天还成立 | `B7` | obs 与实测分家、理由句抄了别的批次的末档数、或句里没有分母即红 |
| 选档页的按钮不印墙钟 | `verify.sh:gen` · `engine-test` · `D1` | 按钮文案与 TIERS 的链长/线索分家、或理由句里冒出毫秒与"几秒"即红；源码那一头的 D1f 还配了 D1f0/D1f1 两条反空转（台账的 K12 打毫秒回归、K13 打"解析不到按钮文案"） |
| 六条规则都不是装饰 | `B6` · `B6-guard` | 某档整档不开火即红 |
| 页面上的数字与存档/seed 不说谎 | `verify.sh:play` · `verify.sh:save` · `verify.sh:resume` | DOM 文本与状态机分家即红 |
| 存档恢复不自动开局、坏档不崩 | `verify.sh:corrupt` · `verify.sh:reloadleg` | 六种坏 payload 任一让页面报错即红 |
| 触屏与鼠标走的是同一套几何 | `verify.sh:mouseleg` · `verify.sh:touchleg` | 命中盒 / 画布缓冲对不上即红 |
| 键盘快捷键真的送达 | `verify.sh:keysleg` | 按键后读数没变即红（这条历史上最脆，见「破坏试验台账」） |
| CI 跑到的门禁，本地一条命令也跑到 | `D15` | `bash tools/ci.sh` 少任何一步，红字点名「本地入口没跑：……」；每步的 rc 不是 ci.sh 自己捕获的红在 `D15b`，阴性自证那一步被接成正极性、或红了却没人点名的红在 `D15c`。这三条形状各有自己的台账刀（`K14` / `K15` / `K16`，三把都切在 `tools/ci.sh` 自己身上，见台账那张表下面那段） |
| 本文档里的"现值"等于代码/脚本的现在值 | `D1`–`D15` | 见 `tools/doctest.mjs`，解析不到就红 |
| 「同一个黑块只数一次」「callNodes=5000 比 20000 好」 | 无闸 | 裁断依据写在 `DESIGN.md §7`，不在这里冒充证据 |

## 复跑

```bash
node tools/engine-test.mjs            # 引擎闸
node tools/balance.mjs                # 实测台架（本机默认 20 张；CI 用 SAMPLES=20 跑 balance.mjs）
node tools/balance.mjs 6              # 只想快点看一眼时给小样本：页面数字那几条等式会跟着分母漂（B5 是拿
                                      # 20 张的读数当现值的），而 B7 不吃 SAMPLES——它按每一档自己登记的张数重测
bash tools/verify.sh                  # 真浏览器闸（自己起 server，两条 URL 形态）
LEGS="play win" bash tools/verify.sh  # 单跑几条腿
GATE_SELFTEST=1 bash tools/verify.sh  # 阴性自证：必须红，且 rc 非 0
node tools/doctest.mjs                # 文档对账（D1…D15 的等式）
node tools/sabotage.mjs               # 破坏试验台账：会改文件再恢复，跑之前工作树必须干净
GATE=1 node tools/sabotage.mjs        # 同一条闸的门禁模式（CI / npm run sabotage 跑的就是这行）：
                                      # 浏览器腿的刀延后但逐条预检，且不回写本文件、改为核对那格 rc
bash tools/ci.sh                      # 本地整闸入口：CI 两个 job 的那十步一次跑齐（含上面两条台账腿）
npm run check                         # node --check 全树
```

端口：本地 5282 · CDP 9382。两个都是本仓专属：别的仓同时在跑各自的闸，端口撞了就会拿到
"另一个仓的 index.html"，那种绿比红更糟（`tools/verify.sh` 的 preflight 会当场拒绝不是 kurotto 的字节）。

## CI

`.github/workflows/ci.yml` 两个 job，`.github/workflows/pages.yml` 发布静态站。
下表每一行都由 `doctest` 的 D6 拿 `ci.yml` 的 job 正文对账（文档不许比门禁松）；
样本数那格是 `.github/workflows/ci.yml:43 的 SAMPLES`，D7 会真的起一个 `SAMPLES=3` 的子进程验它接得上。
（这一处行号刚搬过一次家：`Syntax check every source` 那一步以前自己抄了 3 行 `git ls-files` /
`node --check`，和本地 `npm run check` 是两份独立漂的抄本；现在两边集合当场量过是 21 对 21，
那一步只剩 `run: npm run check` 一行，下面的行整体上移，引用跟着改，D14 会钉住它坐没坐在那一行。）

| 命令 | job | 步骤名 |
| --- | --- | --- |
| `node tools/engine-test.mjs` | check | `Engine tests` |
| `node tools/doctest.mjs` | check | `Docs are asserted surface` |
| `node tools/balance.mjs` | check | `Difficulty ladder is still measured` |
| `node tools/sabotage.mjs` | check | `Ledger proves the doc gate can fail` |
| `bash tools/verify.sh` | browser | `Browser gate, both local URL shapes` |
| `GATE_SELFTEST=1 bash tools/verify.sh` | browser | `Gate proves it can fail` |
| `node tools/deploy-set.mjs` | check | `Deploy set gate` |
| `node tools/deploy-set-selftest.mjs` | check | `Deploy set gate proves it can fail` |

CI 那一行跑的是 `GATE=1 node tools/sabotage.mjs`（`npm run sabotage` 是同一个命令）。GATE 是门禁模式，
和"写台账"的整跑有两处必须的差别：这个 job 没有 Chrome，所以浏览器腿那四把刀（K7–K10）**延后**——
但它们的针与期望点名照样逐条预检；而且它**不回写本文件**，改为要求本表每一格的 `实测 rc` 等于刚打出来的
那个数。少了这层区分，把整跑直接接进 CI 会永久红：第二次跑的时候那一格已经是数字、不再是 `?`，
脚本会按规矩报"不知道该怎么回写"而以 rc=2 死掉。

本地这一侧的入口是 `bash tools/ci.sh`（`npm run ci`）。它不是第五道闸——跑的就是上面那张表里的那几步，
只是把它们接成一条命令：以前本地要按顺序手敲，跳过哪一步就得等 CI 才第一次说话。它自己也不占覆盖表那一格
（那张表由 D6 与 ci.yml 的 job 正文双向比对，CI 里并没有 `ci.sh` 这一步），比它的是 D15：两边都不许手抄，
比对集从 `ci.yml` 现读——本仓现读出 7 个 `tools/*` 门禁，本地入口现跑 10 步，多出的三步是 `npm run check`、
入口文件那一步 grep 和 `GATE_SELFTEST` 阴性自证。每一步的 rc 由 ci.sh 自己捕获、按步写进同一份日志，整闸按
最坏的一步退出；阴性自证那一步是反极性接的（必须红，且红必须点名是哪条断言吃下了那颗注定错的期望），
而它只在自己那一份输出里找那句点名——拿总日志去 grep，前一步残留的一条 FAIL 就能替它说话。台账排在 verify
之前而不是并进 `tools/verify.sh`，是因为 K7–K10 那几把刀改的就是 verify.sh 自己，而 bash 边读边执行：让一个
还在跑的脚本被自己的台架原地改写，红不红就取决于解析偏移，那种绿不能用。跑之前工作树必须干净：
`GATE=1 node tools/sabotage.mjs` 拒绝在脏树上打刀，会停在 rc=2。

这条入口本轮在本机跑满过一次，读数在那份默认日志（`ci.sh` 的第一个参数，本轮没传过别的值）里：九步
`*_RC=0`，反极性那一步 `verify-selftest_RC=1` 且红在自己那一份输出里点到了名，整行 `CI_RC=0`。起停记的是
14:49:45Z→15:01:56Z，约十二分钟，几乎全在 verify 那两步的 headless Chrome 上——这是本轮这台机器的观测值，
不是给重跑的承诺，重跑会盖掉那两份日志。

CI 里没有任何 `npm install`：这仓零运行时依赖，拉一个打包器或浏览器进 CI 只会让门禁输在网络抖动上。
`check` job 用 node 20，`browser` job 必须 node 22（裸 CDP 台架用的是 22 才有的全局 `WebSocket`）。

## 破坏试验台账

一张全绿的报告只说明一件事：这一轮没有东西坏。它没说**闸会不会红**。所以每一道闸都挨了一刀，
刀由 `node tools/sabotage.mjs` 打：它先要求工作树干净，然后把「改成」那一格精确替换进去（针必须
唯一命中，打不中就报 ERROR 而不是静默跳过），跑对应的命令，读回 rc 与点名的断言，再 `git checkout`
把那一个文件恢复，最后不带刀整跑一遍要求全绿。

台账把 rc 读回来写进本文件：`实测 rc` 那一格被回写成什么，就只可能是刀真的打出来的那个数。
哪把刀没红，文件就保持原样并报错——这一节因此不能靠"抄一个好看的数"通过。

CI 与 `npm run sabotage` 跑的是同一张表的 `GATE=1` 那条腿，它报的是「逼红且点名 9 把 · 浏览器腿延后 4 把」，
并且要求这张表 13 格的 `实测 rc` 逐格等于刚打回来的数（延后不等于放过：那四把的针与期望点名照旧逐条预检，
只是这个 job 里没有 Chrome，打它们只会得到"起不来"的 rc=2）。这条腿本轮的读数住在 `_tmp-kurotto-sab-gate1.log`
（末行 `GATE_RC=0`）；被延后的那四把，它们那一格来自带 Chrome 的本地整跑，逐把证据是
`_tmp-kurotto-sab-K7.log` … `_tmp-kurotto-sab-K10.log`（各自 `rc=1`）与四份 `_tmp-kurotto-sab-control-*.log`
（不带刀整跑四道闸，各自 `GATE_RC=0`）。

| 刀 | 打在哪 | 文件 | 针（原文） | 改成 | 期望点名 | 命令 | 实测 rc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K1 | 判据 1 的账改成"数邻格有几个黑格"（R4 退回 R1） | `js/engine/rules.js` | `seen.add(comp[j]); got += sizes[comp[j]];` | `seen.add(comp[j]); got += 1;` | `官方解答在 R4 下合法` | `node tools/engine-test.mjs` | 1 |
| K2 | 铅笔 K4 放宽成"有门口就涂黑"（开始猜） | `js/engine/pencil.js` | `if (a.counted < v && a.gates.size === 1) { put([...a.gates][0], BLACK, RULES[3]); step(); }` | `if (a.counted < v && a.gates.size >= 1) { put([...a.gates][0], BLACK, RULES[3]); step(); }` | `官方例题铅笔 0 猜推满` | `node tools/engine-test.mjs` | 1 |
| K3 | 把墙钟混进 seed（"同一档同一 seed 同一张盘"就此作废） | `js/engine/rng.js` | `let a = seed >>> 0;` | `let a = (seed ^ Date.now()) >>> 0;` | `同 seed 两次生成逐格相同` | `node tools/engine-test.mjs` | 1 |
| K4 | 选档页的链长抄错一格 | `js/engine/generate.js` | `med: { rounds: 14, clues: 20, ms: 215 }` | `med: { rounds: 13, clues: 20, ms: 215 }` | `B5` | `node tools/balance.mjs` | 1 |
| K5 | 排除理由抄回废弃的墙钟读数 | `js/engine/generate.js` | `链长 med 19 轮只比末档多 1 轮` | `每张 p95 4938ms 越过 4000ms 的等待承诺` | `B7` | `node tools/balance.mjs` | 1 |
| K6 | 把请出菜单的 12×12 塞回菜单，抄着它那一批 5 张的读数 | `js/engine/generate.js` | `{ n: 9, label: '9×9', name: '高', pBlack: 0.34, med: { rounds: 14, clues: 20, ms: 215 } },` | `{ n: 9, label: '9×9', name: '高', pBlack: 0.34, med: { rounds: 14, clues: 20, ms: 215 } },\n  { n: 12, label: '12×12', name: '高', pBlack: 0.34, med: { rounds: 19, clues: 38, ms: 1932 } },` | `B5` | `node tools/balance.mjs` | 1 |
| K7 | 续局卡把"格已钉"改文案（界面与状态机分家） | `js/main.js` | `格已钉 · seed` | `格钉住 · seed` | `续局卡点名了已钉格数、seed 与提示次数` | `LEGS=save bash tools/verify.sh` | 1 |
| K8 | 画布重新拿自己当尺子（越画越大那个缺陷） | `js/render/board.js` | `const avail = Math.min((availPx \|\| 640) - WRAP_CHROME, CELL_TARGET * n + 2);` | `const avail = Math.min((canvas.parentElement.clientWidth \|\| 640) - WRAP_CHROME, CELL_TARGET * n + 2);` | `尺子不是画布自己` | `LEGS=win bash tools/verify.sh` | 1 |
| K9 | 对数表自己漂一格 | `tools/verify.sh` | `engine=21 gen=38` | `engine=20 gen=38` | `对数表写` | `LEGS=core bash tools/verify.sh` | 1 |
| K10 | 种下的红不再种（阴性自证变装饰） | `tools/scenarios.js` | `if (w.__selftest) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });` | `if (false) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });` | `没有种下的错期望` | `GATE_SELFTEST=1 LEGS=play bash tools/verify.sh` | 1 |
| K11 | 文档抄的逐报告条数与对数表分家 | `README.md` | `engine 21 / gen 38` | `engine 20 / gen 38` | `D8` | `node tools/doctest.mjs` | 1 |
| K12 | 把耗时印回选档页的按钮上（页面那一头的墙钟回归） | `js/main.js` | `<span class="tier-meta">${t.name} · 实测链长 med ${t.med.rounds} 轮 · 线索 med ${t.med.clues}/${t.n * t.n} 格</span>` | `<span class="tier-meta">${t.name} · 实测链长 med ${t.med.rounds} 轮 · 线索 med ${t.med.clues}/${t.n * t.n} 格 · ${t.med.ms} ms</span>` | `D1f` | `node tools/doctest.mjs` | 1 |
| K13 | 把按钮文案的锚点改名，让 D1f 无话可说 | `js/main.js` | `class="tier-meta"` | `class="tier-copy"` | `D1f0` | `node tools/doctest.mjs` | 1 |
| K14 | 本地入口少跑一道 CI 的门：doctest 那一步指向一个不存在的后缀 | `tools/ci.sh` | `run doctest node tools/doctest.mjs` | `run doctest node tools/doctest.bak` | `D15` | `node tools/doctest.mjs` | 1 |
| K15 | 整闸不再按最坏的一步退出（汇总退出那句被改一个字母） | `tools/ci.sh` | `exit $FAILED` | `exit $FAILEx` | `D15b` | `node tools/doctest.mjs` | 1 |
| K16 | 反极性那一步的点名标签拼错，等于没有人在自己那份输出里找那句 FAIL | `tools/ci.sh` | `grep -q 'FAIL' "$LOG.$name"` | `grep -q 'fail' "$LOG.$name"` | `D15c` | `node tools/doctest.mjs` | 1 |

这三把切的是 `tools/ci.sh` 自己，而 `npm run ci` 正在边读边执行这一份文件：所以三把都做成**同字节数、
同行数**的原地替换（`.mjs`→`.bak`、`FAILED`→`FAILEx`、`FAIL`→`fail`）。只守"不许改行数"还不够——
行数不动而字节数动了，bash 没读到的那半截照样从中间错位开始解析，那种红与绿都跟闸门无关。跑完台账
在 `git status` 里应当只剩 README 自己：那份 diff 就是"逐字节还原"的证人。

这里没有一把刀去拆出货前的两道复核（`挖完反而不唯一` / `出货盘铅笔推不满`）：出题器的每道守卫背后还压着下一道，
拆掉上面那道只会让下一道把盘拦下来，坏盘根本到不了闸面前——这类"拆了照样绿"的刀不是台账的功，它证明的是纵深。
要证明判据 1 的账真的会红，用的是 K1：把 R4 退回 R1，出货盘立刻就不是那批盘。

K12 与 K13 是成对的两把，打在**同一句承诺**的两头：K12 证明"按钮上出现毫秒"会红，K13 把按钮文案的锚点
改名，证明 D1f 在解析不到那一截时不会把空转念成通过（改名那一刀下 D1f 自己仍是绿的——红的是它旁边
那两条反空转）。一条只有"没有 X 即通过"的断言必须配一把"让 X 变得无法检测"的刀，否则它就是一句装饰。

一把只让文件语法坏掉的刀不算红：针打不中、或者刀落下去 rc 还是 0，台账都会点名报错。
闸"能红"的证据是**这一节的表格里每一行都带着一个 1**。

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高——文件图标读文件头，
  内联成 base64 的图标先解码再读同一段。后一条不是可选项：图标可能住在清单里而不是盘上的 `.png`
  （有的仓另有一条"零二进制文件"的承诺，那条只约束"有没有 .png 这个文件"）；如果 P 段只筛文件名，
  声明写 512 而真图 192 就一路放行。
- **钉住两个数**：R 段实际检查的路径条数（`30`）与这一次跑的断言条数（`48`），两个数
  都钉在 `tools/deploy-set.mjs` 顶部的那对常量里。没改页面却掉了，说明解析断了；删掉一张图标会同时
  少一条 R10 与那张的 P1/P2，所以两个数一起钉，断言条数能漂就是闸在缩水的信号。这一节故意只写数值、
  不写那对常量的名字，也不写别仓文档闸的编号：有的仓的文档闸会拿"文档里出现过的同名标识号"回数它
  自己的条数，还有的会把文档里点到的每个组编号逐个核对"这一轮真的发过"——两道闸共用一个名字，
  或者在本仓的文档里出现一个本仓没有的组编号，打红的都是不相干的那一边。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`30`、断言仍然 `48`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug /
X13 内联位图谎报尺寸——只在有靶子时下：X11/X12 要页面上那句 og:image，X13 要清单里真有一段 base64
图标，没有就打印 SKIP；反过来 X1 没有位图目录可砍时改砍 css，P 段一位都不核时台架直接报靶子不够），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑（取径真的会读的那支 JS / 那一张 CSS，不写死某一个仓的入口名），所以页面改了、仓与仓
不同，台架跟着走。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；本仓的整闸在 `tools/verify.sh` 的 `=== deploy-set ===` 那一段也各跑一次。它们红的时候并进本仓那条出口的退出码——这一条是这么证的：
把 ci.yml 里那行 `run: node tools/deploy-set.mjs` 砍掉，本仓整闸必须点名红且退出码非 0。
所以「本地全绿、线上 404 自己的 manifest / sw.js / 图标」这一类坏法在本地就会红。

