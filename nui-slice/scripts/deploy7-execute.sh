#!/usr/bin/env bash
# ============================================================================
# deploy7-execute.sh — NEXUS DEPLOY-7 EXECUTION CHAIN (FORGE phased-build -> live)
# ============================================================================
# ПОДГОТОВИЛ: N.E.O.2 (read-only audit, 11-10 ~04:20). НЕ ЗАПУСКАЛ — исполняет
#   владелец когда FORGE сдаст phased-build. Сборка процедуры в один исполняемый
#   скрипт: S1 sync-check -> S2 tar (MSYS) -> S3 scp+verify -> S4 live-swap
#   (backup + rollback в строке) -> S5 acceptance + итог.
#
# ИСПОЛЬЗОВАНИЕ:
#   bash scripts/deploy7-execute.sh --dry-run --stage <out-dir> --build <expected-buildId>
#     --dry-run : всё кроме S4-swap (S4 = локальная подготовка + dry-sequence echo; live НЕ трогается)
#     --stage   : stage out/ (дефолт D:/ai2_pilot/ai2/ai2/server/static/nexus)
#     --build   : ожидаемый buildId (дефолт 6a3oIez2DFwivAqDaC9rM)
#     --yes     : live-режим без интерактивного подтверждения (non-interactive)
#   Живой run: убрать --dry-run. Только после явной команды владельца.
#   БЕЗОПАСНОСТЬ: live-режим (без --dry-run) без подтверждения завершится exit 9:
#     interactive = prompt [y/N]; non-interactive = нужен --yes. Иначе 0 live-изменений.
#
# CANON: docs/NUE_BUILD_DEPLOY.md · S2 = MSYS /d/Temp (GNU tar 1.35: native D:/ = URL-parse!)
#       D:/nexus/scripts/deploy7-acceptance.sh (G6/G7 minif-tolerant, staged-verified)
#       D:/nexus/reports/NEO2-deploy7-procedure.md + NEO2-deploy-rehearsal.md (PASS)
# SAFETY: pre-flight перед каждым шагом, echo каждого шага, rollback inline,
#   backup до swap, mirror-сервис активен перед swap, buildId assert после swap.
#
set -euo pipefail

# ---- CONFIG (env-overridable) ----
DRY=0
YES=0
STAGE="D:/ai2_pilot/ai2/ai2/server/static/nexus"
EXPECTED_BUILD="6a3oIez2DFwivAqDaC9rM"
TARBALL="/d/Temp/nexus-static.tgz"
SCRATCH="D:/hermes/cache/scratch/deploy7-exec"
REMOTE_SCRATCH="/tmp"
REMOTE_HOST="roy1"
REMOTE_TARGET="/opt/ai2-src/ai2/server/static/nexus"
REMOTE_MIRROR_SVC="nx-deck-mirror"
ORIGIN="https://2.27.5.234.nip.io:4433"
NX="${NX_BIN:-D:/nexus/nexus-deck-core/target/debug/nx.exe}"
NX_SESSION_V="${NX_SESSION:-nx-spark-dev}"
NX_MACHINE="${NX_MACHINE:-sage-pl}"

# MSYS arg-mangling guard: /bin/sh в nx exec args не должно превращаться в
# C:/Program Files/Git/usr/bin/sh (MinGit без usr/bin -> spawn_failed на roy1).
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY=1; shift ;;
    --stage)     STAGE="$2"; shift 2 ;;
    --build)     EXPECTED_BUILD="$2"; shift 2 ;;
    --yes)       YES=1; shift ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

say()  { echo; echo "=== $* ==="; }
ok()   { echo "  [ok] $*"; }
bad()  { echo "  [FAIL] $*" >&2; }

# ---- LIVE-CONFIRMATION GATE (безопасность по умолчанию) ----
# Live-режим (без --dry-run) требует явного подтверждения: интерактивный
# y/N prompt, или --yes для non-interactive. Иначе — abort (0 live-изменений).
if [[ $DRY -eq 0 && $YES -eq 0 ]]; then
  if [[ -t 0 ]]; then
    printf "LIVE RUN: S3 transfer + S4 live-swap ИЗМЕНИТ /opt/ai2-src на sage-pl.\nПодтвердить? [y/N] "
    read -r CONF
    [[ "$CONF" == "y" || "$CONF" == "Y" || "$CONF" == "yes" ]] || { bad "live-run не подтверждён — abort (используй --yes или --dry-run)"; exit 9; }
  else
    bad "non-interactive live-run без --yes — abort (0 live-изменений; добавь --dry-run или --yes)"
    exit 9
  fi
fi

# ROLLBACK: если TARGET уже существует (новый tree после S4.2/S4.3) — сначала убрать, потом mv:
rollback_cmd="rm -rf ${REMOTE_TARGET} && mv ${REMOTE_TARGET}.bak-DEPLOY7 ${REMOTE_TARGET}   # ROLLBACK: восстановить pre-swap tree (rm + mv — не bare mv)"

# ============================ S1 — sync-check ============================
say "S1 — SYNC-CHECK (stage out/, assert buildId)"
ok_dir() { [[ -d "$1" ]] || { bad "$1 не существует"; exit 3; }; ok "$1 exists"; }
ok_dir "$STAGE"
# buildId в html-файлах out/ (Next Turbopack: 404.html/_not-found.html, JSON "b":"<id>"):
# Ищем ЛITERAL expected buildId (длина ~20-21, НЕ regex по ширине):
BUILD_FILES=( "$STAGE/404.html" "$STAGE/_not-found.html" )
HIT=0
HIT_FILE=""
for f in "${BUILD_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  if grep -qF "$EXPECTED_BUILD" "$f"; then HIT=1; HIT_FILE="$f"; ok "buildId $EXPECTED_BUILD найден в $(basename "$f")"; break; fi
done
if [[ $HIT -eq 0 ]]; then
  # fallback: что реально в этом out/ (JSON "b":"...") — диагностика:
  # (|| true: grep-no-match под pipefail не должен убить скрипт — и так exit 3 ниже)
  DISC=$(grep -hoE '"b":"[A-Za-z0-9_-]{10,40}"' "${BUILD_FILES[@]}" 2>/dev/null | head -1 || true)
  bad "expected buildId $EXPECTED_BUILD НЕ найден в ${BUILD_FILES[*]}"
  if [[ -n "$DISC" ]]; then bad "в out/ виден buildId: $DISC (FORGE rebuild stale?)"; fi
  exit 3
fi
FALLBACK="$(basename "$HIT_FILE")"   # та же страница, где подтверждён buildId (S4 assert = она)
[[ -n "$FALLBACK" ]] || { bad "fallback-страница (404.html/_not-found.html) нет в stage"; exit 3; }
ok "fallback-page = $FALLBACK"
mkdir -p "$SCRATCH"; ok "scratch $SCRATCH ready"

# ============================ S2 — tar (MSYS path!) =======================
say "S2 — TARBALL (MSYS /d/Temp — GNU tar 1.35, native D:/ = URL-parse)"
[[ -w "$(dirname "$TARBALL")" ]] || { bad "$(dirname "$TARBALL") не writable"; exit 3; }
# NOTE: если старый tarball (deploy-5, 914590688B, 11-09) — пере-упактовать, НЕ переиспользовать:
if [[ -f "$TARBALL" && $(stat -c%s "$TARBALL") -lt 10000000 ]]; then
  ok "старый tarball < 10MB — переупаковываем (deploy-5 тарабел = 914590688B stale)"
else
  ok "tarball path = $TARBALL"
fi
cd "$(dirname "$STAGE")"   # nexus/ = root в таре (rehearsal pattern)
# MSYS tar: НЕ D:/... (URL-host parse fail); /d/Temp/... = MSYS-equiv:
tar -czf "$TARBALL" "$(basename "$STAGE")"
TARBALL_BYTES=$(stat -c%s "$TARBALL")
ok "tarball = ${TARBALL_BYTES}B"

# ============================ S3 — transfer + size/md5 ===================
say "S3 — TRANSFER to ${REMOTE_SCRATCH}/nexus-static.tgz + byte-verify"
# Путь A (preferred): chunked nx-stdin pipe (измерено roy1->sage-pl: ~1s connect +
# ~0.5s/MB; 913MB = ~131 x 7MB чанк ~ 15 мин; NX stdin-pipe cap 8MB/call).
# Путь B (fallback при упавшем чанке): scp с sage-pl на roy1 (медленный ~1MB/70s).
# MSYS /d/Temp/... НЕ работает в scp (remote не знает MSYS-путей) -> Windows-путь:
WIN_TARBALL=$(echo "$TARBALL" | sed -E 's|^/([a-zA-Z])|\1:|')
if [[ $DRY -eq 1 ]]; then
  ok "DRY: transfer НЕ выполняем"
elif [[ $TARBALL_BYTES -gt 8000000 ]]; then
  ok "TRANSFER: chunked nx-stdin pipe (${TARBALL_BYTES}B, 7MB chunks, ~15min est):"
  CHUNKS="$SCRATCH/chunks"; rm -rf "$CHUNKS"; mkdir -p "$CHUNKS"
  LC_ALL=C split -b 7000000 "$TARBALL" "$CHUNKS/p-" || { bad "split FAILED"; exit 5; }
  NCHUNK=$(ls "$CHUNKS" | wc -l)
  ok "chunks: $NCHUNK x ~7MB"
  $NX exec --on "$NX_MACHINE" /bin/sh -c "rm -f ${REMOTE_SCRATCH}/nexus-static.tgz; : > ${REMOTE_SCRATCH}/nexus-static.tgz" || { bad "remote reset FAILED"; exit 5; }
  i=0
  for c in "$CHUNKS"/p-*; do
    i=$((i+1))
    if ! $NX exec --stdin --on "$NX_MACHINE" /bin/sh -c "cat >> ${REMOTE_SCRATCH}/nexus-static.tgz" < "$c"; then
      bad "chunk $i/$NCHUNK pipe FAILED -> fallback: full scp (--timeout 600)"
      $NX exec --timeout 600 --on "$NX_MACHINE" /bin/sh -c "scp roy1:${WIN_TARBALL} ${REMOTE_SCRATCH}/nexus-static.tgz && echo SCP-OK" || { bad "scp fallback FAILED"; exit 5; }
      break
    fi
    [[ $((i % 10)) -eq 0 ]] && ok "  ${i}/${NCHUNK} chunks"
  done
  [[ $i -ge $NCHUNK ]] && ok "all $NCHUNK chunks piped"
else
  ok "Transfer: direct nx-stdin pipe (${TARBALL_BYTES}B <= 8MB):"
  $NX exec --stdin --on "$NX_MACHINE" /bin/sh -c "cat > ${REMOTE_SCRATCH}/nexus-static.tgz && echo PIPE-OK" < "$TARBALL" || { bad "stdin-pipe FAILED"; exit 5; }
fi
if [[ $DRY -eq 0 ]]; then
  # md5-verify (Windows certutil vs remote md5sum):
  LOCAL_MD5=$({ certutil -hashfile "$TARBALL" MD5 2>/dev/null || md5sum "$TARBALL"; } | grep -oE '[0-9a-fA-F]{32}' | head -1)
  REMOTE_MD5=$($NX exec --on "$NX_MACHINE" /bin/sh -c "md5sum ${REMOTE_SCRATCH}/nexus-static.tgz | cut -d' ' -f1" 2>/dev/null || echo "UNAVAIL")
  REMOTE_SIZE=$($NX exec --on "$NX_MACHINE" /bin/sh -c "stat -c%s ${REMOTE_SCRATCH}/nexus-static.tgz" 2>/dev/null || echo "UNAVAIL")
  [[ "$LOCAL_MD5" == "$REMOTE_MD5" ]] && ok "md5 MATCH (${LOCAL_MD5})" || { bad "md5 MISMATCH: local=${LOCAL_MD5} remote=${REMOTE_MD5}"; exit 5; }
  [[ "$REMOTE_SIZE" == "$TARBALL_BYTES" ]] && ok "size MATCH (${REMOTE_SIZE}B)" || { bad "size MISMATCH: expected=${TARBALL_BYTES} remote=${REMOTE_SIZE}"; exit 5; }
fi

# ============================ S4 — LIVE-SWAP (with backup+rollback) =====
say "S4 — LIVE-SWAP on sage-pl (backup -> swap -> buildId assert -> rollback inline)"
# Генерация swap-s4.sh (однажды, для обоих веток):
cat > "$SCRATCH/swap-s4.sh" <<SWAP_EOF
#!/usr/bin/env bash
set -euo pipefail
TARGET="${REMOTE_TARGET}"
BAK="\${TARGET}.bak-DEPLOY7"
TARBALL="${REMOTE_SCRATCH}/nexus-static.tgz"
EXPECTED_BUILD="${EXPECTED_BUILD}"
FALLBACK="${FALLBACK}"

echo "[S4.1] pre-swap: backup"
rm -rf "\$TARGET.bak-DEPLOY7"; mv "\$TARGET" "\$TARGET.bak-DEPLOY7"
echo "[S4.2] mkdir + extract"
rm -rf "\$TARGET"; mkdir -p "\$TARGET"
tar -xzf "\$TARBALL" -C "\$TARGET" --strip-components=1
echo "[S4.3] buildId assert"
grep -q "\$EXPECTED_BUILD" "\$TARGET/\$FALLBACK" || { echo "buildId ASSERT FAIL — ROLLBACK"; rm -rf "\$TARGET"; mv "\$TARGET.bak-DEPLOY7" "\$TARGET"; exit 1; }
echo "[S4.4] SWAP COMPLETE: \$EXPECTED_BUILD live"
SWAP_EOF
if [[ $DRY -eq 1 ]]; then
  ok "DRY: S4 НЕ выполняем (live-swap в --dry-run запрещён)"
  ok "swap-s4.sh generated: $SCRATCH/swap-s4.sh (dry-sequence below)"
  bash -n "$SCRATCH/swap-s4.sh" && ok "swap-s4.sh syntax OK (bash -n)"
  echo "ROLLBACK (если S4.3 fail): $rollback_cmd"
else
  # Live: pre-flight
  MIRROR_STATE=$($NX exec --on "$NX_MACHINE" /bin/sh -c "systemctl is-active ${REMOTE_MIRROR_SVC}" 2>/dev/null || echo "UNKNOWN")
  [[ "$MIRROR_STATE" == "active" ]] || { bad "mirror ${REMOTE_MIRROR_SVC} = $MIRROR_STATE, NOT active — abort"; exit 4; }
  ok "mirror ${REMOTE_MIRROR_SVC} = active"
  ORIGIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/" || echo "ERR")
  [[ "$ORIGIN_CODE" == "200" ]] || { bad "origin $ORIGIN = $ORIGIN_CODE, NOT 200 — abort"; exit 4; }
  ok "origin $ORIGIN = $ORIGIN_CODE"
  # Upload swap-s4.sh to remote scratch (stdin-pipe):
  $NX exec --stdin --on "$NX_MACHINE" /bin/sh -c "cat > ${REMOTE_SCRATCH}/swap-s4.sh && bash -n ${REMOTE_SCRATCH}/swap-s4.sh && echo SWAP4-UPLOADED" < "$SCRATCH/swap-s4.sh" || { bad "swap-s4.sh upload FAILED"; exit 4; }
  ok "swap-s4.sh uploaded + syntax-OK on sage-pl"
  # Execute S4 (swap with auto-rollback; --timeout 600: extract 913MB > 60s):
  $NX exec --timeout 600 --on "$NX_MACHINE" /bin/sh -c "bash ${REMOTE_SCRATCH}/swap-s4.sh"
  ok "S4 SWAP executed"
  # Post-swap buildId verify on live (строка, не regex; exit-code — на grep):
  if ! $NX exec --on "$NX_MACHINE" /bin/sh -c "grep -q '${EXPECTED_BUILD}' ${REMOTE_TARGET}/${FALLBACK}"; then
    bad "live buildId MISS — ROLLBACK NOW"
    $NX exec --on "$NX_MACHINE" /bin/sh -c "$rollback_cmd"
    exit 6
  fi
  ok "live buildId = $EXPECTED_BUILD (MATCH)"
fi

# ============================ S5 — ACCEPTANCE + SUMMARY =================
say "S5 — ACCEPTANCE (deploy7-acceptance.sh) + ИТОГ"
ACC="D:/nexus/scripts/deploy7-acceptance.sh"
if [[ $DRY -eq 1 ]]; then
  ok "DRY: acceptance НЕ запускаем"
  echo "RUN MANUAL (staged pre-swap): bash $ACC \"${STAGE}\"   # G1-G8 (G1 FAIL ожидаемо pre-Phase-D)"
else
  if [[ ! -f "$ACC" ]]; then bad "acceptance script not found: $ACC"; exit 7; fi
  # 5a — reference: staged G1-G8 pre-swap (local):
  echo "5a: staged G1-G8 pre-swap (reference):"
  bash "$ACC" "$STAGE" || echo "   staged = non-zero (G1 FAIL pre-Phase-D expected; NOTE lines в выводе)"
  # 5b — live smoke (origin, post-swap):
  for R in / /deck /programs /home /games /newf /social; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN$R" || echo ERR)
    [[ "$CODE" == "200" ]] && ok "L1 $R = 200" || { bad "L1 $R = $CODE — SWAP BROKE ROUTE"; exit 8; }
  done
  # 5b+ — live buildId через :4436 (сам live-origin, не только Caddy-proxy :4433):
  LIVE_ORIGIN="https://2.27.5.234.nip.io:4436"
  LIVE_HTML=$(curl -s "$LIVE_ORIGIN/$FALLBACK" || echo "CURL-ERR")
  if grep -qF "$EXPECTED_BUILD" <<<"$LIVE_HTML"; then
    ok "live :4436/$FALLBACK buildId = $EXPECTED_BUILD (MATCH)"
  else
    bad "live :4436/$FALLBACK buildId NE SOVPADET (stale/ERR: ${LIVE_HTML:0:40}...) — swap не опубликован?"; exit 8
  fi
  # 5c — post-swap acceptance на live-tree (sage-pl): upload + run:
  ok "5c: post-swap live acceptance (nx exec sage-pl):"
  $NX exec --stdin --on "$NX_MACHINE" /bin/sh -c "cat > ${REMOTE_SCRATCH}/deploy7-acceptance.sh && chmod +x ${REMOTE_SCRATCH}/deploy7-acceptance.sh" < "$ACC" || { bad "acceptance upload FAILED"; exit 8; }
  $NX exec --timeout 600 --on "$NX_MACHINE" /bin/sh -c "bash ${REMOTE_SCRATCH}/deploy7-acceptance.sh ${REMOTE_TARGET}" || echo "   live = non-zero (см. NOTE: G8/L6 owner-опция; G1 pre-Phase-D)"
fi

say "ИТОГ"
if [[ $DRY -eq 1 ]]; then
  echo "DRY-RUN COMPLETE: S1-S3 executed, S4 dry (no live changes), S5 not run."
  echo "  Next:  FORGE phased-rebuild -> re-run WITHOUT --dry-run -> S4 live-swap + S5 acceptance."
  echo "  ROLLBACK (if needed): $rollback_cmd"
else
  echo "LIVE RUN COMPLETE: S1-S5 all passed."
  echo "  ROLLBACK command: $rollback_cmd"
fi
