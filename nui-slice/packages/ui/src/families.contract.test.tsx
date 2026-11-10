import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { Modal } from './surfaces/modal/modal';
import { Tabs } from './navigation/tabs/tabs';
import { CommandPalette } from './navigation/command-palette/command-palette';
import { ApprovalRequest } from './feedback/approval-request/approval-request';
import { Switch } from './inputs/switch/switch';
import { Select } from './inputs/select/select';
import { Chip } from './actions/chip/chip';
import { Toolbar, ToolbarSeparator } from './surfaces/toolbar/toolbar';

afterEach(cleanup);

describe('family contracts (Task 10)', () => {
  it('closes Modal on Escape and restores focus', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Confirm">
            <button>inside</button>
          </Modal>
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'open' });
    opener.focus();
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Modal with no focusable children focuses the dialog itself', () => {
    render(
      <Modal open onClose={() => { }} title="Notice">text only</Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(dialog);
  });

  it('moves Tabs selection with arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]}
        value="a"
        onChange={() => { }}
      />,
    );
    const tabA = screen.getByRole('tab', { name: 'A' });
    tabA.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'C' })).toHaveFocus();
  });

  it('Tabs emits tab↔tabpanel relations when controls is provided', () => {
    render(
      <Tabs
        tabs={[{ id: 'a', label: 'A', controls: 'panel-a' }, { id: 'b', label: 'B' }]}
        value="a"
        onChange={() => { }}
      />,
    );
    const tabA = screen.getByRole('tab', { name: 'A' });
    expect(tabA).toHaveAttribute('aria-controls', 'panel-a');
    expect(tabA).toHaveAttribute('id', 'panel-a-tab');
    expect(screen.getByRole('tab', { name: 'B' })).not.toHaveAttribute('aria-controls');
  });

  it('CommandPalette opens on mod+k and is keyboard navigable', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      // Контракт §14: глобальный шорткат регистрирует оболочка (как
      // app-shell palette.modk), не сама палитра — Host это имитирует.
      useEffect(() => {
        function onKey(e: KeyboardEvent) {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            setOpen(true);
          }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, []);
      return (
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          items={[{ id: 'runs', label: 'Go to Runs' }, { id: 'mem', label: 'Go to Memory' }]}
          onSelect={onSelect}
        />
      );
    }
    render(<Host />);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('mem'); // ArrowDown moved active to 2nd item
  });

  it('CommandPalette Enter-pick does not leak activation to the restored invoker (NQ-110)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onInvokerClick = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => { onInvokerClick(); setOpen(true); }}>invoker</button>
          <CommandPalette
            open={open}
            onOpenChange={setOpen}
            items={[{ id: 'runs', label: 'Go to Runs' }]}
            onSelect={onSelect}
          />
        </>
      );
    }
    render(<Host />);
    const invoker = screen.getByRole('button', { name: 'invoker' });
    await user.click(invoker); // открыть палитру; invoker = restore-target
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    // NQ-110: pick() размонтирует палитру и cleanup синхронно вернёт фокус
    // на инвокер посреди dispatch'а keydown. Enter обязан быть
    // defaultPrevented — иначе браузер довозит активацию до сфокусированной
    // кнопки (Enter-activation follows focus, Blink/WebKit).
    let event: KeyboardEvent | undefined;
    input.addEventListener('keydown', (e) => { event = e; });
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('runs');
    expect(event?.defaultPrevented).toBe(true);
    expect(invoker).toHaveFocus();
    // Ровно один клик — тот, что открыл палитру; Enter не синтезировал второй.
    expect(onInvokerClick).toHaveBeenCalledTimes(1);
  });

  it('CommandPalette restores focus to the invoker on close', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>palette</button>
          <CommandPalette open={open} onOpenChange={setOpen} items={[]} onSelect={() => { }} />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'palette' });
    opener.focus();
    await user.click(opener);
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('ApprovalRequest distinguishes reject and approve callbacks', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ApprovalRequest title="Deploy?" onApprove={onApprove} onReject={onReject} />);
    await user.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Разрешить' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('Switch toggles with keyboard and exposes aria-checked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} aria-label="notify" />);
    const sw = screen.getByRole('switch', { name: 'notify' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Select uses a native select element', () => {
    render(
      <Select label="Preset" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />,
    );
    expect(screen.getByLabelText('Preset').tagName).toBe('SELECT');
  });

  it('Chip is a toggle button only when onSelect is supplied', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <Chip selected onSelect={onSelect}>People</Chip>
        <Chip selected>Document</Chip>
      </>,
    );
    const toggle = screen.getByRole('button', { name: 'People' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Static tag: no button role, not focusable — provenance labels are not controls.
    expect(screen.queryByRole('button', { name: 'Document' })).not.toBeInTheDocument();
    expect(screen.getByText('Document').tagName).toBe('SPAN');
  });

  it('Toolbar exposes orientation via aria-orientation', () => {
    render(
      <Toolbar orientation="vertical" label="Studio tools">
        <ToolbarSeparator orientation="horizontal" />
      </Toolbar>,
    );
    expect(screen.getByRole('toolbar', { name: 'Studio tools' })).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('ApprovalRequest resolved state shows decision badge, not dead buttons', () => {
    render(
      <ApprovalRequest
        title="Write to src/index.ts"
        state="approved"
        action="write"
        target="src/index.ts"
        scope="workspace:root"
        expiresAt="12:40"
        onApprove={() => { }}
        onReject={() => { }}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('write · src/index.ts · workspace:root · до 12:40')).toBeInTheDocument();
  });

  it('ApprovalRequest restores focus to the resolved status on decision', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ApprovalRequest title="Write" onApprove={() => { }} onReject={() => { }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Разрешить' }));
    rerender(
      <ApprovalRequest title="Write" state="approved" onApprove={() => { }} onReject={() => { }} />,
    );
    const status = screen.getByRole('status');
    const target = status.querySelector('[tabindex="-1"]');
    expect(target).not.toBeNull();
    expect(document.activeElement).toBe(target);
  });
});
