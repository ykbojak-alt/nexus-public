/**
 * Ambient declaration for jest-axe (no bundled d.ts). Must stay a global
 * script file — an ambient `declare module` inside a module file is an
 * augmentation and would not apply to a typeless JS package.
 */
declare module 'jest-axe' {
  export function axe(element: Element | Document | string, options?: unknown): Promise<unknown>;
  export const toHaveNoViolations: unknown;
}
