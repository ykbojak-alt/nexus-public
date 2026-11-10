import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { List, ListItem } from './list';
import { ScrollRegion } from './scroll-region';
import { Listbox, ListboxOption } from '../inputs/listbox/listbox';
import { Tabs } from '../navigation/tabs/tabs';
import { Tab, TabList, TabPanel } from '../navigation/tabs/tab-primitives';
import { Modal } from '../surfaces/modal/modal';
import { Drawer } from '../surfaces/drawer/drawer';
import { ActionMenu } from '../actions/action-menu/action-menu';
import { Tooltip } from '../surfaces/tooltip/tooltip';

afterEach(cleanup);

describe('accessibility primitives (wave-XXV)', () => {
  it('ScrollRegion is named, keyboard reachable and axe-clean', async () => {
    render(<main><ScrollRegion label="Журнал"><p>Записи</p></ScrollRegion></main>);
    const region = screen.getByRole('region', { name: 'Журнал' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('List/ListItem provides valid list ownership and is axe-clean', async () => {
    render(<main><List aria-label="Плагины"><ListItem>Встроенные</ListItem></List></main>);
    expect(screen.getByRole('list')).toContainElement(screen.getByRole('listitem'));
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('Listbox supports arrow navigation and explicit selection; axe-clean', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <main><Listbox aria-label="Модель" value="a" onChange={onChange}>
        <ListboxOption value="a">Модель A</ListboxOption>
        <ListboxOption value="b">Модель B</ListboxOption>
        <ListboxOption value="c" disabled>Модель C</ListboxOption>
      </Listbox></main>,
    );
    const root = screen.getByRole('listbox', { name: 'Модель' });
    root.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Модель B' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('option', { name: 'Модель C' })).toHaveAttribute('aria-disabled', 'true');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('Tabs keeps one roving tab stop and is axe-clean', async () => {
    const user = userEvent.setup();
    render(<main><Tabs tabs={[{ id: 'a', label: 'Обзор' }, { id: 'b', label: 'События' }]} value="a" onChange={() => {}} aria-label="Разделы" /></main>);
    const first = screen.getByRole('tab', { name: 'Обзор' });
    const second = screen.getByRole('tab', { name: 'События' });
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('TabList/Tab/TabPanel exposes relations, roves focus and is axe-clean', async () => {
    const user = userEvent.setup();
    function Host() {
      const [value, setValue] = useState('summary');
      return (
        <>
          <TabList aria-label="Разделы" value={value} onChange={setValue}>
            <Tab value="summary" controls="summary-panel">Сводка</Tab>
            <Tab value="history" controls="history-panel">История</Tab>
          </TabList>
          <TabPanel id="summary-panel" labelledBy="summary-panel-tab" active={value === 'summary'}>Сводка</TabPanel>
          <TabPanel id="history-panel" labelledBy="history-panel-tab" active={value === 'history'}>История</TabPanel>
        </>
      );
    }
    render(<main><Host /></main>);
    const summary = screen.getByRole('tab', { name: 'Сводка' });
    const history = screen.getByRole('tab', { name: 'История' });
    expect(summary).toHaveAttribute('aria-controls', 'summary-panel');
    expect(screen.getByRole('tabpanel', { name: 'Сводка' })).toBeVisible();
    summary.focus();
    await user.keyboard('{ArrowRight}');
    expect(history).toHaveFocus();
    expect(history).toHaveAttribute('tabindex', '0');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('Modal focus-traps, closes on Escape and returns focus; axe-clean', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Открыть</button><Modal open={open} onClose={() => setOpen(false)} title="Настройки"><button>Сохранить</button><button>Отмена</button></Modal></>;
    }
    render(<main><Host /></main>);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    await user.click(opener);
    expect(await axe(document.body)).toHaveNoViolations();
    const cancel = screen.getByRole('button', { name: 'Отмена' });
    cancel.focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('Drawer has a named modal dialog and is axe-clean', async () => {
    render(<main><Drawer open onOpenChange={() => {}} label="Параметры"><button>Закрыть</button></Drawer></main>);
    expect(screen.getByRole('dialog', { name: 'Параметры' })).toBeInTheDocument();
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
  });

  it('Drawer traps keyboard focus and restores it to the opener', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть панель</button>
          <Drawer open={open} onOpenChange={setOpen} label="Параметры">
            <button>Первое</button>
            <button>Последнее</button>
          </Drawer>
        </>
      );
    }
    render(<main><Host /></main>);
    const opener = screen.getByRole('button', { name: 'Открыть панель' });
    await user.click(opener);
    const first = screen.getByRole('button', { name: 'Первое' });
    const last = screen.getByRole('button', { name: 'Последнее' });
    last.focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('dialog', { name: 'Параметры' }).querySelector('[tabindex="0"]')).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(first).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('ActionMenu is axe-clean while open and supports Escape', async () => {
    const user = userEvent.setup();
    render(<main><ActionMenu trigger="Ещё" triggerLabel="Ещё действия" items={[{ id: 'open', label: 'Открыть' }, { id: 'rename', label: 'Переименовать' }]} onAction={() => {}} /></main>);
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }));
    const openItem = screen.getByRole('menuitem', { name: 'Открыть' });
    const renameItem = screen.getByRole('menuitem', { name: 'Переименовать' });
    expect(openItem).toHaveFocus();
    expect(openItem).toHaveAttribute('tabindex', '0');
    await user.keyboard('{ArrowDown}');
    expect(renameItem).toHaveFocus();
    expect(openItem).toHaveAttribute('tabindex', '-1');
    expect(await axe(document.body)).toHaveNoViolations();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ещё действия' })).toHaveFocus();
  });

  it('Tooltip dismisses on Escape and is axe-clean', async () => {
    render(<main><Tooltip content="Справка"><button>Помощь</button></Tooltip></main>);
    const button = screen.getByRole('button', { name: 'Помощь' });
    fireEvent.focus(button);
    expect(button).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Справка');
    expect(await axe(document.body)).toHaveNoViolations();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
