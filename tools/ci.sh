#!/usr/bin/env bash
# 本地一条命令跑齐 ci.yml 的两个 job。这张清单不是手抄的权威：tools/doctest.mjs 的 D15 拿
# ci.yml 现读出来的每一个 tools/* 门禁来比对，这里漏一步就是那一条红。它补的是"本地没有入口"
# 这一格——tools/verify.sh 是浏览器整闸，它自己只顺带跑 deploy-set 两步，check job 那八步
# （engine-test / doctest / balance / 台账 GATE / 入口文件 / npm run check）以前在本地要按顺序手敲，
# 跳过哪一步就得等 CI 才第一次说话。
#
# 台账为什么不并进 tools/verify.sh：K7–K10 那几把刀改的就是 verify.sh 自己，而 bash 是边读边
# 执行的——让一个还在跑的脚本被自己的台架原地改写，红不红就取决于解析偏移，那种绿不能用。
# 所以台账排在 verify 之前，作为独立的一步（GATE=1 是门禁模式：只打 node 侧的刀、不回写 README）。
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1
LOG=${1:-../_tmp-kurotto-ci.log}
FAILED=0
: >"$LOG"
run() {
  name=$1
  shift
  echo "=== $name ==="
  "$@" >>"$LOG" 2>&1
  step_rc=$?
  echo "${name}_RC=$step_rc" >>"$LOG"
  if [ "$step_rc" = 0 ]; then
    echo "  ok $name"
  else
    echo "  RED $name rc=$step_rc（那一步的读数在 $LOG）"
    FAILED=1
  fi
}
# 阴性自证那一步的极性是反的：它必须红。红了还要点名是哪条断言吃下了那颗注定错的期望，
# 否则「rc 非 0」可能只是崩了。
run_must_fail() {
  name=$1
  shift
  echo "=== $name（必须红） ==="
  # 这一步的输出先落在自己那一份文件里再并进总日志：拿整份总日志去 grep FAIL，前一步残留的
  # 一条 FAIL 就能替这一步"点名"，红了也算没说清是谁红的。
  "$@" >"$LOG.$name" 2>&1
  step_rc=$?
  cat "$LOG.$name" >>"$LOG"
  echo "${name}_RC=$step_rc" >>"$LOG"
  if [ "$step_rc" = 0 ]; then
    echo "  RED $name 竟然全绿：这一跑没有证明它会红"
    FAILED=1
  elif ! grep -q 'FAIL' "$LOG.$name"; then
    echo "  RED $name 红了但没有点名是哪条断言（rc=$step_rc）"
    FAILED=1
  else
    echo "  ok $name（如期红，rc=$step_rc）"
  fi
}
run check npm run check
run engine-test node tools/engine-test.mjs
run doctest node tools/doctest.mjs
run balance env SAMPLES=20 node tools/balance.mjs
run entry-files sh -c "test -f index.html && grep -q '<canvas' index.html && grep -q 'js/main.js' index.html && grep -q 'kurotto' index.html"
run ledger env GATE=1 node tools/sabotage.mjs
run deploy-set node tools/deploy-set.mjs
run deploy-set-selftest node tools/deploy-set-selftest.mjs
run verify env WD_TIMEOUT=900 bash tools/verify.sh
run_must_fail verify-selftest env WD_TIMEOUT=900 GATE_SELFTEST=1 bash tools/verify.sh
if [ "$FAILED" = 0 ]; then
  echo "=== 全绿（逐步 rc 写在自己那份日志末尾：$LOG）"
else
  echo "=== 有步骤红，上面点名的就是它（逐条读数在 $LOG）"
fi
exit $FAILED
