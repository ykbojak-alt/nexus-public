import { describe, expect, it } from 'vitest';
import { renderAnsiScreen } from './newf-screen';

describe('renderAnsiScreen', () => {
  it('handles ICH/DCH/ECH/X without crashing', () => {
    const base = renderAnsiScreen('AB CD \x1b[3G\x1b[2@XY \x1b[1G\x1b[2P', 12, 2);
    expect(base[0]).toContain('X');
    const ech = renderAnsiScreen('ABC\x1b[1G\x1b[1X', 12, 2);
    expect(ech[0].trim()).toBe('BC');
  });
});
