import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const screensCss = readFileSync(join(__dirname, 'screens.module.css'), 'utf8');
const homeCss = readFileSync(join(__dirname, 'home.module.css'), 'utf8');
const tokensCss = readFileSync(join(__dirname, '../../../../../packages/tokens/generated/tokens.css'), 'utf8');

function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `missing CSS rule: ${selector}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('}', start);
  return source.slice(start, end);
}

describe('chat density contract (W2-142)', () => {
  it('chat bubbles and traces use the density-scaled spacing ramp', () => {
    for (const selector of ['.chatMsg', '.chatTrace', '.chatMsgHead', '.chatStatusRow']) {
      expect(block(screensCss, selector)).toMatch(/(?:padding|gap):[^;]*var\(--nexus-space-/);
    }
    for (const selector of ['.echoBody', '.echoQuestion', '.echoQuestionLabel']) {
      expect(block(homeCss, selector)).toMatch(/(?:padding|gap|margin-bottom):[^;]*var\(--nexus-space-/);
    }
  });

  it('dense and standard scale spacing only; chat typography stays unchanged', () => {
    expect(tokensCss).toMatch(/\[data-density='dense'\]\s*\{[^}]*--nexus-space-4:\s*calc\(16px \* 0\.85\)/s);
    expect(tokensCss).toMatch(/\[data-density='standard'\]\s*\{[^}]*--nexus-space-4:\s*calc\(16px \* 1\)/s);
    expect(block(screensCss, '.chatText')).toContain('font-size: var(--nexus-type-body-font-size');
    expect(block(homeCss, '.echoQuestionText')).toContain('font-size: 15px');
  });
});
