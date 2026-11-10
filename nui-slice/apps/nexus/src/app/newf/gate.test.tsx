import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { NewfGate } from './gate';

// Мокаем тяжёлые экраны: проверяем, какие props доходят до них.
interface ScreenProps { live: boolean; bridgeBase?: string; backend?: string }

const lipScreen = vi.fn((_p: ScreenProps) => <div data-testid="newf-screen" />);
const luxScreen = vi.fn((_p: ScreenProps) => <div data-testid="newf-lux" />);

vi.mock('../../product/screens/newf', () => ({
  NewfScreen: (p: ScreenProps) => lipScreen(p),
}));
vi.mock('../../product/screens/newf-lux', () => ({
  NewfLuxScreen: (p: ScreenProps) => luxScreen(p),
}));

function lastScreenCall(spy: ReturnType<typeof vi.fn>): ScreenProps {
  const last = spy.mock.calls[spy.mock.calls.length - 1];
  return (last?.[0] ?? { live: false }) as ScreenProps;
}

// JSdom в vitest не даёт полноценного window.location.search — задаём вручную.
function setSearch(query: string) {
  Object.defineProperty(window, 'location', {
    value: { search: query, href: 'http://localhost/newf' + query },
    writable: true,
    configurable: true,
  });
}

describe('NewfGate (#372 sync-read of ?live=1)', () => {
  beforeEach(() => {
    lipScreen.mockClear();
    luxScreen.mockClear();
  });

  it('без ?live=1 → NewfScreen c live=false', () => {
    setSearch('?backend=core');
    render(<NewfGate />);
    const props = lastScreenCall(lipScreen);
    expect(props.live).toBe(false);
  });

  it('?live=1&backend=core → NewfScreen c live=true и backend=core', () => {
    setSearch('?live=1&bridge=http://127.0.0.1:8471&backend=core');
    render(<NewfGate />);
    const props = lastScreenCall(lipScreen);
    expect(props.live).toBe(true);
    expect(props.backend).toBe('core');
    expect(props.bridgeBase).toBe('http://127.0.0.1:8471');
  });

  it('?live=1&shell=lux → NewfLuxScreen c live=true', () => {
    setSearch('?live=1&bridge=http://127.0.0.1:8471&backend=core&shell=lux');
    render(<NewfGate />);
    const props = lastScreenCall(luxScreen);
    expect(props.live).toBe(true);
    expect(props.backend).toBe('core');
    expect(props.bridgeBase).toBe('http://127.0.0.1:8471');
  });

  it('?live=false → NewfScreen c live=false', () => {
    setSearch('?live=false');
    render(<NewfGate />);
    expect(lastScreenCall(lipScreen).live).toBe(false);
  });
});
