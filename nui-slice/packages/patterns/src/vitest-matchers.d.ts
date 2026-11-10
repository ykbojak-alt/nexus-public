/**
 * vitest matcher augmentation — a module file so `declare module 'vitest'`
 * merges with the real declarations instead of shadowing them.
 */
import 'vitest';

declare module 'vitest' {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
}
