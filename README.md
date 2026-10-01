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
| `node tools/doctest.mjs` | 本文档与 `DESIGN.md` 里每个"现值"的等式（D1–D13） | 它只比"文档 vs 代码常数 / 脚本现值"，不复测任何墙钟读数；散文里那句"为什么"它管不着——那些理由各自的台架写在 `DESIGN.md §7` |

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
| 本文档里的"现值"等于代码/脚本的现在值 | `D1`–`D13` | 见 `tools/doctest.mjs`，解析不到就红 |
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
node tools/doctest.mjs                # 文档对账（D1…D13 的等式）
node tools/sabotage.mjs               # 破坏试验台账：会改文件再恢复，跑之前工作树必须干净
npm run check                         # node --check 全树
```

端口：本地 5282 · CDP 9382。两个都是本仓专属：别的仓同时在跑各自的闸，端口撞了就会拿到
"另一个仓的 index.html"，那种绿比红更糟（`tools/verify.sh` 的 preflight 会当场拒绝不是 kurotto 的字节）。

## CI

`.github/workflows/ci.yml` 两个 job，`.github/workflows/pages.yml` 发布静态站。
下表每一行都由 `doctest` 的 D6 拿 `ci.yml` 的 job 正文对账（文档不许比门禁松）；
样本数那格是 `.github/workflows/ci.yml:46 的 SAMPLES`，D7 会真的起一个 `SAMPLES=3` 的子进程验它接得上。

| 命令 | job | 步骤名 |
| --- | --- | --- |
| `node tools/engine-test.mjs` | check | `Engine tests` |
| `node tools/doctest.mjs` | check | `Docs are asserted surface` |
| `node tools/balance.mjs` | check | `Difficulty ladder is still measured` |
| `bash tools/verify.sh` | browser | `Browser gate, both local URL shapes` |
| `GATE_SELFTEST=1 bash tools/verify.sh` | browser | `Gate proves it can fail` |

CI 里没有任何 `npm install`：这仓零运行时依赖，拉一个打包器或浏览器进 CI 只会让门禁输在网络抖动上。
`check` job 用 node 20，`browser` job 必须 node 22（裸 CDP 台架用的是 22 才有的全局 `WebSocket`）。

## 破坏试验台账

一张全绿的报告只说明一件事：这一轮没有东西坏。它没说**闸会不会红**。所以每一道闸都挨了一刀，
刀由 `node tools/sabotage.mjs` 打：它先要求工作树干净，然后把「改成」那一格精确替换进去（针必须
唯一命中，打不中就报 ERROR 而不是静默跳过），跑对应的命令，读回 rc 与点名的断言，再 `git checkout`
把那一个文件恢复，最后不带刀整跑一遍要求全绿。

台账把 rc 读回来写进本文件：`实测 rc` 那一格被回写成什么，就只可能是刀真的打出来的那个数。
哪把刀没红，文件就保持原样并报错——这一节因此不能靠"抄一个好看的数"通过。

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

这里没有一把刀去拆出货前的两道复核（`挖完反而不唯一` / `出货盘铅笔推不满`）：出题器的每道守卫背后还压着下一道，
拆掉上面那道只会让下一道把盘拦下来，坏盘根本到不了闸面前——这类"拆了照样绿"的刀不是台账的功，它证明的是纵深。
要证明判据 1 的账真的会红，用的是 K1：把 R4 退回 R1，出货盘立刻就不是那批盘。

K12 与 K13 是成对的两把，打在**同一句承诺**的两头：K12 证明"按钮上出现毫秒"会红，K13 把按钮文案的锚点
改名，证明 D1f 在解析不到那一截时不会把空转念成通过（改名那一刀下 D1f 自己仍是绿的——红的是它旁边
那两条反空转）。一条只有"没有 X 即通过"的断言必须配一把"让 X 变得无法检测"的刀，否则它就是一句装饰。

一把只让文件语法坏掉的刀不算红：针打不中、或者刀落下去 rc 还是 0，台账都会点名报错。
闸"能红"的证据是**这一节的表格里每一行都带着一个 1**。

