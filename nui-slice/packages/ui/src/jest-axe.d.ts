declare module 'jest-axe' {
  export const axe: (context: Element | Document | DocumentFragment) => Promise<unknown>;
  export const toHaveNoViolations: Record<string, (...args: unknown[]) => unknown>;
}
