// 出题：随机铺一份涂法 → 每个白格都挂上它该有的数字（最强线索集）→ 逐条把线索降级，
// 每降一次都要「计数器恰好 1 解」且「铅笔 0 猜推满并且推到同一份答案」，否则回滚。
//
// 挖线索是**单调安全**的：任何时刻当前盘都唯一且零猜可推，所以超预算就带着更多线索出货——
// 承诺是"唯一 + 零猜"，不是"线索最少"。这就是每盘挖预算能存在的理由（DESIGN.md §3）。
import { countSolutions, isCircle, FREE, EMPTY, NODE_CAP } from './rules.js';
import { solve, RULES } from './pencil.js';
import { mulberry32, shuffled } from './rng.js';

export const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// 菜单档位。12×12 与 14×14 被请出菜单：挖预算在 8 盘里被掐 7/8 与 8/8，出的是没挖过的满线索盘
// （圈密度 33% / 37%，高于 10×10 的 27%），而推理深度不随尺寸增长。理由印在选档页上。
// med 是选档页印出去的"实测链长 / 实测耗时"，由 tools/balance.mjs 的 B5/B5b 逐档核对：
// 链长写等式（它是盘的属性），耗时只卡方向（它是机器速度）。
export const TIERS = [
  { n: 6, label: '6×6', name: '初', pBlack: 0.34, med: { rounds: 8, ms: 9 } },
  { n: 7, label: '7×7', name: '中', pBlack: 0.34, med: { rounds: 11, ms: 26 } },
  { n: 8, label: '8×8', name: '中', pBlack: 0.34, med: { rounds: 12, ms: 72 } },
  { n: 9, label: '9×9', name: '高', pBlack: 0.34, med: { rounds: 14, ms: 215 } },
  { n: 10, label: '10×10', name: '高', pBlack: 0.34, med: { rounds: 18, ms: 636 } },
];
// 请出菜单的档位：理由是量出来的，而且要在选档页上印出来（不是一句"暂未开放"）。
// 读数出自 node 侧同一份 BUDGET（单次 5000 节点 / 每盘挖 120000 节点），8 张一盘，seed 从 5000 起。
export const EXCLUDED_TIERS = [
  { n: 12, reason: '每张 p95 4938ms 越过 4000ms 的等待承诺（B1），而链长 med 只从 18 涨到 20 —— 多等的那两秒买不到更长的推理' },
  { n: 14, reason: '挖线索的节点预算 8 盘里掐了 6 盘，出的是没挖开的厚线索盘（圈密度 30% > 菜单里的 25–27%）；每张 med 9734ms 是承诺的 2.4 倍，链长 med 20 与 12×12 相同' },
];

// 单次调用只花 5000 个节点是量出来的选择：与 20000 那版逐张对照（_tmp-kurotto-sweep.log），
// 五档出货 10/10、线索 med 17/20/26 一格没变、链长 med 不变，而 10×10 每张 p95 从 4183ms 落到 2638ms，
// 挖线索被节点预算掐住的盘反而从 3/10 降到 1/10。承诺线（B1 的 4000ms）一个字没动。
export const BUDGET = { cap: NODE_CAP, callNodes: 5000, digNodes: 120000, order: 'near' };

// 从一份完整涂法读出每个圈位该有的数字。这是 R4 的第三遍独立写法：
// 它和 rules.js 的 violations() 若不一致，出的每张盘的线索就是假的，所以 engine-test 逐盘对账。
export function numberAt(B, black, i) {
  const n = B.n, seen = new Set(), st = [];
  const r0 = (i / n) | 0, c0 = i % n;
  for (const [dr, dc] of NB) {
    const y = r0 + dr, x = c0 + dc;
    if (y < 0 || y >= n || x < 0 || x >= n) continue;
    const j = y * n + x;
    if (!black[j] || isCircle(B.cell[j]) || seen.has(j)) continue;
    seen.add(j); st.push(j);
    while (st.length) {
      const k = st.pop();
      const ky = (k / n) | 0, kx = k % n;
      for (const [a, b] of NB) {
        const ny = ky + a, nx = kx + b;
        if (ny < 0 || ny >= n || nx < 0 || nx >= n) continue;
        const m = ny * n + nx;
        if (!black[m] || isCircle(B.cell[m]) || seen.has(m)) continue;
        seen.add(m); st.push(m);
      }
    }
  }
  return seen.size;
}

// 铅笔推满并且推到目标涂法？
export function pencilAgrees(B, black) {
  const s = solve(B);
  if (s.conflict || !s.solved) return { ok: false, why: s.conflict ? 'conflict:' + s.conflict : 'undetermined:' + s.undetermined.length };
  for (let i = 0; i < B.n * B.n; i++) {
    if (isCircle(B.cell[i])) continue;
    const want = black[i] ? 2 : 1;
    if (s.asg[i] !== want) return { ok: false, why: 'wrong@' + i };
  }
  return { ok: true, fired: s.fired, rounds: s.rounds };
}

export function makePuzzle(n, rnd, opts = {}) {
  const pBlack = opts.pBlack ?? 0.34;
  const budget = { ...BUDGET, ...opts };
  // 每一次计数调用都只花得起 callNodes 个节点：证明撞了这个软预算就换一张涂法重来（判定不看墙钟），
  // 所以"等多久"由 B1 那条实测红线管，"同一 seed 出同一张盘"由节点预算管。
  const callCap = Math.min(budget.cap, budget.callNodes ?? budget.cap);
  const t0 = Date.now();
  let attempts = 0, totalNodes = 0, maxNodes = 0, maxCallMs = 0, digReject = 0, digTry = 0, digUsed = 0;
  const rejects = new Map();
  const note = k => rejects.set(k, (rejects.get(k) || 0) + 1);
  while (attempts++ < 4000) {
    const cell = new Int16Array(n * n).fill(FREE);
    const black = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) black[i] = rnd() < pBlack ? 1 : 0;
    const B = { n, cell };
    for (let i = 0; i < n * n; i++) if (!black[i]) cell[i] = numberAt(B, black, i);

    const c0 = countSolutions(B, { ...budget, cap: callCap });
    totalNodes += c0.nodes; maxNodes = Math.max(maxNodes, c0.nodes);
    maxCallMs = Math.max(maxCallMs, c0.ms);
    if (c0.stopped) { note('初始唯一性证明撞预算'); continue; }
    if (c0.count !== 1) { note('初始线索集就不唯一'); continue; }
    const pa = pencilAgrees(B, black);
    if (!pa.ok) { note('初始线索集铅笔推不满'); continue; }

    const order = shuffled(rnd, [...Array(n * n).keys()].filter(i => cell[i] >= 0));
    const keep = new Map();
    let digStopped = 0;
    for (const i of order) {
      // 每盘的挖线索节点预算：超了就带着剩下的线索出货。少挖只会多留线索，不会出错盘。
      if (budget.digNodes && digUsed > budget.digNodes) { digStopped = order.length - keep.size - 1; break; }
      const orig = cell[i];
      for (const demote of [FREE, EMPTY]) {
        digTry++;
        cell[i] = demote;
        const c = countSolutions(B, { ...budget, cap: callCap });
        digUsed += c.nodes;
        totalNodes += c.nodes; maxNodes = Math.max(maxNodes, c.nodes);
        maxCallMs = Math.max(maxCallMs, c.ms);
        if (c.stopped) { note('挖时撞预算→保留该线索'); cell[i] = orig; break; }
        if (c.count !== 1) continue;
        const pa2 = pencilAgrees(B, black);
        if (!pa2.ok) { digReject++; continue; }
        keep.set(i, demote);
        break;
      }
      if (!keep.has(i)) cell[i] = orig;
    }

    // 出货前用计数器找到的那份解覆盖随机涂法：挖过线索之后，记在手里的那份才是被证过的那份。
    const cFinal = countSolutions(B, { ...budget, cap: callCap, want: 2 });
    totalNodes += cFinal.nodes; maxNodes = Math.max(maxNodes, cFinal.nodes);
    if (cFinal.stopped) { note('出货复核撞预算'); continue; }
    if (cFinal.count !== 1) { note('挖完反而不唯一'); continue; }
    const answer = cFinal.first;
    const paFinal = pencilAgrees(B, answer);
    if (!paFinal.ok) { note('出货盘铅笔推不满:' + paFinal.why); continue; }

    const clues = [...cell].filter(v => v >= 0).length;
    const empties = [...cell].filter(v => v === EMPTY).length;
    const fired = {};
    for (const r of RULES) fired[r] = 0;
    for (const r of RULES) fired[r] = paFinal.fired[r];
    let depth = 0, steps = 0;
    RULES.forEach((r, k) => { if (paFinal.fired[r] > 0) depth = Math.max(depth, k + 1); steps += paFinal.fired[r]; });
    return {
      n, B, black: answer, clues, empties, attempts, digTry, digReject, maxNodes, maxCallMs,
      depth, steps, rounds: paFinal.rounds, digStopped, digUsed,
      avgNodes: Math.round(totalNodes / Math.max(1, digTry + 1)),
      ms: Date.now() - t0, fired, rejects: Object.fromEntries(rejects),
    };
  }
  return { n, fail: '4000 次没出盘', attempts, rejects: Object.fromEntries(rejects), ms: Date.now() - t0 };
}

// UI 的稳定入口：同一个 (n, seed) 在任何引擎里画同一张盘。
export function puzzleFromSeed(n, seed, opts = {}) {
  const p = makePuzzle(n, mulberry32(seed >>> 0), opts);
  if (p.fail) throw new Error(p.fail + ' ' + JSON.stringify(p.rejects));
  return p;
}
