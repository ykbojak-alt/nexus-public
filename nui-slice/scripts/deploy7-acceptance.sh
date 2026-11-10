#!/usr/bin/env bash
# DEPLOY-7 ACCEPTANCE SCRIPT (pre-staged from DEPLOY-7-CHECKLIST.md, N.E.O.2)
# Gates: G1 G3 G4 G5 G6 G7 G8 (G2 = unit tests, опционально RUN_TESTS=1)
# Usage (bash / git-bash, roy1):
#   bash scripts/deploy7-acceptance.sh [OUT_DIR] [BASE_URL] [SSE_WINDOW_S]
# Defaults: OUT_DIR=D:/nexus/apps/nexus/out  BASE_URL=https://2.27.5.234.nip.io:4436  SSE_WINDOW=5
# Env: RUN_TESTS=1 (включить pnpm test, долго) · NEXUS_APP=apps/nexus (path for G2)
# 2026-11-10 minification-artifact audit (staged-verify, N.E.O.2): G1 herdr|hc-bridge|bus2 =
#   literal UI-строки (переживают минификацию, ок); G6/G7 переведены на широкие маркеры
#   'deck-screen' / 'api/deck' (без кавычек/равно) — minified bundle отдаёт JS-prop-форму
#   "data-testid":"…" и template-string `${base}/api/deck${path}`, кавычный grep = ложный 0.
# Exit: 0 = все BLOCKER PASS, 1 = есть FAIL (NOTE не влияют на exit).
set -u
OUT_DIR="${1:-D:/nexus/apps/nexus/out}"
BASE_URL="${2:-https://2.27.5.234.nip.io:4436}"
BASE_URL="${BASE_URL%/}"
SSE_WINDOW="${3:-5}"
RUN_TESTS="${RUN_TESTS:-0}"
PASS=0; FAIL=0; NOTE=0
ok(){ echo "  PASS | $1"; PASS=$((PASS+1)); }
bad(){ echo "  FAIL | $1"; FAIL=$((FAIL+1)); }
note(){ echo "  NOTE | $1"; NOTE=$((NOTE+1)); }
cu(){ curl -s --noproxy '*' --max-time 15 "$@"; }
echo "=== DEPLOY-7 ACCEPTANCE $(date '+%F %T') | OUT_DIR=$OUT_DIR | BASE_URL=$BASE_URL | SSE=${SSE_WINDOW}s ==="

# ---------- G1: grep out/ herdr|hc-bridge|bus2 = 0 (BLOCKER) ----------
g1=$(grep -ricI "herdr\|hc-bridge\|bus2" "$OUT_DIR" 2>/dev/null | grep -v ':0$')
g1f=$(printf '%s' "$g1" | grep -c . || true)
g1l=$(printf '%s\n' "$g1" | awk -F: '{s+=$NF} END{print s+0}')
if [ "$g1f" -eq 0 ]; then ok "G1 grep out/ herdr|hc-bridge|bus2 = 0 files / 0 lines"; else
  bad "G1 grep out/ = $g1f files / $g1l lines (user-visible hc/herdr strings)"; printf '%s\n' "$g1" | sed 's/^/       /' | head -12
fi

# ---------- G2: unit tests (опционально, RUN_TESTS=1) ----------
if [ "$RUN_TESTS" = "1" ]; then
  if (cd "D:/nexus" && pnpm -C "$NEXUS_APP" test 2>&1 | tail -5); then ok "G2 pnpm test PASS"; else bad "G2 pnpm test FAIL"; fi
else
  note "G2 unit tests skipped (RUN_TESTS=1 для включения)"
fi

# ---------- G3: baseline <785 KB shared (BLOCKER) ----------
# metric = JS-only byte-sum /_not-found initial refs (script src + modulepreload href, dedup) / 1024 (perf-budget.test.ts)
nf=$(cu "$BASE_URL/_not-found")
refs=$(printf '%s' "$nf" | grep -oE '(src|href)="[^"]+\.js"' | sed 's/^[a-z]*="//; s/"$//' | sort -u)
refcount=$(printf '%s' "$refs" | grep -c .)
# native Windows scratch path (MSYS /tmp is invisible to native curl here)
tmpdir="${NEXUS_SCRATCH:-D:/hermes/cache/scratch}/deploy7_g3_$$"
mkdir -p "$tmpdir"
total=0; i=0
while read -r p; do
  [ -n "$p" ] || continue
  case "$p" in http*) u="$p";; /*) u="$BASE_URL$p";; *) u="$BASE_URL/$p";; esac
  f="$tmpdir/chunk_$i.js"; i=$((i+1))
  curl -s --noproxy '*' --max-time 15 -o "$f" "$u" 2>/dev/null || : > "$f"
  s=$(wc -c < "$f" 2>/dev/null || echo 0); total=$((total+s))
done <<< "$refs"
rm -rf "$tmpdir"
kb=$(awk -v b="$total" 'BEGIN{printf "%.3f", b/1024}')
if awk -v k="$kb" 'BEGIN{exit !(k+0<785)}'; then ok "G3 baseline ${kb} KB ($refcount initial JS refs) < 785"; else bad "G3 baseline ${kb} KB >= 785 gate"; fi

# ---------- G4: smoke 13 routes (BLOCKER) ----------
routes="/ /mission-control /social /tools /tools/tplayer /hivebid /games/genesis /games/geneseis /newf /home /_not-found /programs /deck"
r_ok=0; r_bad=""
for r in $routes; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 15 "$BASE_URL$r")
  if [ "$c" = "200" ]; then r_ok=$((r_ok+1)); else r_bad="$r_bad $r=$c"; FAIL=$((FAIL+1)); fi
done
if [ "$r_ok" -eq 13 ]; then ok "G4 smoke 13/13 routes 200"; else bad "G4 smoke $r_ok/13 routes (non-200:$r_bad)"; PASS=$((PASS+r_ok)); fi

# ---------- G5: /api/deck/agents live-count + SSE window (BLOCKER) ----------
agents=$(cu "$BASE_URL/api/deck/agents")
live=$(printf '%s' "$agents" | grep -o '"state"[[:space:]]*:[[:space:]]*"live"' | wc -l)
[ "$live" -gt 0 ] && ok "G5 /api/deck/agents: live=$live (equivalence target для /deck DOM)" || bad "G5 /api/deck/agents: live=0 (mirror off?)"
sse=$(curl -sN --noproxy '*' --max-time "$SSE_WINDOW" "$BASE_URL/api/deck/events" | grep -c '^data:' || true)
[ "$sse" -gt 0 ] && ok "G5 SSE ${SSE_WINDOW}s window: events=$sse (поток жив)" || bad "G5 SSE ${SSE_WINDOW}s window: 0 events (обрыв/тишина)"

# ---------- G6: rail/deck DOM markers в билде + click-nav (BLOCKER markers / NOTE nav) ----------
# 2026-11-10 (staged-verify): широкий 'deck-screen' (НЕ data-testid="deck-screen"):
#   в chunks минификатор отдаёт JS-prop-форму "data-testid":"deck-screen" (без '='),
#   в SSR-HTML — атрибуционную data-testid="deck-screen". Широкий маркер ловит обе.
# 2026-11-10 fix (N.E.O.2, live-run): deck-rail — ленивый чанк (1rcah4jyp836y.js), в
#   initial-closure /_not-found НЕ preloadится (0 упоминаний) -> прежний check по closure
#   дал ложный 0. Переведён на whole-tree grep (как G7): маркер ОБЯЗАН быть в билде.
m=$(grep -rl "deck-screen" "$OUT_DIR" 2>/dev/null | wc -l)
if [ "$m" -gt 0 ]; then ok "G6 marker deck-screen в билде = $m файлов (whole-tree, minif-tolerant; deck-rail ленивый чанк)"; else bad "G6 marker deck-screen NOT in build (Phase C/rail не в билде?)"; fi
note "G6/L5 click-nav (/ и /newf rail chip -> /deck) = browser-step (manual/vision), headless curl не кликает"

# ---------- G7: /api/deck no-regression (BLOCKER) ----------
# 2026-11-10 (staged-verify): bundle-wiring = широкий 'api/deck' (БЕЗ кавычек/равно):
#   createDeckBridge минифицируется в template-string  `${base}/api/deck${path}`,
#   т.е. литерала "/api/deck" в bundle нет — кавычный grep даёт ложный 0.
w=$(grep -rl "api/deck" "$OUT_DIR" 2>/dev/null | wc -l)
[ "$w" -gt 0 ] && ok "G7 /api/deck wiring в out/ = $w файлов (широкий, minif-tolerant; PROJECTED)" || bad "G7 /api/deck wiring в out/ = 0 (createDeckBridge не в билде?)"
st=$(cu "$BASE_URL/api/deck/status")
sc=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 15 "$BASE_URL/api/deck/status")
if [ "$sc" = "200" ] && printf '%s' "$st" | grep -q '"connected": *true'; then ok "G7 /api/deck/status 200 connected:true"; else bad "G7 /api/deck/status -> $sc $(printf '%s' "$st" | head -c 80)"; fi
pc=$(curl -s -o /dev/null -w '%{http_code}' -X POST --noproxy '*' --max-time 15 "$BASE_URL/api/deck/status")
[ "$pc" = "404" ] && ok "G7 POST /api/deck/status = 404 (GET-only)" || bad "G7 POST /api/deck/status = $pc (ожидал 404)"

# ---------- G8/L6: honest-empty mirror-down (P2 owner-окно) ----------
note "G8/L6 honest-empty: НЕ exercised этим скриптом (owner-окно: остановить /root/nx-deck-mirror/nx_mirror.py → /deck data-state=disconnected + deck-conn-note, без fake-данных → восстановить)"

echo "=== SUMMARY: PASS=$PASS FAIL=$FAIL NOTE=$NOTE | G1=$g1f G3=${kb}KB G4=$r_ok/13 G5:live=$live,sse=$sse ==="
[ "$FAIL" -eq 0 ] && echo "VERDICT: READY (все BLOCKER PASS)" || echo "VERDICT: NOT READY (FAIL выше)"
exit $FAIL
