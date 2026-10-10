// Minimal CDP driver for headless playtesting (Node 22+ global WebSocket/fetch).
//
// env: CDP_PORT (devtools port, default 9382), BASE_URL (page origin, default
//      http://127.0.0.1:5282/), WITNESS (json handed to the resume scenario)
//      GATE_SELFTEST=1 (makes every report plant one deliberately wrong expectation —
//      scenarios.js 那份和 node 侧的 leg/nav/reload 那份走的是同一条规矩)
//
//   node tools/playtest.cjs open <url>          fresh tab at <url>, prints boot logs
//   node tools/playtest.cjs eval '<expr>' [nonav]   evaluate, await promises, print result
//   node tools/playtest.cjs scenario <name>     inject tools/scenarios.js, run __ngWrap(<name>)
//   node tools/playtest.cjs witness             read timeOrigin/doc/盘面证人 BEFORE any navigation
//   node tools/playtest.cjs nav <url> same|fresh   navigate + assert whether it is a new document
//   node tools/playtest.cjs reload              real reload + assert the document actually died
//   node tools/playtest.cjs leg mouse|touch|keys   真事件（Input.dispatch*）驱动的输入腿
//   node tools/playtest.cjs shot <file.png> / logs
//
// Which page to attach to is decided by BASE_URL's origin, never by a hard-coded port:
// an `eval` that silently lands on an about:blank target reads like a broken deploy.
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CDP_PORT || 9382);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5282/';
const ORIGIN = new URL(BASE).origin;
const SELFTEST = process.env.GATE_SELFTEST === '1';
const cmd = process.argv[2];
const arg = process.argv[3];
const rest = process.argv[4];
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);

const logs = [];
const rows = [];
const ck = (test, cond, detail) => rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
const result = (extra) => {
  // 阴性自证要覆盖 node 侧的腿：真事件（leg mouse/touch/keys）与 nav/reload 的报告不经过
  // scenarios.js 的 report()，不在这里也种一条的话，这五条腿就永远是"没能红过的绿"。
  if (SELFTEST) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });
  return { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
};
const out = (extra) => {
  const r = result(extra);
  if (logs.length) console.error(logs.slice(-40).join('\n'));
  // Console noise first, machine-readable line last: the parser in verify.sh takes the final
  // RESULT line, so a stray '{' in a log cannot hijack the report.
  console.log('RESULT ' + JSON.stringify(r));
};
const evidence = (o) => console.log('EVIDENCE ' + Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' '));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) this.consume(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  consume(m) {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') logs.push(`[log:error] ${e.text} ${e.url || ''}`);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {
      /* not bound yet */
    }
    if (Date.now() > deadline) throw new Error(`devtools never bound on :${PORT}`);
    await sleep(250);
  }
}

async function main() {
  const info = await waitForDevTools();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const cdp = new CDP(ws);

  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) {
      if (t.type === 'page' && isOurs(t.url)) {
        try {
          await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId });
        } catch { /* already gone */ }
      }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let sessionId;
  if (existing) {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: existing.id || existing.targetId, flatten: true }));
  } else {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const evaluate = async (expression) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, timeout: 900000 },
      sessionId
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const json = async (expression) => JSON.parse(await evaluate(`JSON.stringify((${expression}))`));

  const ready = async () => {
    for (let i = 0; i < 160; i++) {
      const s = await evaluate('document.readyState').catch(() => 'loading');
      if (s === 'complete') return;
      await sleep(100);
    }
  };
  const navigate = async (url) => {
    await cdp.send('Page.navigate', { url }, sessionId);
    await ready();
    await sleep(200);
  };
  // 只差一个 hash 的 URL 是 same-document navigation：Page.navigate 过去并不会换文档。
  // 所以"这一腿必须落在新文档里"的走 Page.reload，URL 真的不同才用 navigate。
  const gotoFresh = async (url = BASE) => {
    const cur = String(await evaluate('location.href').catch(() => ''));
    const cut = (u) => u.split('#')[0];
    if (cur && cut(cur) === cut(url)) {
      await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
      await ready();
      await sleep(200);
    } else {
      await navigate(url);
    }
  };
  // 文档身份：每个文档一个随机 doc 号。片段导航不换文档所以它不变，真重载一定变。
  const docInfo = () =>
    evaluate(`(()=>{const k=window.kurotto;return {url:location.href,to:performance.timeOrigin,doc:k?k.doc:'(no window.kurotto)',boot:!!k};})()`).catch((e) => ({ url: 'unknown', to: 0, doc: 'ERR:' + e.message, boot: false }));

  // ---------- in-page geometry: 先量 hit box，再谈"点得到" ----------

  // 选档页上第一档那颗按钮：指针腿从"真点开一档"开始，菜单就不是一块只给程序点的布景。
  // 按钮里有 <b> 和 <span>，命中的是最里面那层，所以要问"命中点是不是在这颗按钮里"。
  const TIER0 = `(()=>{const e=document.querySelector('#tier-list .tier');const b=e.getBoundingClientRect();
    const x=b.left+b.width/2,y=b.top+b.height/2;const t=document.elementFromPoint(x,y);
    return {x,y,n:e.dataset.n,hit:t?(t.id||t.tagName):'null',inTier:String(!!(t&&t.closest&&t.closest('#tier-list .tier')))};})()`;

  const PREP = `(()=>{
    const k=window.kurotto, R=k.engine.rules;
    const st=k.state();
    if(!st) throw new Error('no game on screen');
    const g=st.g, canvas=k.view().canvas;
    const rect=canvas.getBoundingClientRect();
    const at=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.id||e.tagName):'null';};
    const o={n:g.n,rect:{l:rect.left,t:rect.top,w:rect.width,h:rect.height},iw:innerWidth,dpr:devicePixelRatio,
      css:{w:Math.round(rect.width),bw:canvas.width},
      seed:g.seed,sweepTotal:g.n*g.n,sweepMiss:0,cells:[],circles:[],btns:[]};
    for(let i=0;i<g.n*g.n;i++){const c=k.center(i);if(at(c.x,c.y)!=='board')o.sweepMiss++;}
    // 玩家能动的格：非圈格。取前三格做点击样本，坐标与命中元素都带回来。
    for(const i of [...g.cell.keys()].filter(i=>!R.isCircle(g.cell[i])).slice(0,3)){const c=k.center(i);
      o.cells.push({i,x:c.x,y:c.y,hit:at(c.x,c.y)});}
    // 圈格两种都要：写着数字的、空着的。它们的中心点在 canvas 上，但永远点不进去。
    for(const pick of [g.cell.findIndex(v=>R.isNum(v)), g.cell.findIndex(v=>v===R.EMPTY)]){
      if(pick<0)continue;const c=k.center(pick);
      o.circles.push({i:pick,clue:g.cell[pick],x:c.x,y:c.y,hit:at(c.x,c.y)});}
    for(const id of ['btn-black','btn-white','btn-clear','btn-hint','btn-undo','btn-new']){
      const e=document.getElementById(id),b=e.getBoundingClientRect();
      const x=b.left+b.width/2,y=b.top+b.height/2;
      o.btns.push({id,x,y,hit:at(x,y),w:Math.round(b.width),h:Math.round(b.height)});}
    o.vars={black:getComputedStyle(document.documentElement).getPropertyValue('--black-cell').trim(),
      soft:getComputedStyle(document.documentElement).getPropertyValue('--soft').trim(),
      bg:getComputedStyle(document.documentElement).getPropertyValue('--board-bg').trim()};
    // 变量名不算证人，主题名才算：像素对上的必须是"这个文档此刻的那套变量"。
    o.theme=document.documentElement.dataset.theme||'';
    return o;})()`;

  const GAME = `(()=>{const st=window.kurotto.state();const g=st.g;
    return {sel:g.sel,seed:g.seed,n:g.n,moves:g.moves,hints:g.hints,
      marks:Array.from(g.marks),cell:Array.from(g.cell),doc:window.kurotto.doc,to:performance.timeOrigin};})()`;
  // 采画布中心那一个像素：返回 [r,g,b]，腿里拿它和同一文档读到的 CSS 变量对账。
  const PIXEL = (i) => `(()=>{const k=window.kurotto,c=k.center(${i}),cv=k.view().canvas;
    const dpr=Math.max(1,devicePixelRatio||1),box=cv.getBoundingClientRect();
    const d=cv.getContext('2d').getImageData(Math.round((c.x-box.left)*dpr),Math.round((c.y-box.top)*dpr),1,1).data;
    return [d[0],d[1],d[2]];})()`;

  const DOMTXT = `(()=>{const t=s=>(document.querySelector(s)||{}).textContent||'';
    return {name:t('#stat-name'),seed:t('#stat-seed'),moves:t('#stat-moves'),hints:t('#stat-hints'),
    black:t('#stat-black'),remaining:t('#stat-remaining'),conflicts:t('#stat-conflicts'),
    score:t('#stat-score'),genms:t('#stat-genms'),time:t('#stat-time'),
    state:t('#state-line'),hintRule:t('#hint-rule'),hintLine:t('#hint-line'),hintCount:t('#hint-count'),
    veilShown:(()=>{const e=document.getElementById('win-veil');return e?getComputedStyle(e).display!=='none'&&e.getClientRects().length>0:false;})(),
    theme:document.documentElement.dataset.theme||'',
    active:document.activeElement?(document.activeElement.id||document.activeElement.tagName):'null'};})()`;

  // 两条腿各自只发自己那一种真事件：mouse 腿发鼠标，touch 腿发触屏。脚本里成对写 tap，
  // 于是同一条断言在两种事件下各跑一次，而不会出现"鼠标腿其实也按了一遍触屏"的假证据。
  const mouse = async (x, y) => {
    if (arg === 'touch') return;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(90);
  };
  const key = async (k) => {
    const map = { b: 'KeyB', w: 'KeyW', h: 'KeyH', z: 'KeyZ', n: 'KeyN', '0': 'Digit0', Backspace: 'Backspace', Enter: 'Enter', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowLeft: 'ArrowLeft', ArrowDown: 'ArrowDown' };
    const vk = { b: 66, w: 87, h: 72, z: 90, n: 78, '0': 48, Backspace: 8, Enter: 13, ArrowRight: 39, ArrowUp: 38, ArrowLeft: 37, ArrowDown: 40 };
    const text = k.length === 1 ? k : undefined;
    // 绝不给 nativeVirtualKeyCode：macOS 上 Chrome 把它当平台原生键码，于是这只键被 raw keyboard
    // 路径反复补发（一次派发换来一串 keydown）。让 Chrome 自己从 windowsVirtualKeyCode 推原生键码，
    // 一次派发就正好是一次按键——这一条由 keys 腿逐键的「1 seen / 0 repeat」守着，不是靠这句话。
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: map[k], text, windowsVirtualKeyCode: vk[k] }, sessionId);
    if (text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text, key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await sleep(60);
  };
  const touch = async (x, y) => {
    if (arg !== 'touch') return;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] }, sessionId);
    await sleep(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    await sleep(90);
  };

  // ---------- commands ----------

  if (cmd === 'open') {
    await navigate(arg || BASE);
    const d = await docInfo();
    evidence({ url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (rest !== 'nonav') await navigate(BASE);
    const v = await evaluate(arg);
    console.log(typeof v === 'string' ? v : JSON.stringify(v));
  } else if (cmd === 'witness') {
    // 证人自己摆盘：save 那条 scenario 收尾时点了「清空存档」，续局腿要续的那一局必须由这一腿
    // 亲手写进 localStorage，否则下一个文档读到的是"没有档的选档页"——那是一份没有证人的绿。
    // 摆盘走的全是页面自己的门面（start/paint/hint/menu），node 不碰引擎 internals。
    const planted = await evaluate(`(()=>{
      const k=window.kurotto, R=k.engine.rules;
      k.start(7, 4242);
      const g=k.state().g;
      const plain=[...g.cell.keys()].filter(i=>!R.isCircle(g.cell[i]));
      k.paint(plain[0], R.BLACK); k.paint(plain[1], R.WHITE); k.paint(plain[2], R.BLACK);
      k.hint(); k.menu();
      return window.kurotto.state()?'ok':'no state';})()`).catch((e) => 'ERR:' + e.message);
    const d = await docInfo();
    // 派发导航之先，证人已经在 node 手里了：续局那条腿要证明的是"新文档"，不是"我按了一次刷新"。
    // 证人同时把"导航前盘面长什么样"抄一份下来——续局腿要比的是这一份，不是它自己重算的期望。
    // 哈希只从页面里的 __ngHash 取（scenarios.js 那一份实现）：node 再抄一遍哈希，
    // 续局腿比的就是两个哈希函数而不是两张盘面。
    const sent = await evaluate(`(()=>{const st=window.kurotto.state();window.__gateSentinel='sn'+Math.floor(Math.random()*1e6);
      return window.__gateSentinel+'|'+(st?st.g.seed:'no game');})()`);
    const snap = await json(`(()=>{const k=window.kurotto,st=k.state();
      if(!st) return {err:'证人摆盘之后还是没有牌局（planted=${planted}）'};
      if(!window.__ngHash) return {err:'页面里没有 __ngHash：scenarios.js 没在当前文档里，哈希就没有那一份共享实现'};
      const g=st.g, raw=localStorage.getItem(k.save.save);
      if(!raw) return {err:'localStorage 里没有 ' + k.save.save + '：证人没把档写下去'};
      const saved=JSON.parse(raw);
      if(saved.seed!==g.seed||saved.moves!==g.moves) return {err:'档与现场不同步（seed ' + saved.seed + ' vs ' + g.seed + ' · moves ' + saved.moves + ' vs ' + g.moves + '）'};
      return {n:g.n,seed:g.seed,doc:k.doc,url:location.href,cluesHash:window.__ngHash.clues(g.cell),marksHash:window.__ngHash.marks(g.marks),
        moves:g.moves,hints:g.hints,storedMs:saved.elapsed||0,savedMoves:saved.moves,savedHints:saved.hints};})()`);
    evidence({ planted, url: d.url, timeOrigin: d.to, doc: d.doc, sentinel: sent, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio'), ...snap });
    console.log(JSON.stringify({ timeOrigin: d.to, doc: d.doc, ...snap }));
  } else if (cmd === 'nav' || cmd === 'reload') {
    const before = await docInfo();
    const expect = cmd === 'reload' ? 'fresh' : rest;
    const url = cmd === 'reload' ? before.url.split('#')[0] : arg;
    if (cmd === 'reload') await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
    else await cdp.send('Page.navigate', { url: url || BASE }, sessionId);
    await sleep(expect === 'fresh' ? 500 : 350);
    await ready();
    if (expect === 'fresh') {
      for (let i = 0; i < 60; i++) {
        const d = await docInfo();
        if (d.boot && d.doc !== before.doc) break;
        await sleep(150);
      }
    }
    const after = await docInfo();
    evidence({ leg: cmd, expect, urlBefore: before.url, urlAfter: after.url, timeOriginBefore: before.to, timeOriginAfter: after.to, docBefore: before.doc, docAfter: after.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    eq(`${cmd} 之后页面还在同一个 URL 形态`, new URL(after.url).pathname, new URL(url || before.url).pathname);
    ck(`${cmd} 之后应用又起来了（window.kurotto 在）`, after.boot, after.doc);
    if (expect === 'same') {
      eq('片段导航不算重载：timeOrigin 必须没变', after.to, before.to);
      eq('片段导航不算重载：文档身份必须没变', after.doc, before.doc);
    } else {
      ck('真重载：timeOrigin 必须换了（新文档）', after.to !== before.to, `${before.to} -> ${after.to}`);
      ck('真重载：文档身份必须换了', after.doc !== before.doc, `${before.doc} -> ${after.doc}`);
    }
    out({ before, after, expect });
  } else if (cmd === 'scenario') {
    const src = fs.readFileSync(path.join(__dirname, 'scenarios.js'), 'utf8');
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src }, sessionId);
    await gotoFresh(BASE);
    await evaluate(`window.__witness=${process.env.WITNESS || 'null'};window.__selftest=${SELFTEST};'ok'`);
    // Headless reports the page as hidden, and the render loop is allowed to skip frames when
    // hidden — so a scenario that waits on animation would time out against a browser that is
    // only pretending to be in the background.
    await evaluate(`Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
      Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});'ok'`);
    const d = await docInfo();
    evidence({ scenario: arg, url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    const res = await evaluate(`(async()=>{
      if (!window.__ngWrap) throw new Error('scenarios.js never installed');
      // 报告必须是字符串：把对象交给 returnByValue 只会打印出 "[object Object]"，
      // 于是这一腿看起来跑了、verify.sh 却一行断言都解析不到。
      return JSON.stringify(await window.__ngWrap(${JSON.stringify(arg)}));
    })()`);
    // 每一次注入都在文档上留一份，用完就撤：否则同一个文档里会有第 N 份 scenarios.js 在跑。
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId).catch(() => {});
    if (logs.length) console.error(logs.slice(-40).join('\n'));
    console.log('RESULT ' + res);
  } else if (cmd === 'leg') {
    await leg();
  } else if (cmd === 'shot') {
    await cdp.send('Page.bringToFront', {}, sessionId);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.mkdirSync(path.dirname(arg), { recursive: true });
    fs.writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg);
  } else if (cmd === 'logs' || cmd === 'reload-logs') {
    if (cmd === 'reload-logs') await navigate(BASE);
    console.log(logs.join('\n') || '(clean)');
  } else {
    console.error('unknown command: ' + cmd);
    process.exit(64);
  }
  ws.close();
  process.exit(0);

  // ---------- 真事件腿：鼠标 / 触屏 / 键盘（都走 CDP Input.*，不是页内 new Event） ----------

  async function leg() {
    await gotoFresh(BASE);
    // 从选档页真点第一档开局：菜单也是真事件证到的，不是程序摆出来的布景。
    const t0 = await json(TIER0);
    eq('hit box：选档第一档那颗按钮点得到（命中的是按钮里的东西）', t0.inTier, 'true');
    await mouse(t0.x, t0.y);
    await touch(t0.x, t0.y);
    await sleep(150);
    if (arg === 'touch') {
      // 覆写必须写在腿自己的调用里，并且腿要能读回证人：另起进程设 Emulation 等于把桌面断言
      // 重跑一遍。所以这里读回 innerWidth/dpr 并把它命名成"覆写在位"，不命名成"这是手机"。
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
      await sleep(400);
    }
    const p = await json(PREP);
    const d0 = await docInfo();
    const near = (px, hexv) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hexv);
      if (!m) return { ok: false, at: `坏色值 ${hexv}` };
      const x = parseInt(m[1], 16);
      const d = Math.abs(px[0] - (x >> 16 & 255)) + Math.abs(px[1] - (x >> 8 & 255)) + Math.abs(px[2] - (x & 255));
      // 红了要能看见采到的是哪一屏像素：只报"差 665"的话，分不清是颜色不对还是坐标不对。
      return { ok: d <= 12, at: `采到 ${px.join('/')} · 期望 ${hexv} · L1 ${d} @cell ${p.css.w}px/dpr ${p.dpr}` };
    };
    const pix = (label, px, hexv) => { const r = near(px, hexv); ck(label, r.ok, r.at); };
    evidence({ leg: arg, url: d0.url, timeOrigin: d0.to, doc: d0.doc, innerWidth: p.iw, dpr: p.dpr, seed: p.seed, n: p.n, theme: p.theme });
    eq('hit box：棋盘每一格中心都落在 canvas 上', p.sweepMiss, 0);
    eq('hit box：六颗按钮的命中元素就是自己', p.btns.filter((b) => b.hit !== b.id).map((b) => b.hit + '@' + b.id).join(','), '');
    ck('按钮都够点（>=34px 高）', p.btns.every((b) => b.h >= 34), JSON.stringify(p.btns.map((b) => b.h)));
    eq('非圈格样本至少三格', p.cells.length >= 3, 'true');
    ck('样本里有一个写着数字的圈', p.circles.length >= 1 && p.circles.some((c) => c.clue >= 0), JSON.stringify(p.circles.map((c) => c.clue)));
    // 采像素的前提：画布的后备缓冲必须是"当前 dpr 下的当前尺寸"。视口变了而页面不重排的话，
    // 采到的坐标与画出来的格对不上——那时候的颜色红字是假红，所以先把几何钉住再谈颜色。
    ck('画布缓冲跟得上当前 dpr（像素采的就是它自己那一格）', Math.abs(p.css.bw - p.css.w * p.dpr) <= 1,
      `buffer ${p.css.bw} / css ${p.css.w} × dpr ${p.dpr}`);
    if (arg === 'touch') {
      eq('移动覆写在位：innerWidth 读回 390', p.iw, 390);
      eq('移动覆写在位：devicePixelRatio 读回 3', p.dpr, 3);
      ck('窄屏下棋盘仍在视口里', p.rect.l >= 0 && p.rect.w <= p.iw + 1, JSON.stringify({ rect: p.rect, iw: p.iw }));
    }
    if (arg === 'touch' || arg === 'mouse') {
      const circle = p.circles.find((c) => c.clue >= 0);
      eq(`hit box：普通格 ${p.cells[0].i} 的命中元素就是 canvas`, p.cells[0].hit, 'board');
      eq(`hit box：圈格 ${circle.i} 的命中元素也是 canvas`, circle.hit, 'board');

      // 一格里三态连着走：选中→涂黑→铺白→收回未定。每一步既读状态机，也采画布中心那一个像素——
      // "点下去画面真的变了"才是玩家拿到的东西，标志位不是。
      const px0 = await json(PIXEL(p.cells[0].i));
      pix(`未定格 ${p.cells[0].i} 画的就是 --board-bg`, px0, p.vars.bg);
      await mouse(p.cells[0].x, p.cells[0].y);
      await touch(p.cells[0].x, p.cells[0].y);
      let g1 = await json(GAME);
      eq(`${arg} 点击选中并循环了格 ${p.cells[0].i}`, g1.sel, p.cells[0].i);
      eq('第一下从未定循环到黑', g1.marks[p.cells[0].i], 2);
      eq('步数读到 1', g1.moves, 1);
      const px1 = await json(PIXEL(p.cells[0].i));
      pix('真点下去的黑格画的就是 --black-cell', px1, p.vars.black);

      await mouse(p.cells[0].x, p.cells[0].y);
      await touch(p.cells[0].x, p.cells[0].y);
      g1 = await json(GAME);
      eq('第二下循环到白', g1.marks[p.cells[0].i], 1);
      const px2 = await json(PIXEL(p.cells[0].i));
      pix('钉成白的中心画的是 --soft（不是还留着未定的底色）', px2, p.vars.soft);

      await mouse(p.cells[0].x, p.cells[0].y);
      await touch(p.cells[0].x, p.cells[0].y);
      g1 = await json(GAME);
      eq('第三下收回未定', g1.marks[p.cells[0].i], 0);
      const px3 = await json(PIXEL(p.cells[0].i));
      pix('收回之后中心又回到 --board-bg', px3, p.vars.bg);

      // 按钮：真事件按 黑，状态机与画面两边都要读到黑。
      // 动作数一律量"这一下之前/之后各读一次"的差：走位是这条腿自己走的，绝对值等于把我自己的
      // 步伐表写死成期望——改一步就得重算全篇，而差一条都说不清是谁的锅。
      await mouse(p.cells[1].x, p.cells[1].y);
      await touch(p.cells[1].x, p.cells[1].y);
      const mvSel = await json(`window.kurotto.state().g.moves`);
      const bW = p.btns.find((b) => b.id === 'btn-white');
      await mouse(bW.x, bW.y);
      await touch(bW.x, bW.y);
      const dom1 = await json(DOMTXT);
      const stW = await json(`(()=>({v:window.kurotto.mark(${p.cells[1].i}).mark,m:window.kurotto.state().g.moves}))()`);
      eq('按 白 钉住的就是选中格', stW.v, 1);
      eq('白格也算一步', stW.m - mvSel, 1);
      eq('黑格读数没被白格抬高', dom1.black.split('/')[0], '0');
      const bB = p.btns.find((b) => b.id === 'btn-black');
      await mouse(bB.x, bB.y);
      await touch(bB.x, bB.y);
      const stB = await json(`(()=>({v:window.kurotto.mark(${p.cells[1].i}).mark,p:window.kurotto.state().g.marks.filter(m=>m!==0).length,mv:window.kurotto.state().g.moves}))()`);
      eq('按 黑 把同一格改钉成黑', stB.v, 2);
      const pxB = await json(PIXEL(p.cells[1].i));
      pix('按钮点出来的黑格也画得出黑色', pxB, p.vars.black);
      eq('改钉同一格也算一步', stB.mv - stW.m, 1);

      // 圈格改不了：题面是印上去的，不是玩家的一格。
      const beforeCircle = await json(GAME);
      await mouse(circle.x, circle.y);
      await touch(circle.x, circle.y);
      const afterCircle = await json(GAME);
      const domC = await json(DOMTXT);
      eq('圈格点不着：选中格没动', afterCircle.sel, beforeCircle.sel);
      eq('圈格点不着：也没有多算一步', afterCircle.moves, beforeCircle.moves);
      ck('状态行说出了为什么', /圈格.*不能涂/.test(domC.state), domC.state);

      const bC = p.btns.find((b) => b.id === 'btn-clear');
      await mouse(bC.x, bC.y);
      await touch(bC.x, bC.y);
      const stClear = await json(`(()=>({v:window.kurotto.mark(${p.cells[1].i}).mark}))()`);
      eq('按 清 把这一格收回未定', stClear.v, 0);
      const mvU = await json(`window.kurotto.state().g.moves`);
      const bU = p.btns.find((b) => b.id === 'btn-undo');
      await mouse(bU.x, bU.y);
      await touch(bU.x, bU.y);
      const stU = await json(`(()=>({v:window.kurotto.mark(${p.cells[1].i}).mark,m:window.kurotto.state().g.moves}))()`);
      eq('撤销也算一步（动作数只增不减）', stU.m - mvU, 1);
      eq('撤销退回的就是刚才清掉的那一格', stU.v, 2);

      const mvH = await json(`(()=>({pinned:window.kurotto.state().g.marks.filter(m=>m!==0).length,hints:window.kurotto.state().g.hints,mv:window.kurotto.state().g.moves}))()`);
      const bH = p.btns.find((b) => b.id === 'btn-hint');
      await mouse(bH.x, bH.y);
      await touch(bH.x, bH.y);
      const domH = await json(DOMTXT);
      const stH = await json(`(()=>({pinned:window.kurotto.state().g.marks.filter(m=>m!==0).length,hints:window.kurotto.state().g.hints,mv:window.kurotto.state().g.moves}))()`);
      eq('提示按钮按一次给一次', stH.hints - mvH.hints, 1);
      eq('按钮与状态栏的提示计数是同一个数', domH.hintCount, domH.hints);
      ck('提示点名了一条命名规则', /^K\d$/.test(domH.hintRule), domH.hintRule);
      ck('提示不是空话（说了哪一格）', domH.hintLine.length > 8 && /R\d+C\d+=/.test(domH.hintLine), domH.hintLine);
      // "落了一格"看的是动没动：提示完全可能落在玩家已经钉着、但钉反了的那一格上——那一格从黑改白
      // 并不增加已钉数，所以钉数差不是这条承诺的读数，步数差才是。
      const hh = /R(\d+)C(\d+)=(黑|白)/.exec(domH.hintLine);
      const hIdx = hh ? (Number(hh[1]) - 1) * p.n + (Number(hh[2]) - 1) : -1;
      const stCell = await json(`(()=>({v:window.kurotto.mark(${hIdx}).mark}))()`);
      eq('提示按下去真的动了一格（步数 +1）', stH.mv - mvH.mv, 1);
      eq('提示说这一格是什么，画布上这一格就是什么', stCell.v, hh && hh[3] === '黑' ? 2 : 1);
      const pxH = await json(PIXEL(hIdx));
      pix('提示那一格画的是它自己那一色的底', pxH, (hh && hh[3] === '黑' ? p.vars.black : p.vars.soft));

      // 换一局：seed 来自页面自己的随机流，界面印的必须就是这一盘的 seed。
      const sBefore = await json(`(()=>({seed:window.kurotto.state().g.seed}))()`);
      const bn = p.btns.find((b) => b.id === 'btn-new');
      await mouse(bn.x, bn.y);
      await touch(bn.x, bn.y);
      const sAfter = await json(`(()=>({seed:window.kurotto.state().g.seed,n:window.kurotto.state().g.n}))()`);
      const domN = await json(DOMTXT);
      const ymd = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
      ck('换一局换了盘（seed 变了）', sAfter.seed !== sBefore.seed, `${sBefore.seed} -> ${sAfter.seed}`);
      ck('换一局留在同一档', sAfter.n, p.n);
      eq('页面印的 seed 就是这一盘的 seed', domN.seed, `seed ${sAfter.seed}`);
      ck('seed 是随机流给的整数，不是日期、也不是毫秒时间戳',
        Number.isInteger(sAfter.seed) && sAfter.seed >= 1 && sAfter.seed < 0x7fffffff && sAfter.seed !== ymd, String(sAfter.seed));
    }
    if (arg === 'keys') {
      await mouse(p.cells[0].x, p.cells[0].y);
      await touch(p.cells[0].x, p.cells[0].y);
      const act = await json(`(()=>({active:document.activeElement?document.activeElement.id:'null'}))()`);
      eq('焦点钉在棋盘上（先真点了一次）', act.active, 'board');
      const seq = ['b', 'w', '0', 'Backspace', 'Enter', 'ArrowRight', 'ArrowUp', 'h', 'z'];
      // 逐个按键各取一次快照：整段求差只会打印出一个大数，说不清是哪一只键被重复送达。
      const per = [];
      for (const k of seq) {
        const a = await json(`window.kurotto.keyStats()`);
        await key(k);
        const b = await json(`window.kurotto.keyStats()`);
        per.push({ k, seen: b.seen - a.seen, handled: b.handled - a.handled, rep: b.repeated - a.repeated, n: b.by[k] || 0 });
      }
      const dom = await json(DOMTXT);
      const st = await json(`(()=>{const g=window.kurotto.state().g;return {v:g.marks[g.sel],sel:g.sel,n:g.n,moves:g.moves,hints:g.hints,pinned:[...g.marks].filter(m=>m!==0).length}})()`);
      // 仓里 known flake：同一个键盘计数在同样的跑法里读到 0/2/7。所以这里报的是"到达数"，
      // 派发数与实际到达数不等就红，红的那条写着到达数、处理数和自动重复数。
      for (const q of per) eq(`按键 ${q.k} 到达游戏一次`, `${q.seen} seen/${q.handled} handled/${q.rep} repeat/${q.n} total`, `1 seen/1 handled/0 repeat/1 total`);
      const sum = per.reduce((a, q) => a + q.seen, 0);
      eq(`派发了 ${seq.length} 个按键：到达游戏的 keydown 总数`, sum, seq.length);
      // 序列是数得清的：点一格(1) + b(不变) + w(2) + 0(3) + Backspace(不变) + Enter(4) + 方向键(不计数) + h(5) + z(6)
      eq('这一串键走下来的步数读数', dom.moves, '6');
      eq('H 键给了一次提示', dom.hints, '1');
      ck('提示说出了规则名', /^K\d$/.test(dom.hintRule), dom.hintRule);
      ck('提示不是空话', dom.hintLine.length > 8, dom.hintLine);
      // Z 退的是哪一格不用猜：提示文案里就写着 RxCy，逐格对账才叫"撤销退的确实是提示那一格"。
      const hm = /R(\d+)C(\d+)=(黑|白)/.exec(dom.hintLine);
      const hIdx = hm ? (Number(hm[1]) - 1) * st.n + (Number(hm[2]) - 1) : -1;
      ck('提示点名了一格（文案里带着 RxCy=黑|白）', !!hm, dom.hintLine);
      eq('Z 退掉的就是提示点名的那一格（doUndo 的文案不是空话）', st.sel, hIdx);
      ck('退掉之后那一格不再是提示说的值', hIdx >= 0 && st.v !== (hm[3] === '黑' ? 2 : 1), `sel ${st.sel} mark ${st.v} / ${hm && hm[0]}`);
      eq('一路点回来：棋盘上钉着的只剩最初那一下点出来的格', st.pinned, 1);
    }
    if (arg === 'touch') {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId).catch(() => {});
      await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId).catch(() => {});
    }
    out({ leg: arg, cells: p.cells.length, buttons: p.btns.length, n: p.n });
  }
}

main().catch((err) => {
  console.error('ERROR ' + (err.message || err));
  if (rows.length) console.error('RESULT ' + JSON.stringify(result({ crashed: true })));
  else console.error('RESULT ' + JSON.stringify({ rows: [{ test: `${cmd} ${arg || ''} 整条腿跑挂了`, pass: false, detail: String(err.message || err) }], fail: 1, crashed: true }));
  if (logs.length) console.error(logs.slice(-12).join('\n'));
  process.exit(1);
});
