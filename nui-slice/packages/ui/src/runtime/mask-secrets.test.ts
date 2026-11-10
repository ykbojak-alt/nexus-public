import { describe, expect, it } from 'vitest';
import { maskSecrets, MASKED } from './mask-secrets';

describe('maskSecrets (NQ-033)', () => {
  it('masks secret-keyed values recursively without mutating input', () => {
    const body = {
      api_key: 'sk-live-123',
      nested: { token: 'abc', ok: 'visible' },
      list: [{ password: 'p' }, 'plain'],
    };
    const out = maskSecrets(body) as typeof body;
    expect(out.api_key).toBe(MASKED);
    expect(out.nested.token).toBe(MASKED);
    expect(out.nested.ok).toBe('visible');
    expect((out.list[0] as { password: string }).password).toBe(MASKED);
    expect(out.list[1]).toBe('plain');
    expect(body.api_key).toBe('sk-live-123');
  });

  it('masks authorization, cookie, and session keys but keeps author visible', () => {
    const body = {
      authorization: 'Bearer eyJ…',
      setCookie: 'sid=abc',
      sessionId: 'sess-1',
      bearer: 'tok',
      author: 'planner',
    };
    const out = maskSecrets(body) as typeof body;
    expect(out.authorization).toBe(MASKED);
    expect(out.setCookie).toBe(MASKED);
    expect(out.sessionId).toBe(MASKED);
    expect(out.bearer).toBe(MASKED);
    expect(out.author).toBe('planner');
  });

  it('passes primitives through and survives circular refs', () => {
    expect(maskSecrets('s')).toBe('s');
    expect(maskSecrets(null)).toBeNull();
    const circ: Record<string, unknown> = { secret: 'x' };
    circ.self = circ;
    const s = JSON.stringify(maskSecrets(circ));
    expect(s).toContain(MASKED);
    expect(s).toContain('[circular]');
  });
});
