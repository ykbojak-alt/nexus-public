/**
 * craft.* live-probe против реального solidcraft.exe (см. LIVE_PROBE.md).
 * Запуск: solidcraft.exe --control 27990 --sample
 *         node packages\bridge\live-probe.mjs 27990
 * Каждый ответ печатается сырым JSON — вставлять в LIVE_PROBE.md «Факт» verbatim.
 */
import { CraftAdapter } from './craft-adapter.mjs';

const port = Number(process.argv[2] ?? 27990);
const log = (n, r) => console.log(`[${n}]`, JSON.stringify(r));

const a = CraftAdapter.fromTokenFile(port);
await a.connect(port);

// 1 · ui.inspect — adapter/documents/frame_ms по спеке
log(1, await a.uiInspect());

// 2 · engine.commands — реестр (печатаем только ok, длинный вывод не нужен)
const cmds = await a.engineCommands();
log(2, cmds.ok ? { ok: true, count: (cmds.result?.commands ?? cmds.result ?? []).length ?? 'n/a' } : cmds);

// 3 · engine.execute — id из реестра по allowlist, не угадываем
const list = cmds.result?.commands ?? cmds.result ?? [];
const pick = list.find?.((c) => c.enabled && /^(document|parameters|measure)\./.test(c.id));
log(3, await a.engineExecute(pick ? pick.id : 'nexus.nope', pick?.params ?? {}));

// 4 · file.export с allow_paths
log(4, await a.engineExecute('file.export', { path: 'D:/nexus/craft-workspace/probe.step' },
  ['D:/nexus/craft-workspace']));

// 5–6 · control.pending / control.running в простое
log(5, await a.controlPending());
log(6, await a.controlRunning());
a.close();

// 7 · отдельное соединение с неверным токеном → unauthorized + разрыв
const bad = new CraftAdapter('0'.repeat(64));
await bad.connect(port);
log(7, await bad.uiInspect());
bad.close();

console.log('live-probe: done');
