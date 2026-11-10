/**
 * NQ-033 — log-safety helper for runtime event bodies. The Local Agent
 * Runtime contract requires secret values never reach the event log; the
 * UI renders `event.body` verbatim via JSON.stringify, so masking happens
 * here, before serialization. Keys matching the pattern have their value
 * replaced with '[masked]' — recursively, without mutating the input.
 */
// 'auth' is deliberately absent — it would mask `author` fields, which
// runtime events need for auditability.
const SECRET_KEY = /key|token|secret|password|credential|authorization|cookie|session|bearer/i;

export const MASKED = '[masked]';

export function maskSecrets(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? MASKED : maskSecrets(v, seen);
  }
  return out;
}
