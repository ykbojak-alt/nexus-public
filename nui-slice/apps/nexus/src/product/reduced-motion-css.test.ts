import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const reducedBlock = (path: string) => {
  const source = css(path);
  return source.slice(source.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
};

describe('reduced-motion CSS contract', () => {
  it('disables remaining shared and shell transitions', () => {
    expect(css('packages/ui/src/plugins/plugins.module.css'))
      .toMatch(/\.tabBar\s*\{\s*transition:\s*none;/);
    expect(css('apps/nexus/src/product/app-shell.module.css'))
      .toMatch(/\.tl,\s*\.shellWrap \[class\*=['"]frameLeft['"]\],\s*\.stripWrap\s*\{\s*transition:\s*none;/);
  });

  it('disables board, card-game and oracle motion', () => {
    expect(reducedBlock('apps/nexus/src/product/chess/chess.module.css'))
      .toMatch(/\.square,\s*\.promoBtn\s*\{\s*transition:\s*none;/);

    const durak = reducedBlock('apps/nexus/src/product/durak/durak.module.css');
    expect(durak).toContain('  .choicePop,');
    expect(durak).toContain('  .trumpUnder,');
    expect(durak).toMatch(/\.page \.gameBtn,\s*\.modalClose\s*\{\s*transition:\s*none;/);

    const oracle = reducedBlock('apps/nexus/src/product/oracle/oracle.module.css');
    expect(oracle).toContain('  .modeChip,');
    expect(oracle).toContain('  .journalItem,');
  });

  it('disables residual progress and feed transitions and settles CSS entrances', () => {
    const screens = css('apps/nexus/src/product/screens/screens.module.css');
    expect(screens).toMatch(/\.budgetBarFill,\s*\.fsBtn \.fsLock,\s*\.confirmCardInner\s*\{\s*transition:\s*none;/);
    expect(screens).toContain('  .confirmCardInner {');

    expect(css('packages/ui/src/agent-chat/agent-chat.module.css'))
      .toContain('.usageFill { transition: none; }');
    expect(css('packages/ui/src/feedback/feedback.module.css'))
      .toMatch(/\.progressFill\s*\{\s*transition:\s*none;/);

    const motion = css('packages/ui/src/motion/motion.module.css');
    expect(motion).toMatch(/\.enter,\s*\.nestIn\s*\{\s*animation:\s*none;\s*animation-delay:\s*0ms;\s*opacity:\s*1;\s*transform:\s*none;/);
  });
});
