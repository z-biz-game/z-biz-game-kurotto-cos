// 难度与成本的实测台架：菜单是一个承诺，不是一行文案。
// 用法：node tools/balance.mjs [样本数]   （或 SAMPLES=<n>，CI 用 SAMPLES=20）
// 红线逐条：B1 成本 · B2 出盘率 · B3/B3b 阶梯 · B4 铅笔不说谎 · B5/B5b 页面数字 · B6/B6-guard 规则覆盖 · B7 排除档位的理由今天还成立。
import { makePuzzle, TIERS, EXCLUDED_TIERS, BUDGET } from '../js/engine/generate.js';
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

console.log(`菜单 ${TIERS.length} 档 × ${N} 张（seed 从 5000 起，逐张递增，可复跑）`);
const rows = [];
for (const t of TIERS) {
  const ms = [], rounds = [], clues = [], nodes = [], totNodes = [], shippedRound = [];
  const firedBoards = new Map(RULES.map(r => [r, 0]));
  let ship = 0;
  for (let s = 0; s < N; s++) {
    const t0 = Date.now();
    const pz = makePuzzle(t.n, mulberry32(5000 + s * 7919 + t.n), { ...BUDGET, pBlack: t.pBlack });
    if (pz.fail) continue;
    ship++;
    ms.push(Date.now() - t0);
    rounds.push(pz.rounds); clues.push(pz.clues); nodes.push(pz.maxNodes); totNodes.push(pz.nodes);
    shippedRound.push(pz.rounds);
    for (const r of RULES) if (pz.fired[r] > 0) firedBoards.set(r, firedBoards.get(r) + 1);
  }
  const p95Ms = pct(ms, 0.95), p10R = pct(shippedRound, 0.1), p95R = pct(shippedRound, 0.95);
  rows.push({ n: t.n, label: t.label, ship, rate: ship / N, medMs: med(ms), p95Ms, medClues: med(clues),
    medRounds: med(rounds), p10Rounds: p10R, p95Rounds: p95R, maxRounds: Math.max(...rounds), minRounds: Math.min(...rounds),
    maxNodes: Math.max(0, ...nodes), medNodes: med(totNodes), firedBoards });
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
// B3b 往上一档买到的东西要能量到。原来这条写的是"末档的中位链长比首档最长的那一张还长"
// （10×10 med 18 > 6×6 最长 15）——那句承诺是靠最上面那一档撑着的，10×10 请出菜单之后它就不成立了
// （9×9 med 14 < 15）。放宽那条线不是办法，换一句今天仍然为真的：末档的**尾巴**要深过首档最难的一张，
// 且每一档的 p95 都严格比下一档长。这里不写"两档区间不交叠"——单张盘的长短由盘面决定，交叉是结构性的。
const first = rows[0], last = rows[rows.length - 1];
line(last.p95Rounds > first.maxRounds, 'B3b',
  `${last.label} p95 ${last.p95Rounds} 轮 > ${first.label} 最长 ${first.maxRounds} 轮（末档摸得到首档摸不到的深度）`);
const pss = rows.map(r => r.p95Rounds);
line(pss.every((v, i) => i === 0 || v > pss[i - 1]), 'B3b', `链长 p95 逐档严格变长：${pss.join(' → ')}`);
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

// B5 页面数字 == 本次实测：选档页印的"链长 med N 轮 · 线索 med M/n² 格"逐档相等（等式闸）。
// 这两个数都是盘与 seed 的属性，换一台机器是同一个数；耗时不在这一条里（B5b 只卡方向）。
line(TIERS.length === rows.length && TIERS.every((t, i) => t.med.rounds === rows[i].medRounds && t.med.clues === rows[i].medClues), 'B5',
  `TIERS.med [${TIERS.map(t => `${t.med.rounds}轮/${t.med.clues}线索`).join(' ')}] vs 实测 [${rows.map(r => `${r.medRounds}轮/${r.medClues}线索`).join(' ')}]`);
// B5b 耗时只卡方向：ms 是机器速度，不是承诺，写成等式就会随负载变红。
line(TIERS.every((t, i) => i === 0 || t.med.ms > TIERS[i - 1].med.ms), 'B5b',
  `TIERS.med.ms [${TIERS.map(t => t.med.ms).join(',')}] 逐档变慢`);

// B6 六条命名规则每一档都真的开过火：挂着名字但整档不开火的规则是装饰。
for (const r of rows) {
  const never = RULES.filter(x => r.firedBoards.get(x) === 0);
  line(never.length === 0, 'B6', `${r.label} 未开火规则 ${never.length ? never.join(',') : '无'}（${r.ship} 张样本）`);
}
line(RULES.length === 6, 'B6-guard', `规则表 ${RULES.length} 条，与 README 的六条一致`);

// 请出菜单的档位：排除的理由必须是**现在还在成立**的理由，否则那句"为什么不在菜单里"就成了
// 历史读数。obs 里那四个读数（链长 med、线索 med、挖预算被掐的盘数、出题节点 med）都只由
// seed 与节点预算决定，换一台机器是同一个数，所以逐条写死等式；耗时只卡方向（同 B5b）。
// 张数由每一档自己的 obs.samples 带，不吃 SAMPLES：否则页面那句话里的中位没有分母。
// 末档必须在**同一批张数**上重测：链长中位随张数漂（9×9 在 5 张流上读 18 轮，在菜单那 20 张里读 14 轮），
// 拿两条不同分母的流相比，"比末档多几轮"就是在拿五张的中位比二十张的中位。两侧走同一条 seed 流
// （seed = 5000+s*7919+n）和末档那一份 pBlack——比较的对象是"菜单末档在同一批里的样子"，不是另一台机器。
const top = TIERS[TIERS.length - 1];
const refBy = new Map(); // 同一批张数只重测一次末档
function batch(n, S, pBlack) {
  let ship = 0, cut = 0;
  const clues = [], ms = [], rounds = [], totNodes = [];
  for (let s = 0; s < S; s++) {
    const t0 = Date.now();
    const pz = makePuzzle(n, mulberry32(5000 + s * 7919 + n), { ...BUDGET, pBlack });
    if (pz.fail) continue;
    ship++; cut += pz.digStopped > 0 ? 1 : 0;
    clues.push(pz.clues); rounds.push(pz.rounds); totNodes.push(pz.nodes); ms.push(Date.now() - t0);
  }
  return { S, ship, cut, rounds: med(rounds), clues: med(clues), nodes: med(totNodes), ms: med(ms), p95ms: pct(ms, 0.95) };
}
console.log('对账：请出菜单的档位（B7 逐条核对页面理由里的读数，末档在每一档自己的那批张数上重测）');
for (const x of EXCLUDED_TIERS) {
  if (!x.obs) { line(false, 'B7', `${x.n}×${x.n} 没有带 obs：请出菜单的理由没登记读数，就没人能核对它`); continue; }
  const S = x.obs.samples;
  line(Number.isInteger(S) && S >= 5, 'B7', `${x.n}×${x.n} 的分母 ${S} 张：少于 5 张的中位不配印到页面上`);
  const m = batch(x.n, S, top.pBlack);
  if (!refBy.has(S)) refBy.set(S, batch(top.n, S, top.pBlack));
  const rf = refBy.get(S);
  const gain = m.rounds - rf.rounds, costRatio = m.nodes / rf.nodes;
  console.log(`  ${x.n}×${x.n}：出货 ${m.ship}/${S} · 挖预算被掐 ${m.cut}/${S} · 线索 med ${m.clues}/${x.n * x.n} · 链长 med ${m.rounds} 轮 · 出题节点 med ${m.nodes} · 每张 med ${m.ms} ms p95 ${m.p95ms} ms（ms 只进方向线，不进页面文案）`);
  console.log(`  同批末档 ${top.label}（${S} 张）：出货 ${rf.ship}/${S} · 线索 med ${rf.clues}/${top.n * top.n} · 链长 med ${rf.rounds} 轮 · 出题节点 med ${rf.nodes} · 节点倍数 ${costRatio.toFixed(2)} · 每张 med ${rf.ms} ms`);
  line(m.ship === S, 'B7', `${x.n}×${x.n} 样本 ${m.ship}/${S} 张都出得来（出不了盘的档位谈不上"排除理由成立"）`);
  line(rf.ship === S, 'B7', `同批末档 ${top.label} ${rf.ship}/${S} 张都出得来（拿半批末档当中位数，比较就废了）`);
  line(x.obs.rounds === m.rounds, 'B7', `${x.n}×${x.n} 链长 med 文案写 ${x.obs.rounds} · 实测 ${m.rounds}`);
  line(x.obs.clues === m.clues && x.obs.cells === x.n * x.n, 'B7', `${x.n}×${x.n} 线索 med 文案写 ${x.obs.clues}/${x.obs.cells} · 实测 ${m.clues}/${x.n * x.n}`);
  line(x.obs.cut === m.cut, 'B7', `${x.n}×${x.n} 挖预算被掐的盘数 文案写 ${x.obs.cut} · 实测 ${m.cut}`);
  line(x.obs.nodes === m.nodes, 'B7', `${x.n}×${x.n} 出题节点 med 文案写 ${x.obs.nodes} · 实测 ${m.nodes}`);
  // 下面这些是"排除"这件事本身的理由，全部量自这一次实测，且不含墙钟：
  // 深度确实买到了（不是因为更短才出局）、成本涨得比深度快、题面反而更厚。
  line(m.rounds > rf.rounds, 'B7', `${x.n}×${x.n} 链长 med ${m.rounds} > 同批末档 ${rf.rounds}（出局不是因为推理更短）`);
  line(costRatio > m.rounds / rf.rounds, 'B7',
    `${x.n}×${x.n} 出题节点 med 是同批末档的 ${costRatio.toFixed(2)} 倍 > 链长的 ${(m.rounds / rf.rounds).toFixed(2)} 倍（按搜索量付账快过按深度收货，这才是不进菜单的理由）`);
  line(m.clues / (x.n * x.n) >= rf.clues / (top.n * top.n), 'B7',
    `${x.n}×${x.n} 线索密度 ${(100 * m.clues / (x.n * x.n)).toFixed(1)}% ≥ 同批末档 ${(100 * rf.clues / (top.n * top.n)).toFixed(1)}%（挖不开，出的是厚线索盘）`);
  line(m.ms > rf.ms, 'B7', `${x.n}×${x.n} 每张 med ${m.ms} ms > 同批末档 ${rf.ms} ms（等待确实变长了；倍数与毫秒都不在页面上承诺）`);
  // 理由句里的每一个读数——包括它引用末档的那几个数——都是这一批的重算值，逐条 grep 回实测。
  line(x.reason.includes(`同一批 ${S} 张`), 'B7', `${x.n}×${x.n} 的理由把分母写进句子（${S} 张），中位才有分母`);
  const need = [`链长 med ${m.rounds} 轮`, `${m.clues}/${x.n * x.n}`, `${m.nodes}`, `末档同批的 ${costRatio.toFixed(1)} 倍`];
  if (m.cut > 0) need.push(`掐了 ${m.cut}/${S} 盘`);
  else line(!/掐/.test(x.reason), 'B7', `${x.n}×${x.n} 的挖预算一次没掐过（实测 ${m.cut}/${S}），理由里就不许说"掐"`);
  line(need.every(s => x.reason.includes(s)), 'B7',
    `${x.n}×${x.n} 的理由句带上实测读数${need.filter(s => !x.reason.includes(s)).length ? `，缺：${need.filter(s => !x.reason.includes(s)).join(' | ')}` : '（链长/线索/节点/倍数/分母逐条对得上）'}`);
  const gclaim = (x.reason.match(/多(?:出)? (\d+) 轮/) || [])[1];
  line(gclaim !== undefined && +gclaim === gain, 'B7',
    `${x.n}×${x.n} 的理由说"多 ${gclaim ?? '?'} 轮"，同批两侧实测的差是 ${gain} 轮（${m.rounds} − ${rf.rounds}）`);
  const refRounds = [...x.reason.matchAll(/末档(?:量到的)? (\d+) 轮/g)].map(v => +v[1]);
  line(refRounds.every(v => v === rf.rounds), 'B7',
    `${x.n}×${x.n} 的理由引用末档链长 ${refRounds.join('/') || '没有'} 轮，同批实测 ${rf.rounds} 轮（抄旧批次的数就是谎话）`);
  const refClues = [...x.reason.matchAll(/末档同批 (\d+)\/(\d+)/g)].map(v => `${v[1]}/${v[2]}`);
  line(refClues.every(v => v === `${rf.clues}/${top.n * top.n}`), 'B7',
    `${x.n}×${x.n} 的理由引用末档线索 ${refClues.join('/') || '没有'}，同批实测 ${rf.clues}/${top.n * top.n}`);
  line(x.obs.samples === S, 'B7', `${x.n}×${x.n} obs 的分母 ${x.obs.samples} 就是这一段用的张数 ${S}`);
  line(!/[\d.]+(?:ms|秒)/.test(x.reason), 'B7', `${x.n}×${x.n} 的理由里不许出现墙钟（毫秒或"几秒"）：那是这台机器的速度，不是这一档的属性`);
}

console.log(`\n合计红线 ${red} 条破口`);
process.exit(red ? 1 : 0);
