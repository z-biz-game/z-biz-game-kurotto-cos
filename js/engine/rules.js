// 规则语义（本仓唯一的口径来源）与判据 1 的计数器。
//
// 裁断 R4：数字 = 与该圈格正交相邻的黑格所在的「连通黑块」的格子数之和；
// 一个块无论贴着这个圈的几条臂都只数一次（并集），圈格本身永远不能黑，空圈不受约束。
// 三家原文与四条候选读法的取舍表在 DESIGN.md §1：R1 邻格黑格数 / R2 四向射线长 / R3 相邻黑格对数
// 都被官方例题否掉，R2 恰好是 kuromasu 的口径——所以这条边界也是最容易写错的一格。
//
// 这个文件里的两条实现都不含推理规则：
//   countSolutions()      逐格 DFS + 三条「可证等价于这支没有解」的剪枝，带节点与时间预算。
//   countSolutionsDumb()  2^F 全代入逐盘核对，慢，但是 DFS 的尺。
// 铅笔求解器在 pencil.js，它不 import 本文件（判据 2 要求两条路不复用代码）。

export const FREE = -2, EMPTY = -1;
export const UNK = 0, WHITE = 1, BLACK = 2;
export const NODE_CAP = 2000000;
const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function makeBoard(n, clues) {
  const cell = new Int16Array(n * n).fill(FREE);
  for (const [r, c, v] of clues) cell[r * n + c] = v;
  return { n, cell };
}
export function cloneBoard(B) { return { n: B.n, cell: B.cell.slice() }; }
export function at(B, r, c) { return B.cell[r * B.n + c]; }
export function isCircle(v) { return v !== FREE; }
export function isNum(v) { return v >= 0; }

export function nbrs(B, r, c, out = []) {
  out.length = 0;
  for (const [dr, dc] of NB) {
    const y = r + dr, x = c + dc;
    if (y >= 0 && y < B.n && x >= 0 && x < B.n) out.push(y * B.n + x);
  }
  return out;
}

// 给一份完整涂法，逐圈核对。返回 [{r,c,want,got}]，空数组即合法。
export function violations(B, black) {
  const out = [];
  const n = B.n, comp = new Int32Array(n * n).fill(-1);
  let cid = 0;
  const sizes = [];
  for (let i = 0; i < n * n; i++) {
    if (!black[i] || isCircle(B.cell[i]) || comp[i] >= 0) continue;
    const stack = [i]; comp[i] = cid; let sz = 0;
    while (stack.length) {
      const k = stack.pop(); sz++;
      const y = (k / n) | 0, x = k % n;
      for (const j of nbrs(B, y, x)) {
        if (black[j] && !isCircle(B.cell[j]) && comp[j] < 0) { comp[j] = cid; stack.push(j); }
      }
    }
    sizes[cid] = sz; cid++;
  }
  for (let i = 0; i < n * n; i++) {
    if (!isNum(B.cell[i])) continue;
    const r = (i / n) | 0, c = i % n, want = B.cell[i];
    const seen = new Set(); let got = 0;
    for (const j of nbrs(B, r, c)) {
      if (!black[j] || isCircle(B.cell[j])) continue;
      if (seen.has(comp[j])) continue;
      seen.add(comp[j]); got += sizes[comp[j]];
    }
    if (got !== want) out.push({ r, c, want, got });
  }
  return out;
}

export function countSolutionsDumb(B, limit = Infinity) {
  const n = B.n, free = [];
  for (let i = 0; i < n * n; i++) if (!isCircle(B.cell[i])) free.push(i);
  const F = free.length;
  if (F > 26) throw new Error('傻跑版最多 26 格，当前 ' + F);
  const black = new Uint8Array(n * n);
  let count = 0;
  for (let m = 0; m < (1 << F); m++) {
    black.fill(0);
    for (let i = 0; i < F; i++) if ((m >>> i) & 1) black[free[i]] = 1;
    if (violations(B, black).length === 0) {
      count++;
      if (count >= limit) return { count, complete: false, leaves: 1 << F, nodes: 1 << F };
    }
  }
  return { count, complete: true, leaves: 1 << F, nodes: 1 << F };
}

// DFS 用的量全部只从规则本身来：
//   contrib(c) 已涂黑格子里、所在黑块含 c 的邻格的那些格的个数。加黑一格只会让它不变或变大 ⇒ 单调不减。
//   maxc(c)    把「还能变黑的格」（未定 ∪ 已黑）连成块，凡含 c 的邻格的块整块大小求和 ⇒ contrib 的上界。
//   contrib > v 或 maxc < v ⇒ 这支没有解；contrib == v ⇒ 触到这些块的未定格必须白；maxc == v ⇒ 必须黑。
// 预算只有节点一个维度：把墙钟放进 stopped 的判定里，同一个 seed 在快慢不同的机器上会出不同的盘
// （实测同 seed 复跑两次，10×10 的 p10 链长从 10 轮漂到 12 轮），那"同 seed 同盘"就是谎话。
export function countSolutions(B, opts = {}) {
  const cap = opts.cap ?? NODE_CAP;
  const t0 = Date.now();   // 只用来报 ms：墙钟不进任何判定
  const order = opts.order ?? 'near';
  const want = opts.want ?? 2;
  const n = B.n, N = n * n;
  const numCells = [];
  for (let i = 0; i < N; i++) if (isNum(B.cell[i])) numCells.push(i);
  const adj = new Map();
  for (const i of numCells) {
    const r = (i / n) | 0, c = i % n;
    adj.set(i, nbrs(B, r, c).filter(j => !isCircle(B.cell[j])));
  }
  const asg = new Uint8Array(N);
  let nodes = 0, count = 0, stopped = false, viol = 0;
  let first = null; // 找到的第一份完整涂法：出货时用它覆盖出题器自己记的答案
  let last = [];

  function analyze() {
    const bcomp = new Int32Array(N).fill(-1);
    const bsize = [];
    let bc = 0;
    const ccomp = new Int32Array(N).fill(-1);
    const csize = [];
    let cc = 0;
    for (let i = 0; i < N; i++) {
      if (isCircle(B.cell[i])) continue;
      if (asg[i] === BLACK && bcomp[i] < 0) {
        const st = [i]; bcomp[i] = bc; let s = 0;
        while (st.length) {
          const k = st.pop(); s++; const y = (k / n) | 0, x = k % n;
          for (const j of nbrs(B, y, x)) if (!isCircle(B.cell[j]) && asg[j] === BLACK && bcomp[j] < 0) { bcomp[j] = bc; st.push(j); }
        }
        bsize[bc] = s; bc++;
      }
      if (asg[i] !== WHITE && ccomp[i] < 0) {
        const st = [i]; ccomp[i] = cc; let s = 0;
        while (st.length) {
          const k = st.pop(); s++; const y = (k / n) | 0, x = k % n;
          for (const j of nbrs(B, y, x)) if (!isCircle(B.cell[j]) && asg[j] !== WHITE && ccomp[j] < 0) { ccomp[j] = cc; st.push(j); }
        }
        csize[cc] = s; cc++;
      }
    }
    const res = [];
    for (const i of numCells) {
      const bl = new Set(), cl = new Set();
      let contrib = 0, maxc = 0;
      for (const j of adj.get(i)) {
        if (asg[j] === BLACK) { const k = bcomp[j]; if (!bl.has(k)) { bl.add(k); contrib += bsize[k]; } }
        if (asg[j] === WHITE) continue; // 白格不在候选图里，ccomp[j] 是 -1：读它会让 maxc 变 NaN
        const k2 = ccomp[j]; if (!cl.has(k2)) { cl.add(k2); maxc += csize[k2]; }
      }
      res.push({ i, v: B.cell[i], contrib, maxc, bl, cl });
    }
    last = res;
    return { res, bcomp, ccomp };
  }

  function propagate() {
    for (let guard = 0; guard <= 4 * N; guard++) {
      const { res, bcomp, ccomp } = analyze();
      for (const a of res) if (a.contrib > a.v || a.maxc < a.v) return 'conflict';
      // 一轮只落一个改动再重算：P3/P4 都只在各自读到的那份快照上成立，
      // 同一轮连落两个改动会让后一个用已被前一个改坏的界（实测会把真解剪掉）。
      for (const a of res) {
        if (a.contrib === a.v) {
          const need = adj.get(a.i);
          for (let i = 0; i < N; i++) {
            if (asg[i] !== UNK || isCircle(B.cell[i])) continue;
            let hits = need.includes(i);
            if (!hits) for (const j of nbrs(B, (i / n) | 0, i % n))
              if (asg[j] === BLACK && a.bl.has(bcomp[j])) { hits = true; break; }
            if (hits) { asg[i] = WHITE; return propagate(); }
          }
        }
        if (a.maxc === a.v) {
          for (let i = 0; i < N; i++) {
            if (asg[i] !== UNK || isCircle(B.cell[i])) continue;
            let hits = false;
            for (const k of a.cl) if (ccomp[i] === k) { hits = true; break; }
            if (hits) { asg[i] = BLACK; return propagate(); }
          }
        }
      }
      return 'ok';
    }
    return 'conflict';
  }

  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

  function pick() {
    if (order !== 'near') {
      for (let i = 0; i < N; i++) if (asg[i] === UNK && !isCircle(B.cell[i])) return i;
      return -1;
    }
    // near：先动「最紧的那个数字」身边的格子——slack 最小的未满足圈，其次邻着圈最多的格。
    // 行序在同一条规则下的长尾是两个数量级（见 DESIGN.md §3 的两版逐盘对照）。
    let bestSlack = Infinity;
    for (const a of last) { const slack = a.v - a.contrib; if (slack > 0 && slack < bestSlack) bestSlack = slack; }
    if (!isFinite(bestSlack)) bestSlack = -1; // 全部数满：只剩「别把块撑大」这一类格要定
    let best = -1, bestKey = null;
    for (const a of last) {
      const slack = a.v - a.contrib;
      if (bestSlack >= 0 && slack !== bestSlack) continue;
      for (const j of adj.get(a.i)) {
        if (asg[j] !== UNK) continue;
        let circles = 0;
        const y = (j / n) | 0, x = j % n;
        for (const m of nbrs(B, y, x)) if (isNum(B.cell[m])) circles++;
        const key = [-circles, y, x];
        if (best < 0 || cmp(key, bestKey) < 0) { best = j; bestKey = key; }
      }
    }
    if (best >= 0) return best;
    for (let i = 0; i < N; i++) if (asg[i] === UNK && !isCircle(B.cell[i])) return i;
    return -1;
  }

  function dfs() {
    const snap = asg.slice();
    const st = propagate();
    if (st === 'conflict') { viol++; return; }
    const p = pick();
    if (p < 0) {
      const black = new Uint8Array(N);
      for (let i = 0; i < N; i++) black[i] = asg[i] === BLACK ? 1 : 0;
      if (violations(B, black).length === 0) { count++; if (!first) first = black; }
      return;
    }
    for (const val of [BLACK, WHITE]) {
      if (nodes++ > cap) { stopped = true; return; }
      asg[p] = val; dfs();
      asg.set(snap); // 传播出来的强制格必须跟着回滚，否则兄弟分支继承上一条分支的结论
      if (stopped || count >= want) return;
    }
  }
  dfs();
  return { count, nodes, ms: Date.now() - t0, stopped, viol, first, complete: !stopped && count < want };
}
