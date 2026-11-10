// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useVirtualList } from './newf-virtual';

function VirtualHost({ items, rowHeight, overscan }: { items: string[]; rowHeight: number; overscan?: number }) {
  const list = useVirtualList<string, HTMLUListElement>(items, rowHeight, overscan);
  return (
    <ul ref={list.containerRef} style={{ height: 200, overflow: 'auto' }} data-testid="host">
      <li style={{ height: list.totalHeight }} aria-hidden="true" />
      {list.visible.map((item, i) => (
        <li key={item} data-testid={`v-${i}`} style={{ position: 'absolute', top: (list.start + i) * rowHeight }}>{item}</li>
      ))}
    </ul>
  );
}

describe('useVirtualList (W26)', () => {
  const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);

  it('рендеририт только видимый диапазон (меньше полного списка)', () => {
    render(<VirtualHost items={items} rowHeight={28} overscan={3} />);
    const rows = screen.getAllByTestId(/^v-/);
    expect(rows.length).toBeLessThan(items.length);
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getByTestId('v-0')).toHaveTextContent('item-0');
  });
});
