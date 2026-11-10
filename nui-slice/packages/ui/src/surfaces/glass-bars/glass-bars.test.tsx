import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { axe } from 'jest-axe';
import { GlassSurface } from './glass-surface';
import { CapsuleInput } from './capsule-input';
import { StatusStrip } from './status-strip';
import { Chip } from '../../actions/chip/chip';

describe('GlassSurface', () => {
  it('exposes constrained content as a labelled keyboard-scrollable region', async () => {
    const { container } = render(
      <GlassSurface variant="card" tone="alice" scrollable data-testid="scroll-card">
        <ul>{Array.from({ length: 8 }, (_, i) => <li key={i}>Этап обработки результатов {i + 1}</li>)}</ul>
      </GlassSurface>,
    );
    const region = screen.getByRole('region', { name: 'Содержимое панели' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('data-persona', 'alice');
    expect(region.querySelectorAll('li')).toHaveLength(8);
    expect(await axe(container)).toHaveNoViolations();

    Object.defineProperties(region, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    fireEvent.keyDown(region, { key: 'PageDown' });
    expect(region.scrollTop).toBe(100);
    fireEvent.keyDown(region, { key: 'End' });
    expect(region.scrollTop).toBe(200);
  });

  it('uses scrolling rather than clipping for constrained content without adding blur', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'glass-bars.module.css'), 'utf8');
    const scrollRule = css.match(/\.scrollable\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(scrollRule).toContain('overflow: auto');
    expect(scrollRule).toContain('overscroll-behavior: contain');
    expect(scrollRule).not.toContain('backdrop-filter');
  });

  it('renders all four layer variants', () => {
    const { container } = render(
      <>
        <GlassSurface variant="rail" data-testid="r" />
        <GlassSurface variant="topbar" data-testid="t" />
        <GlassSurface variant="card" data-testid="c" />
        <GlassSurface variant="statusbar" data-testid="s" />
      </>,
    );
    for (const id of ['r', 't', 'c', 's']) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain('root');
    }
    expect(container.querySelectorAll('[class*="rail"]').length).toBe(1);
    expect(container.querySelectorAll('[class*="statusbar"]').length).toBe(1);
  });

  it('binds persona tone via data-persona', () => {
    render(<GlassSurface variant="card" tone="alice" data-testid="g" />);
    expect(screen.getByTestId('g')).toHaveAttribute('data-persona', 'alice');
  });

  it('leaves data-persona absent without tone', () => {
    render(<GlassSurface data-testid="g" />);
    expect(screen.getByTestId('g')).not.toHaveAttribute('data-persona');
  });
});

describe('CapsuleInput', () => {
  it('submits trimmed value and labels controls in Russian', () => {
    const onSubmit = vi.fn();
    render(<CapsuleInput defaultValue="  привет  " onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(onSubmit).toHaveBeenCalledWith('  привет  ');
    expect(screen.getByLabelText('Сообщение')).toBeInTheDocument();
  });

  it('does not submit empty input', () => {
    const onSubmit = vi.fn();
    render(<CapsuleInput defaultValue="   " onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('StatusStrip', () => {
  it('renders real progress value', () => {
    render(<StatusStrip label="Статус системы" value="42%" progress={42} />);
    const bar = screen.getByRole('progressbar', { name: 'Статус системы' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('renders honest empty state — «—», indeterminate bar', () => {
    render(<StatusStrip label="Сеть" />);
    const bar = screen.getByRole('progressbar', { name: 'Сеть' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('Chip icon', () => {
  it('renders a decorative icon slot', () => {
    const { container } = render(<Chip icon={<svg data-testid="i" />} onSelect={() => {}}>Чип</Chip>);
    expect(screen.getByTestId('i')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
