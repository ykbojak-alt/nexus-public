/**
 * Wave XI — runtime-гварды контрактов Copilot-механик (диспетч §5).
 * Типы канонические заданы W1: `BusSession`/`BusDelegation` (bus.ts),
 * `ToolCall` (runs.ts), `Ai2Handoff` (agents.ts), `ComposerMode`
 * (@nexus/mock-data). Гварды проверяют ЛЮБОЙ payload (файл шины, SSE,
 * ответ seam) до попадания в компонент — формы сверены с живым хостом:
 *  - sessions(): lastActivityAt=null при отсутствии меток, kind='unknown'
 *    для значений вне enum (bus.py verbatim);
 *  - delegation view: answerPath=null явно, error — причина транспорта;
 *  - tool_call wire: call_id может отсутствовать (null = «нет данных»).
 */

import type { Ai2Handoff } from './agents';
import type { BusDelegation, BusSession } from './bus';
import type { ToolCall } from './runs';
import type { ComposerMode } from '@nexus/mock-data';

export type { Ai2Handoff, BusDelegation, BusSession, ComposerMode, ToolCall };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const has = (v: Record<string, unknown>, k: string, t: string): boolean =>
  typeof v[k] === t;

export function isBusSession(v: unknown): v is BusSession {
  return isObj(v) && has(v, 'id', 'string') && has(v, 'window', 'string') &&
    has(v, 'title', 'string') &&
    (v.kind === 'desktop' || v.kind === 'tui' || v.kind === 'cloud' ||
     v.kind === 'unknown') &&
    (v.status === 'idle' || v.status === 'busy' ||
     v.status === 'locked' || v.status === 'unknown') &&
    (v.lastActivityAt === null || has(v, 'lastActivityAt', 'number'));
}

export function isBusDelegation(v: unknown): v is BusDelegation {
  return isObj(v) && has(v, 'id', 'string') && has(v, 'to', 'string') &&
    has(v, 'taskPath', 'string') &&
    (v.state === 'queued' || v.state === 'sent' || v.state === 'answered' ||
     v.state === 'locked' || v.state === 'failed') &&
    (v.answerPath === null || has(v, 'answerPath', 'string')) &&
    has(v, 'createdAt', 'number') &&
    (v.error === undefined || has(v, 'error', 'string'));
}

export function isToolCall(v: unknown): v is ToolCall {
  return isObj(v) &&
    (v.callId === null || has(v, 'callId', 'string')) &&
    has(v, 'name', 'string') &&
    'input' in v &&
    (v.status === 'ok' || v.status === 'error' || v.status === 'running') &&
    (v.startedAt === null || has(v, 'startedAt', 'number')) &&
    (v.parentCallId === undefined || has(v, 'parentCallId', 'string')) &&
    (v.durationMs === undefined || has(v, 'durationMs', 'number')) &&
    (v.kind === undefined || v.kind === 'tool' || v.kind === 'subagent');
}

export function isHandoff(v: unknown): v is Ai2Handoff {
  return isObj(v) && has(v, 'label', 'string') && has(v, 'agent', 'string') &&
    has(v, 'prompt', 'string') && has(v, 'send', 'boolean');
}

export function isComposerMode(v: unknown): v is ComposerMode {
  return v === 'agent' || v === 'ask' || v === 'plan';
}

/* --- обратная совместимость с W5-версией имён (волна XI) --- */
export const isCopilotSession = isBusSession;
export const isDelegation = isBusDelegation;
