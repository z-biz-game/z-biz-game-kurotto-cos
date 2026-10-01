// Browser-side scenario suite，由 tools/playtest.cjs 注入真实页面后执行。
//
// 这里立的规矩：断言读的是 DOM 文本、几何、画布像素，不是内部标志位。状态字符串只说明代码
// 想干什么，client rect 和一个像素才说明玩家拿到了什么。这一族游戏最容易出的错恰恰是
// "状态对但画面错"：钉成白和还没想长得一样、圈格被画成了普通黑格。
//
// 真事件（鼠标/触屏/键盘）不在这份文件里：那三条腿由 playtest.cjs 的 `leg` 命令用 CDP
// Input.dispatch* 驱动。这里写格子走的是 kurotto.paint，也就是点击落进的同一个状态机。
//
// window.kurotto.engine 就是出货的那份模块图：在这条腿里通过的求解器，就是玩家提示引用的那一个。
//
// ck(name, cond, detail) 是真假；eq(name, got, want) 是字符串相等；eqd 同 eq 但带上诊断读数。
// 所有"必须等于"都走 eq，因为 ck('剩余 0 格', 0) 在人眼里像失败、在布尔里是成功。
// 每一条红都会点名打印，所以红字不是一句 undefined。

((w) => {
  const rows = [];
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
  const eqd = (test, got, want, detail) => ck(test, String(got) === String(want), `got ${got} / want ${want} · ${detail}`);
  const report = (extra) => {
    // 阴性自证：GATE_SELFTEST=1 时每份报告多一条注定错的期望。没有这一段，"闸全绿"这句话
    // 没有任何东西撑着——写过却从没能红的闸，和坏掉的闸长得一模一样。
    if (w.__selftest) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return out;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 崩掉不算"红"，崩掉必须被点名叫出来：坏档那条腿要读这个收集器。
  const bootErrors = [];
  w.addEventListener('error', (e) => bootErrors.push(String(e.message || e)));

  const K = () => w.kurotto;
  const ENG = () => w.kurotto.engine;
  const texts = () => K().texts();
  const $ = (s) => document.querySelector(s);
  const txt = (s) => (($ (s) || {}).textContent || '');
  const shown = (s) => {
    const e = $(s);
    return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hash = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h.toString(16);
  };
  const cluesKey = (cell) => Array.from(cell).join(',');
  const blackKey = (black) => Array.from(black).join('');
  const marksKey = (m) => Array.from(m).join('');
  // 证人里的哈希由页面自己算：node 侧那条 `witness` 命令调的就是这两个函数。两处各写一遍哈希的话，
  // 续局腿比的就是两个哈希函数而不是两张盘面。
  w.__ngHash = { clues: (cell) => hash(cluesKey(cell)), marks: (m) => hash(marksKey(m)) };

  async function begin(n, seed) {
    K().start(n, seed);
    for (let i = 0; i < 400 && !(K().state() && !K().view().gameHidden); i++) await wait(20);
    await wait(30);
    return K().state().g;
  }
  // 只从题面推导（铅笔那条路），不读 g.answer：页面认输要认的是"这一盘真的合法"，
  // 不是"和生成器记下的那份一样"。
  const derive = (g) => ENG().pencil.solve({ n: g.n, cell: g.cell });
  const nonCircles = (g) => [...g.cell.keys()].filter((i) => !ENG().rules.isCircle(g.cell[i]));

  // ---------- 像素：格心采一个点，颜色要和 CSS 变量对得上 ----------
  function peek(x, y) {
    const canvas = K().view().canvas;
    const dpr = Math.max(1, w.devicePixelRatio || 1);
    const box = canvas.getBoundingClientRect();
    const d = canvas.getContext('2d').getImageData(Math.round((x - box.left) * dpr), Math.round((y - box.top) * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  const centerPixel = (i) => { const c = K().center(i); return peek(c.x, c.y); };
  // 违反的圈描的是内缩 2px 的一圈红边，不是填充：采上边中点（内缩 2px）正落在那条线上。
  const edgePixel = (i) => { const c = K().center(i); return peek(c.x, c.y - c.cell / 2 + 2); };
  const hex = (v) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(v);
    if (!m) return null;
    const x = parseInt(m[1], 16);
    return { r: x >> 16 & 255, g: x >> 8 & 255, b: x & 255 };
  };
  const L1 = (p, c) => (c ? Math.abs(p[0] - c.r) + Math.abs(p[1] - c.g) + Math.abs(p[2] - c.b) : 1e9);
  // 环内有没有"印着字"：数字写在圈心一带，空圈环内什么都没有。环本身在 0.29 格外，采不到。
  function inkInside(i) {
    const c = K().center(i), ink = hex(cssVar('--ink'));
    let hits = 0;
    for (const o of [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15]) if (L1(peek(c.x + c.cell * o, c.y), ink) <= 120) hits++;
    return hits;
  }

  // ---------- engine：页面里的引擎与 node 侧是同一份、同一张盘 ----------
  async function engine() {
    const R = ENG().rules, P = ENG().pencil, EX = ENG().example;
    eq('引擎常量与规则表都对得上', [R.FREE, R.EMPTY, R.UNK, R.WHITE, R.BLACK, R.NODE_CAP].join('|'), '-2|-1|0|1|2|2000000');
    eq('命名规则一共 6 条', P.RULES.length, 6);
    ck('规则都叫得出名字（K 加序号加短语）', P.RULES.every((x) => /^K\d_.{2,6}$/.test(x)), P.RULES.join(' '));

    const B = R.makeBoard(EX.EX_N, EX.EX_CLUES);
    const exBlack = new Uint8Array(EX.EX_N * EX.EX_N);
    for (const [r, c] of EX.EX_BLACK) exBlack[r * EX.EX_N + c] = 1;
    eq('官方例题的解答在 R4 下合法', R.violations(B, exBlack).length, 0);
    const dumb = R.countSolutionsDumb(B);
    eq('官方例题空位数 10（4×4 去掉 6 个圈格）', EX.EX_N * EX.EX_N - EX.EX_CLUES.length, 10);
    eq('官方例题 2^10 傻跑恰好 1 解', dumb.count, 1);
    const dfs = R.countSolutions(B);
    eq('DFS 计数器与傻跑版同解数', dfs.count, dumb.count);
    ck('官方例题唯一性证完（没撞节点预算）', dfs.count === 1 && !dfs.stopped, `${dfs.nodes} 节点 · ${dfs.ms}ms`);
    const pa = P.solve(B);
    ck('官方例题铅笔 0 猜推满', pa.solved && !pa.conflict, pa.conflict || `undetermined ${pa.undetermined.length}`);
    let diff = 0;
    for (let i = 0; i < pa.asg.length; i++) if ((pa.asg[i] === R.BLACK ? 1 : 0) !== exBlack[i]) diff++;
    eq('两条路在官方例题上逐格会合（diff 0）', diff, 0);
    ck('例题上开过火的规则不少于 4 条', Object.values(pa.fired).filter((v) => v > 0).length >= 4, JSON.stringify(pa.fired));

    // 跨引擎的盘：node 侧用同一个 seed 量到的盘面哈希写死在这里（复跑见 _tmp-kurotto-goldens.mjs）。
    // 浏览器画的必须是同一张——两台引擎各画各的，页面里印的 seed 就成了装饰。
    for (const [n, wantClues, wantBlack] of [[6, 'f3f7daeb', 'e91ffee0'], [8, '9768653d', '25515005'], [10, '3d8c4188', '2fe3f17f']]) {
      const pz = ENG().generate.puzzleFromSeed(n, 4242);
      ck(`${n}×${n} seed 4242 在浏览器里出了盘`, !pz.fail, String(pz.fail || ''));
      eq(`${n}×${n} seed 4242 的题面与 node 侧同一张盘`, hash(cluesKey(pz.B.cell)), wantClues);
      eq(`${n}×${n} seed 4242 的解答与 node 侧同一张盘`, hash(blackKey(pz.black)), wantBlack);
    }

    // 部署出去的字节也得保持两条路分家：这一条读的是当前 URL 形态下的真文件。
    const res = await fetch(new URL('js/engine/pencil.js', document.baseURI).href);
    const src = await res.text();
    ck('页面取回的 pencil.js 里没有 import 计数器那条路', !/from ['"][^'"]*rules\.js/.test(src) && !/countSolutions/.test(src),
      `${res.status} ${src.length}B`);
    return { scenario: 'engine', rules: P.RULES.length, exampleNodes: dfs.nodes };
  }

  // ---------- gen：出题器在页面里出的每张盘都要过两条判据 ----------
  async function gen() {
    const R = ENG().rules, T = K().TIERS;
    eq('菜单是五档 6/7/8/9/10', T.map((t) => t.n).join(','), '6,7,8,9,10');
    const perTier = [];
    for (const t of T) {
      let shipped = 0, provedUnique = 0, filledByPencil = 0, met = 0, dug = 0, worstNodes = 0;
      const detail = [];
      for (let s = 0; s < 3; s++) {
        const seed = 7100 + s * 311 + t.n;
        const pz = ENG().generate.puzzleFromSeed(t.n, seed, { pBlack: t.pBlack });
        if (pz.fail) { detail.push(`${seed}:FAIL`); continue; }
        shipped++;
        worstNodes = Math.max(worstNodes, pz.maxNodes);
        const c = R.countSolutions({ n: pz.B.n, cell: Int16Array.from(pz.B.cell) });
        if (c.count === 1 && !c.stopped) provedUnique++;
        const pa = ENG().pencil.solve(pz.B);
        if (pa.solved && !pa.conflict) filledByPencil++;
        let d = 0;
        for (let i = 0; i < pa.asg.length; i++) if ((pa.asg[i] === R.BLACK ? 1 : 0) !== pz.black[i]) d++;
        if (d === 0) met++;
        // "挖开了线索"三条一起看：圈密度落到盘面四成半以下、每盘挖线索的节点预算没掐过它、
        // 且确实比"每个白格都挂数字"那份薄。被预算掐住只会出一张厚线索盘，那是另一件事，红字要分得清。
        const undug = t.n * t.n - [...pz.black].reduce((a, b) => a + b, 0);
        if (pz.clues <= 0.45 * t.n * t.n && pz.digStopped === 0 && pz.clues < undug) dug++;
        detail.push(`${seed}:${pz.clues}/${undug}${pz.digStopped ? '(掐)' : ''}`);
      }
      perTier.push({ n: t.n, shipped, provedUnique, filledByPencil, met, dug, worstNodes, detail: detail.join(' ') });
      eq(`${t.label} 三张都出货`, shipped, 3);
      eq(`${t.label} 三张的唯一性都在节点预算内证完`, provedUnique, 3);
      eq(`${t.label} 三张都能用命名规则 0 猜推满`, filledByPencil, 3);
      eq(`${t.label} 三张的铅笔结论与计数器结论逐格相同`, met, 3);
      eqd(`${t.label} 三张都挖开了线索（密度 ≤45% · 没被预算掐 · 比满线索薄）`, dug, 3, detail.join(' '));
      ck(`${t.label} 出货盘的节点用量远低于承诺预算`, worstNodes < R.NODE_CAP, `max ${worstNodes}`);
    }
    // 请出菜单的档位要把理由印在选档页上，不是只写在代码注释里。
    const excluded = texts().excluded;
    ck('选档页印出了 12×12 不在菜单里的理由', /12×12 不在菜单里/.test(excluded), excluded.slice(0, 60));
    ck('选档页印出了 14×14 不在菜单里的理由', /14×14 不在菜单里/.test(excluded), excluded.slice(0, 60));
    ck('排除理由带实测读数（不是"暂未开放"这种空话）', /\d+(\.\d+)?(ms|%|盘)/.test(excluded), excluded.slice(0, 90));
    eq('菜单五档在页面上有五个按钮', document.querySelectorAll('#tier-list .tier').length, 5);
    eq('每一档都把自己实测的链长印在按钮上', document.querySelectorAll('#tier-list .tier .tier-meta').length, 5);
    return { scenario: 'gen', perTier };
  }

  // ---------- play：页面读数与状态机一致 ----------
  async function play() {
    const R = ENG().rules;
    const g = await begin(7, 5000);
    const plain = nonCircles(g);
    const circles = [...g.cell.keys()].filter((i) => R.isCircle(g.cell[i]));
    const total = K().G.blackTotal(g);
    eq('页面开的是 seed 5000 那张盘（题面哈希与 node 侧相同）', hash(cluesKey(g.cell)), '3ff80f8a');
    eq('标题写着尺寸', texts().name, 'クロット 7×7');
    eq('7×7 的档位名是「中」', texts().tier, '中');
    eq('seed 印在牌头上', texts().seed, 'seed 5000');
    eq('未定格数 = 非圈格数', texts().remaining, plain.length);
    eq('开局黑格读数 0/答案总数', texts().black, `0/${total}`);
    eq('开局步数 0', texts().moves, '0');
    eq('开局提示 0', texts().hints, '0');
    eq('难度实测显示的是推理链长', texts().score, `${g.rounds} 轮`);
    ck('出题耗时印在页面上', /^\d+ ms$/.test(texts().genms), texts().genms);
    ck('状态行说了圈的结构（数字圈 + 空圈）', /\d+ 个数字 \+ \d+ 个空圈/.test(texts().state), texts().state);

    K().paint(plain[0], R.BLACK);
    eq('钉一个黑格之后步数读到 1', texts().moves, '1');
    eq('黑格读数跟着走', texts().black, `1/${total}`);
    eq('未定少了一格', texts().remaining, plain.length - 1);
    K().paint(plain[1], R.WHITE);
    eq('钉一个白格也算一步', texts().moves, '2');
    eq('白格不增加黑格数', texts().black, `1/${total}`);
    eq('白格也占掉一个未定格', texts().remaining, plain.length - 2);
    K().paint(plain[1], R.WHITE);
    eq('同一格钉同一个值不算动作', texts().moves, '2');

    K().paint(circles[0], R.BLACK);
    eq('圈格点不动：黑格数没变', texts().black, `1/${total}`);
    ck('状态行说出了圈格为什么不能涂', /圈格.*不能涂/.test(texts().state), texts().state);
    eq('圈格点不动也不计步', texts().moves, '2');

    for (const i of plain) K().paint(i, R.BLACK);
    eq('整盘涂黑的步数 = 前面 2 步 + 真的改了格的那些', texts().moves, plain.length + 1);
    eq('整盘涂黑之后没有未定格', texts().remaining, 0);
    eq('整盘涂黑的黑格数 = 非圈格数', texts().black, `${plain.length}/${total}`);
    ck('整盘涂黑一定违反条款（计数器会点名）', Number(texts().conflicts) > 0, `违反 ${texts().conflicts} 条`);
    ck('状态行说的是违反而不是"完成"', /账不对/.test(texts().state), texts().state);
    eq('铺满但错的时候不认输', shown('#win-veil'), 'false');

    K().undo();
    eq('撤销也算一步（动作数只增不减）', texts().moves, plain.length + 2);
    eq('撤销退掉最后一格', texts().remaining, 1);
    eq('退回来的那一格是未定', K().mark(plain[plain.length - 1]).mark, R.UNK);
    K().menu();
    return { scenario: 'play', n: 7, circles: circles.length, plain: plain.length, total };
  }

  // ---------- hint：提示只能说得出线索推得出的那一格 ----------
  async function hint() {
    const R = ENG().rules;
    const g = await begin(7, 5000);
    const plain = nonCircles(g);
    const want = derive(g);
    ck('题面自己能被铅笔推满（提示的前提）', want.solved && !want.conflict, String(want.conflict));
    K().hint();
    const rule = texts().hintRule;
    ck('提示点名了一条命名规则（编号能在规则表里找到）', /^K\d$/.test(rule) && K().RULES.some((x) => x.startsWith(rule + '_')), rule);
    ck('提示不是空话', (texts().hintLine || '').length > 8, texts().hintLine);
    ck('提示行里写了那一格的坐标', /R\d+C\d+=/.test(texts().hintLine), texts().hintLine);
    eq('提示计数 1', texts().hints, '1');
    eq('按钮上的提示计数与状态栏同步', txt('#hint-count'), texts().hints);
    const st = K().state().g;
    const painted = [...st.marks.keys()].filter((i) => st.marks[i] !== R.UNK);
    eqd('提示按一次就落一格', painted.length, 1, `第 ${painted.join(',')} 格`);
    const i0 = painted[0];
    eq('提示落的正是铅笔推导里的那一格', st.marks[i0], want.asg[i0]);
    ck('提示没有落在圈格上', !R.isCircle(st.cell[i0]), i0);

    K().hint();
    eq('第二次提示再落一格', K().state().g.marks.filter((m) => m !== 0).length, 2);
    eq('提示计数 2', texts().hints, '2');
    K().undo();
    eq('撤销退掉第二次提示那一格', K().state().g.marks.filter((m) => m !== 0).length, 1);
    eq('提示次数是账，不因撤销退档', texts().hints, '2');

    // 一路按提示能不能赢：赢得靠页面自己的判据，不是靠生成器那份答案。
    let guard = 0;
    while (!K().G.isSolved(K().state().g) && guard++ < 400) K().hint();
    ck('只用提示也能推到判据成立', K().G.isSolved(K().state().g), `按了 ${guard} 次`);
    const used = K().state().g.hints;
    // 2 次 + 退回来那一格要重按 = 非圈格数 + 1；每一次按下去都必须真的落一格。
    eqd('提示次数 = 非圈格数 + 撤销逼回来的那一格', used, plain.length + 1, `非圈格 ${plain.length} · 按了 ${guard} 次`);
    eq('只用提示推到判据成立之后页面认输', shown('#win-veil'), 'true');
    return { scenario: 'hint', rule, hints: used, plain: plain.length };
  }

  // ---------- win：判据三条件与纪录排序 ----------
  async function win() {
    const R = ENG().rules, S = ENG().store;
    const g = await begin(8, 60606);
    const plain = nonCircles(g);
    for (const i of plain) K().paint(i, R.BLACK);
    eq('铺满但答案是错的：页面不认输', shown('#win-veil'), 'false');
    ck('铺满但错的时候违反数不为 0', Number(texts().conflicts) > 0, texts().conflicts);
    eq('错盘上"未定"确实是 0（不是靠没填完躲过去的）', texts().remaining, 0);

    for (const i of plain) K().paint(i, R.UNK);
    eq('清回去之后未定数复原', texts().remaining, plain.length);
    const want = derive(g);
    ck('拿题面推得出一整盘（不读答案）', want.solved && !want.conflict, String(want.conflict));
    for (let i = 0; i < want.asg.length; i++) {
      if (R.isCircle(g.cell[i])) continue;
      K().paint(i, want.asg[i] === R.BLACK ? R.BLACK : R.WHITE);
    }
    eq('推对了页面就认输', shown('#win-veil'), 'true');
    eq('违反数归零', texts().conflicts, 0);
    const meta = txt('#win-meta');
    ck('胜利文案报了尺寸与 seed', /8×8 · seed 60606/.test(meta), meta);
    ck('胜利文案报了用时/步数/提示数', /\d{2}:\d{2} · \d+ 步 · \d+ 次提示/.test(meta), meta);
    ck('胜利文案报了实测链长', meta.includes(`推理链长 ${g.rounds} 轮`), meta);
    ck('状态行说出的是判据而不是"恭喜"', /判据核对：.*账都对上了 · 唯一解/.test(texts().state), texts().state);
    ck('纪录行有点名', txt('#win-record').length > 0, txt('#win-record'));

    const payload = JSON.parse(localStorage.getItem(K().save.save) || '{}');
    ck('存档里没有答案（续局不能靠抄盘）', !('answer' in payload) && !('black' in payload), Object.keys(payload).join(','));
    eq('存档的 marks 长度是 n²', payload.marks.length, 64);
    ck('marks 只有 0/1/2 三态', payload.marks.every((m) => [0, 1, 2].includes(m)), JSON.stringify(payload.marks.slice(0, 8)));

    // 同档纪录的排序：先比提示次数，再比步数，最后比用时。
    S.clearRecords();
    S.recordResult({ tier: 8, n: 8, seed: 101, hints: 1, moves: 2, ms: 1000, rounds: 9 });
    eq('提示少的排第一（哪怕步数与用时都更差）', S.recordResult({ tier: 8, n: 8, seed: 102, hints: 0, moves: 99, ms: 9000, rounds: 9 }).rank, 1);
    eq('提示与步数打平时才轮到比用时', S.recordResult({ tier: 8, n: 8, seed: 103, hints: 0, moves: 99, ms: 500, rounds: 9 }).rank, 1);
    // 四条纪录把三步比较各钉一次：103/102 同提示同步数，只比得出用时；104 用时最漂亮但步数更多，
    // 必须排在两条 99 步之后（第 3 名），却仍在"用过一次提示"的 101 前面。
    eq('用时最漂亮也越不过步数更多的纪录', S.recordResult({ tier: 8, n: 8, seed: 104, hints: 0, moves: 200, ms: 100, rounds: 9 }).rank, 3);
    eq('纪录按提示→步数→用时一路排到底', S.loadRecords()[8].map((x) => x.seed).join(','), '103,102,104,101');
    S.clearRecords();
    K().menu();
    eq('回选档后纪录行重新数过（清空了就没有第一名）', document.querySelectorAll('#record-list .rec-val').length, 0);
    return { scenario: 'win', plain: plain.length };
  }

  // ---------- layout：三态必须看得出来是三种，而且两种主题都要对 ----------
  async function layout() {
    const R = ENG().rules;
    K().menu();
    await wait(60);
    const g = await begin(8, 70707);
    const plain = nonCircles(g);
    const numCircles = [...g.cell.keys()].filter((i) => R.isNum(g.cell[i]));
    const emptyCircles = [...g.cell.keys()].filter((i) => g.cell[i] === R.EMPTY);
    K().paint(plain[0], R.BLACK);
    K().paint(plain[1], R.WHITE);

    const trio = () => [
      { name: '黑', px: centerPixel(plain[0]), v: cssVar('--black-cell') },
      { name: '白', px: centerPixel(plain[1]), v: cssVar('--soft') },
      { name: '未定', px: centerPixel(plain[2]), v: cssVar('--board-bg') },
    ];
    const themeOf = () => document.documentElement.dataset.theme;
    const themeAtStart = themeOf();
    const seenThemes = [themeAtStart];
    for (const pass of ['开机主题', '切换之后的主题']) {
      const t = trio();
      for (const row of t) ck(`${pass}（${themeOf()}）：${row.name}格画的就是它自己的 CSS 变量`, L1(row.px, hex(row.v)) <= 12, `${row.px} vs ${row.v}`);
      const d = (a, b) => L1(a.px, hex(b.v));
      ck(`${pass}：三态两两看得出来不一样`, d(t[0], t[1]) > 60 && d(t[0], t[2]) > 60 && d(t[1], t[2]) > 60,
        `黑白 ${d(t[0], t[1])} · 黑未定 ${d(t[0], t[2])} · 白未定 ${d(t[1], t[2])}`);
      document.getElementById('btn-theme').click();
      await wait(80);
      seenThemes.push(themeOf());
    }
    eq('两次切换回到了开机那个主题（主题开关不是单向的）', seenThemes[0], seenThemes[2]);
    const vars = { bg: cssVar('--board-bg'), black: cssVar('--black-cell'), soft: cssVar('--soft'), ink: cssVar('--ink'), bad: cssVar('--bad') };
    eq('三态底色是三个不同的值', [vars.bg, vars.black, vars.soft].filter((v, i, a) => a.indexOf(v) === i).length, 3);

    eq('画布不出 900×900 视口', K().view().canvas.getBoundingClientRect().width <= w.innerWidth, 'true');
    const cell = K().center(0).cell;
    ck('8×8 的格子不小于目标 44px', cell >= 44, `${cell.toFixed(1)}px`);
    // 画布不许自己量自己：多重绘一次格宽必须还是同一个数。inline-block 的 #board-wrap 宽度就是
    // 画布宽度，拿它当尺子的话每画一次涨一点（实测病征：42.0px）。
    K().paint(plain[3], R.BLACK);
    const cell2 = K().center(0).cell;
    eq('再画一次格子宽度不变（尺子不是画布自己）', cell2.toFixed(2), cell.toFixed(2));
    let miss = 0;
    for (const i of [...Array(64).keys()]) if (K().hitAt(K().center(i).x, K().center(i).y) !== i) miss++;
    eq('64 格中心都命中自己（cellAt 与 cellCenter 同一个映射）', miss, 0);

    // 圈格采的不是正中心：数字就印在那一点上，采到的是墨色（浅色主题下离黑底只差 4/2/2，
    // 于是"没涂黑"这条会读成"涂黑了"）。环内、字外那一带（横向 0.2 格）才只可能是底色。
    const c0 = K().center(numCircles[0]);
    const cp = peek(c0.x + c0.cell * 0.2, c0.y);
    ck(`圈格 ${numCircles[0]} 环内字外画的就是未涂的底色 --board-bg`, L1(cp, hex(vars.bg)) <= 12, `${cp} vs ${vars.bg}`);
    ck('圈格不会被涂黑：那一点离 --black-cell 足够远', L1(cp, hex(vars.black)) > 40, `${cp} vs ${vars.black}`);
    const inkNum = inkInside(numCircles[0]);
    ck('数字圈环内印着字', inkNum >= 1, `格 ${numCircles[0]} 写着 ${g.cell[numCircles[0]]}，环内只采到 ${inkNum} 点墨`);
    if (emptyCircles.length) {
      const inkEmpty = inkInside(emptyCircles[0]);
      eq('空圈环内没有字（只有环）', inkEmpty, 0);
    } else ck('这一盘得有空白圈可对照（否则上一条是空跑）', false, 'numCircles 里没有空圈');

    for (const i of plain) K().paint(i, R.BLACK);
    const bad = K().G.conflicts(g);
    ck('整盘涂黑之后有违反的圈可画', bad.size > 0, `违反 ${bad.size} 格`);
    if (bad.size) {
      const bi = [...bad][0];
      const p = edgePixel(bi);
      ck('违反条款的圈描了 --bad 那一色的边', L1(p, hex(vars.bad)) <= 90, `圈 ${bi} 边上 ${p} vs ${vars.bad}`);
      ck('状态行点名了违反的圈位', /个圈的账不对：R\d+C\d+/.test(texts().state), texts().state);
    }
    const btns = ['btn-black', 'btn-white', 'btn-clear', 'btn-hint', 'btn-undo', 'btn-new'].map((id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { id, h: Math.round(b.height) };
    });
    ck('控件都够点（>=34px 高）', btns.every((b) => b.h >= 34), JSON.stringify(btns.map((b) => b.h)));
    eq('图例有 6 条', document.querySelectorAll('.legend .sw').length, 6);
    eq('图例色块各有各的 class', new Set([...document.querySelectorAll('.legend .sw')].map((e) => e.className)).size, 6,
      [...document.querySelectorAll('.legend .sw')].map((e) => e.className).join('|'));
    ck('键位提示写了 B/W/H/Z', /B.*W.*H.*Z/.test(txt('.keyhint')), txt('.keyhint'));
    eq('棋盘的无障碍名字写着这一档的尺寸', K().view().canvas.getAttribute('aria-label'), 'クロット棋盘 8×8：点一格在未定、黑、白之间循环');
    K().menu();
    return { scenario: 'layout', cellPx: Math.round(cell), vars, themeAtStart, numCircles: numCircles.length, emptyCircles: emptyCircles.length };
  }

  // ---------- save：存档存的是题面与进度，不是答案 ----------
  async function save() {
    const R = ENG().rules, S = ENG().store;
    K().menu();
    S.wipeAll();
    const g = await begin(7, 4242);
    const plain = nonCircles(g);
    eq('存档键名在页面上可读', K().save.save, 'kurotto.save');
    eq('三把键都带 kurotto 前缀', Object.values(K().save).every((k) => /^kurotto\./.test(k)), 'true');
    K().paint(plain[0], R.BLACK);
    K().paint(plain[1], R.WHITE);
    K().hint();
    await wait(420);
    // "结算到哪一刻"要靠下一次动作写进去的档来读：整局不结算的话，玩到一半关掉的档存的是 0。
    K().paint(plain[0], R.BLACK);
    const raw = localStorage.getItem(K().save.save);
    ck('localStorage 里真的有这一档', !!raw, String(raw).slice(0, 40));
    const p = JSON.parse(raw || '{}');
    ck('存档不带答案', !('answer' in p) && !('black' in p), Object.keys(p).join(','));
    eq('存档记下尺寸', p.n, 7);
    eq('存档记下 seed', p.seed, 4242);
    eq('存档记下档位', p.tier, 7);
    eq('cell 与 marks 都是 n² 长', [p.cell.length, p.marks.length].join(','), '49,49');
    ck('cell 里留着题面（数字圈与空圈都在）', p.cell.some((v) => v < 0) && p.cell.some((v) => v >= 0), JSON.stringify(p.cell.slice(0, 6)));
    eq('存档里的 marks 与现场逐格相同', hash(marksKey(p.marks)), hash(marksKey(g.marks)));
    eq('存档里的题面与现场逐格相同', hash(cluesKey(p.cell)), hash(cluesKey(g.cell)));
    ck('计时按"到目前为止"结算（不是等回选档才写）', p.elapsed >= 400, `${p.elapsed}ms`);
    eq('提示次数进了存档', p.hints, 1);
    eq('步数进了存档', p.moves, g.moves);

    K().menu();
    await wait(60);
    eq('回选档后出现续局卡', shown('#resume-card'), 'true');
    const pinned = p.marks.filter((m) => m !== 0).length;
    eq('续局卡点名了已钉格数、seed 与提示次数', txt('#resume-meta'), `${pinned} 格已钉 · seed 4242 · 提示 1 次`);

    const before = { seed: K().state().g.seed, clues: hash(cluesKey(K().state().g.cell)) };
    document.getElementById('btn-new').click();
    await wait(250);
    const after = K().state().g;
    ck('换一局真的换了盘（题面哈希变了）', hash(cluesKey(after.cell)) !== before.clues, `${before.seed} -> ${after.seed}`);
    eq('牌头上印的 seed 就是这一盘的 seed（界面不说谎）', texts().seed, `seed ${after.seed}`);
    ck('换一局的 seed 是状态机给的整数，不是日期串', Number.isInteger(after.seed) && after.seed >= 1 && String(after.seed).length <= 10,
      String(after.seed));
    K().menu();
    await wait(60);
    eq('换出来的新的一局也进了档', shown('#resume-card'), 'true');
    document.getElementById('btn-reset').click();
    await wait(60);
    eq('清空存档后续局卡消失', shown('#resume-card'), 'false');
    eq('清空存档后 localStorage 里没有 kurotto 键', Object.keys(localStorage).filter((k) => /^kurotto\./.test(k)).join(','), '');
    return { scenario: 'save', elapsed: p.elapsed, pinned, seedBefore: before.seed, seedAfter: after.seed };
  }

  // ---------- resume：证人由 node 在派发导航之前取走 ----------
  async function resume() {
    const wit = w.__witness;
    ck('拿到 node 侧的证人（派发导航之前抄的）', !!wit && !wit.err, JSON.stringify(wit));
    if (!wit || wit.err) return { scenario: 'resume', witness: wit || null };
    eq('开机停在选档页（没有自动摆一盘）', shown('#view-menu'), 'true');
    eq('续局卡出现在这一档', shown('#resume-card'), 'true');
    document.getElementById('btn-resume').click();
    await wait(220);
    const g = K().state().g;
    ck('拿到的一定是新文档（文档令牌与证人不同）', K().doc !== wit.doc, `${wit.doc} -> ${K().doc}`);
    ck('timeOrigin 也换了', performance.timeOrigin !== wit.timeOrigin, `${wit.timeOrigin} -> ${performance.timeOrigin}`);
    ck('旧文档上的哨兵不在新文档里', typeof w.__gateSentinel === 'undefined', String(w.__gateSentinel));
    eq('续的是同一个 seed', g.seed, wit.seed);
    eq('续的是同一个尺寸', g.n, wit.n);
    eq('盘面题面与证人逐格相同', hash(cluesKey(g.cell)), wit.cluesHash);
    eq('玩家钉过的格子一格没丢', hash(marksKey(g.marks)), wit.marksHash);
    eq('步数接上了', texts().moves, wit.moves);
    eq('提示次数接上了', texts().hints, wit.hints);
    eq('恢复出来的牌局里没有答案', String(g.answer), 'null');
    const t = texts().time;
    const secs = Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]);
    ck('计时从存档接着走（没有从 00:00 重来）', secs >= Math.floor(wit.storedMs / 1000), `${t} vs 存档 ${wit.storedMs}ms`);
    await wait(1100);
    const t2 = texts().time;
    const s2 = Number(t2.split(':')[0]) * 60 + Number(t2.split(':')[1]);
    ck('续上之后秒表还在走（不是钉死在存档值）', s2 > secs, `${t} -> ${t2}`);
    return { scenario: 'resume', witness: { seed: wit.seed, storedMs: wit.storedMs }, time: t, timeAfter: t2 };
  }

  // ---------- corrupt：坏档要当"没有档"，且不能把页面带崩 ----------
  async function corrupt() {
    const FREE = ENG().rules.FREE, S = ENG().store, KEY = K().save.save;
    const raw = localStorage.getItem(KEY);
    ck('种下的坏 payload 还在（页面没有偷偷写回合法档覆写它）', /__kt_garbage__/.test(String(raw)), String(raw).slice(0, 80));
    eq('loadSave 把这个 payload 判成没有档', String(S.loadSave()), 'null');
    eq('开机停在选档页', shown('#view-menu'), 'true');
    eq('续局卡没有出现', shown('#resume-card'), 'false');
    eq('加载期没有未捕获错误', bootErrors.length, 0);
    eq('坏档没把菜单改小', document.querySelectorAll('#tier-list .tier').length, 5);
    eq('坏档之后规则表还是 6 条', K().RULES.length, 6);

    const flavors = [
      ['不是 JSON', '{not json at all'],
      ['是个数组', '[1,2,3]'],
      ['长度对不上', JSON.stringify({ v: 1, n: 7, tier: 7, seed: 1, cell: [1, 2, 3], marks: [0, 0, 0] })],
      ['字段类型不对', JSON.stringify({ v: 1, n: 'slant', tier: 7, seed: 1, cell: new Array(49).fill(0), marks: new Array(49).fill(0) })],
      ['seed 不是数', JSON.stringify({ v: 1, n: 7, tier: 7, seed: '20261001', cell: new Array(49).fill(0), marks: new Array(49).fill(0) })],
      ['尺寸与格数差一', JSON.stringify({ v: 1, n: 7, tier: 7, seed: 1, cell: new Array(48).fill(0), marks: new Array(49).fill(0) })],
    ];
    for (const [name, payload] of flavors) {
      localStorage.setItem(KEY, payload);
      eq(`${name} 的档被判成没有档`, String(S.loadSave()), 'null');
    }
    // 对照：一份形状正确的档必须被认下来。少了这一条，上面六条"全判 null"可能只是 loadSave 一直返回 null。
    localStorage.setItem(KEY, JSON.stringify({ v: 1, n: 7, tier: 7, seed: 3, cell: new Array(49).fill(FREE), marks: new Array(49).fill(0) }));
    const good = S.loadSave();
    eq('形状正确的档会被认下来（六条"判成 null"不是空跑）', good && good.seed, 3);
    localStorage.removeItem(KEY);
    eq('清掉坏档之后 loadSave 也说没有档', String(S.loadSave()), 'null');
    eq('处理坏档全程没有未捕获错误', bootErrors.length, 0);
    S.wipeAll();
    return { scenario: 'corrupt', flavors: flavors.length, bootErrors: bootErrors.length };
  }

  w.__ng = { engine, gen, play, hint, win, layout, save, resume, corrupt };
  // 每个 scenario 都要经 report() 收尾：rows 攒在这里，report 复制一份再清空。
  w.__ngWrap = async (name) => report(await w.__ng[name]());
})(window);
