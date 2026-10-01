// 「圈里的数字数的是什么」的四种候选读法，一次实现、两处消费。
//
// 这里是**被舍掉的那三条**唯一的实现处：`tools/engine-test.mjs` 的第 1 组断言用它裁决官方例题，
// `tools/doctest.mjs` 的 D12 用它核对 `DESIGN.md §1` 那张抄给读者看的表。
// 之前读法只在闸里写了一遍、文档再手抄一遍，抄错的那一格没人看得见：§1 表里 R3 在 (1,1) 写的是
// `1✗`，官方例题上的真值是 `0✗`（两个黑邻格隔着一整格，成不了对）。
//
// R4 才是本仓采的读法，它不在这里重写：它走 `rules.js` 的 `violations()`（判据 1 的账）——
// 判据 2 的铅笔另有第二遍写法（`pencil.js`），两路不复用代码的纪律不管这三条被淘汰的读法。
import { violations, isCircle, nbrs } from './rules.js';

export function readR1(B, black, i) { // 正交邻格里黑格的个数
  let k = 0;
  for (const j of nbrs(B, (i / B.n) | 0, i % B.n)) if (black[j] && !isCircle(B.cell[j])) k++;
  return k;
}
export function readR2(B, black, i) { // 四向射线：每个方向上连续黑格长度之和（S1a 英文字面）
  let k = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    let r = ((i / B.n) | 0) + dr, c = (i % B.n) + dc;
    while (r >= 0 && r < B.n && c >= 0 && c < B.n && black[r * B.n + c] && !isCircle(B.cell[r * B.n + c])) { k++; r += dr; c += dc; }
  }
  return k;
}
export function readR3(B, black, i) { // 相邻黑格之间成对的数量
  const nb = nbrs(B, (i / B.n) | 0, i % B.n).filter(j => black[j] && !isCircle(B.cell[j]));
  let k = 0;
  for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
    const d = Math.abs(((nb[a] / B.n) | 0) - ((nb[b] / B.n) | 0)) + Math.abs((nb[a] % B.n) - (nb[b] % B.n));
    if (d === 1) k++;
  }
  return k;
}
export function readR4(B, black, i) { // 采的那条：相邻黑块的格数和（并集，一个块只数一次）
  const v = violations(B, black);
  const bad = v.find(x => x.r === ((i / B.n) | 0) && x.c === i % B.n);
  return bad ? bad.got : B.cell[i];
}

// 顺序就是 §1 那张表的列顺序；名字里的序号是裁断编号，改了要同步文档。
export const READINGS = [['R1_邻格黑格数', readR1], ['R2_四向射线长', readR2], ['R3_相邻黑格对数', readR3], ['R4_相邻黑块格数和', readR4]];
