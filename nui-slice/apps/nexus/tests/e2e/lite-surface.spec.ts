import { test, expect } from '@playwright/test';

/**
 * NUE-lite acceptance against the prod host (MERC).
 *
 * Wave "lite-acceptance". The deployed bundle was built with
 * NEXT_PUBLIC_NUE_SURFACE=lite, so `/` renders the LiteShell (welcome → key →
 * chat) instead of the full BootScreen.
 *
 * Base URL / rewrite
 * ------------------
 * Conventions are taken from the repo-root live specs
 * (e2e/visual/diag-prod.spec.ts, e2e/visual/diag-lite.spec.ts):
 *   - diag-prod hardcodes the prod host as
 *     https://backend.example.invalid and hits `/home` directly.
 *   - The `/_nexus` asset rewrite is specific to the AI-2 desktop host
 *     (see desktop-contract.spec.ts). The MERC prod host serves the NEXUS
 *     bundle BARE under `/_next/...` (confirmed by curl of the live index:
 *     it references `/_next/static/...` with no `/_nexus/` prefix and exposes
 *     `data-testid="lite-welcome"` on `/`). So the app root is the host root;
 *     no `/_nexus` prefix is applied here.
 *
 * Selectors
 * ---------
 * Taken from apps/nexus/src/product/lite/lite-shell.tsx:
 *   - [data-testid="lite-welcome"]  — the welcome / key-gate form
 *   - #lite-nue-key                 — the NUE-key input (type=password)
 *   - button:has-text("Войти")      — the submit button on the welcome form
 *   - [role="alert"]                — the format error paragraph
 *   - [data-testid="lite-chat"]     — the chat shell shown after a valid key
 *   - textarea[aria-label="Текст задачи"] — the composer in the chat shell
 *
 * Key format
 * ----------
 * A valid NUE key is `nue_<hex>` (lowercase): /^nue_[a-f0-9]+$/i
 * (apps/nexus/src/product/lite/lite-shell.tsx & data-source.ts
 *  NUE_CLIENT_KEY_PATTERN). `NEXUS_LIVE_TOKEN` (env) is the Bearer for the
 * /v1 API surface, NOT the value typed into the field. The value typed is
 * read from NEXUS_LIVE_TOKEN by the caller and must itself match nue_<hex>;
 * nothing is hardcoded in this spec.
 */

const LIVE = process.env.NEXUS_LIVE_URL ?? 'https://backend.example.invalid';
const NEXUS_LIVE_TOKEN = process.env.NEXUS_LIVE_TOKEN ?? '';

// The NUE-key input is a React *controlled* field (value={draft}); the
// "Войти" button is disabled={!draft.trim()}. On the deployed headless-shell
// build, `fill` / delay-free `pressSequentially` can race the controlled
// re-render and leave `draft` empty (button stuck disabled) or drop the
// keystroke. Typing each character via a real key `press` with a short settle
// reliably commits `draft` before we read the button's enabled state. This is
// the one difference a plain `fill`-based spec gets wrong here.
async function typeKey(
  page: import('@playwright/test').Page,
  value: string,
): Promise<void> {
  const key = page.locator('#lite-nue-key');
  await key.fill('');
  for (const ch of value) {
    await key.press(ch);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(60);
}

test.describe('NUE-lite surface — prod host', () => {
  test('1. lite welcome screen renders on /', async ({ page }) => {
    await page.goto(`${LIVE}/`, { waitUntil: 'domcontentloaded' });

    // The LiteShell welcome gate must be present…
    const welcome = page.locator('[data-testid="lite-welcome"]');
    await expect(welcome).toBeVisible({ timeout: 30_000 });

    // …the AGENT-A title is there, the key field is available…
    await expect(welcome.locator('#lite-nue-key')).toBeVisible();
    await expect(welcome.locator('h1')).toHaveText('AGENT-A');

    // …and it is NOT the full BootScreen (no boot-progress testid).
    await expect(page.locator('[data-testid="boot-progress"]')).toHaveCount(0);
  });

  test('2. invalid NUE key is rejected, does not enter the shell', async ({ page }) => {
    await page.goto(`${LIVE}/`, { waitUntil: 'domcontentloaded' });
    const welcome = page.locator('[data-testid="lite-welcome"]');
    await expect(welcome).toBeVisible({ timeout: 30_000 });

    // Each iteration clears the field, types the bad value, and submits. The
    // "Войти" button is only enabled once `draft` is non-empty; Playwright
    // auto-waits for it on the click.
    const enter = page.locator('button:has-text("Войти")');

    for (const bad of ['bad', 'xyz']) {
      await typeKey(page, bad);
      await expect(enter).toBeEnabled({ timeout: 5_000 });
      await enter.click();
      // A format error surfaces…
      await expect(welcome.locator('[role="alert"]')).toBeVisible();
      // …the welcome form is still there (we did NOT enter the chat shell)…
      await expect(welcome).toBeVisible();
      // …and the chat shell is not rendered.
      await expect(page.locator('[data-testid="lite-chat"]')).toHaveCount(0);
    }

    // End state after the invalid attempts: no chat shell.
    await expect(page.locator('[data-testid="lite-chat"]')).toHaveCount(0);
  });

  test('3. valid scoped NUE key leads to the AGENT-A chat shell', async ({ page }) => {
    test.skip(
      !NEXUS_LIVE_TOKEN,
      'NEXUS_LIVE_TOKEN not available — valid-key check cannot be exercised',
    );

    // Sanity: the value actually used must be a well-formed nue_<hex> key.
    const valid = /^nue_[a-f0-9]+$/i.test(NEXUS_LIVE_TOKEN);
    test.skip(
      !valid,
      'NEXUS_LIVE_TOKEN is not a nue_<hex> key — not usable as the lite key',
    );

    await page.goto(`${LIVE}/`, { waitUntil: 'domcontentloaded' });
    const welcome = page.locator('[data-testid="lite-welcome"]');
    await expect(welcome).toBeVisible({ timeout: 30_000 });

    const enter = page.locator('button:has-text("Войти")');
    await typeKey(page, NEXUS_LIVE_TOKEN);
    await expect(enter).toBeEnabled({ timeout: 5_000 });
    await enter.click();

    // The welcome gate is gone and the chat shell is up.
    await expect(page.locator('[data-testid="lite-chat"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(welcome).toHaveCount(0);
    await expect(page.locator('textarea[aria-label="Текст задачи"]')).toBeVisible();
  });
});
