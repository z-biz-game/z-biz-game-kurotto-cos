// 出题：随机铺一份涂法 → 每个白格都挂上它该有的数字（最强线索集）→ 逐条把线索降级，
// 每降一次都要「计数器恰好 1 解」且「铅笔 0 猜推满并且推到同一份答案」，否则回滚。
//
// 挖线索是**单调安全**的：任何时刻当前盘都唯一且零猜可推，所以超预算就带着更多线索出货——
// 承诺是"唯一 + 零猜"，不是"线索最少"。这就是每盘挖预算能存在的理由（DESIGN.md §3）。
import { countSolutions, isCircle, FREE, EMPTY, NODE_CAP } from './rules.js';
import { solve, RULES } from './pencil.js';
import { mulberry32, shuffled } from './rng.js';

export const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// 菜单四档。med 是选档页印出去的实测读数，由 tools/balance.mjs 逐档核对：链长与线索密度写等式
// （它们是盘与 seed 的属性，换一台机器是同一个数），耗时只卡方向（它是机器速度，写成等式就会随负载变红）。
// 菜单的天花板是"这一档的等待我们敢不敢承诺"，不是"还能不能更长"——10×10 比 9×9 长 4 轮（同一批 20 张），
// 它出局是因为每张按 2.6 倍的搜索量付账；而 B1 那条等待线在它身上**本机没过、CI 那台 2 vCPU 过了**，
// 同一份代码同一个 seed 两台机器差出一倍以上——这就是墙钟不许当承诺、也不许印到页面上的原因（DESIGN.md §5、§7）。
export const TIERS = [
  { n: 6, label: '6×6', name: '初', pBlack: 0.34, med: { rounds: 8, clues: 10, ms: 9 } },
  { n: 7, label: '7×7', name: '中', pBlack: 0.34, med: { rounds: 11, clues: 13, ms: 26 } },
  { n: 8, label: '8×8', name: '中', pBlack: 0.34, med: { rounds: 12, clues: 17, ms: 72 } },
  { n: 9, label: '9×9', name: '高', pBlack: 0.34, med: { rounds: 14, clues: 20, ms: 215 } },
];
// 请出菜单的档位：理由是量出来的，而且要在选档页上印出来（不是一句"暂未开放"）。
// obs 里的每一个数都由 tools/balance.mjs 的 B7 当场复跑再逐条对账：seed 流与菜单同一条
// （seed = 5000 + s*7919 + n），张数写在各档自己的 obs.samples 里、不吃 SAMPLES；链长 / 线索 /
// 被掐盘数 / 出题节点数只由 seed 与节点预算决定，换一台机器是同一个数，所以写等式。
// **比较必须同分母**：末档 9×9 在这条 5 张流上读到的链长中位是 18 轮，在菜单那 20 张里是 14 轮——
// 拿五张的中位去比二十张的中位会造出一句"多 5 轮"的假话，所以 B7 把末档也在同一批张数上再量一遍，
// 理由句里"比末档多 N 轮""末档同批的 X.X 倍"这类相对说法，逐条用同批两侧的重算值核对。
// 10×10 用 20 张：它刚从菜单里下来，要引用的就是菜单那张表用的分母。
// 墙钟不进理由句（毫秒与"几秒"都不行）：它是这台机器的速度而不是这一档的属性，印出去就成了没人能核对的承诺。
export const EXCLUDED_TIERS = [
  {
    n: 10,
    obs: { samples: 20, rounds: 18, clues: 25, cells: 100, cut: 1, nodes: 28146 },
    reason: '同一批 20 张里链长 med 18 轮确实比末档量到的 14 轮多出 4 轮，深度是买到了；但题面没有变薄（线索 25/100 格，末档同批 20/81），每张的出题节点 med 28146 是末档同批的 2.6 倍，挖线索的每盘预算还掐了 1/20 盘——按一次的搜索量付账买到的不是更薄的盘，而我们没法对一台猜不到的机器承诺这一档的等待',
  },
  {
    n: 12,
    obs: { samples: 5, rounds: 19, clues: 38, cells: 144, cut: 0, nodes: 36250 },
    reason: '同一批 5 张里链长 med 19 轮只比末档多 1 轮，线索还有 38/144 格，密度不降反升，出题节点 med 36250 是末档同批的 2.0 倍——盘大了一圈，买到的是一张更厚的题面和成倍的搜索量，而不是更长的推理',
  },
  {
    n: 14,
    obs: { samples: 5, rounds: 20, clues: 53, cells: 196, cut: 4, nodes: 124727 },
    reason: '同一批 5 张里挖预算掐了 4/5 盘，出的是没挖开的厚线索盘（53/196 格，密度比末档同批还高）；链长 med 20 轮只比末档多 2 轮，出题节点 med 124727 却是末档同批的 6.9 倍——深度只挪了一点，成本却要看预算脸色',
  },
];

// 单次计数调用只花得起 callNodes 个节点。这个数字是这么用的：撞了软预算就带着此刻更多的线索
// 出货（挖线索单调安全，见文件头），所以它买的是"每张多久"，不改"这是哪张盘"。
// 为什么取 5000 而不是更大：本仓没有它的对照闸，README 的承诺表把这一格标成"无闸"。
// cap / callNodes / digNodes 三个预算都是纯节点数，墙钟不参与任何判定。
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
      n, B, black: answer, clues, empties, attempts, digTry, digReject, maxNodes, maxCallMs, nodes: totalNodes,
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
