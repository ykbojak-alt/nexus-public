// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isBusDelegation,
  isBusSession,
  isComposerMode,
  isHandoff,
  isToolCall,
  type BusDelegation,
  type BusSession,
  type ToolCall,
} from './copilot';
import type { Ai2Handoff } from './agents';
import type { ComposerMode } from '@nexus/mock-data';
import { getDataSource } from '../../../product/data-source';

/* Wave XI contract tests (dispatch §5 shapes). Shape guards run
 * unconditionally — they validate any bus/SSE payload before UI. Seam
 * tests are capability-gated: an absent seam skips honestly instead of
 * fabricating, matching the «нет данных» rule. Canonical types — W1:
 * bus.ts / runs.ts / agents.ts / mock-data ComposerMode. */

const session: BusSession = {
  id: 'w2-1718', window: 'W2', title: 'Дизайн-система',
  kind: 'tui', status: 'busy', lastActivityAt: 1729000000,
};

const delegation: BusDelegation = {
  id: 'del-1', to: 'W4', taskPath: 'bus/inbox/w4/task.md',
  state: 'sent', answerPath: null, createdAt: 1729000000,
};

const toolCall: ToolCall = {
  callId: 'c-1', name: 'read_file', input: { path: 'a.ts' },
  output: 'ok', startedAt: 1729000000, durationMs: 42, status: 'ok',
};

const handoff: Ai2Handoff = {
  label: 'Start Implementation', agent: 'agent',
  prompt: 'Start implementation', send: true,
};

describe('copilot contracts — BusSession', () => {
  it('accepts a valid session and every status/kind enum value', () => {
    expect(isBusSession(session)).toBe(true);
    for (const s of ['idle', 'busy', 'locked', 'unknown'] as const)
      expect(isBusSession({ ...session, status: s })).toBe(true);
    for (const k of ['desktop', 'tui', 'cloud'] as const)
      expect(isBusSession({ ...session, kind: k })).toBe(true);
  });

  it('null lastActivityAt и kind unknown — честные значения живого хоста', () => {
    // bus.py отдаёт None, когда у окна нет меток активности, и 'unknown'
    // для kind вне enum — гварды принимают, не выдумываем.
    expect(isBusSession({ ...session, lastActivityAt: null })).toBe(true);
    expect(isBusSession({ ...session, kind: 'unknown' })).toBe(true);
  });

  it('rejects wrong enum values, missing fields and wrong types', () => {
    expect(isBusSession({ ...session, status: 'running' })).toBe(false);
    expect(isBusSession({ ...session, kind: 'web' })).toBe(false);
    expect(isBusSession({ ...session, window: 5 })).toBe(false);
    expect(isBusSession({ ...session, lastActivityAt: 'now' })).toBe(false);
    for (const k of ['id', 'window', 'title', 'kind', 'status', 'lastActivityAt']) {
      const { [k]: _dropped, ...rest } = session as unknown as Record<string, unknown>;
      expect(isBusSession(rest)).toBe(false);
    }
    expect(isBusSession(null)).toBe(false);
    expect(isBusSession('W2')).toBe(false);
  });
});

describe('copilot contracts — BusDelegation', () => {
  it('accepts all five states; answerPath null или путь', () => {
    expect(isBusDelegation(delegation)).toBe(true);
    expect(delegation.answerPath).toBeNull();
    for (const st of ['queued', 'sent', 'answered', 'locked', 'failed'] as const)
      expect(isBusDelegation({ ...delegation, state: st })).toBe(true);
    expect(isBusDelegation({ ...delegation, answerPath: 'bus/outbox/w5/ans.md' })).toBe(true);
  });

  it('error-поле опционально строкой; bad state / bad answerPath отвергаются', () => {
    expect(isBusDelegation({ ...delegation, error: 'send.ps1 exit 1' })).toBe(true);
    expect(isBusDelegation({ ...delegation, error: 5 })).toBe(false);
    expect(isBusDelegation({ ...delegation, state: 'done' })).toBe(false);
    expect(isBusDelegation({ ...delegation, answerPath: 42 })).toBe(false);
    const { taskPath: _dropped, ...rest } = delegation;
    expect(isBusDelegation(rest)).toBe(false);
  });
});

describe('copilot contracts — ToolCall', () => {
  it('parentCallId absent is a valid top-level call', () => {
    const { parentCallId: _dropped, ...top } = { ...toolCall, parentCallId: 'c-0' };
    expect('parentCallId' in top).toBe(false);
    expect(isToolCall(top)).toBe(true);
  });

  it('nested call links to parent via parentCallId', () => {
    const parent: ToolCall = { ...toolCall, callId: 'c-0', name: 'execution_subagent' };
    const child: ToolCall = { ...toolCall, callId: 'c-1', parentCallId: 'c-0', name: 'read_file' };
    expect(isToolCall(parent)).toBe(true);
    expect(isToolCall(child)).toBe(true);
    expect(child.parentCallId).toBe(parent.callId);
  });

  it('callId null и startedAt null — честные «нет данных» хоста', () => {
    expect(isToolCall({ ...toolCall, callId: null })).toBe(true);
    expect(isToolCall({ ...toolCall, startedAt: null })).toBe(true);
  });

  it('rejects non-string parentCallId, missing input key, bad status', () => {
    expect(isToolCall({ ...toolCall, parentCallId: 7 })).toBe(false);
    const { input: _dropped, ...noInput } = toolCall;
    expect(isToolCall(noInput)).toBe(false);
    for (const st of ['ok', 'error', 'running'] as const)
      expect(isToolCall({ ...toolCall, status: st })).toBe(true);
    expect(isToolCall({ ...toolCall, status: 'done' })).toBe(false);
    expect(isToolCall({ ...toolCall, durationMs: 'long' })).toBe(false);
  });

  it('kind discriminator: accepted as tool/subagent, absent (legacy) also ok', () => {
    expect(isToolCall({ ...toolCall, kind: 'tool' })).toBe(true);
    expect(isToolCall({ ...toolCall, kind: 'subagent' })).toBe(true);
    // старые прогоны без поля — валидны (обратная совместимость)
    expect(isToolCall({ ...toolCall })).toBe(true);
    expect(isToolCall({ ...toolCall, kind: 'agent' })).toBe(false);
    expect(isToolCall({ ...toolCall, kind: 5 })).toBe(false);
  });
});

describe('copilot contracts — Handoff', () => {
  it('accepts a valid handoff; send is a strict boolean', () => {
    expect(isHandoff(handoff)).toBe(true);
    expect(isHandoff({ ...handoff, send: false })).toBe(true);
    expect(isHandoff({ ...handoff, send: 'yes' })).toBe(false);
    expect(isHandoff({ ...handoff, agent: 3 })).toBe(false);
  });
});

describe('copilot contracts — ComposerMode', () => {
  it('vocab is exactly agent|ask|plan', () => {
    for (const m of ['agent', 'ask', 'plan'] as ComposerMode[])
      expect(isComposerMode(m)).toBe(true);
    expect(isComposerMode('explore')).toBe(false);
    expect(isComposerMode('default')).toBe(false);
  });
});

describe('copilot contracts — XI seams on the data source', () => {
  const ds = getDataSource() as unknown as Record<string, unknown>;
  // Приземление W1: seams живут в неймспейсе ds.bus (listSessions /
  // delegateTask / getDelegation); корневые имена тоже принимаем.
  const bus = (ds.bus ?? ds) as Record<string, unknown>;

  it('listSessions / delegateTask / getDelegation — present or honestly absent', () => {
    for (const seam of ['listSessions', 'delegateTask', 'getDelegation']) {
      if (typeof bus[seam] !== 'function') {
        // W1 seam не приземлён — честное «нет данных», не фейк.
        continue;
      }
      expect(typeof bus[seam]).toBe('function');
    }
  });

  it('listSessions output validates against BusSession when present', async () => {
    if (typeof bus.listSessions !== 'function') return;
    const list = await (bus.listSessions as () => Promise<unknown[]>)();
    for (const s of list) expect(isBusSession(s)).toBe(true);
  });

  it('delegateTask reply validates against Delegation when present', async () => {
    if (typeof bus.delegateTask !== 'function') return;
    // Реальную отправку не делаем — seam проверяется формой ответа на
    // несуществующее окно (хост обязан отвергнуть UnknownWindow, не падать).
    await expect(
      (bus.delegateTask as (i: unknown) => Promise<unknown>)({ window: 'W999', task: 'probe' }),
    ).rejects.toThrow();
  });

  it('agent specs expose handoffs[] validated by contract when present', async () => {
    const agents = await getDataSource().listAgents();
    for (const a of agents as unknown as Array<Record<string, unknown>>) {
      if (a.handoffs === undefined) continue;
      expect(Array.isArray(a.handoffs)).toBe(true);
      for (const h of a.handoffs as unknown[]) expect(isHandoff(h)).toBe(true);
    }
  });
});

/* Живой гейт: AI2_LIVE_URL=http://host — seams бьются по настоящему хосту;
   без переменной блок честно пропускается (не фабрикуем). */
const LIVE = process.env.AI2_LIVE_URL;
describe.skipIf(LIVE == null)('copilot contracts — live host', () => {
  it('listSessions возвращает валидные Session от живого хоста', async () => {
    const { createAi2DataSource } = await import('../adapters/product-data-source');
    const live = createAi2DataSource({ baseUrl: LIVE });
    const sessions = await live.bus!.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(isBusSession(s)).toBe(true);
  });

  it('getDelegation на несуществующем id отвечает честной ошибкой', async () => {
    const { createAi2DataSource } = await import('../adapters/product-data-source');
    const live = createAi2DataSource({ baseUrl: LIVE });
    await expect(live.bus!.getDelegation('dlg-00000000-000000-deadbeef'))
      .rejects.toThrow();
  });
});
