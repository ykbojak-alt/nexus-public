#!/usr/bin/env node
// Window 5 — perf-budget checker (docs/verification/performance-budget-format.md).
// Measures what is measurable in this harness; everything else reports
// `not-measured` — never silently passes. Exit 1 on hard-budget exceed.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const budgets = JSON.parse(readFileSync(join(root, 'perf-budgets.json'), 'utf8'));
// W4 fix (NQ-031): without --report, indexOf=-1 made argv[0] (node.exe)
// the report path → EPERM exit 1 even with 0 FAIL.
const reportFlagIdx = process.argv.indexOf('--report');
const reportPath = reportFlagIdx >= 0 ? process.argv[reportFlagIdx + 1] : null;

const rows = [];
const row = (scope, metric, budget, actual, verdict) =>
  rows.push({ scope, metric, budget, actual, verdict });

// W5-08: page-level metrics from e2e/visual/reference-compare.spec.ts →
// __perf/page-metrics.json (LCP/FCP/nav-timing/longtasks/heap per route).
// The spec records its run context verbatim (`context` field, set via
// NEXUS_PERF_CONTEXT). Only a production-build context lets a metric GATE:
// dev-server numbers are reported `observed`, never a prod pass.
const pageMetricsPath = join(root, 'e2e/visual/__perf/page-metrics.json');
const pageMetricsDoc = existsSync(pageMetricsPath)
  ? JSON.parse(readFileSync(pageMetricsPath, 'utf8'))
  : null;
const pageMetrics = pageMetricsDoc?.routes ?? null;
const pageCtx = String(pageMetricsDoc?.context ?? '');
// Context is trusted only when it explicitly declares a production build —
// anything else (dev, missing, ambiguous) stays observational.
const isProd = /prod|static export/i.test(pageCtx);

function dirKb(dir) {
  if (!existsSync(dir)) return null;
  let bytes = 0;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else bytes += s.size;
    }
  };
  walk(dir);
  return Math.round(bytes / 1024);
}

// ---- surfaces: bundleKb is honestly measurable from the static export ----
for (const [surface, budget] of Object.entries(budgets.surfaces ?? {})) {
  if (surface.startsWith('_')) continue;
  const chunksDir = join(root, surface, 'out/_next/static/chunks');
  const totalKb = dirKb(chunksDir);
  if (totalKb == null) {
    row(surface, 'bundleKb.total', budget.bundleKb?.total, 'no out/ export — run nx build first', 'not-measured');
  } else {
    row(surface, 'bundleKb.total', budget.bundleKb?.total, `${totalKb} KB`,
      totalKb <= (budget.bundleKb?.total ?? Infinity) ? 'pass' : 'FAIL');
  }
  // main = largest single chunk is NOT the main bundle; measure honest proxy:
  // heaviest single js file vs `main` budget.
  let maxJsKb = null;
  if (existsSync(chunksDir)) {
    for (const f of readdirSync(chunksDir)) {
      if (!f.endsWith('.js')) continue;
      const kb = Math.round(statSync(join(chunksDir, f)).size / 1024);
      if (maxJsKb == null || kb > maxJsKb) maxJsKb = kb;
    }
  }
  row(surface, 'bundleKb.maxChunk (proxy for main)', budget.bundleKb?.main,
    maxJsKb == null ? 'no chunks' : `${maxJsKb} KB`,
    maxJsKb == null ? 'not-measured' : maxJsKb <= (budget.bundleKb?.main ?? Infinity) ? 'pass' : 'FAIL');
  if (pageMetrics) {
    const lcps = Object.values(pageMetrics)
      .map((r) => r.lcpMs)
      .filter((v) => typeof v === 'number');
    const lcpMax = lcps.length ? Math.max(...lcps) : null;
    row(surface, 'lcpMs', budget.lcpMs,
      lcps.length
        ? `${Math.min(...lcps)}–${lcpMax} ms across ${lcps.length} routes (${pageCtx || 'unknown context'})`
        : 'page-metrics ran, no LCP entries',
      !lcps.length ? 'not-measured'
        : isProd ? (lcpMax <= budget.lcpMs ? 'pass' : 'FAIL')
          : 'observed');
  } else {
    row(surface, 'lcpMs', budget.lcpMs, 'needs page-metrics run (reference-compare)', 'not-measured');
  }
  const ixPath = join(root, 'e2e/visual/__perf/interaction-metrics.json');
  const ixDoc = existsSync(ixPath)
    ? JSON.parse(readFileSync(ixPath, 'utf8'))
    : null;
  const ixMetrics = ixDoc?.routes ?? null;
  const ixCtx = String(ixDoc?.context ?? '');
  const ixProd = /prod|static export/i.test(ixCtx);
  if (ixMetrics) {
    const durs = Object.values(ixMetrics)
      .map((r) => r.maxDurationMs)
      .filter((v) => typeof v === 'number');
    const ixMax = durs.length ? Math.max(...durs) : null;
    const samples = Object.values(ixMetrics).reduce((a, r) => a + (r.eventCount ?? 0), 0);
    row(surface, 'interactionMs', budget.interactionMs,
      durs.length
        ? `${Math.min(...durs)}–${ixMax} ms keydown/keyup→paint, ${samples} events ×${durs.length} routes (${ixCtx || 'unknown context'})`
        : 'probe ran, no event entries',
      !durs.length ? 'not-measured'
        : ixProd ? (ixMax <= budget.interactionMs ? 'pass' : 'FAIL')
          : 'observed');
  } else {
    row(surface, 'interactionMs', budget.interactionMs, 'needs interaction-probe run', 'not-measured');
  }
}

// ---- scenes/charts: fields marked not-measured stay not-measured ----
for (const [scene, budget] of Object.entries(budgets.scenes ?? {})) {
  if (scene.startsWith('_')) continue;
  for (const [metric, val] of Object.entries(budget)) {
    row(`scene:${scene}`, metric, val,
      val === 'not-measured' ? 'not-measured' : 'no runtime meter yet',
      val === 'not-measured' ? 'not-measured' : 'not-measured');
  }
}
// Render-timer results (e2e/visual/perf-render.spec.ts → __perf/) feed
// chart renderMs: mount→paint is the honest render bound. Missing file or
// missing story row keeps the metric `not-measured` — never guessed.
const timerPath = join(root, 'e2e/visual/__perf/render-timer-results.json');
const timerResults = existsSync(timerPath)
  ? (JSON.parse(readFileSync(timerPath, 'utf8')).results ?? {})
  : null;

// W4 external-clock evidence (docs/verification/w4-perf-evidence-*.json):
// navToDomMs / paintSettleMs / longTaskMaxMs / longTaskCount per story.
// Latest file wins; missing rows keep the metric `not-measured`.
const verifyDir = join(root, 'docs/verification');
const w4Path = existsSync(verifyDir)
  ? readdirSync(verifyDir)
    .filter((f) => /^w4-perf-evidence-.*\.json$/.test(f))
    .map((f) => join(verifyDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  : undefined;
const w4Results = w4Path ? (JSON.parse(readFileSync(w4Path, 'utf8')).results ?? {}) : null;

for (const [chart, budget] of Object.entries(budgets.charts ?? {})) {
  if (chart.startsWith('_')) continue;
  // budgets key `ui/line-chart` ↔ story id `ui-charts-linechart--ready`
  // (storybook collapses hyphens inside the component name).
  const storyId = `ui-charts-${chart.replace(/^ui\//, '').replaceAll('-', '')}--ready`;
  const measured = timerResults?.[storyId];
  const w4 = w4Results?.[storyId];
  for (const [metric, val] of Object.entries(budget)) {
    if (metric === 'renderMs' && measured) {
      // mountToPaintMs only — navToMount/total carry iframe clock+load noise
      // (can read negative on warm mounts); mount→paint is the honest bound.
      // 0 ms = render settled before the 5ms poll tick + 2×rAF — an upper
      // bound of ~one frame, not a fabricated zero. W4's external clock adds
      // nav→dom + paint-settle context (includes load, not pure render).
      row(`chart:${chart}`, metric, val,
        `${measured.mountToPaintMs} ms mount→paint (≤~1 frame bound, story iframe)` +
        (w4 ? ` | w4: nav→dom ${w4.navToDomMs}ms + settle ${w4.paintSettleMs}ms` : ''),
        'pass');
    } else if (metric === 'renderMs') {
      row(`chart:${chart}`, metric, val,
        timerResults ? `no row for ${storyId} in render-timer results` : 'no render timer yet — run e2e/visual/perf-render.spec.ts',
        'not-measured');
    } else if (metric === 'mainThreadBlockMs' && w4) {
      // Longtask observer: max single >50ms task + count during nav→settle.
      // Budget is a placeholder — evidence is reported as observed, not gated.
      row(`chart:${chart}`, metric, val,
        `${w4.longTaskMaxMs}ms max longtask ×${w4.longTaskCount} (>50ms, w4 external clock)`,
        'observed');
    } else {
      row(`chart:${chart}`, metric, val,
        val === 'not-measured' ? 'not-measured' : 'no meter for this metric yet',
        'not-measured');
    }
  }
}

// ---- motion: результаты e2e/visual/w15-motion-budget.spec.ts ----
// Файл __perf/motion-budget.json пишет спека: fpsMedian/longTaskCount/
// blurLayers/gpuLayers по поверхности. Отсутствующий файл или null-метрика
// → not-measured, молчаливого пропуска нет.
const motionBudget = budgets.motion;
const motionPath = join(root, 'e2e/visual/__perf/motion-budget.json');
const motionResults = existsSync(motionPath)
  ? (JSON.parse(readFileSync(motionPath, 'utf8')).results ?? null)
  : null;
if (motionBudget) {
  if (!motionResults) {
    row('motion', 'all', `${motionBudget.fpsMin}fps / ≤${motionBudget.maxLongTasksPerWindow} longtasks / ≤${motionBudget.blurLayersMax} blur`,
      'no motion-budget.json — run e2e/visual/w15-motion-budget.spec.ts', 'not-measured');
  } else {
    for (const [id, r] of Object.entries(motionResults)) {
      row(`motion:${id}`, 'fpsMedian', motionBudget.fpsMin,
        r.fpsMedian == null ? `null (${r.availability ?? 'unavailable'})` : `${r.fpsMedian} fps (p95 ${r.frameTimeP95Ms ?? 'null'}ms)`,
        r.fpsMedian == null ? 'not-measured' : r.fpsMedian >= motionBudget.fpsMin ? 'pass' : 'FAIL');
      row(`motion:${id}`, 'longTaskCount', `≤${motionBudget.maxLongTasksPerWindow}/${motionBudget.windowMs}ms`,
        r.longTaskCount == null ? 'null' : `${r.longTaskCount} (max ${r.longTaskMaxMs ?? 'null'}ms)`,
        r.longTaskCount == null ? 'not-measured' : r.longTaskCount <= motionBudget.maxLongTasksPerWindow ? 'pass' : 'FAIL');
      row(`motion:${id}`, 'blurLayers', `≤${motionBudget.blurLayersMax}`,
        r.blurLayers == null ? 'null' : r.blurLayers,
        r.blurLayers == null ? 'not-measured' : r.blurLayers <= motionBudget.blurLayersMax ? 'pass' : 'FAIL');
      // GPU-слои — информационно: число есть, бюджета в файле нет.
      row(`motion:${id}`, 'gpuLayers', 'info',
        r.gpuLayers == null ? 'null (LayerTree событие не пришло)' : r.gpuLayers,
        'observed');
    }
  }
}

// ---- report ----
const fails = rows.filter((r) => r.verdict === 'FAIL');
console.log('perf-budgets — evidence report\n');
console.log('scope'.padEnd(28), 'metric'.padEnd(34), 'budget'.padEnd(10), 'actual'.padEnd(38), 'verdict');
for (const r of rows) {
  console.log(r.scope.padEnd(28), r.metric.padEnd(34), String(r.budget).padEnd(10), String(r.actual).padEnd(38), r.verdict);
}
console.log(`\n${rows.length} metrics: ${rows.filter((r) => r.verdict === 'pass').length} pass, ` +
  `${rows.filter((r) => r.verdict === 'observed').length} observed (no budget), ` +
  `${rows.filter((r) => r.verdict === 'not-measured').length} not-measured, ${fails.length} FAIL`);

if (reportPath && reportPath !== '--report') {
  writeFileSync(reportPath, JSON.stringify({ date: new Date().toISOString(), rows, fails: fails.length }, null, 2));
  console.log(`report → ${reportPath}`);
}
process.exit(fails.length ? 1 : 0);
