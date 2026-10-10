// 判据 2 的铅笔求解器：只用下面命名出来的规则从空盘推到全钉，一次都不猜。
//
// 这份文件不 import rules.js（两条路不复用代码是判据 2 的硬要求），
// 所以 R4 的语义在这里独立写了第二遍，连 FREE/EMPTY 这两个哨兵值都是各自定义的。
// 两版必须在官方例题上会合，见 tools/engine-test.mjs 的 X 组断言。
//
// 记号（同样只从裁断 R4 来：数字 = 与它正交相邻的黑格所在连通黑块的格子数之和，一格只数一次）：
//   黑块 G        = 已涂黑格的极大连通块
//   counted(c)    = 含 c 邻格的黑块的格子数之和
//   候选块        = （未定 ∪ 已黑）在非圈格上的极大连通块
//   supply(c)     = 含 c 邻格的候选块的格子全集
//   gate(c)       = 「c 的未定邻格」∪「c 的已计入黑块的未定门口」——想让 counted(c) 变大，第一脚必须踩在 gate 上
//
// 规则（RULES 的顺序就是 balance.mjs 统计的「深度」顺序，改名要同步 README）：
//   K1 圈格不黑    有圈的格（含空圈）一律白。
//   K2 数满邻白    counted(c) == v ⇒ c 的未定邻格一律白（再黑一格就多一格）。
//   K3 块封顶      黑块 G 计入 c ⇒ |G| ≤ v - (counted(c) - |G|)；取等 ⇒ G 的门口全白；超了 ⇒ 矛盾。
//   K4 单门必黑    counted(c) < v 且 gate(c) 只剩一格 ⇒ 那格黑。gate 空而还缺 ⇒ 矛盾。
//   K5 候选和恰好  |supply(c)| == v ⇒ supply(c) 全黑；< v ⇒ 矛盾。
//   K6 单块必长    counted(c) < v、c 只有唯一一个计入块 G、且 c 没有未定邻格
//                 ⇒ G 必须长到 v 格：门口数 == v - |G| 就全黑，门口只剩一个就那格黑。
export const RULES = ['K1_圈格不黑', 'K2_数满邻白', 'K3_块封顶', 'K4_单门必黑', 'K5_候选和恰好', 'K6_单块必长'];

const FREE = -2;
const isCircle = v => v !== FREE, isNum = v => v >= 0;
const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const UNK = 0, WHITE = 1, BLACK = 2;

export function solve(B, opts = {}) {
  const n = B.n, N = n * n;
  const asg = new Uint8Array(N);
  const fired = new Map(RULES.map(r => [r, 0]));
  const trace = opts.trace ? [] : null;
  const pos = i => `R${((i / n) | 0) + 1}C${(i % n) + 1}`;
  const numIdx = [];
  for (let i = 0; i < N; i++) if (isNum(B.cell[i])) numIdx.push(i);
  const adjOf = new Map();
  for (const i of numIdx) {
    const r = (i / n) | 0, c = i % n, out = [];
    for (const [dr, dc] of NB) {
      const y = r + dr, x = c + dc;
      if (y >= 0 && y < n && x >= 0 && x < n && !isCircle(B.cell[y * n + x])) out.push(y * n + x);
    }
    adjOf.set(i, out);
  }

  function comps(pred) {
    const id = new Int32Array(N).fill(-1);
    const list = [];
    for (let i = 0; i < N; i++) {
      if (id[i] >= 0 || !pred(i)) continue;
      const cid = list.length; const st = [i]; id[i] = cid; const cells = [];
      while (st.length) {
        const k = st.pop(); cells.push(k);
        const y = (k / n) | 0, x = k % n;
        for (const [dr, dc] of NB) {
          const ny = y + dr, nx = x + dc;
          if (ny < 0 || ny >= n || nx < 0 || nx >= n) continue;
          const j = ny * n + nx;
          if (id[j] >= 0 || !pred(j)) continue;
          id[j] = cid; st.push(j);
        }
      }
      list.push(cells);
    }
    return { id, list };
  }
  const doorsOf = (cells, g) => {
    const out = new Set();
    for (const j of cells) {
      const y = (j / n) | 0, x = j % n;
      for (const [dr, dc] of NB) {
        const ny = y + dr, nx = x + dc;
        if (ny < 0 || ny >= n || nx < 0 || nx >= n) continue;
        const m = ny * n + nx;
        if (!isCircle(B.cell[m]) && g[m] === UNK) out.add(m);
      }
    }
    return out;
  };

  let conflict = null;
  let rounds = 0; // 推满用了多少轮：链长是本仓唯一有内容的难度读数（要钉的格数由题面固定，见 DESIGN.md §4）
  function put(i, val, rule) {
    if (asg[i] === val) return false;
    if (asg[i] !== UNK) { conflict = `${rule} 要求 ${pos(i)}=${val === BLACK ? '黑' : '白'}，可它已经是${asg[i] === BLACK ? '黑' : '白'}`; return true; }
    asg[i] = val;
    fired.set(rule, fired.get(rule) + 1);
    if (trace) trace.push(`${rule}: ${pos(i)}=${val === BLACK ? '黑' : '白'}`);
    return true;
  }

  for (let round = 0; round < 600 && !conflict; round++) {
    rounds = round + 1;
    const g = asg.slice();
    const blk = comps(i => g[i] === BLACK);
    const cand = comps(i => g[i] !== WHITE && !isCircle(B.cell[i]));
    const info = new Map();
    for (const i of numIdx) {
      const cs = new Set(); let sum = 0;
      const ss = new Set();
      for (const j of adjOf.get(i)) {
        if (g[j] === BLACK && !cs.has(blk.id[j])) { cs.add(blk.id[j]); sum += blk.list[blk.id[j]].length; }
        if (g[j] !== WHITE) ss.add(cand.id[j]);
      }
      const supply = new Set();
      for (const k of ss) for (const j of cand.list[k]) supply.add(j);
      const gates = new Set();
      for (const j of adjOf.get(i)) if (g[j] === UNK) gates.add(j);
      for (const k of cs) for (const j of doorsOf(blk.list[k], g)) gates.add(j);
      info.set(i, { counted: sum, comps: cs, supply, gates });
    }
    let changed = false;
    const step = () => { if (!changed) changed = true; };

    for (let i = 0; i < N && !conflict; i++)
      if (isCircle(B.cell[i]) && asg[i] === UNK) { put(i, WHITE, RULES[0]); step(); }

    for (const i of numIdx) {
      const v = B.cell[i], a = info.get(i);
      if (a.counted === v) {
        for (const j of adjOf.get(i)) if (asg[j] === UNK) { put(j, WHITE, RULES[1]); step(); }
      }
      if (a.counted > v) conflict = `核对: ${pos(i)} 写着 ${v}，可它已经数到 ${a.counted}`;
      if (a.supply.size < v) conflict = `K5: ${pos(i)} 写着 ${v}，可它能拿到的格子一共只有 ${a.supply.size}`;
      if (a.counted < v && a.gates.size === 0) conflict = `K4: ${pos(i)} 还差 ${v - a.counted} 格，但一个门口都没有`;
    }
    if (conflict) break;

    for (const i of numIdx) {
      const a = info.get(i);
      for (const k of a.comps) {
        const size = blk.list[k].length;
        const room = B.cell[i] - (a.counted - size); // 这一格还留给该块的名额
        if (size === room) for (const j of doorsOf(blk.list[k], g)) if (asg[j] === UNK) { put(j, WHITE, RULES[2]); step(); }
      }
    }
    if (conflict) break;

    for (const i of numIdx) {
      const a = info.get(i), v = B.cell[i];
      if (a.counted < v && a.gates.size === 1) { put([...a.gates][0], BLACK, RULES[3]); step(); }
      if (a.supply.size === v && a.counted < v) { for (const j of a.supply) if (asg[j] === UNK) { put(j, BLACK, RULES[4]); step(); } }
    }
    if (conflict) break;

    for (const i of numIdx) {
      const a = info.get(i), v = B.cell[i];
      if (a.counted >= v) continue;
      if (a.comps.size !== 1) continue;
      if ([...adjOf.get(i)].some(j => g[j] === UNK)) continue;
      const k = [...a.comps][0], cells = blk.list[k], size = cells.length;
      const doors = [...doorsOf(cells, g)];
      if (doors.length === 1) { put(doors[0], BLACK, RULES[5]); step(); }
      else if (doors.length === v - size) { for (const j of doors) if (asg[j] === UNK) { put(j, BLACK, RULES[5]); step(); } }
    }
    if (conflict) break;
    if (!changed) break;
  }

  const undetermined = [];
  for (let i = 0; i < N; i++) if (!isCircle(B.cell[i]) && asg[i] === UNK) undetermined.push(i);
  return {
    asg, conflict, fired: Object.fromEntries(fired), undetermined, trace, rounds,
    solved: undetermined.length === 0 && !conflict, pos,
  };
}
