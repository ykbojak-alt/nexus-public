import { defineConfig } from 'vitest/config';

/**
 * App-scoped vitest config (Window 3). The Next app tsconfig must keep
 * "jsx": "preserve" (Next requirement), so esbuild is pinned to automatic
 * JSX here for test transforms. Root vitest.config.ts stays shared.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Shared DOM harness (storybook-harness-contract): jest-dom + RTL cleanup
    // + jest-axe. Без cleanup DOM течёт между тестами — «multiple elements».
    setupFiles: ['../../packages/ui/test/setup.ts'],
    // Тот же лимит, что в корневом конфиге: под нагрузкой полного прогона
    // jsdom+axe-тесты не укладывались в дефолтные 5 с (в изоляции проходят).
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      // Только NEWF-поддерево — как в измерении #410.
      include: ['src/app/newf/**/*.{ts,tsx}', 'src/product/screens/newf*.{ts,tsx}'],
      reporter: ['text-summary', 'json', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 75,
      },
    },
  },
});
