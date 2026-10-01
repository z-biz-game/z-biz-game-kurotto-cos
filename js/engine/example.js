// 官方例题（Nikoli kurotto01/02.gif）：逐格读数由 _tmp-kurotto-ascii.mjs 从 PNG 量出后抄在这里。
// 这份数据是「圈里的数字数什么」那条裁断的证物：node 侧 tools/engine-test.mjs 与浏览器侧
// tools/scenarios.js 都读这同一个模块。两边各抄一遍的话，抄错的那一份会替另一份说话。
import { EMPTY } from './rules.js';

export const EX_N = 4;
// [行, 列, 数字]；EMPTY(-1) 是"画了圈但没印数字"——它同样永远不能涂黑，只是不给任何计数约束。
export const EX_CLUES = [[0, 0, 2], [1, 0, 0], [1, 1, 3], [2, 3, 1], [3, 1, 1], [1, 3, EMPTY]];
// 官方解答里被涂黑的格子（0 基行列）。
export const EX_BLACK = [[0, 1], [0, 2], [2, 1], [3, 3]];
