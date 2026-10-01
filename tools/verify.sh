#!/usr/bin/env bash
# One-shot browser verification: real Chrome, real DOM, real input events, scripted scenarios.
#
#   ./tools/verify.sh                 # 两条 URL 形态（根 / 与 Pages 的 /z-biz-game-kurotto-cos/）各跑一遍
#   LEGS="play win" ./tools/verify.sh
#   BASE_URL=https://z-biz-game.github.io/z-biz-game-kurotto-cos/ ./tools/verify.sh   # 追加已部署站点这一形态
#   GATE_SELFTEST=1 ./tools/verify.sh   # 阴性自证：种一条注定错的期望，必须点名变红并且 rc 非 0
#
# 这个仓的规矩，改之前先读：
#  * 每一腿一个自己的 --user-data-dir（mktemp -d 在 _tmp-verify 里），写完档的腿自己清档；
#    共用 profile 会让"续局"那条腿读到自己上一腿留下的档，看起来像绿其实什么都没测。
#  * 指针断言走 CDP Input.dispatch*（真事件），并且断言点击之前先断言 hit box：
#    getBoundingClientRect() 的中心要与 document.elementFromPoint() 对得上。display:grid 会盖掉
#    UA 的 [hidden]，所以"这一块藏起来了"必须由几何作证，不能假设。
#  * 片段导航不算重载：续局腿的证人（timeOrigin + doc + 哨兵）由 node 在派发导航之前取走。
#  * 不要加 --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader：软件光栅会占满
#    每一个核，而且在没有 CDP 客户端 attached 时 Chrome 根本不会自己退。
#  * macOS 没有 timeout：看门狗用后台子 shell + trap（下面的 WD）。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
PORT=${CDP_PORT:-9382}
# 5282 是本仓自己的端口；别的 agent 同时在跑各自仓的 verify.sh，端口撞了就会拿到"另一个仓"的
# index.html，那种绿比红更糟。
HTTP=${HTTP_PORT:-5282}
SELF=${GATE_SELFTEST:-0}
TMPD="$HERE/_tmp-verify"
rm -rf "$TMPD"; mkdir -p "$TMPD"
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

SPID=0
LOCAL=1
node "$HERE/server.cjs" "$HTTP" >"$TMPD/server.log" 2>&1 &
SPID=$!
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$HTTP/" >/dev/null 2>&1 && break
  sleep 0.25
done

SHAPES=("http://127.0.0.1:$HTTP/" "http://127.0.0.1:$HTTP/z-biz-game-kurotto-cos/")
if [ -n "${BASE_URL:-}" ]; then
  SHAPES+=("$BASE_URL")
  case "$BASE_URL" in "http://127.0.0.1:$HTTP"*) ;; *) LOCAL=0 ;; esac
fi

# Pre-flight: prove the bytes we are about to test are this app's, not some other repo's
# index.html served on the same port. 两种形态都要过——Pages 的前缀形态挂了就是 404。
for base in "${SHAPES[@]}"; do
  SERVED=$(curl -fsS -m 5 "$base" 2>/dev/null || true)
  case "$SERVED" in *js/main.js*) ;; *) echo "nothing served at $base (see $TMPD/server.log)" >&2; exit 2 ;; esac
  echo "$SERVED" | grep -qi kurotto || { echo "$base 不是クロット/kurotto：端口上坐着别的仓" >&2; exit 2; }
  echo "$SERVED" | grep -q クロット || { echo "$base 的 HTML 里没有 クロット" >&2; exit 2; }
  curl -fsS -m 5 "${base}js/engine/rules.js" >/dev/null || { echo "$base 下取不到 js/engine/rules.js" >&2; exit 2; }
  curl -fsS -m 5 "${base}js/engine/pencil.js" >/dev/null || { echo "$base 下取不到 js/engine/pencil.js" >&2; exit 2; }
done
echo "preflight: ${#SHAPES[@]} 个 URL 形态都 served 且带 kurotto/クロット 标记 — ${SHAPES[*]}"

CPID=0
UDD=""
cleanup() {
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$CPID" != 0 ] && kill -9 $CPID 2>/dev/null
  [ -n "$UDD" ] && rm -rf "$UDD"
}
trap cleanup EXIT
( sleep ${WD_TIMEOUT:-900}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

FAILED=0
REPORTS="$TMPD/reports.txt"; : >"$REPORTS"; export REPORTS
LEGS=${LEGS:-core play win mouse touch keys save}
# 每份报告的断言条数。README「闸的形状」那一节抄的就是这张表，tools/doctest.mjs 的 D8 逐条对账。
# 为什么在闸里数：条数是跑出来的读数，只写在文档上就会随代码漂——加了断言、删了断言，文档还在报
# 上一个世界的数，而"文档自己加起来等于自己"那道恒等式照样绿。这里数一次，文档那侧才有分母。
# GATE_SELFTEST 那一种多一条种下的红，所以下面按 +1 比。
EXPECTS='engine=21 gen=38 play=30 hint=16 win=20 layout=26 mouseleg=41 touchleg=44 keysleg=26 save=22 fragleg=4 resume=15 reloadleg=4 corrupt=16'
export EXPECTS

leg_start() {   # $1 = leg name, $2 = base url
  UDD=$(mktemp -d "$TMPD/udd-$1.XXXXXX")
  "$CHROME" --headless=new --remote-debugging-port=$PORT --user-data-dir="$UDD" \
    --window-size=900,900 --no-first-run --no-default-browser-check about:blank >"$TMPD/chrome-$1.log" 2>&1 &
  CPID=$!
  # A fresh --user-data-dir binds DevTools later than a warm profile: wait on the endpoint.
  for i in $(seq 1 120); do
    curl -fsS -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
    sleep 0.25
  done
  curl -fsS -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || {
    echo "  RED devtools never bound on :$PORT (leg $1)" >&2; FAILED=1; return 1; }
  export CDP_PORT=$PORT BASE_URL="$2"
  echo "--- leg $1 @ $2 (profile $UDD)"
}
leg_stop() {   # 每条腿自己收自己的尸：profile 一定要删，写完的档不能留给下一条腿
  [ "$CPID" != 0 ] && kill -9 $CPID 2>/dev/null
  wait $CPID 2>/dev/null
  [ -n "$UDD" ] && rm -rf "$UDD"
  CPID=0; UDD=""
}

parse() {   # $1 = leg name (used as the printed name when a run dies before any assertion)
  python3 -c "
import sys, json, os
leg, selfmode = sys.argv[1], sys.argv[2] == '1'
path = os.environ['RESULT_FILE']
raw = ''
try:
    with open(path) as f:
        for line in f:
            if line.startswith('RESULT '): raw = line[7:].strip()
except FileNotFoundError:
    pass
if not raw:
    print('  RED %s：没有 RESULT 行（这一腿一条断言都没跑到）' % leg); sys.exit(1)
try:
    d = json.loads(raw)
except Exception as e:
    print('  UNPARSED:', raw[:300]); sys.exit(1)
for r in d['rows']:
    if not r['pass']: print('  FAIL %-56s %s' % (r['test'], r['detail']))
if not d['rows']:
    print('  RED %s：NO CHECKS RUN — a leg that asserts nothing cannot be green' % leg); sys.exit(1)
planted = sum(1 for r in d['rows'] if r['test'].startswith('GATE_SELFTEST') and not r['pass'])
if selfmode:
    # 先记账再判：把没种上的报告也写进对数表，末尾那句「实到几份 / 点名几份」才是有分母的数，
    # 而不是"只有种上的才被数到"的自比较。
    open(os.environ['REPORTS'], 'a').write('%s %d\n' % (leg, planted))
    if planted == 0:
        print('  RED %s：这一份报告里没有种下的错期望（这条腿证明不了自己能红）' % leg); sys.exit(1)
# 条数对账：这份报告跑的断言数必须等于对数表里那格（自测模式多一条种下的红）。
name = leg.split('/')[-1]
table = dict(kv.split('=') for kv in os.environ['EXPECTS'].split())
if name not in table:
    print('  RED %s：对数表里没有「%s」这一份（新增或改名的报告必须登记条数，不能让文档抄一个猜的数）' % (leg, name)); sys.exit(1)
want = int(table[name]) + (1 if selfmode else 0)
if len(d['rows']) != want:
    print('  RED %s：断言 %d 条，对数表写 %d 条——文档「闸的形状」抄的就是这张表，漂了要当场说' % (leg, len(d['rows']), want)); sys.exit(1)
extra = {k: v for k, v in d.items() if k not in ('rows', 'fail')}
print('  %d checks, %d failed  %s' % (len(d['rows']), d['fail'], extra if extra else ''))
sys.exit(1 if d['fail'] else 0)
" "$1" "${SELF:-0}" || FAILED=1
}

run_scenario() {   # $1 name, $2 leg
  export RESULT_FILE="$TMPD/$2-$1.out"
  node tools/playtest.cjs scenario "$1" >"$TMPD/$2-$1.out" 2>"$TMPD/$2-$1.console.log"
  sed -n 's/^EVIDENCE /  EVID /p' "$TMPD/$2-$1.out"
  parse "$2/$1"
  if [ -s "$TMPD/$2-$1.console.log" ]; then
    echo "  --- console ($2/$1) ---"
    sed 's/^/  /' "$TMPD/$2-$1.console.log" | tail -10
  fi
}

run_cmd() {   # $1 = tag（文件名安全的腿名）, 其余 = playtest 参数
  local tag="$1"; shift
  export RESULT_FILE="$TMPD/$tag.cmd.out"
  node tools/playtest.cjs "$@" >"$TMPD/$tag.cmd.out" 2>"$TMPD/$tag.cmd.console.log"
  sed -n 's/^EVIDENCE /  EVID /p' "$TMPD/$tag.cmd.out"
  grep -q '^RESULT ' "$TMPD/$tag.cmd.out" && parse "$tag"
  return 0
}

for base in "${SHAPES[@]}"; do
  echo
  echo "########## URL 形态 $base ##########"
  for leg in $LEGS; do
    case $leg in
      core)
        leg_start core "$base" || continue
        node tools/playtest.cjs open "$base" | head -3
        BOOT=""
        for i in $(seq 1 60); do
          BOOT=$(node tools/playtest.cjs eval "window.kurotto?'ready':'nope'" nonav 2>/dev/null | tr -d '\n" ')
          case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
        done
        echo "  boot: kurotto $BOOT @ $base"
        run_scenario engine core
        run_scenario gen core
        leg_stop ;;
      play)
        leg_start play "$base" || continue
        run_scenario play play
        run_scenario hint play
        leg_stop ;;
      win)
        leg_start win "$base" || continue
        run_scenario win win
        run_scenario layout win
        leg_stop ;;
      mouse)
        leg_start mouse "$base" || continue
        run_cmd mouseleg leg mouse
        leg_stop ;;
      touch)
        leg_start touch "$base" || continue
        run_cmd touchleg leg touch
        leg_stop ;;
      keys)
        leg_start keys "$base" || continue
        run_cmd keysleg leg keys
        leg_stop ;;
      save)
        leg_start save "$base" || continue
        run_scenario save save
        # 证人必须在派发导航之前拿到：node 先把 timeOrigin/doc/哨兵读回来。
        W=$(node tools/playtest.cjs witness | tail -1)
        echo "  WITNESS $W"
        # 证人不在场，续局腿就没有可比的东西：这里必须当场红，不能拖到 resume 里变成"一条断言都没跑"。
        case "$W" in *'"doc"'*) ;; *) echo "  RED witness 没拿到读数（续局腿没有证人＝没跑）：$W" >&2; FAILED=1 ;; esac
        export WITNESS="$W"
        # 对照腿：片段导航不算重载 —— timeOrigin 与文档身份都不许变。
        run_cmd fragleg nav "${base}#gate-fragment-nav" same
        # 续局腿：scenario 自己会做一次真导航，所以这里拿到的一定是新文档。
        run_scenario resume save
        # 坏档：顺序很重要。先真重载拿到一个干净的文档，再把坏 payload 种下去——
        # 反过来做的话，重载那一下的 pagehide 会让这个文档把它自己那局合法存档写回去，
        # 刚种下的坏档在 scenario 读到它之前就被覆写了。persistOff 一并摘掉写入（本页只读不写，
        # 开关由页面提供：ESM 的 namespace 属性是只读的，import * 那份 Store.save 写不进去）。
        # 这仓没有 #hash 深链，所以不需要抹 URL——重载之后 URL 本来就没有片段。
        run_cmd reloadleg reload
        node tools/playtest.cjs eval "window.__plantedGarbage='6 payloads';
          window.kurotto.pausePersist();
          localStorage.setItem('kurotto.save', JSON.stringify({v:1,n:'slant',tier:7,seed:'20261001',cell:'zzz',marks:[],__kt_garbage__:1}));
          localStorage.getItem('kurotto.save')" nonav >/dev/null 2>&1
        run_scenario corrupt save
        leg_stop ;;
      *)
        # 未知腿名必须红，不能"匹配不到就算跑完了"：LEGS=hint 曾经一声不响地跑出
        # === ALL GREEN === 而一份报告都没有（hint 是 play 腿里的一条 scenario，不是腿名）。
        # ${leg} 的花括号不是装饰：没有 LANG 的环境里裸写 `$leg（` 会把全角括号的首字节算进
        # 变量名，报 unbound variable——红是红了，但点不出是哪个腿名。
        echo "  RED 未知的腿：${leg}（LEGS 只认 core play win mouse touch keys save）" >&2
        FAILED=1 ;;
    esac
  done
done

if [ "$SELF" = 1 ]; then
  echo
  echo "=== GATE_SELFTEST：种下的期望必须点名变红 ==="
  echo "  planted rows: scenarios.js 在 __selftest 为真时给每一份报告加一条 1==2，"
  echo "                node 侧的腿（真事件 / nav / reload）由 playtest.cjs 的 result() 加同一条"
  # 对数：一份报告对应一条种下的红。少一份＝那条腿这一轮根本没跑（或种期望的代码漂了），
  # 光看 rc≠0 是分不清这两件事的。
  EXPECTED=0
  for leg in $LEGS; do
    case $leg in
      core|play|win) EXPECTED=$((EXPECTED + 2)) ;;
      mouse|touch|keys) EXPECTED=$((EXPECTED + 1)) ;;
      save) EXPECTED=$((EXPECTED + 5)) ;;
      *) echo "  RED 未知的腿：${leg}（对数表里没有它）" >&2; FAILED=1 ;;
    esac
  done
  EXPECTED=$((EXPECTED * ${#SHAPES[@]}))
  GOT=$(wc -l <"$REPORTS" | tr -d ' ')
  HIT=$(awk '$2 > 0' "$REPORTS" | wc -l | tr -d ' ')
  echo "  应有 $EXPECTED 份报告，实到 $GOT 份，其中 $HIT 份点名吃下了种下的错"
  if [ "$GOT" != "$EXPECTED" ]; then
    echo "  RED 阴性自证的报告数对不上：$GOT ≠ $EXPECTED（有腿没跑，或对数表漂了）" >&2
    FAILED=1
  fi
  if [ "$FAILED" = 0 ]; then
    echo "  RED 阴性自证失败：闸没能把种下的错期望跑红（这个闸证明不了自己会红）" >&2
    FAILED=1
  elif [ "$HIT" != "$EXPECTED" ]; then
    echo "  RED 阴性自证只被 $HIT/$EXPECTED 份报告点名（差的那些腿从没红过＝没被证明会红）" >&2
    FAILED=1
  else
    echo "  ok 闸确实会红，且 rc 非 0"
  fi
fi

kill $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE (rc=$FAILED) ==="
exit $FAILED
