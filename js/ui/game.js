// 一局的状态机：题面 + 玩家涂法 + 违规回显 + 提示。
// 提示来自铅笔求解器（js/engine/pencil.js）跑在**题面**上的一份带 trace 的推导：
// 它说出的每一格都是线索推得出的，与玩家当前涂得对不对无关——所以涂错时提示会说"这格应该是白"，
// 而不是顺着玩家的错往下编。
import { EMPTY, isCircle, isNum, nbrs, violations, UNK, WHITE, BLACK } from '../engine/rules.js';
import { solve } from '../engine/pencil.js';
import { puzzleFromSeed } from '../engine/generate.js';

export function newGame(n, seed, opts = {}) {
  const pz = puzzleFromSeed(n, seed, opts);
  return {
    n,
    seed,
    tier: n,
    cell: pz.B.cell,
    answer: pz.black,
    marks: new Uint8Array(n * n),
    sel: -1,
    flash: -1,
    moves: 0,
    hints: 0,
    startedAt: Date.now(),
    elapsed: 0,
    genMs: pz.ms,
    rounds: pz.rounds,
    clues: pz.clues,
    empties: pz.empties,
    digStopped: pz.digStopped,
    _trace: null,
  };
}

export function circleList(g) {
  const out = [];
  for (let i = 0; i < g.n * g.n; i++) if (isNum(g.cell[i])) out.push(i);
  return out;
}

// counted(c)：已经涂黑的那些邻格所在黑块的格数之和（R4）。未定的邻格不算进来。
function countedAround(g, i) {
  const n = g.n, N = n * n;
  const seen = new Int32Array(N).fill(-1);
  let cid = 0, sum = 0;
  const ids = new Set();
  const nb = [];
  const r0 = (i / n) | 0, c0 = i % n;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const y = r0 + dr, x = c0 + dc;
    if (y >= 0 && y < n && x >= 0 && x < n) nb.push(y * n + x);
  }
  for (const j of nb) {
    if (g.marks[j] !== BLACK || isCircle(g.cell[j]) || seen[j] >= 0) continue;
    const st = [j]; seen[j] = cid; let sz = 0;
    while (st.length) {
      const k = st.pop(); sz++;
      const ky = (k / n) | 0, kx = k % n;
      for (const m of nbrs(g.n ? { n } : { n }, ky, kx)) {
        if (g.marks[m] === BLACK && !isCircle(g.cell[m]) && seen[m] < 0) { seen[m] = cid; st.push(m); }
      }
    }
    if (!ids.has(cid)) { ids.add(cid); sum += sz; }
    cid++;
  }
  return { sum, hasUnknown: nb.some(j => !isCircle(g.cell[j]) && g.marks[j] === UNK) };
}

// 违规圈：数超了，或者邻格全定完了但对不上账。
export function conflicts(g) {
  const bad = new Set();
  for (const i of circleList(g)) {
    const { sum, hasUnknown } = countedAround(g, i);
    if (sum > g.cell[i] || (!hasUnknown && sum !== g.cell[i])) bad.add(i);
  }
  return bad;
}

export function remaining(g) {
  let k = 0;
  for (let i = 0; i < g.n * g.n; i++) if (!isCircle(g.cell[i]) && g.marks[i] === UNK) k++;
  return k;
}

export function blackCount(g) {
  let k = 0;
  for (let i = 0; i < g.n * g.n; i++) if (g.marks[i] === BLACK) k++;
  return k;
}

// 这局该有几个黑格。存档里不写答案，所以恢复牌局时答案只能从题面重新推出来——
// 而题面是唯一解的，推出来的就是答案（判据 1/2 已经证过），不需要额外存储。
export function blackTotal(g) {
  if (g.answer) {
    let k = 0;
    for (let i = 0; i < g.answer.length; i++) k += g.answer[i];
    return k;
  }
  const s = solve({ n: g.n, cell: g.cell });
  if (!s.solved) return 0;
  let k = 0;
  for (let i = 0; i < s.asg.length; i++) if (s.asg[i] === BLACK) k++;
  return k;
}

export function isSolved(g) {
  if (remaining(g) !== 0) return false;
  const black = new Uint8Array(g.n * g.n);
  for (let i = 0; i < black.length; i++) black[i] = g.marks[i] === BLACK ? 1 : 0;
  return violations({ n: g.n, cell: g.cell }, black).length === 0;
}

export function select(g, i) {
  if (i < 0 || i >= g.n * g.n) return g;
  g.sel = i;
  return g;
}

export function paint(g, i, val) {
  if (i < 0 || i >= g.n * g.n) return { g, changed: false };
  if (isCircle(g.cell[i])) return { g, changed: false };   // 圈格不能涂（裁断 R4 的一部分）
  if (g.marks[i] === val) return { g, changed: false };
  const before = g.marks[i];
  g.marks[i] = val;
  g.moves++;
  g.sel = i;
  return { g, changed: true, from: before };
}

export function cycle(g, i) {
  if (i < 0 || i >= g.n * g.n || isCircle(g.cell[i])) return { g, changed: false };
  const next = g.marks[i] === UNK ? BLACK : g.marks[i] === BLACK ? WHITE : UNK;
  return paint(g, i, next);
}

// 提示：拿题面的带 trace 推导，找第一条"玩家还没涂对"的格。
export function hint(g) {
  if (!g._trace) {
    const s = solve({ n: g.n, cell: g.cell }, { trace: true });
    if (s.conflict || !s.solved) return { g, rule: null, why: '这局的推导链断了（引擎的账对不上）' };
    const byCell = new Map();
    for (const t of s.trace) {
      const m = /^(K\d)[^:]*: R(\d+)C(\d+)=(黑|白)$/.exec(t);
      if (!m) continue;
      const idx = (Number(m[2]) - 1) * g.n + (Number(m[3]) - 1);
      if (!byCell.has(idx)) byCell.set(idx, { rule: m[1], val: m[4] === '黑' ? BLACK : WHITE, text: t });
    }
    g._trace = byCell;
    g._rounds = s.rounds;
  }
  // trace 里也有圈格（K1 把它们钉成白），但圈格永远涂不上：留在候选里的话，提示按下去只加次数
  // 不落子——玩家什么也没发生。候选只从"玩家能动的格"里挑。
  const order = [...g._trace.keys()].filter(i => !isCircle(g.cell[i]));
  const wrong = order.find(i => g.marks[i] !== BLACK && g.marks[i] !== WHITE);
  const pickIdx = order.find(i => g.marks[i] === (g._trace.get(i).val === BLACK ? WHITE : BLACK))
    ?? wrong ?? order[0];
  if (pickIdx === undefined) return { g, rule: null, why: '已经没有可提示的了' };
  const h = g._trace.get(pickIdx);
  const painted = paint(g, pickIdx, h.val);
  g.hints++;
  g.flash = pickIdx;
  return { g, rule: h.rule, cell: pickIdx, val: h.val, text: h.text, changed: painted.changed, from: painted.from, pos: `R${((pickIdx / g.n) | 0) + 1}C${(pickIdx % g.n) + 1}` };
}

export function serialize(g) {
  return {
    v: 1, n: g.n, tier: g.tier, seed: g.seed,
    cell: Array.from(g.cell), marks: Array.from(g.marks),
    moves: g.moves, hints: g.hints, elapsed: g.elapsed,
    genMs: g.genMs, rounds: g.rounds, clues: g.clues, empties: g.empties,
    savedAt: Date.now(),
  };
}

export function deserialize(s) {
  const n = s.n;
  if (!Number.isInteger(n) || n < 1) return null;
  const cell = Int16Array.from(s.cell);
  const marks = Uint8Array.from(s.marks);
  if (cell.length !== n * n || marks.length !== n * n) return null;
  return {
    n, seed: s.seed, tier: s.tier ?? n, cell, answer: null, marks,
    sel: -1, flash: -1, moves: s.moves | 0, hints: s.hints | 0,
    startedAt: Date.now(), elapsed: s.elapsed | 0,
    genMs: s.genMs ?? null, rounds: s.rounds ?? null, clues: s.clues ?? 0, empties: s.empties ?? 0,
    _trace: null,
  };
}

