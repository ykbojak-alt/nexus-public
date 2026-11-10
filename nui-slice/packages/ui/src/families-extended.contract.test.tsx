import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ActionMenu } from './actions/action-menu/action-menu';
import { CommandTrigger } from './actions/command-trigger/command-trigger';
import { SplitButton } from './actions/split-button/split-button';
import { Combobox } from './inputs/combobox/combobox';
import { RadioGroup } from './inputs/radio/radio';
import { Checkbox } from './inputs/checkbox/checkbox';
import { TextField } from './inputs/text-field/text-field';
import { Popover } from './surfaces/popover/popover';
import { Drawer } from './surfaces/drawer/drawer';
import { ToastRegion, type ToastData } from './feedback/toast/toast';
import { ProgressBar } from './feedback/progress-bar/progress-bar';
import { EmptyState } from './feedback/empty-state/empty-state';
import { ErrorState } from './feedback/error-state/error-state';
import { LoadingState } from './feedback/loading-state/loading-state';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeaderCell } from './surfaces/table/table';
import { SystemNotice } from './feedback/system-notice/system-notice';
import { NavItem } from './navigation/nav-item/nav-item';
import { Breadcrumbs } from './navigation/breadcrumbs/breadcrumbs';
import { IconRail } from './navigation/icon-rail/icon-rail';
import { PageHeader } from './navigation/page-header/page-header';
import { WindowFrame } from './layout/window-frame';
import { ArtPanel } from './surfaces/art-panel/art-panel';
import { AssistantCard } from './ai/assistant-card/assistant-card';

afterEach(cleanup);

describe('Task 10 extended families — semantic contracts', () => {
  it('ActionMenu: menu/menuitem semantics, Escape closes and refocuses trigger', () => {
    const onAction = vi.fn();
    render(<ActionMenu trigger={<span>Actions</span>} triggerLabel="Actions"
      items={[{ id: 'retry', label: 'Retry' }, { id: 'delete', label: 'Delete', danger: true }]}
      onAction={onAction} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry' }));
    expect(onAction).toHaveBeenCalledWith('retry');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Combobox: combobox/listbox roles and Enter selects', () => {
    const onChange = vi.fn();
    render(<Combobox label="Agent" value="" onChange={onChange}
      options={[{ value: 'a', label: 'Alice' }, { value: 'm', label: 'Mech' }]} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'me' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('m');
  });

  it('TextField: label association + error announces via alert', () => {
    render(<TextField label="Name" error="Required" />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('Checkbox and RadioGroup use native semantics', () => {
    const onCheck = vi.fn();
    const onRadio = vi.fn();
    render(<>
      <Checkbox label="Notify" checked={false} onCheckedChange={onCheck} />
      <RadioGroup label="Mode" value="a" onChange={onRadio}
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
    </>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notify' }));
    expect(onCheck).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(onRadio).toHaveBeenCalledWith('b');
  });

  it('Drawer: aria-modal dialog, Escape calls onOpenChange, restores focus', () => {
    const onOpenChange = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return <><button onClick={() => setOpen(true)}>open</button>
        <Drawer open={open} onOpenChange={(o) => { setOpen(o); onOpenChange(o); }} label="Panel">body</Drawer></>;
    }
    render(<Host />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Drawer: aria-modal implies focus trap — Tab cycles inside', () => {
    render(
      <Drawer open onOpenChange={() => { }} label="Panel">
        <button>first</button><button>last</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const last = screen.getByRole('button', { name: 'last' });
    // Scrollable body (tabindex=0) is the first cycle member.
    const body = dialog.querySelector('[tabindex="0"]') as HTMLElement;
    expect(body).not.toBeNull();
    // Trap owns the wrap edges: Tab past last → first; Shift+Tab before first → last.
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(body);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Popover: dialog role, outside click closes', () => {
    render(<div>
      <Popover trigger={<span>info</span>} label="Details">details body</Popover>
      <button>outside</button>
    </div>);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Toast region is polite live region; dismiss button works', async () => {
    const onDismiss = vi.fn();
    const toasts: ToastData[] = [{ id: 't1', message: 'Saved', durationMs: 0 }];
    render(<ToastRegion toasts={toasts} onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    // notifyOut (W4-1010): dismiss держит keep-alive 140ms до onDismiss.
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('t1'));
  });

  it('ProgressBar exposes progressbar semantics with clamped value', () => {
    render(<ProgressBar value={120} label="Build" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '120');
  });

  it('NavItem marks active page; Breadcrumbs mark last crumb', () => {
    render(<>
      <NavItem label="Runs" href="/runs" active />
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Runs' }]} />
    </>);
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(nav).getByText('Runs')).toHaveAttribute('aria-current', 'page');
  });

  it('IconRail lists sections, marks the active one, and selects via onSelect', async () => {
    const onSelect = vi.fn();
    render(<IconRail activeId="runtime" onSelect={onSelect}
      sections={[
        { id: 'mc', label: 'Миссии', href: '/mission-control' },
        { id: 'runtime', label: 'Runtime', href: '/runtime' },
      ]} footer={<span>profile</span>} />);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(2);
    // 'page' — листовой маршрут: единый vocab с TopBar/Breadcrumbs и e2e-контрактом
    expect(within(nav).getByRole('link', { name: 'Runtime' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(nav).getByRole('link', { name: 'Миссии' }));
    expect(onSelect).toHaveBeenCalledWith('mc');
    expect(screen.getByText('profile')).toBeInTheDocument();
  });

  it('IconRail expands child routes under the active section; leaf carries aria-current=page', () => {
    render(<IconRail activeId="models" onSelect={() => { }}
      sections={[
        {
          id: 'intel', label: 'Intelligence', children: [
            { id: 'memory', label: 'Память', href: '/memory' },
            { id: 'models', label: 'Модели', href: '/models' },
          ]
        },
        { id: 'runtime', label: 'Runtime', href: '/runtime' },
      ]} />);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    const parent = within(nav).getByRole('button', { name: 'Intelligence' });
    expect(parent).toHaveAttribute('aria-expanded', 'true');
    // ровно один «page» — листовой маршрут; родитель-кнопка страницей не является
    expect(within(nav).getByRole('link', { name: 'Модели' })).toHaveAttribute('aria-current', 'page');
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(parent).not.toHaveAttribute('aria-current');
  });

  it('PageHeader renders title, subtitle and hosts the KPI/actions slots', () => {
    render(<PageHeader title="Рантайм" subtitle="Наблюдаемая консоль"
      kpi={<span data-testid="kpi-strip" />} actions={<button type="button">A</button>} />);
    expect(screen.getByRole('heading', { name: 'Рантайм' })).toBeInTheDocument();
    expect(screen.getByText('Наблюдаемая консоль')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
  });

  it('WindowFrame (runtime-2 A0): slot regions render, empty ones collapse', () => {
    const { rerender } = render(
      <WindowFrame brand={<b>NEXUS</b>} tabs={<nav>табы</nav>} tools={<button>⚙</button>}
        left={<nav>меню</nav>} right={<div>карта</div>} bottom={<div>версии</div>}>
        <p>канвас</p>
      </WindowFrame>,
    );
    const frame = screen.getByTestId('window-frame');
    expect(screen.getByText('NEXUS')).toBeInTheDocument();
    expect(screen.getByText('канвас')).toBeInTheDocument();
    expect(screen.getByText('версии')).toBeInTheDocument();
    expect(frame.querySelector('header')).not.toBeNull();
    expect(frame.querySelectorAll('aside')).toHaveLength(2);
    expect(frame.querySelector('footer')).not.toBeNull();
    rerender(<WindowFrame><p>канвас</p></WindowFrame>);
    const bare = screen.getByTestId('window-frame');
    expect(bare.querySelector('header')).toBeNull();
    expect(bare.querySelector('aside')).toBeNull();
    expect(bare.querySelector('footer')).toBeNull();
  });

  it('ArtPanel (visual-3): art + scrim render; absent art is an honest panel', () => {
    const { rerender } = render(
      <ArtPanel art={{ src: '/art/a.webp' }}><p>контент</p></ArtPanel>,
    );
    const panel = screen.getByTestId('art-panel');
    expect(panel).toHaveAttribute('data-has-art');
    expect(panel.querySelector('img')).not.toBeNull();
    rerender(<ArtPanel><p>контент</p></ArtPanel>);
    const bare = screen.getByTestId('art-panel');
    expect(bare).not.toHaveAttribute('data-has-art');
    expect(bare.querySelector('img')).toBeNull();
    expect(bare).toHaveTextContent('контент');
  });

  it('AssistantCard (visual-3): portrait/tags/status; selected is aria-pressed; no art → monogram', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <AssistantCard name="AGENT-A" subtitle="Диалог и инсайты" tags={['Диалог', 'Инсайты']}
        status="available" statusLabel="Доступен" selected onSelect={onSelect} />,
    );
    const card = screen.getByTestId('assistant-card');
    // Интерактивная карточка — нативный <button> (контракт app-shell: Tab
    // должен падать на настоящий интерактивный тег, не div[role=button]).
    expect(card.tagName).toBe('BUTTON');
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('AGENT-A')).toBeInTheDocument();
    expect(screen.getByText('Доступен')).toBeInTheDocument();
    expect(screen.getByText('Диалог')).toBeInTheDocument();
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalled();
    rerender(<AssistantCard name="M.E.C.H." />);
    expect(screen.getByTestId('assistant-card').querySelector('img')).toBeNull();
  });

  it('SystemNotice tones map to status/alert roles', () => {
    render(<><SystemNotice tone="info">i</SystemNotice><SystemNotice tone="error">e</SystemNotice></>);
    expect(screen.getByRole('status')).toHaveTextContent('i');
    expect(screen.getByRole('alert')).toHaveTextContent('e');
  });

  it('SplitButton fires main action and menu action independently', () => {
    const onClick = vi.fn();
    const onAction = vi.fn();
    render(<SplitButton label="Run" onClick={onClick}
      items={[{ id: 'dry', label: 'Dry run' }]} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dry run' }));
    expect(onAction).toHaveBeenCalledWith('dry');
  });

  it('CommandTrigger renders kbd hint and fires onClick', () => {
    const onClick = vi.fn();
    render(<CommandTrigger onClick={onClick} />);
    const btn = screen.getByRole('button', { name: /Search commands/ });
    expect(btn).toHaveTextContent('Ctrl K');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('EmptyState renders title and optional action', () => {
    render(<EmptyState title="No runs" body="Start your first run" action={<button>New</button>} />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No runs');
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('EmptyState inline variant renders a hint line, not a hero panel', () => {
    render(<EmptyState variant="inline" title="Прогонов под фильтром нет" />);
    const el = screen.getByTestId('empty-state');
    expect(el.tagName).toBe('P');
    expect(el).toHaveAttribute('data-state', 'empty');
    expect(el).toHaveTextContent('Прогонов под фильтром нет');
  });

  it('ErrorState inline keeps role=alert and offers a themed retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState variant="inline" title="Не удалось загрузить историю" onRetry={onRetry} />);
    const el = screen.getByRole('alert');
    expect(el).toHaveAttribute('data-state', 'error');
    const btn = screen.getByRole('button', { name: 'Повторить' });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalled();
  });

  it('LoadingState announces politely and is marked loading', () => {
    render(<LoadingState>Загрузка истории…</LoadingState>);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('data-state', 'loading');
    expect(el).toHaveTextContent('Загрузка истории…');
  });

  it('Table is labelled, keeps th/td semantics and marks selected rows', () => {
    render(
      <Table label="Сравнение прогонов">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Метрика</TableHeaderCell>
            <TableHeaderCell numeric>A</TableHeaderCell>
            <TableHeaderCell numeric>B</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow selected>
            <TableCell rowHeader>Score</TableCell>
            <TableCell numeric>0.91</TableCell>
            <TableCell numeric>0.87</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('table', { name: 'Сравнение прогонов' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Метрика' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Score' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Score 0.91 0.87' })).toHaveAttribute('data-selected');
  });
});
