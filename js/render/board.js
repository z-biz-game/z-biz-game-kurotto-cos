// 画布渲染：只负责画与命中换算，不持有任何游戏状态。
// 颜色从 CSS 变量取，所以换主题不需要改这里；verify.sh 的 mouse/touch 腿采画布中心像素来
// 确认"点下去真的画黑了"，因此黑格必须是纯色填充（不能有渐变/纹理）。
import { EMPTY, isCircle, isNum, WHITE, BLACK } from '../engine/rules.js';

export const CELL_TARGET = 44; // 目标格宽（px）：菜单按这个尺寸撑出画布，鼠标腿也按它算命中盒

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function layout(canvas, n) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const avail = Math.min(
    (canvas.parentElement.clientWidth || 640) - 4,
    CELL_TARGET * n + 2);
  const cssSize = Math.max(CELL_TARGET * 3, Math.floor(avail / n) * n);
  const cell = cssSize / n;
  canvas.style.width = cssSize + 'px';
  canvas.style.height = cssSize + 'px';
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cssSize, cell, dpr };
}

export function cellAt(canvas, n, clientX, clientY) {
  const box = canvas.getBoundingClientRect();
  const cell = box.width / n;
  const c = Math.floor((clientX - box.left) / cell);
  const r = Math.floor((clientY - box.top) / cell);
  if (r < 0 || c < 0 || r >= n || c >= n) return -1;
  return r * n + c;
}

// 与 cellAt 同一个映射的正方向：给指针腿算"这一格的中心在哪"，两条边共用一份几何才不会各说各话。
export function cellCenter(canvas, n, i) {
  const box = canvas.getBoundingClientRect();
  const cell = box.width / n;
  const r = (i / n) | 0, c = i % n;
  return { x: box.left + (c + 0.5) * cell, y: box.top + (r + 0.5) * cell, cell,
    left: box.left, top: box.top, width: box.width, height: box.height };
}

// game: { n, cell:Int16Array, marks:Uint8Array, bad:Set<number>, sel:number, flash:number }
export function draw(canvas, game) {
  const { n } = game;
  const { ctx, cssSize, cell } = layout(canvas, n);
  const ink = css('--ink', '#EDEFF3');
  const bg = css('--board-bg', '#212B3A');
  const line = css('--grid-line', '#3A4454');
  const blackC = css('--black-cell', '#080B12');
  const dot = css('--dot', '#7A879B');
  const badC = css('--bad', '#FF6B5A');
  const accent = css('--accent', '#59D49C');
  const soft = css('--soft', '#3C4A62');

  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssSize, cssSize);

  for (let i = 0; i < n * n; i++) {
    const r = (i / n) | 0, c = i % n;
    const x = c * cell, y = r * cell;
    const v = game.cell[i];
    if (!isCircle(v) && game.marks[i] === BLACK) {
      ctx.fillStyle = blackC;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    } else if (!isCircle(v) && game.marks[i] === WHITE) {
      // 整格铺 --soft：钉成白必须和"还没想"（--board-bg）一眼两样，只点一颗小圆点等于没说。
      ctx.fillStyle = soft;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    }
    if (isCircle(v)) {
      // 圈：数字圈写数字，空圈只画环。两种都不能涂黑，所以永远不填黑底。
      ctx.strokeStyle = v === EMPTY ? dot : ink;
      ctx.lineWidth = Math.max(1.4, cell * 0.05);
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, cell * 0.29, 0, Math.PI * 2);
      ctx.stroke();
      if (isNum(v)) {
        ctx.fillStyle = ink;
        ctx.font = `600 ${Math.round(cell * 0.42)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), x + cell / 2, y + cell / 2 + cell * 0.02);
      }
    }
    if (game.bad.has(i)) {
      ctx.strokeStyle = badC;
      ctx.lineWidth = Math.max(2, cell * 0.07);
      ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
    }
    if (i === game.flash) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
    }
  }

  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let k = 0; k <= n; k++) {
    const p = Math.round(k * cell) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, cssSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(cssSize, p); ctx.stroke();
  }
  if (game.sel >= 0) {
    const r = (game.sel / n) | 0, c = game.sel % n;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, cell * 0.05);
    ctx.strokeRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
  }
}
