import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { LiveContext, type LiveCtx } from './screens/newf';
import { useLiveCtx, useLiveCtxOrNull } from './use-live-ctx';

const mockCtx = { live: {} as LiveCtx['live'], bridge: {} as LiveCtx['bridge'], dismissAttention: () => {} } as LiveCtx;
const wrap = (children: ReactNode) => createElement(LiveContext.Provider, { value: mockCtx }, children);

describe('use-live-ctx', () => {
  it('useLiveCtxOrNull returns null outside provider', () => {
    const { result } = renderHook(() => useLiveCtxOrNull());
    expect(result.current).toBeNull();
  });

  it('useLiveCtx throws outside provider with clear error', () => {
    expect(() => renderHook(() => useLiveCtx())).toThrowError(/outside the newf shell provider/);
  });

  it('both return ctx inside provider', () => {
    const { result: a } = renderHook(() => useLiveCtx(), { wrapper: ({ children }) => wrap(children) });
    const { result: b } = renderHook(() => useLiveCtxOrNull(), { wrapper: ({ children }) => wrap(children) });
    expect(a.current).toBe(mockCtx);
    expect(b.current).toBe(mockCtx);
  });
});
