// 文档是被断言的面：README / DESIGN 里印出去的每一个「现值」都必须等于代码或脚本里的现在值。
//
// 为什么要有这个文件：引擎断言、实测读数、浏览器里的文案都有命令去复测，而一段散文没有。它可以一直
// 抄下去，直到某天代码改了字、文档还在引用上一个世界的数。本仓已经抓到过一起：`DESIGN.md §1` 那张
// 裁断表里 R3 在 `(1,1)` 抄成了 `1`，官方例题上的真值是 `0`——两个黑邻格隔着一整格，成不了对。
//
// 规矩（和 tools/balance.mjs 的 B5/B6 一样）：
//   * 每一条等式都配一条「解析到的条数」的反空转断言——正则没命中不是绿，是红；
//   * 只比现值，不复测读数：ms、出货率、节点数这类本机测量在这里只作为「文档写的数与代码里的界」
//     的关系出现（D5c），这里不去重跑它们（重跑归 balance，逐张复算归 engine-test）；
//   * 文档改形状（表格列、句子措辞、引用格式）不算通过的理由：解析不到就是红。
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS, EXCLUDED_TIERS, BUDGET } from '../js/engine/generate.js';
import { RULES } from '../js/engine/pencil.js';
import { READINGS } from '../js/engine/readings.js';
import { makeBoard, isNum, isCircle, FREE, EMPTY, NODE_CAP } from '../js/engine/rules.js';
import { EX_N, EX_CLUES, EX_BLACK } from '../js/engine/example.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
const emitted = new Set();
let rows = 0;
const ok = (cond, label, detail) => {
  rows++;
  emitted.add(label.match(/^D\d+/)[0]);
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

const README = read('README.md');
const DESIGN = read('DESIGN.md');
const DOCS = README + '\n' + DESIGN;
const CI = read('.github/workflows/ci.yml');
const BAL = read('tools/balance.mjs');
const VERIFY = read('tools/verify.sh');
const ENGTEST = read('tools/engine-test.mjs');
const PLAYTEST = read('tools/playtest.cjs');
const PENCIL = read('js/engine/pencil.js');
const PKG = JSON.parse(read('package.json'));
const HTML = read('index.html');

// ---- D1 菜单：在册的五档 + 请出菜单的两档，文档抄的都必须等于代码现值 ----
const tierRows = [...README.matchAll(/^\| (初|中|高) \| (\d+)×\d+ \| 链长 med (\d+) 轮 \| 出题 med (\d+) ms \|$/gm)];
ok(tierRows.length === TIERS.length, `D1a README 的五档表解析到 ${TIERS.length} 行（解析不到不等于通过）`,
  `解析 ${tierRows.length} 行 vs TIERS ${TIERS.length} 档`);
for (const t of TIERS) {
  const row = tierRows.find(m => +m[2] === t.n); // 档名会重复（两个「中」两个「高」），按尺寸认档
  ok(!!row && row[1] === t.name, `D1 ${t.name} ${t.n}×${t.n} 那一行在文档的档位表里`,
    row ? `文档 | ${row[1]} | ${row[2]}×${row[2]} |` : '文档里没有这一档');
  ok(!!row && +row[3] === t.med.rounds, `D1b ${t.n}×${t.n} 链长 med ${t.med.rounds} 轮 == TIERS 现值`,
    row ? `文档 ${row[3]} vs 代码 ${t.med.rounds}` : '解析不到那一行');
  ok(!!row && +row[4] === t.med.ms, `D1c ${t.n}×${t.n} 出题 med ${t.med.ms} ms == TIERS 现值`,
    row ? `文档 ${row[4]} vs 代码 ${t.med.ms}` : '解析不到那一行');
}
const sizeList = (README.match(/选一档\*\*：([\d×/ ]+)。/) || [])[1];
ok(!!sizeList && sizeList.trim().split(/\s*\/\s*/).join(' ') === TIERS.map(t => `${t.n}×${t.n}`).join(' '),
  'D1d 玩法那一行的尺寸清单逐档等于 TIERS（正文散文里的尺寸也是现值）',
  sizeList ? `文档 ${sizeList.trim()} vs 代码 ${TIERS.map(t => `${t.n}×${t.n}`).join(' / ')}` : '解析不到尺寸清单');
const tierCountClaims = [...DOCS.matchAll(/(?<![上这那每同换末首])([一二三四五六七八九十])档(?:（|菜单| ×|的|，|、|。)/g)].map(m => m[1]);
ok(tierCountClaims.length >= 3 && tierCountClaims.every(w => CN[w] === TIERS.length),
  `D1e 文档里所有「N 档」都是 ${TIERS.length} 档（中文数词也要对上）`,
  `解析 ${tierCountClaims.length} 处：${tierCountClaims.join(' ')} vs 代码 ${TIERS.length}`);
const exclLines = [...README.matchAll(/^- (\d+)×\1 不在菜单里：(.+)$/gm)];
ok(exclLines.length === EXCLUDED_TIERS.length, `D1f README 抄的排除条数等于 EXCLUDED_TIERS 的条数`,
  `解析 ${exclLines.length} 条 vs 代码 ${EXCLUDED_TIERS.length} 条`);
for (const m of exclLines) {
  const x = EXCLUDED_TIERS.find(y => y.n === +m[1]);
  ok(!!x && x.reason === m[2], `D1 ${m[1]}×${m[1]} 那句排除理由逐字等于 generate.js 里印到页面上的那一句`,
    x ? (x.reason === m[2] ? '逐字相同' : `文档「${m[2].slice(0, 28)}…」vs 页面「${x.reason.slice(0, 28)}…」`) : '代码里没有这一档的排除记录');
}

// ---- D2 六条命名规则：文档 / 页面 / 实现三处的名字集与条数都要是同一份 ----
const docRules = [...README.matchAll(/^\| `(K\d_[^`]+)` \| [^|]+ \|$/gm)].map(m => m[1]);
ok(docRules.length === RULES.length, `D2a README 的规则表解析到 ${RULES.length} 条`,
  `解析 ${docRules.length} 条 vs RULES ${RULES.length} 条`);
ok(docRules.join('|') === RULES.join('|'), 'D2 README 的规则名逐条逐序等于 pencil.js 的 RULES',
  `实现 ${RULES.join(' ')} vs 文档 ${docRules.join(' ')}`);
const htmlRules = [...HTML.matchAll(/<b>(K\d) ([^<]+)<\/b>/g)].map(m => `${m[1]}_${m[2]}`);
ok(htmlRules.length === RULES.length && htmlRules.join('|') === RULES.join('|'),
  'D2b 选档页上给玩家看的那六条名字也等于 RULES（页面不是文档的复印件，它自己会漂）',
  `页面 ${htmlRules.length} 条：${htmlRules.join(' ')}`);
const PENCIL_BODY = PENCIL.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const ghost = RULES.map((r, i) => (PENCIL_BODY.includes(`RULES[${i}]`) ? null : r)).filter(Boolean);
ok(ghost.length === 0, 'D2c 每条规则都被铅笔的**代码**引用（不只活在注释与名字表里）',
  ghost.length ? `只有名字没有实现：${ghost.join(' ')}` : `RULES[0]…RULES[${RULES.length - 1}] 在非注释行里各出现 ≥1 次`);
const countClaims = [...DOCS.matchAll(/([一二三四五六七八九十])条(?:命名)?规则/g)].map(m => CN[m[1]]);
const rangeClaims = [...(README + '\n' + DESIGN + '\n' + HTML).matchAll(/K1[–-]K(\d)/g)].map(m => +m[1]);
ok(countClaims.length >= 2 && rangeClaims.length >= 2 && countClaims.every(x => x === RULES.length) && rangeClaims.every(x => x === RULES.length),
  `D2d 文档里「N 条规则」与「K1–KN」全部等于 ${RULES.length}`,
  `条数 ${countClaims.join(' ')} · 区间上界 ${rangeClaims.join(' ')} vs RULES ${RULES.length}`);

// ---- D3 闸的形状：腿数、形态数、每形态报告数、合计，全部从脚本现值推 ----
const shapeRe = /闸的形状：腿 (\d+) 条 · 形态 (\d+) 种 · 每形态 (\d+) 份报告 · 合计 (\d+) 份/g;
const shapeAll = DOCS.match(shapeRe) || [];
const s = DOCS.match(/闸的形状：腿 (\d+) 条 · 形态 (\d+) 种 · 每形态 (\d+) 份报告 · 合计 (\d+) 份/);
const legsM = VERIFY.match(/LEGS=\$\{LEGS:-([^}]*)\}/);
const legs = legsM ? legsM[1].trim().split(/\s+/) : [];
const shapes = ((VERIFY.match(/SHAPES=\(([^)]*)\)/) || [, ''])[1].match(/"[^"]+"/g) || []).length;
const reportsPerShape = (VERIFY.match(/^\s*run_scenario [a-z]+/gm) || []).length + (VERIFY.match(/^\s*run_cmd [a-z]+/gm) || []).length;
ok(shapeAll.length === 1, 'D3a 「闸的形状」那句话在两份文档里只出现一次（两处都写就会各漂各的）',
  `${shapeAll.length} 处`);
ok(!!s && legs.length >= 5 && shapes >= 1 && reportsPerShape >= 5, 'D3b 脚本与文档两边都读到了闸的形状',
  `verify.sh: ${legs.length} 腿 × ${shapes} 形态 × ${reportsPerShape} 报告 · 文档句 ${s ? '在' : '不在'}`);
ok(!!s && +s[1] === legs.length, `D3 文档写的腿数等于 LEGS 默认值（${legs.join(' ')}）`,
  s ? `文档 ${s[1]} vs 脚本 ${legs.length}` : '解析不到');
ok(!!s && +s[2] === shapes, 'D3c 文档写的形态数等于 SHAPES 的条目数', s ? `文档 ${s[2]} vs 脚本 ${shapes}` : '解析不到');
ok(!!s && +s[3] === reportsPerShape, `D3d 每形态报告数等于脚本里的 run_scenario + run_cmd 次数（${reportsPerShape}）`,
  s ? `文档 ${s[3]} vs 脚本 ${reportsPerShape}` : '解析不到');
ok(!!s && +s[4] === reportsPerShape * shapes, 'D3e 合计份数 == 每形态 × 形态数',
  s ? `文档 ${s[4]} vs ${reportsPerShape}×${shapes}=${reportsPerShape * shapes}` : '解析不到');
const engTotalDoc = (README.match(/\| (\d+) 条等式/) || [])[1];
const engTotalCode = (ENGTEST.match(/const EXPECT_TOTAL = (\d+);/) || [])[1];
ok(!!engTotalDoc && !!engTotalCode && +engTotalDoc === +engTotalCode,
  `D3f 文档说的引擎断言条数等于 engine-test 自己钉的 EXPECT_TOTAL`,
  engTotalDoc && engTotalCode ? `文档 ${engTotalDoc} vs 代码 ${engTotalCode}` : `解析：文档 ${engTotalDoc} / 代码 ${engTotalCode}`);

// ---- D4 端口：文档那一句 == verify.sh / package.json / playtest.cjs 的现值 ----
const httpM = VERIFY.match(/HTTP=\$\{HTTP_PORT:-(\d+)\}/);
const cdpM = VERIFY.match(/PORT=\$\{CDP_PORT:-(\d+)\}/);
const devM = (PKG.scripts?.dev || '').match(/server\.cjs\s+(\d+)/);
const phM = PLAYTEST.match(/CDP_PORT \|\| (\d+)/);
const pbM = PLAYTEST.match(/BASE_URL \|\| 'http:\/\/127\.0\.0\.1:(\d+)/);
const portDoc = DOCS.match(/端口：本地 (\d+) · CDP (\d+)/);
ok(httpM && cdpM && devM && phM && pbM && portDoc, 'D4a 五个来源都解析到了端口（少一个就是接线改了形状）',
  `verify ${httpM?.[1]}/${cdpM?.[1]} · package ${devM?.[1]} · playtest ${pbM?.[1]}/${phM?.[1]} · 文档 ${portDoc?.[1]}/${portDoc?.[2]}`);
const httpVals = [httpM?.[1], devM?.[1], pbM?.[1]];
ok(!!portDoc && httpVals.every(v => +v === +portDoc[1]), `D4 HTTP 端口三处一致且等于文档（${httpVals.join('/')}）`,
  portDoc ? `文档 ${portDoc[1]}` : '解析不到');
ok(!!portDoc && [cdpM?.[1], phM?.[1]].every(v => +v === +portDoc[2]), `D4b CDP 端口两处一致且等于文档（${cdpM?.[1]}/${phM?.[1]}）`,
  portDoc ? `文档 ${portDoc[2]}` : '解析不到');

// ---- D5 预算与线：文档写的数等于代码里的常数 ----
const budDoc = README.match(/判据 1 的预算是 (\d+) 节点，单次计数调用 (\d+) 节点，每盘挖线索 (\d+) 节点/);
ok(!!budDoc, 'D5a 承诺表里那句预算写了三个数', budDoc ? `文档 ${budDoc.slice(1, 4).join(' / ')}` : '解析不到');
ok(!!budDoc && +budDoc[1] === BUDGET.cap && +budDoc[2] === BUDGET.callNodes && +budDoc[3] === BUDGET.digNodes,
  'D5 承诺表那三个数逐格等于 BUDGET 现值',
  budDoc ? `文档 ${budDoc.slice(1, 4).join('/')} vs 代码 ${BUDGET.cap}/${BUDGET.callNodes}/${BUDGET.digNodes}` : '解析不到');
ok(!!budDoc && +budDoc[1] === NODE_CAP, `D5b cap 就是 rules.js 导出的 NODE_CAP（同一件事不许有两个数）`,
  budDoc ? `文档 ${budDoc[1]} vs NODE_CAP ${NODE_CAP}` : '解析不到');
const designBud = [...DESIGN.matchAll(/^\| `BUDGET\.(\w+)` \| (\d+) \|/gm)];
ok(designBud.length === 3 && designBud.every(m => BUDGET[m[1]] !== undefined && +m[2] === BUDGET[m[1]]),
  `D5c DESIGN §3 的预算表三行都等于 BUDGET（解析到 ${designBud.length} 行：${designBud.map(m => m[1]).join(',') || '无'}）`,
  designBud.map(m => `${m[1]}=${m[2]}`).join(' ') + ` vs 代码 ${JSON.stringify(BUDGET)}`);
const costDoc = [...DOCS.matchAll(/p95 ≤ (\d+) ms/g)].map(m => +m[1]);
const costCode = (BAL.match(/const COST_MS = (\d+);/) || [])[1];
ok(costDoc.length >= 2 && !!costCode && costDoc.every(v => v === +costCode),
  `D5d 文档里那句等待线（${costDoc.join(' / ')} ms）等于 balance 的 COST_MS`,
  costCode ? `COST_MS = ${costCode}` : '解析不到 COST_MS');

// ---- D6 CI 覆盖表：文档声称在 CI 跑的门禁必须真在那个 job 里，反过来也是 ----
const ciSection = README.slice(README.indexOf('## CI'), README.indexOf('## 破坏试验台账'));
const jobSrc = CI.slice(CI.indexOf('\njobs:'));
const jobBlocks = {};
for (const m of jobSrc.matchAll(/^ {2}([A-Za-z0-9_-]+):([\s\S]*?)(?=\n {2}[A-Za-z0-9_-]+:|\n(?=\S)|(?![\s\S]))/gm)) jobBlocks[m[1]] = m[2];
const ciRows = [...ciSection.matchAll(/^\| `([^`]+)` \| (check|browser) \| `([^`]+)` \|$/gm)];
ok(Object.keys(jobBlocks).length === 2 && ciRows.length >= 4,
  `D6a CI 的 job 块与文档覆盖表都解析到了东西（job ${Object.keys(jobBlocks).join('/')} · 表 ${ciRows.length} 行）`,
  `文档 ${ciRows.length} 行 vs job ${Object.keys(jobBlocks).length} 个`);
const listedCmds = new Set();
for (const r of ciRows) {
  const block = jobBlocks[r[2]] || '';
  listedCmds.add(r[1]);
  ok(block.includes(r[3]) && block.includes(r[1]), `D6 覆盖表那一行真在 ${r[2]} job 里：${r[1]}`, `步骤名「${r[3]}」`);
}
const ciCommands = [...new Set((CI.match(/(?:node|bash) tools\/[\w.-]+/g) || []).map(x => x.replace(/^/, '')))];
const unlisted = ciCommands.filter(c => !listedCmds.has(c));
ok(unlisted.length === 0, 'D6b ci.yml 里跑的每个 tools 门禁都被覆盖表列了（文档不许比门禁松）',
  unlisted.length ? `漏了：${unlisted.join('，')}` : `runner 里 ${ciCommands.join(' / ')} 全在表上`);
const jobCountDoc = (ciSection.match(/两个 job/) || [])[0];
ok(!!jobCountDoc && Object.keys(jobBlocks).length === 2, `D6c 文档说「两个 job」，ci.yml 的 jobs: 下就正好两个（${Object.keys(jobBlocks).join('/')}）`,
  `${Object.keys(jobBlocks).length} 个 job · 文案 ${jobCountDoc || '没有那句'}`);

// ---- D7 SAMPLES 旋钮：ci.yml 的值 == 文档引用的值 == 不接线时的默认，且 env 真接得上 ----
const ciSamples = (CI.match(/SAMPLES: "(\d+)"/) || [])[1];
const docSamples = (README.match(/CI 用 SAMPLES=(\d+) 跑 balance\.mjs/) || [])[1];
const defaultN = (BAL.match(/envn > 0 \? envn : (\d+);/) || [])[1];
const docDefault = (README.match(/本机默认 (\d+) 张/) || [])[1];
ok(!!ciSamples && !!docSamples && !!defaultN && !!docDefault, 'D7a 四处都读到了样本数',
  `ci.yml ${ciSamples} · 文档引用 ${docSamples} · 默认 ${defaultN} · 文档说的默认 ${docDefault}`);
ok(ciSamples && docSamples && defaultN && +ciSamples === +docSamples && +ciSamples === +defaultN && +defaultN === +docDefault,
  `D7 CI 的 SAMPLES == 文档引用的值 == 不设 env 的默认 == 文档写的那个默认（${ciSamples}/${docSamples}/${defaultN}/${docDefault}）`,
  `${ciSamples} / ${docSamples} / ${defaultN} / ${docDefault}`);
const ladderDoc = (README.match(/([一二三四五六七八九十])档 × (\d+) 张的实测/) || []);
ok(!!ladderDoc.length && CN[ladderDoc[1]] === TIERS.length && +ladderDoc[2] === +defaultN,
  'D7b 测试过程那句「N 档 × M 张的实测」等于档数与默认样本',
  ladderDoc.length ? `文档 ${ladderDoc[1]}档 × ${ladderDoc[2]} vs ${TIERS.length} 档 × ${defaultN}` : '解析不到那句');
const probe = await new Promise(resolve => {
  const child = spawn(process.execPath, [join(ROOT, 'tools/balance.mjs')], { env: { ...process.env, SAMPLES: '3' } });
  let buf = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(buf || '(no output)'); }, 20000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    buf += d;
    if (/档 × \d+ 张/.test(buf)) { clearTimeout(timer); child.kill('SIGKILL'); resolve(buf.split('\n')[0]); }
  });
  child.on('close', () => { clearTimeout(timer); resolve(buf.split('\n')[0] || '(exited silently)'); });
});
ok(/× 3 张/.test(probe), 'D7c 子进程探针：SAMPLES=3 必须真的改成 3 张（env 是接上的，不是装饰）', `balance 第一行：${probe}`);

// ---- D8 逐报告条数：文档抄的那 14 个数等于 verify.sh 的对数表，且自洽 ----
const expectM = VERIFY.match(/EXPECTS='([^']*)'/);
const expects = Object.fromEntries((expectM ? expectM[1].trim().split(/\s+/) : []).map(kv => kv.split('=')));
const reportsSection = README.slice(README.indexOf('浏览器那份逐报告的条数'), README.indexOf('`balance.mjs` 的红线'));
const items = [...reportsSection.matchAll(/\b(engine|gen|play|hint|win|layout|mouseleg|touchleg|keysleg|save|fragleg|resume|reloadleg|corrupt) (\d+)/g)]
  .map(m => ({ name: m[1], n: +m[2] }));
const totals = reportsSection.match(/每形态 (\d+) 条 · 合计 (\d+) 条/);
ok(items.length === Object.keys(expects).length && !!totals && !!expectM,
  `D8a 文档的逐报告条数、总数、脚本的对数表三处都解析到了（${items.length} 项 / 表上 ${Object.keys(expects).length} 项）`,
  `解析 ${items.length} 项 · EXPECTS ${Object.keys(expects).length} 项 · 总句 ${totals ? '在' : '不在'}`);
const stray = items.filter(x => expects[x.name] === undefined);
const missingNames = Object.keys(expects).filter(k => !items.some(x => x.name === k));
ok(stray.length === 0 && missingNames.length === 0, 'D8b 文档列的报告名与对数表的键一一对上（谁也不能单方面多一条或少一条）',
  `文档多：${stray.map(x => x.name).join(',') || '无'} · 表多：${missingNames.join(',') || '无'}`);
const drift = items.filter(x => expects[x.name] !== undefined && +expects[x.name] !== x.n);
ok(drift.length === 0, 'D8 文档抄的每一份条数逐格等于 verify.sh 的 EXPECTS',
  drift.length ? `漂了：${drift.map(x => `${x.name} 文档 ${x.n} vs 表 ${expects[x.name]}`).join('，')}` : `${items.length} 份全部相同`);
const designExpectBlock = (DESIGN.match(/```\n(engine=\d+[^\n]*)\n```/) || [])[1];
ok(!!designExpectBlock && designExpectBlock.trim() === expectM[1].trim(),
  'D8c DESIGN 里贴的那份对数表逐字等于 verify.sh 里的那一行',
  designExpectBlock ? `贴了 ${designExpectBlock.split(/\s+/).length} 项` : 'DESIGN 里没有那段代码块');
const perShape = items.reduce((a, b) => a + b.n, 0);
ok(!!totals && perShape === +totals[1], 'D8d 文档列的逐报告条数加起来 == 它自己写的每形态条数',
  totals ? `加起来 ${perShape} vs 文档 ${totals[1]}` : '解析不到');
ok(!!totals && perShape * shapes === +totals[2], 'D8e 每形态条数 × 形态数 == 文档写的合计',
  totals ? `${perShape}×${shapes} vs ${totals[2]}` : '解析不到');

// ---- D9 引用不漂：每一条 path:NN 都落在真实行数内，带锚点的还要真指到那个名字 ----
const cites = [...DOCS.matchAll(/((?:\.github\/workflows\/)?[\w./-]+\.(?:js|mjs|cjs|sh|json|html|yml)):(\d+)(?:-(\d+))?/g)];
const bad = [];
for (const c of cites) {
  let src;
  try { src = read(c[1]); } catch { bad.push(`${c[1]}:${c[2]}（文件不存在）`); continue; }
  const n = src.split('\n').length;
  if (+c[2] > n || (+c[3] && +c[3] > n)) bad.push(`${c[1]}:${c[2]}${c[3] ? '-' + c[3] : ''}（该文件只有 ${n} 行）`);
}
ok(cites.length >= 5, `D9a 文档里的行号引用解析到了 ${cites.length || 0} 条（少于 5 条说明引用格式改了）`, `${cites.length} 条`);
ok(bad.length === 0, 'D9 每一条 path:NN 引用都落在真实文件的行数内',
  bad.length ? `越界：${bad.join('，')}` : `${cites.length} 条全部在范围内`);
const anchors = [['js/engine/generate.js', 'TIERS'], ['tools/engine-test.mjs', 'EXPECT_TOTAL'], ['tools/balance.mjs', 'COST_MS'],
  ['tools/verify.sh', 'EXPECTS'], ['.github/workflows/ci.yml', 'SAMPLES']];
for (const [file, token] of anchors) {
  const m = DOCS.match(new RegExp(`${file.replace(/[./]/g, '\\$&')}:(\\d+) 的 ${token}\\b`));
  let detail = '文档没有「' + file + ':NN 的 ' + token + '」这条引用';
  let hit = false;
  if (m) {
    const line = read(file).split('\n')[+m[1] - 1] || '';
    hit = line.includes(token);
    detail = `${file}:${m[1]} 那行「${line.trim().slice(0, 58)}」${hit ? '含' : '不含'} ${token}`;
  }
  ok(hit, `D9b ${file}:${m ? m[1] : '?'} 真的坐着 ${token}（引用是锚点，不是装饰）`, detail);
}

// ---- D10 红线标签双向：文档点名的每条红线都得存在，存在的每条都得有人写 ----
const realLabels = [...new Set((BAL.match(/'((?:B\d(?:b)?(?:-guard)?))'/g) || []).map(x => x.slice(1, -1)))];
const docLabels = [...new Set((DOCS.match(/(?<![A-Za-z0-9_])B\d(?:b)?(?:-guard)?/g) || []))];
ok(realLabels.length >= 8 && docLabels.length >= 8, 'D10a 两边的红线标签都解析到了',
  `balance ${realLabels.sort().join(' ')} · 文档 ${docLabels.sort().join(' ')}`);
const missing = docLabels.filter(l => !realLabels.includes(l));
const undocumented = realLabels.filter(l => !docLabels.includes(l));
ok(missing.length === 0, 'D10 文档点名的每条红线在 balance.mjs 里都还在',
  missing.length ? `文档引用了不存在的红线：${missing.join(' ')}` : `${docLabels.sort().join(' ')} 全部存在`);
ok(undocumented.length === 0, 'D10b balance.mjs 里每条红线都被文档点名（新增红线不能没人写）',
  undocumented.length ? `没写进文档：${undocumented.join(' ')}` : '一一对上');

// ---- D11 承诺表：「闸」那一格里的每个名字都得指得出一个真东西 ----
const promiseSection = README.slice(README.indexOf('## 承诺表'), README.indexOf('## 复跑'));
const promiseRows = [...promiseSection.matchAll(/^\| (.+?) \| (.+?) \| (.+?) \|$/gm)]
  .filter(m => m[1] !== '承诺' && !/^[-\s]+$/.test(m[1]));
ok(promiseRows.length >= 12, `D11a 承诺表解析到 ${promiseRows.length} 行（少于 12 行说明表格形状改了或整节被删）`,
  `${promiseRows.length} 行`);
const known = new Set([...realLabels, ...items.map(x => `verify.sh:${x.name}`), 'engine-test', '无闸']);
for (const m of promiseRows) {
  const found = [...m[2].matchAll(/(?:engine-test|verify\.sh:[a-z]+|B\d(?:b)?(?:-guard)?|D\d+|无闸)/g)].map(x => x[0]);
  const rest = m[2].replace(/(?:engine-test|verify\.sh:[a-z]+|B\d(?:b)?(?:-guard)?|D\d+|无闸)/g, '').replace(/[`·—–\s]/g, '');
  const bogus = found.filter(t => t !== '无闸' && !t.startsWith('D') && !known.has(t));
  ok(found.length > 0 && rest.length === 0 && bogus.length === 0,
    `D11 承诺那一行的闸都认得：${m[1].slice(0, 18)}…`, `格子里是「${m[2]}」${bogus.length ? ` · 认不出：${bogus.join(',')}` : ''}${rest ? ` · 剩下没认掉的字符：${rest}` : ''}`);
}
const noGateRows = promiseRows.filter(m => m[2].includes('无闸'));
ok(noGateRows.length >= 1, `D11b 承诺表里至少有 ${noGateRows.length} 行明写「无闸」（一张全绿的承诺表是在说谎）`,
  noGateRows.map(m => m[1].slice(0, 24)).join(' / '));

// ---- D12 官方例题：题面、解答、四条读法那张表，全部重算一遍 ----
const EX = makeBoard(EX_N, EX_CLUES);
const exBlack = new Uint8Array(EX_N * EX_N);
for (const [r, c] of EX_BLACK) exBlack[r * EX_N + c] = 1;
const exIdx = DESIGN.indexOf('题面（');
const gridBlock = exIdx >= 0 ? ((DESIGN.slice(exIdx).match(/```\n([\s\S]*?)\n```/) || [])[1] || '') : '';
const gridRows = gridBlock.split('\n').filter(x => x.trim());
ok(gridRows.length === EX_N, `D12a DESIGN 的题面/解答 ASCII 解析到 ${EX_N} 行`, `${gridRows.length} 行`);
let gridBad = [];
gridRows.forEach((ln, r) => {
  const halves = ln.trim().split(/\s{2,}/);
  if (halves.length !== 2) { gridBad.push(`第 ${r} 行不是一个题面+解答的对（解析到 ${halves.length} 段）`); return; }
  const clueCells = halves[0].split(/\s+/);
  if (clueCells.length !== EX_N || halves[1].length !== EX_N) { gridBad.push(`第 ${r} 行不是 4 格`); return; }
  for (let c = 0; c < EX_N; c++) {
    const tok = clueCells[c];
    const want = /^\d$/.test(tok) ? +tok : tok === '○' ? EMPTY : tok === '·' ? FREE : null;
    if (want === null) { gridBad.push(`第 ${r} 行第 ${c} 格的符号「${tok}」不认识`); continue; }
    if (EX.cell[r * EX_N + c] !== want) gridBad.push(`题面 (${r},${c}) 文档画的是 ${tok}，example.js 是 ${EX.cell[r * EX_N + c]}`);
    const black = halves[1][c] === '#';
    if (black !== !!exBlack[r * EX_N + c]) gridBad.push(`解答 (${r},${c}) 文档画的是 ${halves[1][c]}，example.js 的官方黑格是 ${exBlack[r * EX_N + c] ? '#' : '.'}`);
  }
});
ok(gridBad.length === 0, 'D12 DESIGN 那张题面/解答 ASCII 逐格等于 example.js 的官方数据',
  gridBad.length ? gridBad.slice(0, 3).join('；') : '题面 16 格 + 解答 16 格全部相同');

const readRows = [...DOCS.matchAll(/^\| \((\d+),(\d+)\)=(\d+) \| (\d+)([✓✗]) \| (\d+)([✓✗]) \| (\d+)([✓✗]) \| (\d+)([✓✗]) \|$/gm)];
const numCells = [...Array(EX_N * EX_N).keys()].filter(i => isNum(EX.cell[i]));
ok(readRows.length === numCells.length, `D12b 裁断表解析到 ${numCells.length} 行（每行一个数字圈）`,
  `解析 ${readRows.length} 行 vs 例题 ${numCells.length} 个数字圈`);
const valBad = [];
for (const row of readRows) {
  const i = (+row[1]) * EX_N + (+row[2]);
  if (!isNum(EX.cell[i]) || EX.cell[i] !== +row[3]) { valBad.push(`(${row[1]},${row[2]})=${row[3]} 这一格在例题里不存在或不是这个数`); continue; }
  READINGS.forEach(([name, fn], k) => {
    const shown = +row[4 + k * 2];
    const mark = row[5 + k * 2];
    const real = fn(EX, exBlack, i);
    if (shown !== real) valBad.push(`${name} 在 (${row[1]},${row[2]})：文档写 ${shown}，重算是 ${real}`);
    if ((mark === '✓') !== (real === EX.cell[i])) valBad.push(`${name} 在 (${row[1]},${row[2]}) 的 ${mark} 与「等于圈里的数字吗」不符`);
  });
}
ok(valBad.length === 0, 'D12 四条读法 × 五个数字圈：文档那 20 个读数与 20 个对勾叉号全部重算相符',
  valBad.length ? valBad.slice(0, 4).join('；') : '20 格全部相同');
const rejects = READINGS.map(([, fn]) => numCells.filter(i => fn(EX, exBlack, i) !== EX.cell[i]).length);
ok(rejects[3] === 0 && rejects[0] >= 1 && rejects[1] >= 1 && rejects[2] >= 1,
  'D12c 只有 R4 全中，另外三条各被官方例题否掉', `被否掉的处数 R1/R2/R3/R4 = ${rejects.join('/')}`);
const rejectDoc = DESIGN.match(/另外三条各被 (\d+)\/(\d+)\/(\d+) 处否掉/);
ok(!!rejectDoc && rejectDoc.slice(1, 4).map(Number).join(',') === rejects.slice(0, 3).join(','),
  `D12d 文档那句「各被 N/N/N 处否掉」等于重算的 ${rejects.slice(0, 3).join('/')}（这句以前抄成过 3/3/4）`,
  rejectDoc ? `文档 ${rejectDoc.slice(1, 4).join('/')}` : '解析不到那句');
const byNum = k => READINGS.find(([n]) => n.startsWith(k))[1];
const bulletClaims = [
  ['R1', '- **R1（舍）', '- **R3（舍）', /`\((\d+),(\d+)\)=(\d+)` 处只有 (\d+) 个黑邻格/, byNum('R1')],
  ['R2', '- **R2（舍）', '- **R1（舍）', /`\((\d+),(\d+)\)=(\d+)` 上只给 (\d+)/, byNum('R2')],
  ['R3', '- **R3（舍）', '**一处只有文字作证', /`\((\d+),(\d+)\)(?:=(\d+))?` 处给 (\d+)/, byNum('R3')],
];
for (const [name, from, to, re, fn] of bulletClaims) {
  const seg = DESIGN.slice(DESIGN.indexOf(from), DESIGN.indexOf(to));
  const m = seg.match(re);
  ok(!!m, `D12e ${name} 那条「舍」的理由里带一个可复算的读数`, m ? `解析到 (${m[1]},${m[2]}) 处 ${m[4]}` : `${name} 那一条里解析不到那格读数`);
  if (m) {
    const i = +m[1] * EX_N + (+m[2]);
    ok(fn(EX, exBlack, i) === +m[4], `D12 ${name} 在 (${m[1]},${m[2]}) 的读数是 ${m[4]}（散文里的这个数重算相符）`,
      `${name}(${m[1]},${m[2]}) 重算 ${fn(EX, exBlack, i)} vs 文档 ${m[4]}`);
  }
}
{
  const nbM = DESIGN.match(/`\((\d+),(\d+)\)` 只有一个邻格/);
  let real = null;
  if (nbM) {
    const n0 = +nbM[1] * EX_N + (+nbM[2]);
    real = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dr, dc]) => [+nbM[1] + dr, +nbM[2] + dc])
      .filter(([r, c]) => r >= 0 && r < EX_N && c >= 0 && c < EX_N && !isCircle(EX.cell[r * EX_N + c])).length;
  }
  ok(!!nbM && real === 1, 'D12f「同一个块只数一次」那句靠文字裁断的前提是真的：(0,0) 只有一个非圈邻格',
    nbM ? `(${nbM[1]},${nbM[2]}) 的非圈邻格数 ${real}` : '解析不到那句');
}

// ---- D13 「见 DESIGN.md §N」全部指得到存在的节（代码注释也一起数） ----
const sections = [...new Set((DESIGN.match(/^## §(\d+)/gm) || []).map(x => +x.slice(4)))];
const refs = [
  ...[...DOCS.matchAll(/DESIGN\.md §(\d+)/g)].map(m => ({ where: '文档', n: +m[1] })),
  ...[...DESIGN.matchAll(/（§(\d+)）/g)].map(m => ({ where: 'DESIGN 自指', n: +m[1] })),
  ...[...read('js/engine/rules.js').matchAll(/DESIGN\.md §(\d+)/g)].map(m => ({ where: 'rules.js', n: +m[1] })),
  ...[...read('js/engine/pencil.js').matchAll(/DESIGN\.md §(\d+)/g)].map(m => ({ where: 'pencil.js', n: +m[1] })),
  ...[...read('js/engine/generate.js').matchAll(/DESIGN\.md §(\d+)/g)].map(m => ({ where: 'generate.js', n: +m[1] })),
  ...[...HTML.matchAll(/DESIGN\.md §(\d+)/g)].map(m => ({ where: 'index.html', n: +m[1] })),
];
ok(sections.length >= 6 && refs.length >= 8, `D13a DESIGN 有 ${sections.length} 节、全仓有 ${refs.length} 处 §N 引用（解析不到就说明格式改了）`,
  `节 ${sections.join(',')} · 引用 ${refs.length} 处`);
const dangling = refs.filter(x => !sections.includes(x.n));
ok(dangling.length === 0, 'D13 每一处「DESIGN.md §N」都指向存在的那一节',
  dangling.length ? `悬空：${dangling.map(x => `${x.where} §${x.n}`).join('，')}` : `${refs.length} 处全部落在 §${sections.join('/')} 里`);

// ---- D10c 文档声称的 D 区间 == 这一次真的跑出来的那些标签（自数，防"整节被删"） ----
const dRanges = [...DOCS.matchAll(/D1[^\d]{1,4}D(\d+)/g)].map(m => +m[1]);
const dMentions = [...new Set((DOCS.match(/(?<![A-Za-z0-9_])D\d+/g) || []))].map(x => +x.slice(1));
ok(dRanges.length >= 2 && dRanges.every(v => v === emitted.size),
  `D10c 文档写的 D 区间上界（${dRanges.join('/')}）等于这一次跑出来的 D 标签数 ${emitted.size}`,
  `本次发出 ${emitted.size} 个 D 标签：${[...emitted].sort((a, b) => +a.slice(1) - +b.slice(1)).join(' ')}`);
const unknownD = dMentions.filter(v => !emitted.has(`D${v}`));
ok(unknownD.length === 0, 'D10d 文档点名的每个 D 编号这一次都真的跑了（删掉一节就会红）',
  unknownD.length ? `没有对应检查：${unknownD.map(v => 'D' + v).join(' ')}` : `点到的 ${dMentions.sort().join(',')} 全在`);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`  未过：${f}`);
  process.exit(1);
}

