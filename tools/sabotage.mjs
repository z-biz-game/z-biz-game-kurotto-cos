// 破坏试验台账：把每一类谎各写回代码里一遍，看闸会不会**点名**变红。
//
// 用法：node tools/sabotage.mjs          跑 README「破坏试验台账」里的全部刀（约 20 分钟）
//       node tools/sabotage.mjs K1 K11   只跑点名的几把（调试用；回写 README 仍要求整跑全绿）
//
// 为什么要有这个文件：一份全绿的报告只说明"这一轮没有东西坏"，它没说**闸会不会红**。
// 台账每一行那个 1 必须由脚本把退出码读回来，不能抄。
//
// 五条硬规矩：
//   1. 工作树必须干净：刀打在定稿的那一份上，否则恢复那一步的 git checkout 会把在写的东西抹掉。
//   2. 针必须唯一命中：0 次或 >1 次都是 ERROR——"打不中却一声不响跑完"是台账最坏的失败。
//   3. rc != 0 **且**输出点名了它那一条断言才算红；语法炸了也是 rc != 0，但那不是闸红。
//   4. 每把刀只恢复它那一个文件，恢复后立刻验工作树；脏了就停，不带脏树跑下一把。
//   5. 全部刀红完之后不带刀整跑四道闸要求全绿，只有到这一步才回写 README 的实测 rc。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const PH = String.fromCharCode(1);
const stripTicks = s => (/^`.*`$/.test(s) ? s.slice(1, -1) : s);
const die = msg => { console.log(`  ERROR ${msg}`); process.exit(2); };

const sh = (cmd, timeout) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), timedOut: !!r.error && r.error.code === 'ETIMEDOUT' };
};
const git = a => sh(`git ${a}`, 30000);

// ---- 台账的刀是从 README 那张表里解析出来的：文档改了，跑的就是改后的那一版 ----
const readmePath = 'README.md';
const readme0 = read(readmePath);
const ledgerRows = readme0.split('\n').filter(l => /^\| K\d+ \| /.test(l));
const parse = l => l.replace(/\\\|/g, PH).split('|').slice(1, -1).map(c => c.trim().replace(new RegExp(PH, 'g'), '|'));
const knives = ledgerRows.map(l => {
  const c = parse(l);
  if (c.length !== 8) die(`台账那一行的列数不是 8：${l.slice(0, 40)}…（解析到 ${c.length} 列）`);
  return { id: c[0], where: c[1], file: stripTicks(c[2]), needle: stripTicks(c[3]),
    repl: stripTicks(c[4]).replace(/\\n/g, '\n'), expect: stripTicks(c[5]), cmd: stripTicks(c[6]), rc: c[7], raw: l };
});
if (!knives.length) die('README 的台账里一把刀都没解析到（表格形状改了就是这里）');
const only = process.argv.slice(2);
const picked = only.length ? knives.filter(k => only.includes(k.id)) : knives;
if (only.length && picked.length !== only.length) die(`点名的刀有几把不在台账上：${only.filter(x => !picked.some(k => k.id === x)).join(' ')}`);

// ---- 预检：树必须干净；针唯一命中；期望点名的那条断言得真的写在闸里 ----
const dirty = git('status --porcelain').out.trim();
if (dirty) die(`工作树不干净，刀不能打在半成品上（先 commit 或先把这些挪开）：\n${dirty}`);
const harness = ['tools/engine-test.mjs', 'tools/balance.mjs', 'tools/scenarios.js', 'tools/verify.sh', 'tools/doctest.mjs', 'tools/playtest.cjs']
  .map(f => ({ f, src: read(f) }));
for (const k of picked) {
  let src;
  try { src = read(k.file); } catch { die(`${k.id} 的文件不存在：${k.file}`); }
  const hits = src.split(k.needle).length - 1;
  if (hits !== 1) die(`${k.id} 的针在 ${k.file} 里命中 ${hits} 次（必须恰好 1 次；打不中或打多了都不许跑）`);
  if (k.repl === k.needle) die(`${k.id} 的「改成」与针相同，这一刀不会改变任何东西`);
  if (!harness.some(h => h.src.includes(k.expect))) die(`${k.id} 期望点名的「${k.expect}」在任何一道闸的源码里都找不到（断言被改名或删掉了）`);
  console.log(`  预检 ${k.id} · ${k.file} 针唯一命中 · 期望点名「${k.expect}」`);
}

const timeoutFor = cmd => (/verify\.sh/.test(cmd) ? 1500000 : /balance/.test(cmd) ? 900000 : /doctest/.test(cmd) ? 240000 : 300000);
const results = [];
for (const k of picked) {
  const src = read(k.file);
  writeFileSync(join(ROOT, k.file), src.replace(k.needle, k.repl));
  const t0 = Date.now();
  const r = sh(k.cmd, timeoutFor(k.cmd));
  const named = r.out.split('\n').filter(l => l.includes(k.expect));
  const log = `_tmp-kurotto-sab-${k.id}.log`;
  writeFileSync(join(ROOT, log), `${k.cmd}\nrc=${r.rc} 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n${'='.repeat(60)}\n${r.out}`);
  const restore = git(`checkout -- ${k.file}`);
  const stillDirty = git(`status --porcelain -- ${k.file}`).out.trim();
  if (stillDirty) die(`${k.id} 之后 ${k.file} 没能恢复到干净（rc=${restore.rc}）：${stillDirty}`);
  const okKnife = r.rc !== 0 && named.length > 0 && !r.timedOut;
  results.push({ id: k.id, rc: r.rc, named: named.length, secs: +(((Date.now() - t0) / 1000).toFixed(1)), log, ok: okKnife, timedOut: r.timedOut });
  console.log(`  ${okKnife ? '红得住' : '没红/没点名'} ${k.id} · rc=${r.rc} 点名 ${named.length} 行 · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${log}`);
  for (const l of named.slice(0, 2)) console.log(`      ${l.trim().slice(0, 130)}`);
  if (r.timedOut) console.log(`      （超时被掐：这不是闸红）`);
}

const bad = results.filter(x => !x.ok);
if (bad.length) die(`有 ${bad.length} 把刀没红或没点名（${bad.map(x => x.id).join(' ')}）：README 保持原样，不回写任何 rc`);
const subset = only.length > 0;
if (subset) {
  console.log(`\n点名的调试跑：不跑对照整跑、不回写 README（台账要的是整跑一遍，不给参数才行）。`);
  process.exit(0);
}

// ---- 不带刀整跑一遍：台账的前提是"把刀拔了之后四道闸本来就是绿的" ----
const controls = [['engine', 'node tools/engine-test.mjs'], ['balance', 'node tools/balance.mjs'],
  ['verify', 'bash tools/verify.sh'], ['doctest', 'node tools/doctest.mjs']];
for (const [name, cmd] of controls) {
  const r = sh(cmd, timeoutFor(cmd));
  writeFileSync(join(ROOT, `_tmp-kurotto-sab-control-${name}.log`), `${cmd}\nGATE_RC=${r.rc}\n${'='.repeat(60)}\n${r.out}`);
  if (r.rc !== 0) die(`不带刀整跑时 ${name} 竟然红了（rc=${r.rc}）：先看 _tmp-kurotto-sab-control-${name}.log`);
  console.log(`  对照 ${name} · rc=0（刀拔干净了）`);
}

// ---- 回写实测 rc：只动每行末尾那一格 ----
let out = readme0;
for (const k of picked) {
  const idx = out.indexOf(k.raw);
  if (idx < 0) die(`回写时找不到台账那一行了：${k.id}`);
  const rc = results.find(x => x.id === k.id).rc;
  const newline = k.raw.replace(/\? \|\s*$/, `${rc} |`);
  if (newline === k.raw) die(`${k.id} 那一行末尾不是「? |」，不知道该怎么回写：${k.raw.slice(-40)}`);
  out = out.slice(0, idx) + newline + out.slice(idx + k.raw.length);
}
writeFileSync(join(ROOT, readmePath), out);
console.log(`\n回写了 ${picked.length} 行的实测 rc；台账的每一行现在都带一个由脚本读回来的数。`);
