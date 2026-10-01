// 引擎闸：每条断言都要能在引擎写坏时变红（阴性自证），只打印读数不算闸。
// 用法：node tools/engine-test.mjs [seeds]
import { makeBoard, countSolutions, countSolutionsDumb, violations, isCircle, isNum, nbrs, FREE, EMPTY, NODE_CAP } from '../js/engine/rules.js';
import { solve, RULES } from '../js/engine/pencil.js';
import { makePuzzle, numberAt, TIERS, BUDGET, EXCLUDED_TIERS } from '../js/engine/generate.js';
import { mulberry32 } from '../js/engine/rng.js';
import { EX_N, EX_CLUES, EX_BLACK } from '../js/engine/example.js';

let fail = 0, pass = 0;
const VERBOSE = !!process.env.VERBOSE;
// 逐盘断言在闸里是**计数**不是日志：五档 × 12 张的"ok"会把真正要看的汇总和红灯淹掉。
const note = (cond, label, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  **FAIL** ${label}${extra ? ' · ' + extra : ''}`); }
  if (cond && VERBOSE) console.log(`  ok   ${label}${extra ? ' · ' + extra : ''}`);
};
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}${extra ? ' · ' + extra : ''}`); }
  else { fail++; console.log(`  **FAIL** ${label}${extra ? ' · ' + extra : ''}`); }
};

// ---------- 官方例题（数据在 js/engine/example.js：浏览器那条 engine 腿读的是同一份）----------
// 题面：4×4，数字圈 (1,1)=2 · (2,1)=0 · (2,2)=3 · (3,4)=1 · (4,2)=1，另外 (2,4) 是一个空圈。
// 解答：黑格在 (1,2) (1,3) (3,2) (4,4)。
const EX = makeBoard(EX_N, EX_CLUES);
const exBlack = new Uint8Array(EX_N * EX_N);
for (const [r, c] of EX_BLACK) exBlack[r * EX_N + c] = 1;

// ---------- 1. 四条候选读法打在官方例题上：只有 R4 全中 ----------
console.log('判据读法四条');
function readR1(B, black, i) { // 正交邻格里黑格的个数
  let k = 0;
  for (const j of nbrs(B, (i / B.n) | 0, i % B.n)) if (black[j] && !isCircle(B.cell[j])) k++;
  return k;
}
function readR2(B, black, i) { // 四向射线：每个方向上连续黑格长度之和（S1a 英文字面）
  let k = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    let r = ((i / B.n) | 0) + dr, c = (i % B.n) + dc;
    while (r >= 0 && r < B.n && c >= 0 && c < B.n && black[r * B.n + c] && !isCircle(B.cell[r * B.n + c])) { k++; r += dr; c += dc; }
  }
  return k;
}
function readR3(B, black, i) { // 相邻黑格之间成对的数量
  const nb = nbrs(B, (i / B.n) | 0, i % B.n).filter(j => black[j] && !isCircle(B.cell[j]));
  let k = 0;
  for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
    const d = Math.abs(((nb[a] / B.n) | 0) - ((nb[b] / B.n) | 0)) + Math.abs((nb[a] % B.n) - (nb[b] % B.n));
    if (d === 1) k++;
  }
  return k;
}
const READINGS = [['R1_邻格黑格数', readR1], ['R2_四向射线长', readR2], ['R3_相邻黑格对数', readR3], ['R4_相邻黑块格数和', (B, black, i) => {
  const v = violations(B, black);
  const bad = v.find(x => x.r === ((i / B.n) | 0) && x.c === i % B.n);
  return bad ? bad.got : B.cell[i];
}]];
const hitBy = {};
for (const [name, fn] of READINGS) {
  let hits = 0, total = 0;
  for (let i = 0; i < EX_N * EX_N; i++) {
    if (!isNum(EX.cell[i])) continue;
    total++;
    if (fn(EX, exBlack, i) === EX.cell[i]) hits++;
  }
  hitBy[name] = `${hits}/${total}`;
}
ok(hitBy.R4_相邻黑块格数和 === '5/5', '裁断 R4 在官方例题上 5 个数字圈全中', `命中 ${hitBy.R4_相邻黑块格数和}`);
ok(hitBy.R1_邻格黑格数 !== '5/5', 'R1 邻格黑格数被官方例题否掉', `只中 ${hitBy.R1_邻格黑格数}`);
ok(hitBy.R2_四向射线长 !== '5/5', 'R2 四向射线长（S1a 英文的字面读法）被官方例题否掉', `只中 ${hitBy.R2_四向射线长}`);
ok(hitBy.R3_相邻黑格对数 !== '5/5', 'R3 相邻黑格对数被官方例题否掉', `只中 ${hitBy.R3_相邻黑格对数}`);

// ---------- 2. 官方例题：两条路会合 ----------
console.log('官方例题：计数器 × 铅笔');
ok(violations(EX, exBlack).length === 0, '官方解答在 R4 下合法', JSON.stringify(violations(EX, exBlack)));
const dumbEx = countSolutionsDumb(EX);
ok(dumbEx.count === 1 && dumbEx.complete, '官方例题 2^10 全穷举恰好 1 解', `${dumbEx.count} 解 / ${dumbEx.leaves} 叶`);
const dfsEx = countSolutions(EX, { want: 3 });
ok(dfsEx.count === dumbEx.count, 'DFS 计数器与傻跑版在官方例题上同解数', `DFS ${dfsEx.count} · 傻跑 ${dumbEx.count}`);
ok(dfsEx.count === 1 && !dfsEx.stopped, '官方例题唯一性证完（没撞节点预算）', `${dfsEx.nodes} 节点 · ${dfsEx.viol} 支被剪 · ${dfsEx.ms}ms`);
{
  const n = EX_N;
  let same = true;
  for (let i = 0; i < n * n; i++) if ((dfsEx.first[i] ? 1 : 0) !== exBlack[i]) same = false;
  ok(same, 'DFS 找到的那份解逐格 == 官方解答');
}
const pen = solve(EX);
ok(!pen.conflict && pen.solved && pen.undetermined.length === 0, '官方例题铅笔 0 猜推满', pen.conflict || `未定 ${pen.undetermined.length} 格`);
{
  let diff = 0;
  for (let i = 0; i < EX_N * EX_N; i++) {
    if (isCircle(EX.cell[i])) continue;
    if (pen.asg[i] !== (exBlack[i] ? 2 : 1)) diff++;
  }
  ok(diff === 0, '两版在官方例题上会合：铅笔推出的就是官方解答', `不一致 ${diff} 格`);
}
ok(RULES.every(r => Object.prototype.hasOwnProperty.call(pen.fired, r)), '每条命名规则都在开火表里', Object.keys(pen.fired).join(','));
ok(pen.fired['K1_圈格不黑'] > 0 && pen.fired['K2_数满邻白'] > 0 && pen.fired['K3_块封顶'] > 0 && pen.fired['K4_单门必黑'] > 0,
  '官方例题上 K1–K4 都开过火（规则不是摆设）', RULES.map(r => `${r}=${pen.fired[r]}`).join(' '));

// ---------- 3. 没有 2×2 规矩：这是与 nurikabe 族的口径边界 ----------
console.log('R4 不含 2×2 / 连通 / 白格连通');
{
  // 一个 2×2 黑块贴着一个写 4 的圈：R4 合法；若谁偷偷加了 2×2 禁令，这里就会被判违规。
  const B = makeBoard(3, [[0, 1, 4]]);
  const black = new Uint8Array(9);
  for (const i of [4, 5, 7, 8]) black[i] = 1;
  ok(violations(B, black).length === 0, '2×2 黑块在 R4 下合法', JSON.stringify(violations(B, black)));
  const B2 = makeBoard(3, [[0, 1, 1]]);
  const b2 = new Uint8Array(9); b2[4] = 1;
  ok(violations(B2, b2).length === 0, '1 格的孤立黑块合法（janko 首段的"必须成多米诺"不是规则）');
}

// ---------- 4. 计数器对账：DFS 与 2^F 全代入逐盘相等 ----------
console.log('计数器对账（DFS vs 傻跑）');
{
  let compared = 0, mismatch = 0, maxNodes = 0;
  for (let s = 0; s < 240; s++) {
    const rnd = mulberry32(90000 + s);
    const n = 4 + (s % 3);
    const cell = new Int16Array(n * n).fill(FREE);
    for (let i = 0; i < n * n; i++) if (rnd() < 0.3) cell[i] = rnd() < 0.25 ? EMPTY : Math.floor(rnd() * 5);
    const B = { n, cell };
    const free = [...Array(n * n).keys()].filter(i => !isCircle(B.cell[i]));
    if (free.length > 18) continue;
    const dumb = countSolutionsDumb(B);
    for (const order of ['row', 'near']) {
      const dfs = countSolutions(B, { order, want: 3 });
      compared++;
      maxNodes = Math.max(maxNodes, dfs.nodes);
      if (dfs.count !== Math.min(dumb.count, 3) || dfs.stopped) mismatch++;
    }
  }
  ok(mismatch === 0 && compared >= 200, '剪枝版与傻跑版逐盘同解数', `${compared} 次对照，不一致 ${mismatch} · 最大节点 ${maxNodes}`);
}

// ---------- 5. 出题器不变量：每张出货盘两条路同时点头 ----------
console.log('出题器不变量');
const SEEDS = +(process.argv[2] || 12);
const perTier = [];
for (const t of TIERS) {
  let shipped = 0, clues = [], rounds = [], nodes = [], ms = [];
  for (let s = 1; s <= SEEDS; s++) {
    const pz = makePuzzle(t.n, mulberry32(s * 977 + t.n * 31), { ...BUDGET, pBlack: t.pBlack });
    if (pz.fail) { note(false, `${t.label} seed ${s} 出货`, pz.fail + ' ' + JSON.stringify(pz.rejects)); continue; }
    shipped++;
    const B = { n: pz.B.n, cell: pz.B.cell };
    note(violations(B, pz.black).length === 0, `${t.label} seed ${s} 出货盘合法`, JSON.stringify(violations(B, pz.black)).slice(0, 120));
    const c = countSolutions(B, { ...BUDGET, want: 3 });
    note(c.count === 1 && !c.stopped, `${t.label} seed ${s} 唯一性证完`, `${c.count} 解 / ${c.nodes} 节点 · 剪 ${c.viol} 支`);
    note(c.nodes <= NODE_CAP, `${t.label} seed ${s} 没破节点预算`, `${c.nodes} 节点`);
    const p = solve(B);
    let diff = 0;
    for (let i = 0; i < t.n * t.n; i++) if (!isCircle(B.cell[i]) && p.asg[i] !== (pz.black[i] ? 2 : 1)) diff++;
    note(!p.conflict && p.solved && diff === 0, `${t.label} seed ${s} 铅笔推满 == 计数器唯一解`, p.conflict || `不一致 ${diff} 格`);
    let blackTotal = 0;
    for (let i = 0; i < pz.black.length; i++) blackTotal += pz.black[i];
    note(blackTotal === [...c.first].filter(v => v).length, `${t.label} seed ${s} 出货答案就是计数器那份`, `${blackTotal}`);
    clues.push(pz.clues); rounds.push(pz.rounds); nodes.push(pz.maxNodes); ms.push(pz.ms);
  }
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : NaN;
  perTier.push({ n: t.n, label: t.label, shipped, medClues: med(clues), medRounds: med(rounds), maxNodes: Math.max(0, ...nodes), medMs: med(ms) });
  console.log(`  ${t.label}：出货 ${shipped}/${SEEDS} · 线索 med ${med(clues)} · 链长 med ${med(rounds)} 轮 · 单卡最大节点 ${Math.max(0, ...nodes)} · 每张 med ${med(ms)} ms`);
}
ok(perTier.every(p => p.shipped === SEEDS), '每一档每张都出货（没有"这一档偶尔出不了盘"）', perTier.map(p => `${p.label} ${p.shipped}/${SEEDS}`).join(' '));

// ---------- 6. seed 确定性：同一个 seed 画同一张盘 ----------
console.log('seed 确定性');
for (const t of TIERS) {
  const a = makePuzzle(t.n, mulberry32(4242), { ...BUDGET, pBlack: t.pBlack });
  const b = makePuzzle(t.n, mulberry32(4242), { ...BUDGET, pBlack: t.pBlack });
  const same = !a.fail && !b.fail &&
    a.B.cell.every((v, i) => v === b.B.cell[i]) &&
    a.black.every((v, i) => v === b.black[i]);
  ok(same, `${t.label} 同 seed 两次生成逐格相同`, a.fail || b.fail ? '没出货' : `${a.clues} 条线索`);
}
// 同一串 seed 还要跨过"机器快慢"这一维：给一台假想的慢机器（每次读表都多走 250ms），
// 出的盘必须一模一样。这五条里之前那版是会在这一条上红的——那时 countSolutions 的
// stopped 里写着 Date.now() - t0 > 250，慢机器会提前掐断挖线索，同一个 seed 出的是另一张盘。
{
  const realNow = Date.now;
  let walked = 0;
  Date.now = () => (walked += 250);
  const slow = TIERS.map(t => makePuzzle(t.n, mulberry32(4242), { ...BUDGET, pBlack: t.pBlack }));
  Date.now = realNow;
  slow.forEach((a, k) => {
    const b = makePuzzle(TIERS[k].n, mulberry32(4242), { ...BUDGET, pBlack: TIERS[k].pBlack });
    const identical = !a.fail && !b.fail && a.B.cell.every((v, i) => v === b.B.cell[i]) &&
      a.black.every((v, i) => v === b.black[i]);
    ok(identical, `${TIERS[k].label} 在"每次读表 +250ms 的慢机器"上出同一张盘`,
      a.fail || b.fail ? `出货情况 a:${!a.fail} b:${!b.fail}` : `${a.clues} vs ${b.clues} 条线索`);
  });
}

// ---------- 7. 菜单承诺：档位表与请出菜单的那两档 ----------
console.log('菜单与预算');
ok(TIERS.map(t => t.n).join(',') === '6,7,8,9,10', '菜单五档 6/7/8/9/10', TIERS.map(t => t.n).join(','));
ok(EXCLUDED_TIERS.map(t => t.n).join(',') === '12,14', '12×12 与 14×14 被请出菜单且带理由', EXCLUDED_TIERS.map(t => `${t.n}:${t.reason.length > 20}`).join(' '));
ok(BUDGET.cap === NODE_CAP && BUDGET.callNodes === 5000 && BUDGET.digNodes === 120000 && BUDGET.order === 'near',
  '出题预算：单次 5000 节点 / 每盘挖 120000 节点 / near 挑格 / 承诺预算 2000000 节点', JSON.stringify(BUDGET));
ok(BUDGET.timeMs === undefined && BUDGET.digMs === undefined,
  '预算表里没有按墙钟掐的旋钮（墙钟进判定＝同 seed 在不同机器上出不同的盘）', Object.keys(BUDGET).join(','));
ok(perTier.every(p => p.maxNodes <= NODE_CAP), '出货盘从未撞过节点预算', perTier.map(p => `${p.label} ${p.maxNodes}`).join(' '));

// ---------- 8. 阴性自证：闸自己也得能红 ----------
// 把出货盘的某个数字改大 1：计数器必须数不出解，铅笔必须不再"推满"，两者沉默就是它没在检查。
console.log('阴性自证');
{
  const pz = makePuzzle(TIERS[2].n, mulberry32(99001), { ...BUDGET, pBlack: TIERS[2].pBlack });
  if (pz.fail) { fail++; console.log('  **FAIL** 阴性自证拿不到出货盘'); }
  else {
    const B = { n: pz.B.n, cell: Int16Array.from(pz.B.cell) };
    const numIdx = [...B.cell.keys()].filter(i => isNum(B.cell[i]));
    // 刀口一：把某个数字写成「比它能拿到的格子总数还多一格」。
    // 这一支在任何涂法下都不成立，所以计数器必须证完并数出 0 解——
    // （原来的刀口"+1"不算：改大一号可能另有它自己的唯一解，那是题目不是引擎的错。）
    const supplyOf = (i) => {
      const seen = new Set(), st = [];
      for (const j of nbrs(B, (i / B.n) | 0, i % B.n)) if (!isCircle(B.cell[j]) && !seen.has(j)) { seen.add(j); st.push(j); }
      while (st.length) {
        const k = st.pop();
        for (const m of nbrs(B, (k / B.n) | 0, k % B.n)) if (!isCircle(B.cell[m]) && !seen.has(m)) { seen.add(m); st.push(m); }
      }
      return seen.size;
    };
    const target = numIdx.find(i => supplyOf(i) < B.n * B.n) ?? numIdx[0];
    B.cell[target] = supplyOf(target) + 1;
    const r = countSolutions(B, { ...BUDGET, want: 2 });
    ok(!r.stopped && r.count === 0, '数字超过它能拿到的格数 -> 计数器证完这支没有解', `${r.count} 解 / ${r.nodes} 节点 · 剪 ${r.viol} 支`);
    ok(!solve(B).solved, '同样的盘 -> 铅笔不再"推满"（它会说推满才算绿）', solve(B).conflict || '它推满了');
    ok(violations(B, pz.black).length > 0, '同样的盘 -> 逐圈核对点名违规', `${violations(B, pz.black).length} 条`);
    // 刀口二：唯一解意味着把答案翻一格一定违规（否则 violations 根本没在核对整盘）。
    const flip = { n: pz.B.n, cell: Int16Array.from(pz.B.cell) };
    const black = Uint8Array.from(pz.black);
    const flipIdx = black.findIndex(v => v === 1);
    black[flipIdx] = 0;
    ok(violations(flip, black).length > 0, '把答案的一格黑翻成白 -> 违规点名', `${violations(flip, black).length} 条`);
    // 反过来：数字写回 R4 真值必须仍然合法（否则 violations 是一盏常红的灯）
    const back = { n: pz.B.n, cell: Int16Array.from(pz.B.cell) };
    back.cell[numIdx[0]] = numberAt(back, pz.black, numIdx[0]);
    ok(violations(back, pz.black).length === 0, '数字写回 R4 真值 -> 又合法（violations 不是常量假绿）');
  }
}

// ---------- 9. 两条路不复用代码（判据 2 的硬要求）----------
console.log('两条路的独立性');
{
  const src = await import('node:fs').then(m => m.readFileSync(new URL('../js/engine/pencil.js', import.meta.url), 'utf8'));
  ok(!/from '.*rules\.js/.test(src) && !/from ".\/rules/.test(src), 'pencil.js 没有 import 计数器那条路', '看源码：无 rules.js 引用');
  ok(!/countSolutions/.test(src), 'pencil.js 里没有引用 countSolutions');
}

console.log(`\n合计 ${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);
