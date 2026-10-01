// 难度与成本的实测台架：菜单是一个承诺，不是一行文案。
// 用法：node tools/balance.mjs [样本数]   （或 SAMPLES=<n>，CI 用 SAMPLES=20）
// 红线逐条：B1 成本 · B2 出盘率 · B3/B3b 阶梯 · B4 铅笔不说谎 · B5/B5b 页面数字 · B6/B6-guard 规则覆盖。
import { makePuzzle, TIERS, BUDGET } from '../js/engine/generate.js';
import { countSolutions, countSolutionsDumb, isCircle, isNum, FREE } from '../js/engine/rules.js';
import { solve, RULES } from '../js/engine/pencil.js';
import { mulberry32 } from '../js/engine/rng.js';

const argn = +process.argv[2]; const envn = +process.env.SAMPLES;
const N = Number.isInteger(argn) && argn > 0 ? argn : Number.isInteger(envn) && envn > 0 ? envn : 20;

let red = 0;
const line = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : '**RED**'} ${label} · ${detail}`); if (!cond) red++; };

const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const med = a => pct(a, 0.5);

console.log(`菜单五档 × ${N} 张（seed 从 5000 起，逐张递增，可复跑）`);
const rows = [];
for (const t of TIERS) {
  const ms = [], rounds = [], clues = [], nodes = [], shippedRound = [];
  const firedBoards = new Map(RULES.map(r => [r, 0]));
  let ship = 0;
  for (let s = 0; s < N; s++) {
    const t0 = Date.now();
    const pz = makePuzzle(t.n, mulberry32(5000 + s * 7919 + t.n), { ...BUDGET, pBlack: t.pBlack });
    if (pz.fail) continue;
    ship++;
    ms.push(Date.now() - t0);
    rounds.push(pz.rounds); clues.push(pz.clues); nodes.push(pz.maxNodes);
    shippedRound.push(pz.rounds);
    for (const r of RULES) if (pz.fired[r] > 0) firedBoards.set(r, firedBoards.get(r) + 1);
  }
  const p95Ms = pct(ms, 0.95), p10R = pct(shippedRound, 0.1), p95R = pct(shippedRound, 0.95);
  rows.push({ n: t.n, label: t.label, ship, rate: ship / N, medMs: med(ms), p95Ms, medClues: med(clues),
    medRounds: med(rounds), p10Rounds: p10R, p95Rounds: p95R, maxRounds: Math.max(...rounds), minRounds: Math.min(...rounds),
    maxNodes: Math.max(0, ...nodes), firedBoards });
  console.log(`  ${t.name} ${t.label}：出货 ${ship}/${N} = ${(100 * ship / N).toFixed(0)}% · 线索 med ${med(clues)} · 链长 med ${med(rounds)} 轮 全距 ${Math.min(...rounds)}–${Math.max(...rounds)} p95 ${p95R} 轮 · 每张 med ${med(ms)} ms p95 ${p95Ms} ms · 唯一性节点 max ${Math.max(0, ...nodes)} · 开火覆盖 ${RULES.map(r => `${r.slice(0, 2)}=${firedBoards.get(r)}`).join(' ')}`);
}

// B1 成本绝对线：这一句承诺给的是"按换一局之后最多等多久"，所以线咬的是 p95 而不是中位。
const COST_MS = 4000;
for (const r of rows) line(r.p95Ms <= COST_MS, 'B1', `${r.label} 每张 p95 ${r.p95Ms} ms ≤ 承诺 ${COST_MS} ms`);
// B2 出盘率：菜单里的一档必须每一张都出得来，"偶尔出不了盘"不是这一档的承诺。
for (const r of rows) line(r.rate === 1, 'B2', `${r.label} 出货率 ${(100 * r.rate).toFixed(0)}% = 100%`);
// B3 阶梯：链长（铅笔推满用了多少轮）随档位不减，且首档与末档严格变长。
const rs = rows.map(r => r.medRounds);
line(rs.every((v, i) => i === 0 || v >= rs[i - 1]), 'B3', `链长 med 逐档不减：${rs.join(' → ')}`);
line(rs[0] < rs[rs.length - 1], 'B3', `首档 ${rs[0]} < 末档 ${rs[rs.length - 1]}（阶梯不能是平的）`);
// B3b 往上一档买到的东西要能量到：末档的中位链长，比首档最长的那一张还要长。
// 这里不写"两档区间不交叠"——实测首档 p95 15 轮 > 末档 p10 10 轮，单张盘的长短由盘面决定，交叉是结构性的。
const first = rows[0], last = rows[rows.length - 1];
line(last.medRounds > first.maxRounds, 'B3b',
  `${last.label} med ${last.medRounds} 轮 > ${first.label} 最长 ${first.maxRounds} 轮（首档最难的一张 ≈ 末档的中位）`);
console.log(`  观测：档间交叉 ${first.label} p95 ${first.p95Rounds} 轮 vs ${last.label} p10 ${last.p10Rounds} 轮 —— "换档必定更长"这句不提供，不是红线`);

// B4 铅笔不说谎：造一批"不唯一"的盘，铅笔若声称推满就是它撒谎。
// 造法是把出货盘的线索整片撒掉，只留最少的几个数字——留得少就容易多解。
{
  let lied = 0, multi = 0, tried = 0;
  const M = Math.max(4, N >> 2);
  for (let s = 0; s < M; s++) {
    const t = TIERS[(s % TIERS.length)];
    const pz = makePuzzle(t.n, mulberry32(77000 + s * 131), { ...BUDGET, pBlack: t.pBlack });
    if (pz.fail) continue;
    tried++;
    const B = { n: t.n, cell: Int16Array.from(pz.B.cell) };
    const nums = [...B.cell.keys()].filter(i => isNum(B.cell[i]));
    // 撒到只剩约三成的数字圈（按下标取模，可复跑），空圈全部放开成普通格
    for (const i of nums) if (i % 10 >= 3) B.cell[i] = FREE;
    for (let i = 0; i < B.cell.length; i++) if (B.cell[i] < 0) B.cell[i] = FREE;
    const c = countSolutions(B, { ...BUDGET, want: 2 });
    if (c.stopped) continue;
    if (c.count < 2) continue; // 只统计"证出来确实多解"的盘：无解盘不能给 B4 加分
    multi++;
    const p = solve(B);
    if (p.solved && !p.conflict) lied++;
  }
  line(lied === 0, 'B4', `多解盘上铅笔"推满"的次数 ${lied}（试 ${tried} 盘，其中 ${multi} 盘证过多解）`);
  line(multi >= 3, 'B4-guard', `反面样本 ${multi} 盘 ≥ 3：没有多解样本时 B4 是一盏常绿的灯`);
}

// B5 页面数字 == 本次实测：选档页印的"链长 med N 轮"逐档相等（等式闸）。
line(TIERS.length === rows.length && TIERS.every((t, i) => t.med.rounds === rows[i].medRounds), 'B5',
  `TIERS.med.rounds [${TIERS.map(t => t.med.rounds).join(',')}] vs 实测 [${rows.map(r => r.medRounds).join(',')}]`);
// B5b 耗时只卡方向：ms 是机器速度，不是承诺，写成等式就会随负载变红。
line(TIERS.every((t, i) => i === 0 || t.med.ms > TIERS[i - 1].med.ms), 'B5b',
  `TIERS.med.ms [${TIERS.map(t => t.med.ms).join(',')}] 逐档变慢`);

// B6 六条命名规则每一档都真的开过火：挂着名字但整档不开火的规则是装饰。
for (const r of rows) {
  const never = RULES.filter(x => r.firedBoards.get(x) === 0);
  line(never.length === 0, 'B6', `${r.label} 未开火规则 ${never.length ? never.join(',') : '无'}（${r.ship} 张样本）`);
}
line(RULES.length === 6, 'B6-guard', `规则表 ${RULES.length} 条，与 README 的六条一致`);

// 观测：12×12 / 14×14 不在菜单里，这里只报读数不设红线（未来的通过不该把闸弄红）。
console.log('观测：请出菜单的档位（不参与红线）');
for (const n of [12, 14]) {
  let ship = 0, cut = 0, clues = [], ms = [], rounds = [];
  const K = Math.max(3, N >> 2);
  for (let s = 0; s < K; s++) {
    const t0 = Date.now();
    const pz = makePuzzle(n, mulberry32(5000 + s * 7919 + n), BUDGET);
    if (pz.fail) continue;
    ship++; cut += pz.digStopped > 0 ? 1 : 0; clues.push(pz.clues); ms.push(Date.now() - t0); rounds.push(pz.rounds);
  }
  console.log(`  ${n}×${n}：出货 ${ship}/${K} · 挖预算被掐 ${cut}/${K} · 线索 med ${med(clues)}/${n * n} · 链长 med ${med(rounds)} 轮 · 每张 med ${med(ms)} ms`);
}

console.log(`\n合计红线 ${red} 条破口`);
process.exit(red ? 1 : 0);
