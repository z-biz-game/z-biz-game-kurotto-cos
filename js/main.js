// 装配层：DOM 事件 → ui/game.js 的状态转移 → render/board.js 的一次重绘。
// verify.sh 的每一条腿都只读这里渲染出来的 DOM 文本、几何与画布像素，
// 所以任何"页面说了什么"的承诺（唯一解、链长、seed、违规数）都必须落到 DOM 上，不能只在内存里。
import { TIERS, EXCLUDED_TIERS } from './engine/generate.js';
import { RULES } from './engine/pencil.js';
import * as RULES_MOD from './engine/rules.js';
import * as PENCIL_MOD from './engine/pencil.js';
import * as GEN_MOD from './engine/generate.js';
import * as STORE_MOD from './store.js';
import * as EXAMPLE_MOD from './engine/example.js';
import * as G from './ui/game.js';
import { draw, cellAt, cellCenter } from './render/board.js';
import { loadSave, saveGame, clearSave, loadRecords, recordResult, savePrefs, loadPrefs, wipeAll, storageAvailable, KEYS } from './store.js';
import * as Theme from './theme.js';
import { mulberry32 } from './engine/rng.js';

const $ = s => document.querySelector(s);
const el = {
  menu: $('#view-menu'), game: $('#view-game'),
  tiers: $('#tier-list'), excluded: $('#excluded-note'), records: $('#record-list'),
  resume: $('#resume-card'), resumeName: $('#resume-name'), resumeMeta: $('#resume-meta'), btnResume: $('#btn-resume'),
  canvas: $('#board'), wrap: $('#board-wrap'), veil: $('#win-veil'), winMeta: $('#win-meta'), winRecord: $('#win-record'),
  name: $('#stat-name'), tier: $('#stat-tier'), seed: $('#stat-seed'), time: $('#stat-time'),
  moves: $('#stat-moves'), hints: $('#stat-hints'), black: $('#stat-black'), remaining: $('#stat-remaining'),
  conflicts: $('#stat-conflicts'), score: $('#stat-score'), genms: $('#stat-genms'),
  hintCount: $('#hint-count'), hintRule: $('#hint-rule'), hintLine: $('#hint-line'),
  state: $('#state-line'), btnTheme: $('#btn-theme'), btnReset: $('#btn-reset'),
};

const rndSeed = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
// 每个文档一个令牌：片段导航（只改 #hash）不会重建树，令牌不变；真导航/真重载一定变。
// 续局腿要的"我拿到的一定是个新文档"就靠它作证，不能只看 URL。
const DOC = 'doc' + Math.random().toString(36).slice(2, 10);
let state = null;   // { g, undo: [], view }
let tick = null;
// 坏档那条腿要让页面只读不写：ESM 的 namespace 属性写不进去（import * 是只读的），
// 所以摘掉写入这件事得由页面自己提供一个开关。
let persistOff = false;
const keyStats = { seen: 0, handled: 0, repeated: 0, by: {} };   // 键盘腿的读数：事件到底有没有送到这个文档

// seed 不按日期算：换一局必须真的换一张盘，界面显示的 seed 就是这张盘的 seed。
function nextSeed() { return 1 + Math.floor(rndSeed() * 0x7ffffffe); }

function show(view) {
  el.menu.hidden = view !== 'menu';
  el.game.hidden = view !== 'game';
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function elapsed() { return (state?.g.elapsed || 0) + (state?.running ? Date.now() - state.startedAt : 0); }

function renderMenu() {
  el.tiers.innerHTML = '';
  for (const t of TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier' + (state && state.g.tier === t.n && !el.game.hidden ? ' on' : '');
    b.dataset.n = String(t.n);
    // 按钮上只印盘与 seed 的属性（链长、线索格数）：耗时曾在这里印成"每档 med N ms"，
    // 而同一份代码在 CI 那台机器上量出来是 2.4 倍——印出去的秒数没有一台机器能替它签字。
    b.innerHTML = `<b>${t.label}</b><span class="tier-meta">${t.name} · 实测链长 med ${t.med.rounds} 轮 · 线索 med ${t.med.clues}/${t.n * t.n} 格</span>`;
    b.addEventListener('click', () => { startGame(t.n, nextSeed()); });
    el.tiers.appendChild(b);
  }
  el.excluded.textContent = EXCLUDED_TIERS.map(x => `${x.n}×${x.n} 不在菜单里：${x.reason}`).join(' ');

  const recs = loadRecords();
  el.records.innerHTML = '';
  for (const t of TIERS) {
    const list = recs[t.n] || [];
    const li = document.createElement('li');
    const best = list[0];
    li.innerHTML = `<span class="rec-tier">${t.label}</span>` + (best
      ? `<span class="rec-val">${fmtTime(best.ms)}</span><span class="rec-sub">${best.hints} 提示 · ${best.moves} 步 · seed ${best.seed}</span>`
      : '<span class="rec-sub">还没有纪录</span>');
    el.records.appendChild(li);
  }

  const s = loadSave();
  if (s) {
    const tier = TIERS.find(t => t.n === s.n);
    el.resume.hidden = false;
    el.resumeName.textContent = `未完成的 ${tier ? tier.label : s.n + '×' + s.n}`;
    const marks = s.marks.filter(m => m !== 0).length;
    el.resumeMeta.textContent = `${marks} 格已钉 · seed ${s.seed} · 提示 ${s.hints || 0} 次`;
  } else el.resume.hidden = true;
}

function startGame(n, seed) {
  const g = G.newGame(n, seed);
  state = { g, undo: [], running: true, startedAt: Date.now(), view: null };
  show('game');
  el.name.textContent = `クロット ${n}×${n}`;
  el.tier.textContent = (TIERS.find(t => t.n === n) || {}).name || '—';
  el.seed.textContent = `seed ${seed}`;
  el.veil.hidden = true;
  el.hintRule.textContent = '提示理由';
  el.hintLine.innerHTML = '按 <b>提示</b> 会说出当前能推的一格，以及它依据哪条命名规则。';
  el.canvas.setAttribute('aria-label', `クロット棋盘 ${n}×${n}：点一格在未定、黑、白之间循环`);
  renderMenu();
  persist();
  paintAll();
  startClock();
}

function resumeGame(s) {
  const g = G.deserialize(s);
  if (!g) { clearSave(); return false; }
  state = { g, undo: [], running: true, startedAt: Date.now(), view: null };
  show('game');
  el.name.textContent = `クロット ${g.n}×${g.n}`;
  el.tier.textContent = (TIERS.find(t => t.n === g.tier) || {}).name || '—';
  el.seed.textContent = `seed ${g.seed}`;
  el.veil.hidden = true;
  paintAll();
  startClock();
  return true;
}

function startClock() {
  if (tick) clearInterval(tick);
  tick = setInterval(() => { el.time.textContent = fmtTime(elapsed()); }, 250);
}

function persist() {
  if (!state || !storageAvailable() || persistOff) return;
  // 存档里的计时必须是"到目前为止"的：只在回选档时结算的话，玩到一半被关掉的档存的是 0，
  // 续局腿要断言的"计时接着走"就永远接着一个假数走。折叠之后把起点挪到此刻，免得重复计费。
  state.g.elapsed = elapsed();
  state.startedAt = Date.now();
  saveGame(G.serialize(state.g));
}

function paintAll() {
  const g = state.g;
  const bad = G.conflicts(g);
  // 宽度问的是舞台，不是 #board-wrap：那颗布是 inline-block，宽度就是画布自己的宽度，
  // 让它当尺子画布会越画越大（layout 腿量到过 42px 的格）。
  draw(el.canvas, { n: g.n, cell: g.cell, marks: g.marks, bad, sel: g.sel, flash: g.flash }, el.wrap.parentElement.clientWidth);
  const totalBlack = G.blackTotal(g);
  el.moves.textContent = String(g.moves);
  el.hints.textContent = String(g.hints);
  el.hintCount.textContent = String(g.hints);
  el.black.textContent = `${G.blackCount(g)}/${totalBlack}`;
  el.remaining.textContent = String(G.remaining(g));
  el.conflicts.textContent = String(bad.size);
  el.score.textContent = `${g.rounds} 轮`;
  el.genms.textContent = `${g.genMs} ms`;
  el.time.textContent = fmtTime(elapsed());
  if (bad.size) {
    el.state.className = 'conflict-line bad';
    el.state.textContent = `${bad.size} 个圈的账不对：${[...bad].slice(0, 3).map(i => `R${((i / g.n) | 0) + 1}C${(i % g.n) + 1} 写着 ${g.cell[i]}`).join('、')}${bad.size > 3 ? ' …' : ''}`;
  } else if (G.remaining(g) === 0) {
    el.state.className = 'conflict-line ok';
    el.state.textContent = '每一格都钉满了，正在核账…';
  } else {
    el.state.className = 'conflict-line';
    el.state.textContent = `还有 ${G.remaining(g)} 格未定 · 圈 ${g.clues} 个数字 + ${g.empties} 个空圈`;
  }
}

function afterChange() {
  paintAll();
  persist();
  checkWin();
}

function checkWin() {
  const g = state.g;
  if (!G.isSolved(g)) return false;
  state.running = false;
  const ms = elapsed();
  g.elapsed = ms;
  const res = recordResult({ tier: g.tier, n: g.n, seed: g.seed, hints: g.hints, moves: g.moves, ms, rounds: g.rounds });
  el.veil.hidden = false;
  el.winMeta.textContent = `${g.n}×${g.n} · seed ${g.seed} · ${fmtTime(ms)} · ${g.moves} 步 · ${g.hints} 次提示 · 推理链长 ${g.rounds} 轮`;
  el.winRecord.textContent = res.rank > 0
    ? (res.isRecord ? `这一档的新纪录（第 ${res.rank} 名）` : `这一档第 ${res.rank} 名`)
    : '已存档';
  el.state.className = 'conflict-line ok';
  el.state.textContent = '判据核对：每一格的账都对上了 · 唯一解';
  persist();
  renderMenu();
  return true;
}

function doHint() {
  if (!state) return;
  const r = G.hint(state.g);
  if (r.rule) {
    el.hintRule.textContent = r.rule;
    el.hintLine.textContent = `${r.text} —— 这一格是线索推得出的，不是猜的。`;
  } else {
    el.hintLine.textContent = r.why;
  }
  // 提示改的格也要能退：doUndo 的文案早就这么承诺了，退不掉的那句就是谎。
  if (r.changed) state.undo.push({ i: r.cell, from: r.from });
  afterChange();
}

function doPaint(val) {
  if (!state) return;
  const i = state.g.sel;
  if (i < 0) { el.state.textContent = '先选一格。'; return; }
  if (RULES_MOD.isCircle(state.g.cell[i])) {
    el.state.textContent = '圈格里印着题面的线索，它永远不是黑块 —— 这一格不能涂。';
    return;
  }
  const before = state.g.marks[i];
  const r = G.paint(state.g, i, val);
  if (r.changed) state.undo.push({ i, from: before });
  afterChange();
}

function doCycle(i) {
  if (!state) return;
  if (i < 0) return;
  if (RULES_MOD.isCircle(state.g.cell[i])) {
    el.state.textContent = '圈格里印着题面的线索，它永远不是黑块 —— 这一格不能涂。';
    return;
  }
  const before = state.g.marks[i];
  const r = G.cycle(state.g, i);
  if (r.changed) state.undo.push({ i, from: before });
  afterChange();
}

function doUndo() {
  const u = state.undo.pop();
  if (!u) { el.state.textContent = '没有可撤销的一步（提示改的格也在这里退）。'; return; }
  state.g.marks[u.i] = u.from;
  state.g.moves++;
  state.g.sel = u.i;
  afterChange();
}

function moveSel(dr, dc) {
  const g = state.g;
  let r = g.sel < 0 ? 0 : (g.sel / g.n) | 0;
  let c = g.sel < 0 ? 0 : g.sel % g.n;
  r = Math.min(g.n - 1, Math.max(0, r + dr));
  c = Math.min(g.n - 1, Math.max(0, c + dc));
  g.sel = r * g.n + c;
  paintAll();
}

el.canvas.addEventListener('pointerdown', ev => {
  ev.preventDefault();
  el.canvas.focus();
  doCycle(cellAt(el.canvas, state.g.n, ev.clientX, ev.clientY));
});
el.canvas.addEventListener('contextmenu', ev => ev.preventDefault());
// 屏宽一变画布就得重排：尺寸的尺子（舞台宽度、devicePixelRatio）都只在 paintAll 里读一次，
// 没有这个监听的话，转屏/缩窗之后棋盘还是上一次的大小，玩家点到的格与画出来的格错位。
// 触屏腿量的就是这个：覆写视口之后、第一次点击之前，画布的后备缓冲必须已经跟上新 dpr。
window.addEventListener('resize', () => { if (state) paintAll(); });
// 像素比变了不一定会补一次 resize（CDP 覆视口就是先改宽度、后改 dpr，两次重排之间画布按旧 dpr
// 排好了；用户把窗口拖到另一块屏上也是同一件事）。画布的后备缓冲停在旧 dpr 上就是糊的一张图，
// 而闸在像素上对颜色——所以 dpr 一变就重排。
function watchPixelRatio() {
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onChange = () => { if (state) paintAll(); watchPixelRatio(); };
  if (mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
  else mq.addListener(onChange);
}
watchPixelRatio();

function handleKey(ev) {
  const k = ev.key;
  if (k === 'ArrowUp') { moveSel(-1, 0); ev.preventDefault(); return true; }
  if (k === 'ArrowDown') { moveSel(1, 0); ev.preventDefault(); return true; }
  if (k === 'ArrowLeft') { moveSel(0, -1); ev.preventDefault(); return true; }
  if (k === 'ArrowRight') { moveSel(0, 1); ev.preventDefault(); return true; }
  if (k === 'Enter' || k === ' ') { if (state.g.sel >= 0) { doCycle(state.g.sel); ev.preventDefault(); return true; } return false; }
  if (k === 'b' || k === 'B') { doPaint(2); return true; }
  if (k === 'w' || k === 'W') { doPaint(1); return true; }
  if (k === '0' || k === 'Backspace') { doPaint(0); ev.preventDefault(); return true; }
  if (k === 'h' || k === 'H') { doHint(); return true; }
  if (k === 'z' || k === 'Z') { doUndo(); return true; }
  if (k === 'n' || k === 'N') { startGame(state.g.n, nextSeed()); return true; }
  return false;
}

// seen 是"事件送到这个文档了几次"，handled 是"游戏真的动了一步"，repeated 是操作系统自动补发。
// 键盘腿要能点出是哪一只有问题：只报一个总数的话，0/2/7 这种跳动说不清是谁的锅。
document.addEventListener('keydown', ev => {
  keyStats.seen++;
  keyStats.by[ev.key] = (keyStats.by[ev.key] || 0) + 1;
  if (ev.repeat) keyStats.repeated++;
  if (el.game.hidden || !state) return;
  if (handleKey(ev)) keyStats.handled++;
});

$('#btn-black').addEventListener('click', () => doPaint(2));
$('#btn-white').addEventListener('click', () => doPaint(1));
$('#btn-clear').addEventListener('click', () => doPaint(0));
$('#btn-hint').addEventListener('click', doHint);
$('#btn-undo').addEventListener('click', doUndo);
$('#btn-new').addEventListener('click', () => startGame(state ? state.g.n : TIERS[0].n, nextSeed()));
$('#btn-menu').addEventListener('click', backToMenu);
$('#btn-menu-2').addEventListener('click', backToMenu);
$('#btn-again').addEventListener('click', () => startGame(state.g.n, nextSeed()));
$('#btn-reset').addEventListener('click', () => { wipeAll(); renderMenu(); el.state.textContent = '存档已清空。'; });
el.btnTheme.addEventListener('click', () => {
  const t = Theme.toggle();
  savePrefs({ theme: t });
  // 棋盘的颜色是从 CSS 变量现读的，变量换了但画布上还留着上一次的颜色——不重绘就是"换了主题，
  // 棋盘没换"。layout 腿在两种主题下各采一次像素，这里不重绘会当场红。
  if (state) paintAll();
});
$('#btn-resume').addEventListener('click', () => { const s = loadSave(); if (s) resumeGame(s); else renderMenu(); });

function backToMenu() {
  if (state) { state.g.elapsed = elapsed(); state.running = false; persist(); }
  show('menu');
  renderMenu();
}

// 引擎与闸在页面里可达：browser 的 engine 腿就是在真浏览器里跑同一份 ESM。
window.kurotto = {
  TIERS, EXCLUDED_TIERS, RULES, G,
  // 页面里读到的模块图就是出货的那一份：browser 的 engine 腿不再另抄一个求解器，
  // 否则「页面里的引擎过了」和「发布出去的引擎过了」就是两件事。
  engine: { rules: RULES_MOD, pencil: PENCIL_MOD, generate: GEN_MOD, store: STORE_MOD, example: EXAMPLE_MOD },
  doc: DOC,
  state: () => state,
  keyStats: () => ({ ...keyStats, by: { ...keyStats.by } }),
  view: () => ({ canvas: el.canvas, n: state ? state.g.n : 0, menuHidden: el.menu.hidden, gameHidden: el.game.hidden }),
  center: i => cellCenter(el.canvas, state.g.n, i),
  hitAt: (x, y) => cellAt(el.canvas, state.g.n, x, y),
  mark: i => (state ? { clue: state.g.cell[i], mark: state.g.marks[i], sel: state.g.sel } : null),
  start: (n, seed) => startGame(n, seed ?? nextSeed()),
  cycle: i => doCycle(i),
  paint: (i, v) => { state.g.sel = i; doPaint(v); },
  hint: () => doHint(),
  undo: () => doUndo(),
  menu: backToMenu,
  save: KEYS,
  pausePersist: () => { persistOff = true; },
  storageAvailable,
  texts: () => ({
    name: el.name.textContent, moves: el.moves.textContent, hints: el.hints.textContent,
    black: el.black.textContent, remaining: el.remaining.textContent, conflicts: el.conflicts.textContent,
    score: el.score.textContent, genms: el.genms.textContent, time: el.time.textContent,
    seed: el.seed.textContent, tier: el.tier.textContent, state: el.state.textContent,
    hintRule: el.hintRule.textContent, hintLine: el.hintLine.textContent, excluded: el.excluded.textContent,
  }),
};

Theme.init();
renderMenu();
show('menu');
window.dispatchEvent(new Event('kurotto:ready'));

// ---- 全屏开关 ----
//
// 绑到 index.html 的 HUD 里真实存在的 #btn-fullscreen。
// 只在 js 里留一串 requestFullscreen 能骗过字符串扫描，但按钮不在 DOM 里就是死代码：
// 玩家按不到，功能等于没做。所以 id 必须与 HTML 里的按钮对得上，缺失时要在控制台喊出来。
//
// 三套 API 一律**特性探测**，不做 UA 判断：iPhone 版 Safari 压根没有元素全屏（只有 <video> 能全屏），
// 老 Edge 只认 ms 前缀，Firefox 认 moz 前缀。UA 字符串是猜的，方法在不在是量的，猜错就静默失效。
function fsRoot() {
  return document.documentElement;
}

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function fsRequest(root) {
  // 老 Edge 的 msRequestFullscreen 挂在元素上，和标准名同一个位置，所以并排取即可。
  return root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen || null;
}

// iOS Safari 会把非 video 元素的请求直接 reject 成 NotAllowedError。
// 这个 promise 没人接就升级成 unhandledrejection，冒到 window.onerror——离屏预载时足以把整页判死。
// 因此凡是可能返回 promise 的调用，返回值一律就地吞掉，绝不让拒绝逃出这一层。
function fsQuiet(p) {
  if (p && typeof p.catch === 'function') p.catch(() => {});
  return p;
}

// 返回 true=请求进入，false=请求退出，null=不支持（调用方据此禁用按钮）。
function toggleFullscreen(root) {
  const req = fsRequest(root);
  if (!req) return null;
  if (fsElement()) {
    // 退出侧同样要兜底：老 Edge 是 msExitFullscreen；万一三者皆无就当无事发生，不抛。
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) fsQuiet(exit.call(document));
    return false;
  }
  // 部分实现（如被 Permissions-Policy 挡住的 iframe）会同步抛，所以 catch 和 .catch 两头都要接。
  try {
    fsQuiet(req.call(root));
  } catch (err) {
    // 拒绝即降级：静默保持当前形态，不冒泡、不打断这一局的其余逻辑。
  }
  return true;
}

function bindFullscreen(btn) {
  const root = fsRoot();

  // 状态回写：Esc 和 iOS 下滑手势退出时不会经过按钮，
  // 只有 fullscreenchange 事件能把按钮的文案/字形拉回正确状态，否则它会一直假装自己在全屏里。
  const sync = () => {
    const on = !!fsElement();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    btn.title = on ? "退出全屏 (F)" : "全屏 (F)";
    document.body.classList.toggle('is-fullscreen', on);
    return on;
  };

  if (!fsRequest(root)) {
    // 不支持就要说明为什么：只把按钮变灰，玩家会以为这活根本没做完。
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」）';
    return;
  }

  btn.addEventListener('click', () => {
    toggleFullscreen(root);
    sync();
  });

  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // 正在输入框里打字时不劫持按键，否则会打不出 f。
    if (ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName)) return;
    if (ev.key === "f" || ev.key === "F") {
      ev.preventDefault();
      toggleFullscreen(root);
      sync();
    }
  });

  sync();
}

function bootFullscreen() {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) {
    // 按钮被谁删掉了？在控制台喊出来，别让这个坑静默地烂在下一棒手里。
    console.warn('[fullscreen] index.html 里找不到 #' + "btn-fullscreen" + '，全屏开关没有入口');
    return;
  }
  bindFullscreen(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFullscreen);
} else {
  bootFullscreen();
}
