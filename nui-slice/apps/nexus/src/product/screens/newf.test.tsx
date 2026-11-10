// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeLook, mockHcBridge, NewfScreen, NewfTerminals, parseHerdrLayout } from './newf';
import { applyStatusEvent, FloatingTerminal, LiveContext, NewfPopScreen, type LiveCtx, type LiveData } from './newf';
import { createCoreBridge, type NewfBridge } from './newf-live';
import { renderAnsiScreen } from './newf-screen';
import { VoiceUiContext } from './voice-ui';
import {
  applySizes,
  collectSizeDiff,
  collectSizes,
  createInMemoryStateStore,
  fingerprint,
  layoutStateKey,
  parseLayoutState,
  serializeLayout,
  serializeLayoutState,
  type LayoutCommands,
} from './newf';

afterEach(cleanup);

beforeEach(() => {
  // jsdom lacks PointerEvent/DragEvent; use MouseEvent so coordinate-bearing
  // interactions exercise the same handlers without a browser or live bridge.
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('DragEvent', MouseEvent);
  // #528: floating-геометрия персистится в localStorage — между тестами чистим,
  // чтобы тесты были изолированы (новые окна с дефолтной позицией).
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

const HERDR_LAYOUT = JSON.stringify({
  id: 'root',
  type: 'row',
  gap: 8,
  resizable: false,
  children: [
    {
      id: 'sidebar',
      type: 'column',
      size: { px: 268 },
      min: 44,
      max: 480,
      children: [
        { id: 'brand', type: 'block', size: { px: 46 }, content: { mod: 'workspace-chrome', props: { footer: false } } },
        { id: 'shell', type: 'block', content: { terminal: 'mock-roy-01' } },
        { id: 'active', type: 'block', content: { tab: 'active', pane: { gap: 8, radius: 10 } } },
      ],
    },
    {
      id: 'panel',
      type: 'stack',
      active: 'agents-pane',
      children: [
        { id: 'agents-pane', type: 'block', content: { agent: 'focused' } },
        { id: 'files-pane', type: 'block', content: { mod: 'files' } },
      ],
    },
  ],
});

const INTERACTIVE_LAYOUT = JSON.stringify({
  id: 'root',
  type: 'column',
  children: [
    {
      id: 'split', type: 'row', resizable: true, gap: 8,
      children: [
        { id: 'pane-a', type: 'block', size: { px: 200 }, min: 150, max: 250, content: { mod: 'files' } },
        { id: 'pane-b', type: 'block', size: { px: 200 }, min: 150, max: 250, content: { mod: 'changes' } },
      ],
    },
    {
      id: 'stack', type: 'stack', active: 'files-pane', children: [
        { id: 'files-pane', type: 'block', content: { mod: 'files' } },
        { id: 'changes-pane', type: 'block', content: { mod: 'changes' } },
      ],
    },
  ],
});

const INTERACTIVE_COLUMN_LAYOUT = JSON.stringify({
  id: 'column-split', type: 'column', resizable: true, children: [
    { id: 'top-pane', type: 'block', size: { px: 180 }, min: 100, max: 260, content: { mod: 'files' } },
    { id: 'bottom-pane', type: 'block', size: { px: 180 }, min: 100, max: 260, content: { mod: 'changes' } },
  ],
});

const AGENTS_LAYOUT = JSON.stringify({
  id: 'agents-root', type: 'row', resizable: false, children: [
    { id: 'agents-block', type: 'block', content: { mod: 'agents' } },
  ],
});

const CORE_AGENT_TERMINALS = [
  { address: 'local/alice', state: 'working', labels: { agent: 'alice', 'newf.seat': 'orchestrator' } },
  { address: 'local/coder', state: 'idle', labels: { agent: 'devin', 'newf.seat': 'coder-1' } },
  { address: 'local/coder-2', state: 'idle', labels: { agent: 'forge', 'newf.seat': 'coder-2' } },
  { address: 'local/reviewer', state: 'idle', labels: { agent: 'codex', 'newf.seat': 'reviewer' } },
  { address: 'local/short', state: 'idle', labels: { agent: 'qoder', 'newf.seat': 'short' } },
  { address: 'local/unseated', state: 'idle', labels: { agent: 'helper' } },
  { address: 'local/coder-child', state: 'idle', parent: 'local/coder', labels: { agent: 'nested-helper' } },
];

describe('NEWF E1 layout renderer', () => {
  it('parses Herdr row/column/stack/block nodes, geometry, and each content kind', () => {
    const layout = parseHerdrLayout(HERDR_LAYOUT);

    expect(layout.type).toBe('row');
    expect(layout.gap).toBe(8);
    expect(layout.resizable).toBe(false);
    expect(layout.children?.[0].size).toEqual({ px: 268 });
    expect(layout.children?.[0].min).toBe(44);
    expect(layout.children?.[0].max).toBe(480);
    expect(layout.children?.[0].children?.map((node) => node.content?.kind)).toEqual(['mod', 'terminal', 'tab']);
    expect(layout.children?.[1].active).toBe('agents-pane');
    expect(layout.children?.[1].children?.map((node) => node.content?.kind)).toEqual(['agent', 'mod']);
  });

  it('rejects invalid JSON and duplicate node identifiers with readable errors', () => {
    expect(() => parseHerdrLayout('{ broken')).toThrow(/JSON/i);
    const duplicate = JSON.stringify({
      id: 'root', type: 'row', children: [
        { id: 'same', type: 'block', content: { mod: 'spaces' } },
        { id: 'same', type: 'block', content: { mod: 'agents' } },
      ],
    });
    expect(() => parseHerdrLayout(duplicate)).toThrow(/duplicate.*same/i);
  });

  it('renders the default tree with offline mock spaces and agents', async () => {
    render(<NewfScreen />);

    const root = screen.getByTestId('newf-workspace');
    expect(root).toHaveAttribute('data-mode', 'mock');
    expect(screen.getByRole('heading', { level: 1, name: 'NEWF' })).toBeInTheDocument();
    expect(screen.getByText('Mock bridge · offline')).toBeInTheDocument();
    expect(screen.getByText(/передайте prop live/i)).toBeInTheDocument();
    // UI-5: newf-mods грузится лениво — ждём резолва чанка.
    const spaces = within(await screen.findByRole('region', { name: 'Spaces' }));
    expect(spaces.getByText('Local workspace')).toBeInTheDocument();
    expect(spaces.getByText('remote-host')).toBeInTheDocument();
    expect(spaces.getByText('roy2')).toBeInTheDocument();
    const agents = within(await screen.findByRole('region', { name: 'Agents' }));
    expect(agents.getByText('AGENT-A')).toBeInTheDocument();
    expect(agents.getByText('ROLE-2')).toBeInTheDocument();
    expect(agents.getByText('ROLE-1')).toBeInTheDocument();
  });

  it('renders mod, terminal, tab, and agent blocks from a supplied Herdr layout', () => {
    render(<NewfScreen layoutJson={HERDR_LAYOUT} />);

    expect(screen.getByRole('region', { name: 'Workspace chrome' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Terminal mock-roy-01' })).toHaveTextContent('Waiting for a fixture dependency.');
    expect(screen.getByRole('region', { name: 'Tab active' })).toHaveTextContent('mock-local-01');
    expect(screen.getByRole('region', { name: 'Agent focused' })).toHaveTextContent('AGENT-A');
    expect(screen.queryByRole('region', { name: 'Mod files' })).not.toBeInTheDocument();
  });

  it('shows a parse error without crashing the page', () => {
    render(<NewfScreen layoutJson="not-json" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/layout JSON/i);
  });

  it('provides fixture-backed spaces, terminals, and agents without live operations', () => {
    expect(mockHcBridge.spaces().map((space) => space.machine)).toEqual(['This machine', 'remote-host', 'roy2']);
    expect(mockHcBridge.terminals()).toHaveLength(7);
    expect(mockHcBridge.agents().map((agent) => agent.status)).toEqual(
      ['working', 'idle', 'blocked', 'idle', 'done', 'working', 'idle']);
  });

  it('resizes a row split by pointer and clamps the next keyboard adjustment to min/max', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_LAYOUT} />);
    const divider = screen.getByRole('slider', { name: /pane-a.*pane-b/i });
    const paneA = screen.getByTestId('newf-layout-node-pane-a');
    const paneB = screen.getByTestId('newf-layout-node-pane-b');
    vi.spyOn(paneA, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 0, right: 200, top: 0, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(paneB, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 208, right: 408, top: 0, bottom: 100, x: 208, y: 0, toJSON: () => ({}) } as DOMRect);

    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 248 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 248 });
    expect(divider).toHaveAttribute('aria-valuenow', '248');

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider).toHaveAttribute('aria-valuenow', '250');
    expect(divider).toHaveAttribute('aria-valuemax', '250');
    expect(screen.getByTestId('newf-layout-node-pane-b')).toHaveAttribute('data-size-px', '150');
  });

  it('resizes a column split along its horizontal separator', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_COLUMN_LAYOUT} />);
    const divider = screen.getByRole('slider', { name: /top-pane.*bottom-pane/i });
    const top = screen.getByTestId('newf-layout-node-top-pane');
    const bottom = screen.getByTestId('newf-layout-node-bottom-pane');
    vi.spyOn(top, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 180, left: 0, right: 200, top: 0, bottom: 180, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(bottom, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 180, left: 0, right: 200, top: 190, bottom: 370, x: 0, y: 190, toJSON: () => ({}) } as DOMRect);

    fireEvent.pointerDown(divider, { pointerId: 2, clientY: 180 });
    fireEvent.pointerMove(divider, { pointerId: 2, clientY: 210 });
    fireEvent.pointerUp(divider, { pointerId: 2, clientY: 210 });

    expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
    expect(divider).toHaveAttribute('aria-valuenow', '210');
    expect(bottom).toHaveAttribute('data-size-px', '150');
  });

  it('switches the active child in a stack from its accessible tab strip', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_LAYOUT} />);
    const tabs = screen.getByRole('tablist', { name: 'Layout tabs stack' });
    const filesTab = within(tabs).getByRole('tab', { name: 'files-pane' });
    const changesTab = within(tabs).getByRole('tab', { name: 'changes-pane' });
    expect(filesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'files-pane' })).toBeInTheDocument();

    fireEvent.click(changesTab);

    expect(changesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'changes-pane' })).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'files-pane' })).not.toBeInTheDocument();
  });

  it('center-drop swaps two movable panes in their split', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_LAYOUT} />);
    const paneA = screen.getByTestId('newf-layout-node-pane-a');
    const paneB = screen.getByTestId('newf-layout-node-pane-b');
    fireEvent.dragStart(paneA, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    fireEvent.dragOver(paneB);
    fireEvent.drop(paneB, { clientX: 0, clientY: 0 });

    const split = screen.getByTestId('newf-layout-node-split');
    const directPanes = Array.from(split.children).filter((child) => child.hasAttribute('data-layout-node'));
    expect(directPanes.map((child) => child.getAttribute('data-layout-node'))).toEqual(['pane-b', 'pane-a']);
  });

  it('edge-drop creates a nested split beside the target pane', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_LAYOUT} />);
    const paneA = screen.getByTestId('newf-layout-node-pane-a');
    const paneB = screen.getByTestId('newf-layout-node-pane-b');
    vi.spyOn(paneB, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 100, left: 0, right: 100, top: 0, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.dragStart(paneA, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    fireEvent.dragOver(paneB, { clientX: 5, clientY: 50 });
    fireEvent.drop(paneB, { clientX: 5, clientY: 50 });

    const nested = screen.getByTestId('newf-layout-node-split-pane-b-pane-a');
    expect(nested).toHaveAttribute('data-layout-type', 'row');
    const nestedPanes = Array.from(nested.children).filter((child) => child.hasAttribute('data-layout-node'));
    expect(nestedPanes.map((child) => child.getAttribute('data-layout-node'))).toEqual(['pane-a', 'pane-b']);
  });

  it('does not make panes draggable when movable=false is inherited from an ancestor', () => {
    const lockedLayout = JSON.stringify({
      id: 'locked-root', type: 'row', movable: false, children: [
        { id: 'locked-a', type: 'block', content: { mod: 'files' } },
        { id: 'locked-b', type: 'block', content: { mod: 'changes' } },
      ],
    });
    render(<NewfScreen layoutJson={lockedLayout} />);
    expect(screen.getByTestId('newf-layout-node-locked-a')).toHaveAttribute('draggable', 'false');
    expect(screen.getByTestId('newf-layout-node-locked-b')).toHaveAttribute('draggable', 'false');
  });

  it('renders the five fixed swarm seats — role titles with user-named occupants', async () => {
    render(<NewfScreen />);
    const agents = await screen.findByRole('region', { name: 'Agents' });
    // роли зафиксированы, имена — пользовательские (из фикстур/лейблов)
    for (const title of ['Оркестратор', 'Кодер 1', 'Кодер 2', 'Ревизор/тестер', 'Короткий']) {
      expect(within(agents).getByText(new RegExp(title))).toBeInTheDocument();
    }
    for (const name of ['AGENT-A', 'ROLE-2', 'ROLE-1', 'ROLE-4', 'AGENT-B']) {
      expect(within(agents).getByText(name)).toBeInTheDocument();
    }
    expect(within(agents).queryByText('свободно')).not.toBeInTheDocument();
    // субагенты вложены под своих родителей (parent → terminal)
    expect(agents.querySelector('[data-sub-of="mock-local-01"]')).not.toBeNull();
    expect(agents.querySelector('[data-sub-of="mock-sage-01"]')).not.toBeNull();
    expect(within(agents).getByText('OpenCode')).toBeInTheDocument();
    expect(within(agents).getByText('forge-r')).toBeInTheDocument();
  });

  it('live mode shows honest offline state instead of mock data when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('mocked offline')));
    render(<NewfScreen live bridgeBase="http://127.0.0.1:1" />);

    const root = screen.getByTestId('newf-workspace');
    expect(root).toHaveAttribute('data-mode', 'live');
    // Мост недоступен → честный offline-бейдж, мок-данные не подставляются.
    expect(await screen.findByText(/live-bridge недоступен/i, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Mock spaces' })).not.toBeInTheDocument();
  });
});

describe('NEWF nexus-core bridge (backend=core)', () => {
  function jsonResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
  }

  /** Роут /events в тестах отсутствует (как в ранних core) — честный 404. */
  function events404(): Response {
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not Found' } as Response;
  }

  it('queries /api/core/* and normalizes supervisor to_dict() records', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/terminals')) {
        return jsonResponse({
          count: 1, live: 1,
          terminals: [{
            name: 't1', machine: 'local', address: 'local/t1',
            command: ['bash'], cwd: null, state: 'working', attention: false,
            keep: true, parent: 'local/t0', die_with_parent: false,
            labels: { 'nx.space': 's1', 'nx.tab': 'main', agent: 'devin', 'newf.seat': 'coder-1' },
          }],
        });
      }
      if (url.endsWith('/api/core/agents')) {
        return jsonResponse({ agents: [{
          address: 'local/t1', name: 'devin', state: 'working', attention: false,
          parent: 'local/t0',
          labels: { 'nx.space': 's1', 'newf.seat': 'coder-1' },
        }], count: 1 });
      }
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) {
        return jsonResponse({ spaces: [{ id: 's1', name: 's1', machine: 'local' }] });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const bridge = createCoreBridge('http://core.test:5683');
    const terms = await bridge.terminals();
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({
      address: 'local/t1', state: 'working', agent: 'devin',
      spaceId: 's1', tab: 'main', machine: 'local', seat: 'coder-1',
    });
    const spaces = await bridge.spaces();
    expect(spaces[0]).toMatchObject({ id: 's1', machine: 'local' });
    const agents = await bridge.agents();
    expect(agents[0]).toMatchObject({ name: 'devin', terminal: 'local/t1', status: 'working', seat: 'coder-1', parent: 'local/t0' });
    // вся активность ушла по /api/core префиксу
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain('/api/core/');
      expect(String(url)).not.toContain('/api/bus/');
    }
  });

  it('screen() hits /api/core/screen/{term} with bare terminal name', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toBe('http://core.test:5683/api/core/screen/t1');
      return jsonResponse({ term: 'local/t1', screen: 'hello core' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const bridge = createCoreBridge('http://core.test:5683');
    await expect(bridge.screen('local/t1')).resolves.toBe('hello core');
  });

  it('live backend=core renders live panes from core payloads (no bus calls)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/bus/')) throw new Error('bus must not be called in core mode');
      if (url.endsWith('/api/core/terminals')) {
        return jsonResponse({ count: 1, live: 1, terminals: [{
          name: 't1', machine: 'local', address: 'local/t1', state: 'working',
          labels: { 'nx.space': 's1', 'nx.tab': 'main', agent: 'devin' },
        }] });
      }
      if (url.endsWith('/api/core/agents')) {
        return jsonResponse({ agents: [{
          address: 'local/t1', name: 'devin', state: 'working',
          labels: { 'nx.space': 's1' },
        }], count: 1 });
      }
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) return jsonResponse({ spaces: [{ id: 's1', name: 's1', machine: 'local' }] });
      if (url.endsWith('/api/core/machines')) return jsonResponse({ machines: ['local'] });
      if (url.includes('/api/core/screen/')) return jsonResponse({ term: 'local/t1', screen: 'core screen tail' });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NewfScreen live backend="core" bridgeBase="http://core.test:5683" layoutJson={HERDR_LAYOUT} />);
    expect(screen.getByTestId('newf-workspace')).toHaveAttribute('data-mode', 'live');
    // данные из ядра доехали — агент-пейн показывает devin, экран опрашивается
    await screen.findByText('devin', {}, { timeout: 8000 });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/core/screen/'))).toBe(true);
    }, { timeout: 8000 });
    expect(screen.queryByText(/недоступен/i)).not.toBeInTheDocument();
  });

  it('adds sub-agent controls for non-orchestrator seats and unseated agents, but not the orchestrator', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/terminals')) return jsonResponse({ terminals: CORE_AGENT_TERMINALS });
      if (url.endsWith('/api/core/agents')) return jsonResponse({ agents: CORE_AGENT_TERMINALS.map((t, i) => ({ address: t.address, name: t.labels.agent ?? `agent-${i}`, state: t.state, parent: t.parent ?? null, labels: { 'newf.seat': t.labels['newf.seat'] } })) });
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) return jsonResponse({ spaces: [] });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NewfScreen live backend="core" bridgeBase="http://core.test:5683" layoutJson={AGENTS_LAYOUT} />);
    const agents = await screen.findByRole('region', { name: 'Agents' });
    await screen.findByText('helper');

    expect(screen.queryByTestId('spawn-sub-agent-local/alice')).not.toBeInTheDocument();
    expect(screen.getByTestId('spawn-sub-agent-local/coder')).toHaveAccessibleName('Spawn sub-agent');
    expect(screen.getByTestId('spawn-sub-agent-local/coder-2')).toHaveAccessibleName('Spawn sub-agent');
    expect(screen.getByTestId('spawn-sub-agent-local/reviewer')).toHaveAccessibleName('Spawn sub-agent');
    expect(screen.getByTestId('spawn-sub-agent-local/short')).toHaveAccessibleName('Spawn sub-agent');
    expect(screen.getByTestId('spawn-sub-agent-local/unseated')).toHaveAccessibleName('Spawn sub-agent');
    expect(agents.querySelector('[data-sub-of="local/coder"]')).toHaveTextContent('nested-helper');
  });

  it('submits a command with the parent terminal, supports Escape, and leaves discovery to polling', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/core/terminals')) return jsonResponse({ terminals: CORE_AGENT_TERMINALS });
      if (url.endsWith('/api/core/agents')) return jsonResponse({ agents: CORE_AGENT_TERMINALS.map((t, i) => ({ address: t.address, name: t.labels.agent ?? `agent-${i}`, state: t.state, parent: t.parent ?? null, labels: { 'newf.seat': t.labels['newf.seat'] } })) });
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) return jsonResponse({ spaces: [] });
      if (url.endsWith('/api/core/run')) return jsonResponse({ address: 'local/new-child' });
      throw new Error(`unexpected ${url} ${init?.method ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<NewfScreen live backend="core" bridgeBase="http://core.test:5683" layoutJson={AGENTS_LAYOUT} />);
    await screen.findByText('helper');
    await user.click(screen.getByTestId('spawn-sub-agent-local/coder'));
    const input = screen.getByRole('textbox', { name: 'Sub-agent command' });
    // #528 UX: pre-fill разумной команды
    expect(input).toHaveValue('claude');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Sub-agent command' })).not.toBeInTheDocument();

    await user.click(screen.getByTestId('spawn-sub-agent-local/coder'));
    const input2 = screen.getByRole('textbox', { name: 'Sub-agent command' });
    fireEvent.change(input2, { target: { value: 'python -m tools.agents.loop --persona codex' } });
    await user.keyboard('{Enter}');

    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/core/run'))).toBe(true));
    const [, request] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/core/run'))!;
    const body = JSON.parse(String(request.body));
    // #528: frontend-мост не передаёт name — backend синтезирует ui-<parent>-<ts36>
    expect(body.command).toEqual(['python', '-m', 'tools.agents.loop', '--persona', 'codex']);
    expect(body.parent).toBe('local/coder');
    expect(body.labels).toEqual({ agent: 'sub' });
    expect(typeof body.name).toBe('string');
    expect(body.name).toMatch(/^ui-local-coder-/);
    // New child is not inserted optimistically; it appears only in a later terminal poll.
    expect(screen.queryByText('local/new-child')).not.toBeInTheDocument();
  });

  it('backend=bus legacy: работает через core-пути (без /api/bus/*)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/terminals')) return jsonResponse({ terminals: CORE_AGENT_TERMINALS });
      if (url.endsWith('/api/core/agents')) return jsonResponse({ agents: CORE_AGENT_TERMINALS.map((t, i) => ({ address: t.address, name: t.labels.agent ?? `agent-${i}`, state: t.state, parent: t.parent ?? null, labels: { 'newf.seat': t.labels['newf.seat'] } })) });
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) return jsonResponse({ spaces: [] });
      if (url.includes('/api/core/screen/')) return jsonResponse({ term: 'x', screen: 'frame' });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NewfScreen live backend="bus" bridgeBase="http://bus.test:5681" layoutJson={AGENTS_LAYOUT} />);
    await screen.findByText('helper');

    // legacy-режим больше не обращается к /api/bus/* (BUS вырезан из клиента)
    const busCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/bus/'));
    expect(busCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('exposes run only on core bridge and posts to its run route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ address: 'local/sub-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');

    await expect(core.run?.({ command: ['node', 'worker.js'], parent: 'local/parent', labels: { agent: 'sub' } }))
      .resolves.toEqual({ address: 'local/sub-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/run', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }));
    const runCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/core/run'))!;
    const runBody = JSON.parse(String(runCall[1].body));
    expect(runBody.command).toEqual(['node', 'worker.js']);
    expect(runBody.parent).toBe('local/parent');
    expect(runBody.labels).toEqual({ agent: 'sub' });
    expect(typeof runBody.name).toBe('string');
    expect(runBody.name).toMatch(/^ui-local-parent-/);
  });

  it('#528: клик по агенту открывает плавающее терминал-окно (Herdr parity)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/terminals')) return jsonResponse({ terminals: CORE_AGENT_TERMINALS });
      if (url.endsWith('/api/core/agents')) return jsonResponse({ agents: CORE_AGENT_TERMINALS.map((t, i) => ({ address: t.address, name: t.labels.agent ?? `agent-${i}`, state: t.state, parent: t.parent ?? null, labels: { 'newf.seat': t.labels['newf.seat'] } })) });
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) return jsonResponse({ spaces: [] });
      if (url.includes('/api/core/screen/')) return jsonResponse({ term: 'x', screen: 'frame' });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<NewfScreen live backend="core" bridgeBase="http://core.test:5683" layoutJson={AGENTS_LAYOUT} />);

    await screen.findByText('devin');
    fireEvent.click(screen.getByText('devin'));
    await vi.waitFor(() => {
      expect(screen.getAllByTestId('floating-terminal').length).toBeGreaterThanOrEqual(1);
    });
    const floating = screen.getAllByTestId('floating-terminal')[0];
    expect(floating).toHaveAttribute('data-floating-address', 'local/coder');

    // keep (pin) — не закрывается при клике на другого агента
    fireEvent.click(screen.getByTestId('floating-keep-local/coder'));
    expect(screen.getByTestId('floating-keep-local/coder')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('forge'));
    await vi.waitFor(() => {
      expect(screen.getAllByTestId('floating-terminal').some((n) => n.getAttribute('data-floating-address') === 'local/coder')).toBe(true);
    });

    // close × — закрывает оба окна
    fireEvent.click(screen.getByTestId('floating-close-local/coder-2'));
    fireEvent.click(screen.getByTestId('floating-close-local/coder'));
    await vi.waitFor(() => {
      expect(screen.queryByTestId('floating-terminal')).not.toBeInTheDocument();
    });
  });

  it('#528: живой ввод — печатный символ → send {term,text}, Enter/стрелки → keys', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/core/terminals')) return jsonResponse({ terminals: CORE_AGENT_TERMINALS });
      if (url.endsWith('/api/core/agents')) return jsonResponse({ agents: CORE_AGENT_TERMINALS.map((t, i) => ({ address: t.address, name: t.labels.agent ?? `agent-${i}`, state: t.state, parent: t.parent ?? null, labels: { 'newf.seat': t.labels['newf.seat'] } })) });
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) return jsonResponse({ spaces: [] });
      if (url.includes('/api/core/screen/')) return jsonResponse({ term: 'x', screen: 'frame' });
      if (url.endsWith('/api/core/send')) return jsonResponse({ term: 'x', status: 'sent' });
      if (url.endsWith('/api/core/keys')) return jsonResponse({ term: 'x', status: 'keys_sent' });
      throw new Error(`unexpected ${url} ${init?.method ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<NewfScreen live backend="core" bridgeBase="http://core.test:5683" layoutJson={AGENTS_LAYOUT} />);

    const agentsRegion = await screen.findByRole('region', { name: 'Agents' });
    const devinBtn = within(agentsRegion).getByRole('button', { name: /devin/ });
    fireEvent.click(devinBtn);
    const pane = await screen.findByTestId('floating-terminal');
    const terminal = within(pane).getByRole('region', { name: 'Terminal local/coder' });
    expect(terminal).toHaveAttribute('tabindex', '0');

    // печатный символ → send {term, text: 'a'}
    fireEvent.keyDown(terminal, { key: 'a' });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/core/send'))).toBe(true);
    });
    const [, sendReq] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/core/send'))!;
    expect(JSON.parse(String(sendReq.body))).toMatchObject({ term: 'local/coder', text: 'a' });

    // Enter → keys ['enter']
    fireEvent.keyDown(terminal, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/core/keys')).length).toBeGreaterThanOrEqual(1);
    });
    const [, keysReq] = [...fetchMock.mock.calls].reverse().find(([u]) => String(u).endsWith('/api/core/keys'))!;
    expect(JSON.parse(String(keysReq.body))).toMatchObject({ term: 'local/coder', keys: ['enter'] });

    // стрелка → keys ['up']
    fireEvent.keyDown(terminal, { key: 'ArrowUp' });
    await vi.waitFor(() => {
      const keys = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/core/keys'));
      expect(JSON.parse(String(keys[keys.length - 1][1].body))).toMatchObject({ keys: ['up'] });
    });
  });

  it('#528: живой ввод — Backspace и Ctrl+C → keys; paste → send всего текста', async () => {
    const keys = vi.fn().mockResolvedValue({});
    const put = vi.fn().mockResolvedValue({});
    const send = vi.fn().mockResolvedValue(undefined);
    const bridge: NewfBridge = {
      spaces: async () => [], terminals: async () => [], agents: async () => [],
      screen: async () => 'frame',
      send,
      put,
      keys,
      streamEvents: () => () => {},
    };
    const liveCtx: LiveCtx = {
      live: {
        spaces: [],
        terminals: [{ address: 't-prod', label: 'test', state: 'idle' }],
        agents: [],
        error: null,
      },
      bridge,
      dismissAttention: () => {},
    };
    render(
      <LiveContext.Provider value={liveCtx}>
        <FloatingTerminal
          address="t-prod"
          win={{ x: 0, y: 0, w: 400, h: 300, pinned: false }}
          onDrag={() => {}}
          onClose={() => {}}
          onTogglePin={() => {}}
        />
      </LiveContext.Provider>,
    );
    const terminal = screen.getByRole('region', { name: 'Terminal t-prod' });

    fireEvent.keyDown(terminal, { key: 'Backspace' });
    fireEvent.keyDown(terminal, { key: 'c', ctrlKey: true });
    await vi.waitFor(() => {
      expect(keys).toHaveBeenCalledWith('t-prod', ['backspace']);
      expect(keys).toHaveBeenCalledWith('t-prod', ['ctrl+c']);
    });

    // paste → put без Enter (POST /api/core/put {term, text})
    fireEvent.paste(terminal, { clipboardData: { getData: () => 'python agent.py' } });
    await vi.waitFor(() => {
      expect(put).toHaveBeenCalledWith('t-prod', 'python agent.py');
    });
  });

  it('W10: drop файла на панель → sendFile {content,name,send:true}', async () => {
    const sendFile = vi.fn().mockResolvedValue({ ok: true });
    const bridge: NewfBridge = {
      spaces: async () => [], terminals: async () => [], agents: async () => [],
      screen: async () => 'frame',
      send: async () => {},
      keys: async () => {},
      sendFile,
      streamEvents: () => () => {},
    };
    const liveCtx: LiveCtx = {
      live: {
        spaces: [],
        terminals: [{ address: 't-prod', label: 'test', state: 'idle' }],
        agents: [],
        error: null,
      },
      bridge,
      dismissAttention: () => {},
    };
    render(
      <LiveContext.Provider value={liveCtx}>
        <FloatingTerminal
          address="t-prod"
          win={{ x: 0, y: 0, w: 400, h: 300, pinned: false }}
          onDrag={() => {}}
          onClose={() => {}}
          onTogglePin={() => {}}
        />
      </LiveContext.Provider>,
    );
    const terminal = screen.getByRole('region', { name: 'Terminal t-prod' });
    const file = { name: 'note.txt', type: 'text/plain', text: async () => 'hello world' } as unknown as File;

    fireEvent.dragOver(terminal);
    expect(terminal).toHaveAttribute('data-drag-over', 'true');
    fireEvent.drop(terminal, { dataTransfer: { files: [file] } });
    await vi.waitFor(() => {
      expect(sendFile).toHaveBeenCalledWith('t-prod', expect.objectContaining({ content: 'hello world', name: 'note.txt', send: true }));
    });
  });

  it('#517: agents() читает живой /api/core/agents (себя/паренты/статус)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/agents')) {
        return jsonResponse({ agents: [
          { address: 'local/alice', name: 'alice', state: 'working', attention: false, labels: { 'newf.seat': 'orchestrator' }, parent: null },
          { address: 'local/coder-child', name: 'nested-helper', state: 'idle', labels: {}, parent: 'local/coder' },
        ], count: 2 });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');

    const agents = await core.agents();
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({ id: 'local/alice', name: 'alice', terminal: 'local/alice', status: 'working', seat: 'orchestrator' });
    expect(agents[1]).toMatchObject({ id: 'local/coder-child', name: 'nested-helper', status: 'idle', parent: 'local/coder' });
  });

  it('#552: resize отправляет POST /api/core/terminal/<name>/resize {cols,rows}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'resized' }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.resize?.('local/t1', 120, 30)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/terminal/t1/resize', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ cols: 120, rows: 30 }),
    }));
  });

  it('#552: resize при отсутствии endpoint (404 текст) → BridgeHttpError unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}),
    } as Response));
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.resize?.('local/t1', 80, 24)).rejects.toMatchObject({ kind: 'unavailable', status: 404 });
  });

  it('#557: put отправляет POST /api/core/put {term, text} — без Enter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'put_ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.put?.('local/t1', 'python agent.py')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/put', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ term: 'local/t1', text: 'python agent.py' }),
    }));
  });

  it('#564: programs() читает каталог программ; офлайн → [] честно', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      programs: [
        { id: 'claude', title: 'Claude Code', cmd: ['claude'], cwd: 'D:/<repo>', available: true, resolved: 'claude' },
        { id: 'gobl', title: 'Gobl', cmd: ['gobl'], cwd: null, available: false, resolved: null },
      ], count: 2,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    const list = await core.programs!();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'claude', available: true, resolved: 'claude' });
    expect(list[1]).toMatchObject({ id: 'gobl', available: false, resolved: null });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}) } as Response));
    expect(await core.programs!()).toEqual([]);
  });

  it('#564: runProgram шлёт POST /run-program {program} → address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ address: 'local/cmd-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.runProgram?.('claude')).resolves.toEqual({ address: 'local/cmd-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/run-program', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ program: 'claude' }),
    }));
  });

  it('#564: dumpUrl строит URL transcript dump (bare name)', () => {
    const core = createCoreBridge('http://core.test:5683');
    expect(core.dumpUrl?.('local/t1')).toBe('http://core.test:5683/api/core/terminal/t1/dump');
  });

  it('W3: spawnChild шлёт POST /terminal/<name>/spawn-child {command}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ address: 'local/child-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.spawnChild?.('local/t1', { command: ['claude'] }))
      .resolves.toEqual({ address: 'local/child-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/terminal/t1/spawn-child', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ command: ['claude'] }),
    }));
  });

  it('W3: restart шлёт POST /terminal/<term>/restart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'restarted' }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.restart?.('local/t1')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/terminal/t1/restart', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('W5: capabilities() читает {endpoints}; 404 → {} честно', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      version: 'N3',
      endpoints: { screen: true, restart: true, programs: false, dump: true },
    })));
    const core = createCoreBridge('http://core.test:5683');
    const res = await core.capabilities!();
    expect(res.endpoints.screen).toBe(true);
    expect(res.endpoints.programs).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}) } as Response));
    expect(await core.capabilities!()).toEqual({ endpoints: {} });
  });

  it('W9: machinesDetail() читает ?detail=1; 404 → [] честно', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      { name: 'local', state: 'connected', uptime_s: 3661, terminals: 2,
        metrics: { cpu: 12.5, mem: 41, uptime_s: 999 } },
      { name: 'roy2', state: 'unreachable', why: 'conn refused', uptime_s: 0, terminals: 0 },
    ])));
    const core = createCoreBridge('http://core.test:5683');
    const list = await core.machinesDetail!();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: 'local', uptime_s: 3661, terminals: 2 });
    expect(list[0].metrics?.cpu).toBe(12.5);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}) } as Response));
    expect(await core.machinesDetail!()).toEqual([]);
  });

  it('W10: sendFile шлёт POST /terminal/<name>/send-file {content,name,send}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.sendFile?.('local/t1', { content: 'hello', name: 'a.txt', send: true }))
      .resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/terminal/t1/send-file', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ content: 'hello', name: 'a.txt', send: true }),
    }));
  });

  it('W11: setLabels шлёт POST /terminal/<term>/labels {labels}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.setLabels?.('local/t1', { role: 'coder' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/terminal/local%2Ft1/labels', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ labels: { role: 'coder' } }),
    }));
  });

  it('W13: cloneTerminal шлёт POST /terminal/<name>/clone {name?}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ address: 'local/t1-clone' }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.cloneTerminal?.('local/t1', { name: 't1-c' }))
      .resolves.toEqual({ address: 'local/t1-clone' });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/terminal/local%2Ft1/clone', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 't1-c' }),
    }));
  });

  it('W14: worktrees() читает GET /worktrees?repo; 404 → [] честно', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      worktrees: [
        { main: true, name: 'nexus', path: 'D:/<repo>', branch: 'master' },
        { main: false, name: 'wt-a', path: 'D:/<repo>-wt-a', branch: 'wt-a', status: 'dirty' },
      ],
    })));
    const core = createCoreBridge('http://core.test:5683');
    const list = await core.worktrees!();
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ name: 'wt-a', status: 'dirty' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}) } as Response));
    expect(await core.worktrees!()).toEqual([]);
  });

  it('W15: audit() читает GET /audit?action&limit; 404 → BridgeHttpError (W56)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      entries: [
        { seq: 2, ts: 1, action: 'run', decision: 'allow', subject: 'v1', agent: 'forge' },
        { seq: 1, ts: 2, action: 'kill', decision: 'deny' },
      ],
      total: 2,
    })));
    const core = createCoreBridge('http://core.test:5683');
    const res = await core.audit!({ action: 'run', limit: 10 });
    expect(res.total).toBe(2);
    expect(res.entries[0]).toMatchObject({ action: 'run', decision: 'allow', subject: 'v1' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}) } as Response));
    await expect(core.audit!()).rejects.toBeInstanceOf(Error);
  });

  it('W16: recordings() читает GET /recordings; 404 → [] честно', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        { id: 'r1', term: 't1', path: 'D:/<repo>/recordings/r1.cast' },
      ],
    })));
    const core = createCoreBridge('http://core.test:5683');
    const list = await core.recordings!();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'r1', term: 't1' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}) } as Response));
    expect(await core.recordings!()).toEqual([]);
  });

  it('W17: workspaceTemplates()/workspaceSpawn() контракты', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      templates: [
        { name: 'cockpit', terms: [{ name: 't1', command: ['cmd.exe'], cwd: 'D:/<repo>' }] },
      ],
    })));
    const core = createCoreBridge('http://core.test:5683');
    const templates = await core.workspaceTemplates!();
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ name: 'cockpit', terms: [{ name: 't1' }] });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ created: ['t1'], terminals: ['local/t1'] })));
    const spawned = await core.workspaceSpawn!('cockpit');
    expect(spawned).toMatchObject({ created: ['t1'], terminals: ['local/t1'] });
  });

  it('W18: batch() шлёт POST /batch {action, terms}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      results: { 'local/t1': { ok: true }, 'local/t2': { ok: false, error: 'x' } },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    const res = await core.batch!({ action: 'kill', terms: ['local/t1', 'local/t2'] });
    expect(res.results['local/t1']).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/batch', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'kill', terms: ['local/t1', 'local/t2'] }),
    }));
  });

  it('W19: snapshot()/restoreSnapshot() контракты', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ path: 'snapshots/t1-1.json' })));
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.snapshot?.('local/t1')).resolves.toEqual({ path: 'snapshots/t1-1.json' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ restored: true })));
    await expect(core.restoreSnapshot?.('local/t1', 'snapshots/t1-1.json')).resolves.toEqual({ ok: true });
  });

  it('W20: approvals()/approvalDecide() контракты', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      approvals: [
        { approval_id: 'a1', status: 'pending', action: 'kill', subject: 'local/t1' },
      ],
    })));
    const core = createCoreBridge('http://core.test:5683');
    const list = await core.approvals!();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ approval_id: 'a1', action: 'kill' });

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ approval_id: 'a1', status: 'approved' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(core.approvalDecide?.('a1', true)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/approvals/a1', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ approved: true }),
    }));
  });

  it('W29: setNote шлёт POST /terminal/<term>/note {text}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    await expect(core.setNote?.('local/t1', 'в работе')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://core.test:5683/api/core/terminal/t1/note', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'в работе' }),
    }));
  });

  it('#517: agents() при отсутствии /agents (404 текст) падает на живые /terminals', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/agents')) return events404();
      if (url.endsWith('/api/core/terminals')) {
        return jsonResponse({ count: 2, terminals: [
          { address: 'local/alice', name: 'alice', state: 'working', labels: { agent: 'alice', 'newf.seat': 'orchestrator' } },
          { address: 'local/plain', name: 'plain', state: 'idle', labels: {} },
        ] });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const core = createCoreBridge('http://core.test:5683');
    const agents = await core.agents();
    expect(agents).toHaveLength(1); // только терминал с agent-лейблом
    expect(agents[0]).toMatchObject({ id: 'local/alice', name: 'alice', status: 'working', seat: 'orchestrator' });
  });
});

describe('NEWF #517 live data (SSE + empty states)', () => {
  it('applyStatusEvent меняет state терминала и статус агента по адресу', () => {
    const prev: LiveData = {
      spaces: [],
      terminals: [{ address: 't1', label: 'A', state: 'idle' }],
      agents: [{ id: 't1', name: 'A', terminal: 't1', status: 'idle' }],
      error: null,
    };
    const next = applyStatusEvent(prev, { seq: 1, type: 'status', address: 't1', state: 'done' });
    expect(next.terminals[0].state).toBe('done');
    expect(next.agents[0].status).toBe('done');
  });

  it('applyStatusEvent игнорирует чужие адреса и невалидные статусы', () => {
    const prev: LiveData = {
      spaces: [], terminals: [{ address: 't1', label: 'A', state: 'idle' }],
      agents: [{ id: 't1', name: 'A', terminal: 't1', status: 'idle' }], error: null,
    };
    expect(applyStatusEvent(prev, { seq: 2, type: 'status', address: 'tX', state: 'done' })).toBe(prev);
    expect(applyStatusEvent(prev, { seq: 3, type: 'status', address: 't1', state: 'weird' })).toBe(prev);
    expect(applyStatusEvent(prev, { seq: 4, type: 'title', address: 't1', title: 'x' })).toBe(prev);
  });

  it('applyStatusEvent не трогает offline-данные', () => {
    const prev: LiveData = {
      spaces: [], terminals: [{ address: 't1', label: 'A', state: 'idle' }],
      agents: [{ id: 't1', name: 'A', terminal: 't1', status: 'idle' }],
      error: 'bridge down',
    };
    expect(applyStatusEvent(prev, { seq: 5, type: 'status', address: 't1', state: 'done' })).toBe(prev);
  });

  it('W2: applyStatusEvent поднимает attention-флаг по событию attention', () => {
    const prev: LiveData = {
      spaces: [],
      terminals: [{ address: 't1', label: 'A', state: 'working' }],
      agents: [{ id: 't1', name: 'A', terminal: 't1', status: 'working' }],
      error: null,
    };
    const next = applyStatusEvent(prev, { seq: 6, type: 'attention', address: 't1', state: 'blocked', attention: true });
    expect(next.terminals[0].attention).toBe(true);
    expect(next.terminals[0].state).toBe('blocked');
    const again = applyStatusEvent(prev, { seq: 7, type: 'status', address: 't1', state: 'idle' });
    expect(again.terminals[0].attention).toBeUndefined();
  });

  it('NewfTerminals: пустой список → честный «no terminals: nx run»', () => {
    const liveCtx: LiveCtx = {
      live: { spaces: [], terminals: [], agents: [], error: null },
      bridge: { spaces: async () => [], terminals: async () => [], agents: async () => [], screen: async () => '', send: async () => {}, keys: async () => {} },
      dismissAttention: () => {},
    };
    render(
      <LiveContext.Provider value={liveCtx}>
        <NewfTerminals />
      </LiveContext.Provider>,
    );
    expect(screen.getByTestId('terminals-empty')).toHaveTextContent('no terminals: nx run');
  });

  it('NewfTerminals: ошибка моста → текст ошибки вместо фиктивного списка', () => {
    const liveCtx: LiveCtx = {
      live: { spaces: [], terminals: [], agents: [], error: 'bridge unreachable' },
      bridge: { spaces: async () => [], terminals: async () => [], agents: async () => [], screen: async () => '', send: async () => {}, keys: async () => {} },
      dismissAttention: () => {},
    };
    render(
      <LiveContext.Provider value={liveCtx}>
        <NewfTerminals />
      </LiveContext.Provider>,
    );
    expect(screen.getByText(/bridge unreachable/)).toBeInTheDocument();
    expect(screen.queryByTestId('terminals-empty')).not.toBeInTheDocument();
  });

  it('W8: ?pop-страница рендерит панель и кнопку «вернуть в кокпит»', () => {
    render(<NewfPopScreen live bridgeBase="http://core.test:5683" backend="core" address="local/t1" />);
    const pop = screen.getByTestId('newf-pop');
    expect(pop).toBeInTheDocument();
    // кнопка re-dock присутствует (без live-моста screen может быть пуст)
    expect(screen.getByTestId('pop-dock-back')).toBeInTheDocument();
    // W25: dump-ссылка в pop-шапке (parity)
    expect(screen.getByTestId('pop-dump-local/t1')).toHaveAttribute('href', 'http://core.test:5683/api/core/terminal/t1/dump');
  });
});

describe('NEWF ANSI screen tail renderer', () => {
  it('renders the real ConPTY PowerShell prompt and consumes private modes, SGR, and OSC title', () => {
    const raw = '\x1b[?9001h\x1b[?1004h\x1b[?25l\x1b[2J\x1b[m\x1b[HPS D:\\nexus>\x1b]0;C:\\Users\\pwsh.exe\x07\x1b[?25h';
    const lines = renderAnsiScreen(raw, 120, 4);

    expect(lines[0]).toBe('PS D:\\nexus>');
    expect(lines.join('')).not.toMatch(/[\u001b\u009b]/);
  });

  it('removes SGR styling without losing the displayed text', () => {
    expect(renderAnsiScreen('\x1b[1;36mNEXUS_DEMO_OK\x1b[0m', 40, 2)[0]).toBe('NEXUS_DEMO_OK');
  });

  it('consumes OSC titles terminated by BEL or ST', () => {
    const raw = '\x1b]0;C:\\Users\\pwsh.exe\x07ready\x1b]2;ignored title\x1b\\ done';
    expect(renderAnsiScreen(raw, 40, 2)[0]).toBe('ready done');
  });

  it('clears the virtual display for CSI 2J', () => {
    expect(renderAnsiScreen('old output\x1b[2J', 40, 3)).toEqual(['', '', '']);
  });

  it('honors CSI J modes 0 and 1, and CSI K modes 0, 1, and 2', () => {
    expect(renderAnsiScreen('keep\r\nremove\x1b[0J', 20, 3)).toEqual(['keep', 'remove', '']);
    expect(renderAnsiScreen('remove\r\nkeep\x1b[1J', 20, 3)).toEqual(['', '', '']);
    expect(renderAnsiScreen('12345\x1b[2D\x1b[0K', 20, 2)[0]).toBe('123');
    expect(renderAnsiScreen('12345\x1b[2D\x1b[1K', 20, 2)[0]).toBe('    5');
    expect(renderAnsiScreen('12345\x1b[3D\x1b[2K', 20, 2)[0]).toBe('');
  });

  it('supports cursor movement and absolute H/f positioning', () => {
    const raw = 'abcdef\x1b[3DXY\x1b[2;4H!\x1b[1;2f?\x1b[1B\x1b[2C@\x1b[1A\x1b[1D#';
    expect(renderAnsiScreen(raw, 12, 3)).toEqual(['a?cX#f', '   !@', '']);
    expect(renderAnsiScreen('\x1b[1;14HPS D:\\nexus>', 40, 2)[0]).toBe('             PS D:\\nexus>');
  });

  it('consumes unsupported CSI without leaking sequence bytes into text', () => {
    expect(renderAnsiScreen('before\x1b[999zafter', 40, 2)[0]).toBe('beforeafter');
  });

  it('#528: ICH (CSI n @) вставляет пробелы и сдвигает строку вправо', () => {
    // Ink/Claude Code repaint: «Радтебявидеть» + курсор на 4-ю позицию → пробел
    expect(renderAnsiScreen('Радтебявидеть\x1b[10D\x1b[1@', 40, 2)[0]).toBe('Рад тебявидеть');
    expect(renderAnsiScreen('ABCDEF\x1b[2D\x1b[1@', 8, 2)[0]).toBe('ABCD EF');
    // вставка у правого края: выпадающие символы теряются за краем
    expect(renderAnsiScreen('ABCDEF\x1b[4D\x1b[3@', 8, 2)[0]).toBe('AB   CDE');
    expect(renderAnsiScreen('ABCDEF\x1b[5D\x1b[10@', 8, 2)[0]).toBe('A');
  });

  it('#528: DCH (CSI n P) удаляет символы и сдвигает строку влево', () => {
    expect(renderAnsiScreen('hello world\x1b[6D\x1b[1P', 40, 2)[0]).toBe('helloworld');
    expect(renderAnsiScreen('ABCDEF\x1b[4D\x1b[2P', 10, 2)[0]).toBe('ABEF');
    // удаление до конца строки
    expect(renderAnsiScreen('ABCDEF\x1b[4D\x1b[10P', 10, 2)[0]).toBe('AB');
  });

  it('#528: ECH (CSI n X) стирает символы от курсора, не двигая его', () => {
    expect(renderAnsiScreen('hello world\x1b[3D\x1b[3X', 40, 2)[0]).toBe('hello wo');
    expect(renderAnsiScreen('ABCDE\x1b[2D\x1b[2X', 10, 2)[0]).toBe('ABC');
  });

  it('#528: CHA (CSI n G) и VPA (CSI n d) позиционируют курсор без потери пробелов', () => {
    // CHA: «Claude Code» затем \x1b[24G — v2.1.319 пишется с 24-й колонки.
    // Без поддержки 'G' текст дописался бы слипно (Claude Codev2.1.319).
    const expected = 'Claude Code' + ' '.repeat(12) + 'v2.1.319';
    expect(renderAnsiScreen('Claude Code\x1b[24Gv2.1.319', 40, 4)[0]).toBe(expected);
    // CHA(4) → колонка 3 (0-base): XY перекрывают «def» частично
    expect(renderAnsiScreen('abcdef\x1b[4GXY', 12, 3)[0]).toBe('abcXYf');
    expect(renderAnsiScreen('abcdef\x1b[1GXY', 12, 3)[0]).toBe('XYcdef');
    // VPA: CSI 3 d — строка 3 (1-based) = индекс 2 сетки; колонка не сбрасывается
    expect(renderAnsiScreen('abc\x1b[3dXY', 12, 3)).toEqual(['abc', '', '   XY']);
  });

  it('wraps at the column limit and scrolls old rows out of the visible grid', () => {
    expect(renderAnsiScreen('abcdef', 3, 3)).toEqual(['abc', 'def', '']);
    expect(renderAnsiScreen('one\r\ntwo\r\ntri\r\nfour\r\nfive', 5, 3)).toEqual(['tri', 'four', 'five']);
  });

  it('handles backspace as a cursor move before the next echoed character', () => {
    expect(renderAnsiScreen('ABCDE\bZ', 12, 2)[0]).toBe('ABCDZ');
  });

  it('keeps command output and prompt visible after CRLF input echo', () => {
    const raw = 'PS D:\\nexus> Get-Date\r\nGet-Date\r\n23:57:20\r\nNEXUS_DEMO_OK\r\nPS D:\\nexus>';
    expect(renderAnsiScreen(raw, 120, 6)).toEqual([
      'PS D:\\nexus> Get-Date',
      'Get-Date',
      '23:57:20',
      'NEXUS_DEMO_OK',
      'PS D:\\nexus>',
      '',
    ]);
  });

  it('shows the cleaned screen in the live terminal pane instead of raw escape bytes', async () => {
    const ansiPrompt = '\x1b[?9001h\x1b[2J\x1b[m\x1b[HPS D:\\nexus>\x1b]0;pwsh.exe\x07';
    const jsonResponse = (body: unknown): Response => ({
      ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
    } as Response);
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/terminals')) return jsonResponse({ terminals: [{ name: 't1', address: 'local/t1', state: 'idle' }] });
      if (url.endsWith('/api/core/agents')) return jsonResponse({ agents: [{ address: 'local/t1', name: 't1', state: 'idle' }] });
      if (url.endsWith('/api/core/events')) return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not Found' } as Response;
      if (url.endsWith('/api/core/spaces')) return jsonResponse({ spaces: [] });
      if (url.endsWith('/api/core/screen/t1')) return jsonResponse({ term: 'local/t1', screen: ansiPrompt });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const terminalLayout = JSON.stringify({ id: 'root', type: 'block', content: { terminal: 'local/t1' } });

    render(<NewfScreen live backend="core" bridgeBase="http://core.test:5683" layoutJson={terminalLayout} />);

    const terminal = await screen.findByRole('region', { name: 'Terminal local/t1' });
    await within(terminal).findByText('PS D:\\nexus>');
    expect(terminal.querySelector('pre')).not.toHaveTextContent(/[\u001b\u009b]/);
  });
});

describe('NEWF P1 look fields', () => {
  it('parses divider/border/radius/shadow/background and stack header into nodes', () => {
    const layout = parseHerdrLayout(JSON.stringify({
      id: 'root',
      type: 'row',
      divider: { width: 4, color: 'rebeccapurple' },
      border: { width: 2, color: '#123456' },
      radius: 6,
      shadow: 'md',
      background: { gradient: { from: '#111', to: '#222', angle: 90 } },
      children: [
        {
          id: 's',
          type: 'stack',
          header: { content: { mod: 'tabs' } },
          children: [
            { id: 'p1', type: 'block', content: { terminal: 'mock-local-01' } },
            { id: 'p2', type: 'block', content: { terminal: 'mock-local-02' } },
          ],
        },
        {
          id: 'b',
          type: 'block',
          background: { image: '/img/wall.png', fit: 'cover' },
          content: { mod: 'spaces' },
        },
      ],
    }));
    expect(layout.divider).toEqual({ width: 4, color: 'rebeccapurple' });
    expect(layout.border).toEqual({ width: 2, color: '#123456' });
    expect(layout.radius).toBe(6);
    expect(layout.shadow).toBe('md');
    expect(layout.background).toEqual({ gradient: { from: '#111', to: '#222', angle: 90 } });
    const stack = layout.children?.[0];
    expect(stack?.header).toEqual({ content: { kind: 'mod', name: 'tabs' } });
    const block = layout.children?.[1];
    expect(block?.background).toEqual({ image: '/img/wall.png', fit: 'cover' });
  });

  it('accepts gradient as array on the root (herdr-layout: newf-default-layout.ts form)', () => {
    const layout = parseHerdrLayout(JSON.stringify({
      id: 'root',
      type: 'row',
      background: { gradient: ['#0b0f14', '#111a24'], angle: 180 },
      children: [],
    }));
    expect(layout.background).toEqual({ gradient: { from: '#0b0f14', to: '#111a24', angle: 180 } });
  });

  it('accepts bare array background and [from, to, angle]', () => {
    const bare = parseHerdrLayout(JSON.stringify({
      id: 'root', type: 'row', background: ['#111', '#222'], children: [],
    }));
    expect(bare.background).toEqual({ gradient: { from: '#111', to: '#222' } });
    const withAngle = parseHerdrLayout(JSON.stringify({
      id: 'root', type: 'row', background: ['#111', '#222', 90], children: [],
    }));
    expect(withAngle.background).toEqual({ gradient: { from: '#111', to: '#222', angle: 90 } });
    // angle как третий элемент массива + sibling angle: sibling выигрывает.
    const sibling = parseHerdrLayout(JSON.stringify({
      id: 'root', type: 'row', background: { gradient: ['#111', '#222', 45], angle: 180 }, children: [],
    }));
    expect(sibling.background).toEqual({ gradient: { from: '#111', to: '#222', angle: 180 } });
  });

  it('rejects invalid gradient arrays with readable errors', () => {
    for (const bad of [
      { id: 'r', type: 'row', background: ['#111'], children: [] },
      { id: 'r', type: 'row', background: ['#111', 3], children: [] },
      { id: 'r', type: 'row', background: ['#111', '#222', 'wide'], children: [] },
      { id: 'r', type: 'row', background: { gradient: ['#111'], angle: 180 }, children: [] },
      { id: 'r', type: 'row', background: { gradient: ['#111', '#222'], angle: 'wide' }, children: [] },
    ]) {
      expect(() => parseHerdrLayout(JSON.stringify(bad))).toThrow();
    }
  });

  it('rejects broken divider/background/shadow/header values with readable errors', () => {
    for (const bad of [
      { id: 'r', type: 'row', divider: { width: -1 }, children: [] },
      { id: 'r', type: 'row', divider: { color: '' }, children: [] },
      { id: 'r', type: 'row', border: { width: -2 }, children: [] },
      { id: 'r', type: 'row', radius: -5, children: [] },
      { id: 'r', type: 'row', shadow: 'xl', children: [] },
      { id: 'r', type: 'row', background: { gradient: { from: '#111' } }, children: [] },
      { id: 'r', type: 'row', background: { image: { fit: 'cover' } }, children: [] },
      { id: 'r', type: 'row', background: { image: { src: '/a.png', fit: 'zoom' } }, children: [] },
      { id: 'b', type: 'block', header: { content: { mod: 'tabs' } }, content: { mod: 'spaces' } },
      { id: 's', type: 'stack', header: { content: { terminal: 't1' } }, children: [{ id: 'p', type: 'block', content: { mod: 'files' } }] },
    ]) {
      expect(() => parseHerdrLayout(JSON.stringify(bad))).toThrow();
    }
  });

  it('applies border/radius/shadow/background styles on block nodes', () => {
    render(<NewfScreen layoutJson={JSON.stringify({
      id: 'root', type: 'block',
      border: { width: 3, color: '#0f0' },
      radius: 12,
      shadow: 'lg',
      background: '#f0f',
      content: { mod: 'spaces' },
    })} />);
    const node = screen.getByTestId('newf-layout-node-root');
    expect(node.style.borderWidth).toBe('3px');
    expect(node.style.borderColor).toBe('rgb(0, 255, 0)');
    expect(node.style.borderRadius).toBe('12px');
    expect(node.style.boxShadow).toContain('0 10px 28px');
    expect(node.style.background).toBe('rgb(255, 0, 255)');
  });

  it('renders the array-gradient root background as linear-gradient CSS', () => {
    render(<NewfScreen layoutJson={JSON.stringify({
      id: 'root', type: 'block',
      background: { gradient: ['#0b0f14', '#111a24'], angle: 180 },
      content: { mod: 'spaces' },
    })} />);
    const node = screen.getByTestId('newf-layout-node-root');
    // одиночные имена цветов проходят как есть в CSS (не rgb())
    expect(node.style.background).toBe('linear-gradient(180deg, #0b0f14, #111a24)');
  });

  it('renders a stack header mod instead of the built-in tab strip when header is set', () => {
    const { container } = render(<NewfScreen layoutJson={JSON.stringify({
      id: 'root', type: 'stack', active: 'p1',
      header: { content: { mod: 'tabs' } },
      children: [
        { id: 'p1', type: 'block', content: { terminal: 'mock-local-01' } },
        { id: 'p2', type: 'block', content: { terminal: 'mock-local-02' } },
      ],
    })} />);
    // header-мод рендерится вместо встроенной полосы кнопок newf-tab-*
    expect(container.querySelector('[data-stack-header]')).not.toBeNull();
    expect(container.querySelector('#newf-tab-root-p1')).toBeNull();
    expect(container.querySelector('#newf-tab-root-p2')).toBeNull();
    // мод tabs всё же виден внутри шапки
    expect(container.querySelector('[data-stack-header] [role="tablist"]')).not.toBeNull();
  });
});

describe('NEWF §4 look cascade', () => {
  it('parses look fields and rejects invalid values with readable errors', () => {
    const layout = parseHerdrLayout(JSON.stringify({
      id: 'root', type: 'row',
      look: {
        theme: 'dark',
        colors: { canvas: '#101010', accent: '#ff0' },
        font: 'JetBrains Mono',
        font_size: 14,
        terminal_padding: 8,
        ui_font: 'Geist',
        terminal_opacity: 0.8,
      },
      children: [],
    }));
    expect(layout.look).toEqual({
      theme: 'dark',
      colors: { canvas: '#101010', accent: '#ff0' },
      font: 'JetBrains Mono',
      font_size: 14,
      terminal_padding: 8,
      ui_font: 'Geist',
      terminal_opacity: 0.8,
    });

    for (const bad of [
      { id: 'r', type: 'row', look: { theme: 'neon' }, children: [] },
      { id: 'r', type: 'row', look: { colors: { canvas: '' } }, children: [] },
      { id: 'r', type: 'row', look: { font_size: 0 }, children: [] },
      { id: 'r', type: 'row', look: { terminal_padding: -1 }, children: [] },
      { id: 'r', type: 'row', look: { terminal_opacity: 1.5 }, children: [] },
      { id: 'r', type: 'row', look: { terminal_opacity: -0.1 }, children: [] },
    ]) {
      expect(() => parseHerdrLayout(JSON.stringify(bad))).toThrow();
    }
  });

  it('inherits look down the layout tree: parent wins nearest, local overrides', () => {
    const layout = parseHerdrLayout(JSON.stringify({
      id: 'root', type: 'row',
      look: { theme: 'dark', colors: { canvas: '#000' }, font_size: 12 },
      children: [
        { id: 'a', type: 'block', look: { font_size: 16 }, content: { terminal: 'mock-local-01' } },
        { id: 'b', type: 'block', content: { terminal: 'mock-local-02' } },
      ],
    }));
    expect(layout.look).toEqual({ theme: 'dark', colors: { canvas: '#000' }, font_size: 12 });
    // каскад: a наследует theme/colors от root, но font_size локальный
    const aLook = mergeLook(layout.look, layout.children?.[0].look);
    expect(aLook?.theme).toBe('dark');
    expect(aLook?.font_size).toBe(16);
    expect(aLook?.colors).toEqual({ canvas: '#000' });
    const bLook = mergeLook(layout.look, layout.children?.[1].look);
    expect(bLook?.font_size).toBe(12);
  });

  it('applies inherited look styles to terminal panes (mock)', () => {
    render(<NewfScreen layoutJson={JSON.stringify({
      id: 'root', type: 'block',
      look: { font: 'Comic Sans MS', font_size: 15, terminal_padding: 6, terminal_opacity: 0.5 },
      content: { terminal: 'mock-local-01' },
    })} />);
    const terminal = screen.getByRole('region', { name: 'Terminal mock-local-01' });
    expect(terminal.style.fontFamily).toContain('Comic Sans MS');
    expect(terminal.style.fontSize).toBe('15px');
    expect(terminal.style.padding).toBe('6px');
    expect(terminal.style.opacity).toBe('0.5');
  });

  it('applies ui_font to UI wrappers and keeps terminal font overrides', async () => {
    render(<NewfScreen layoutJson={JSON.stringify({
      id: 'root', type: 'column',
      look: { ui_font: 'Geist UI', font: 'JetBrains Mono' },
      children: [
        { id: 'u', type: 'block', content: { mod: 'agents' } },
        { id: 't', type: 'block', content: { terminal: 'mock-local-01' } },
      ],
    })} />);
    const agents = await screen.findByRole('region', { name: 'Agents' });
    expect((agents.closest('[data-layout-node]') as HTMLElement | null)?.style.fontFamily).toContain('Geist UI');
    const terminal = screen.getByRole('region', { name: 'Terminal mock-local-01' });
    expect(terminal.style.fontFamily).toContain('JetBrains Mono');
  });
});

describe('NEWF §5 state/interactivity', () => {
  const jsonResponse = (body: unknown): Response => ({
    ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
  } as Response);
  const events404 = (): Response => ({
    ok: false, status: 404, json: async () => ({}), text: async () => 'Not Found',
  } as Response);
  // UI-5: newf-mods грузится лениво — регионы «Agents»/«Spaces» ждут
  // резолва чанка (findByRole), дальше работаем с DOM синхронно.
  const agentsRegion = () => screen.findByRole('region', { name: 'Agents' });
  const footer = () => screen.getByRole('contentinfo', { name: 'Workspace status' });
  const agentsList = async () => (await agentsRegion()).querySelector(':scope > ul') as HTMLElement;
  const focusedAgentId = async () => {
    const focused = (await agentsRegion()).querySelector('[data-agent-focused="true"]');
    return focused?.getAttribute('data-agent-id') ?? null;
  };

  it('agent arrows move focus through the roster (depth-first) and Enter selects / Esc clears it', async () => {
    render(<NewfScreen />);
    const list = await agentsList();

    expect(await focusedAgentId()).toBeNull();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(await focusedAgentId()).toBe('alice');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(await focusedAgentId()).toBe('sub-opencode');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(await focusedAgentId()).toBe('forge');
    // backwards moves to the previous row in the tree
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(await focusedAgentId()).toBe('sub-opencode');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(await focusedAgentId()).toBe('forge');

    // Enter selects the focused agent (highlighted row)
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(await focusedAgentId()).toBe('forge');

    // Esc clears focus
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(await focusedAgentId()).toBeNull();
    expect((await agentsRegion()).querySelector('li.selected')).toBeNull();
  });

  it('agent navigation wraps around the roster when none is focused', async () => {
    render(<NewfScreen />);
    const list = await agentsList();
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(await focusedAgentId()).toBe('ace'); // wrap: up from none = last
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(await focusedAgentId()).toBe('alice');
  });

  it('row split arrows move focus between visible children; Enter is a no-op outside stacks', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_LAYOUT} />);
    const split = screen.getByTestId('newf-layout-node-split');
    fireEvent.focus(split);

    fireEvent.keyDown(split, { key: 'ArrowRight' });
    expect(screen.getByTestId('newf-layout-node-pane-a')).toHaveAttribute('data-layout-focused', 'true');
    fireEvent.keyDown(split, { key: 'ArrowRight' });
    expect(screen.getByTestId('newf-layout-node-pane-b')).toHaveAttribute('data-layout-focused', 'true');
    // stack tab row is a sibling, not a child of the row split
    fireEvent.keyDown(split, { key: 'Enter' });
    expect(screen.getByTestId('newf-layout-node-stack')).not.toHaveAttribute('data-layout-focused', 'true');
    expect(screen.getByTestId('newf-layout-node-pane-b')).toHaveAttribute('data-layout-focused', 'true');
  });

  it('stack arrows move across tabs and Enter activates the focused tab', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_LAYOUT} />);
    const stack = screen.getByTestId('newf-layout-node-stack');
    fireEvent.focus(stack);
    expect(screen.getByRole('tabpanel', { name: 'files-pane' })).toBeInTheDocument();

    fireEvent.keyDown(stack, { key: 'ArrowRight' });
    fireEvent.keyDown(stack, { key: 'Enter' });
    expect(screen.getByRole('tabpanel', { name: 'changes-pane' })).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'files-pane' })).not.toBeInTheDocument();
    // the newly activated tab is the focused node
    expect(screen.getByTestId('newf-layout-node-changes-pane')).toHaveAttribute('data-layout-focused', 'true');

    // Esc returns focus to the stack node itself
    fireEvent.keyDown(stack, { key: 'Escape' });
    expect(stack).toHaveAttribute('data-layout-focused', 'true');
  });

  it('resize sliders expose value text and keyboard adjust keeps aria in sync', () => {
    render(<NewfScreen layoutJson={INTERACTIVE_LAYOUT} />);
    const divider = screen.getByRole('slider', { name: /pane-a.*pane-b/i });
    const paneA = screen.getByTestId('newf-layout-node-pane-a');
    const paneB = screen.getByTestId('newf-layout-node-pane-b');
    vi.spyOn(paneA, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 0, right: 200, top: 0, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(paneB, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 208, right: 408, top: 0, bottom: 100, x: 208, y: 0, toJSON: () => ({}) } as DOMRect);

    expect(divider).toHaveAttribute('aria-valuetext', '200px');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider).toHaveAttribute('aria-valuenow', '208');
    expect(divider).toHaveAttribute('aria-valuetext', '208px');
  });

  it('footer machine filter narrows agents and spaces and highlights the active machine (mock)', async () => {
    render(<NewfScreen />);
    // all agents visible initially
    expect(within(await agentsRegion()).getByText('AGENT-A')).toBeInTheDocument();
    expect(within(await agentsRegion()).getByText('ROLE-2')).toBeInTheDocument();

    const sageChip = within(footer()).getByRole('button', { name: 'remote-host' });
    expect(sageChip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(sageChip);

    expect(sageChip).toHaveAttribute('aria-pressed', 'true');
    expect(within(await agentsRegion()).queryByText('AGENT-A')).not.toBeInTheDocument();
    expect(within(await agentsRegion()).getByText('ROLE-2')).toBeInTheDocument();
    // spaces mod is filtered to the machine as well
    const spaces = await screen.findByRole('region', { name: 'Spaces' });
    expect(within(spaces).queryByText('Local workspace')).not.toBeInTheDocument();
    expect(within(spaces).getByText('Sage worker')).toBeInTheDocument();

    // clicking the active machine again clears the filter
    fireEvent.click(sageChip);
    expect(sageChip).toHaveAttribute('aria-pressed', 'false');
    expect(within(await agentsRegion()).getByText('AGENT-A')).toBeInTheDocument();
  });

  it('footer machine filter works in live mode (backend=core) — same UiState data path', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/core/terminals')) {
        return jsonResponse({ terminals: [
          { name: 'alice', address: 'local/alice', machine: 'local', state: 'working', labels: { agent: 'alice', 'newf.seat': 'orchestrator' } },
          { name: 'forge', address: 'sage/forge', machine: 'remote-host', state: 'idle', labels: { agent: 'forge', 'newf.seat': 'coder-1' } },
        ] });
      }
      if (url.endsWith('/api/core/agents')) {
        return jsonResponse({ agents: [
          { address: 'local/alice', name: 'alice', state: 'working', labels: { 'newf.seat': 'orchestrator' } },
          { address: 'sage/forge', name: 'forge', state: 'idle', labels: { 'newf.seat': 'coder-1' } },
        ] });
      }
      if (url.endsWith('/api/core/events')) return events404();
      if (url.endsWith('/api/core/spaces')) {
        return jsonResponse({ spaces: [
          { id: 's-local', name: 'Local', machine: 'local' },
          { id: 's-sage', name: 'Sage', machine: 'remote-host' },
        ] });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const withStatusLayout = JSON.stringify({
      id: 'mirror-root', type: 'column', children: [
        { id: 'mirror-agents', type: 'block', content: { mod: 'agents' } },
        { id: 'mirror-status', type: 'block', size: { px: 34 }, content: { mod: 'workspace-status' } },
      ],
    });

    render(<NewfScreen live backend="core" bridgeBase="http://core.test:5683" layoutJson={withStatusLayout} />);
    const agents = await screen.findByRole('region', { name: 'Agents' });
    await within(agents).findByText('alice');
    await within(agents).findByText('forge');

    const sageChip = within(screen.getByRole('contentinfo', { name: 'Workspace status' })).getByRole('button', { name: 'remote-host' });
    fireEvent.click(sageChip);
    expect(within(agents).queryByText('alice')).not.toBeInTheDocument();
    expect(within(agents).getByText('forge')).toBeInTheDocument();
  });
});

describe('NEWF §5 persistence & layout commands', () => {
  const jsonResponse = (body: unknown): Response => ({
    ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
  } as Response);

  it('serializes and parses .state files (agentOrder/activeSpace/activeTab/focusedAgent/sizes + version)', () => {
    const file = serializeLayoutState({
      agentOrder: ['alice', 'forge', 'codex'],
      activeSpace: 'sage',
      activeTab: 'review',
      focusedAgent: 'forge',
      sizes: { 'pane-a': 240 },
    }, 'abc123');
    const parsed = parseLayoutState(file);
    expect(parsed).toEqual({
      version: 'abc123',
      agentOrder: ['alice', 'forge', 'codex'],
      activeSpace: 'sage',
      activeTab: 'review',
      focusedAgent: 'forge',
      sizes: { 'pane-a': 240 },
    });
    expect(parseLayoutState(null)).toBeNull();
    expect(parseLayoutState('garbage')).toBeNull();
    expect(parseLayoutState('{"agentOrder":["a"]}')).toBeNull(); // без version
  });

  it('collectSizes / applySizes round-trip px sizes, clamping to min/max', () => {
    const layout = parseHerdrLayout(INTERACTIVE_LAYOUT);
    const sizes = collectSizes(layout);
    expect(sizes['pane-a']).toBe(200);
    expect(sizes['pane-b']).toBe(200);
    expect(sizes['split']).toBeUndefined(); // у сплита size.px нет

    const applied = applySizes(layout, { 'pane-a': 500, 'pane-b': 100 });
    expect(applied.children?.[0].children?.[0].size).toEqual({ px: 250 }); // max 250
    expect(applied.children?.[0].children?.[1].size).toEqual({ px: 150 }); // min 150
  });

  it('applySizes ignores ids without size.px and returns the same tree for undefined sizes', () => {
    const layout = parseHerdrLayout(INTERACTIVE_LAYOUT);
    expect(applySizes(layout, undefined)).toBe(layout);
    expect(applySizes(layout, { 'split': 999 }).children?.[0].size).toBeUndefined();
  });

  it('serializeLayout emits the same JSON parseable by parseHerdrLayout with identical shape', () => {
    const layout = parseHerdrLayout(HERDR_LAYOUT);
    const source = serializeLayout(layout);
    const reparsed = parseHerdrLayout(source);
    expect(reparsed).toEqual(layout);
  });

  it('collectSizeDiff reports only px nodes that changed from the file version', () => {
    const file = parseHerdrLayout(INTERACTIVE_LAYOUT);
    const resized = applySizes(file, { 'pane-a': 220 });
    const diff = collectSizeDiff(resized, file);
    expect(diff).toEqual({ 'pane-a': 220 });
    expect(collectSizeDiff(file, file)).toEqual({});
  });

  const FULL_LAYOUT = JSON.stringify({
    id: 'root', type: 'column', gap: 8, children: [
      { id: 'split', type: 'row', resizable: true, gap: 8, children: [
        { id: 'pane-a', type: 'block', size: { px: 200 }, min: 150, max: 250, content: { mod: 'files' } },
        { id: 'pane-b', type: 'block', size: { px: 200 }, min: 150, max: 250, content: { mod: 'changes' } },
      ] },
      { id: 'agents-main', type: 'block', size: { weight: 1 }, content: { mod: 'agents' } },
      { id: 'status-main', type: 'block', size: { px: 34 }, content: { mod: 'workspace-status' } },
    ],
  });

  it('restores agentOrder/activeSpace/sizes from a saved .state on mount', () => {
    const store = createInMemoryStateStore();
    store.save(layoutStateKey('default'), serializeLayoutState({
      agentOrder: ['alice', 'forge'],
      activeSpace: 'sage',
      activeTab: 'review',
      focusedAgent: 'forge',
      sizes: { 'pane-a': 230 },
    }, fingerprint(FULL_LAYOUT)));

    render(<NewfScreen store={store} layoutJson={FULL_LAYOUT} />);
    // размеры восстановлены (файл совпал с кликом)
    expect(screen.getByTestId('newf-layout-node-pane-a')).toHaveAttribute('data-size-px', '230');
    // activeSpace восстановлен → фильтр машины активен
    const sageChip = within(screen.getByRole('contentinfo', { name: 'Workspace status' })).getByRole('button', { name: 'remote-host' });
    expect(sageChip).toHaveAttribute('aria-pressed', 'true');
  });

  it('click (agent selection) persists to .state; remount restores it', async () => {
    const store = createInMemoryStateStore();
    const { unmount } = render(<NewfScreen store={store} layoutJson={FULL_LAYOUT} />);
    const agents = await screen.findByRole('region', { name: 'Agents' });
    // Enter-выбор агента → focusedAgent
    fireEvent.keyDown(agents.querySelector(':scope > ul') as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(agents.querySelector(':scope > ul') as HTMLElement, { key: 'Enter' });

    const saved = parseLayoutState(store.load(layoutStateKey('default')));
    expect(saved?.focusedAgent).toBe('alice');

    unmount();
    render(<NewfScreen store={store} layoutJson={FULL_LAYOUT} />);
    expect((await screen.findByRole('region', { name: 'Agents' })).querySelector('[data-agent-focused="true"]'))
      .toHaveAttribute('data-agent-id', 'alice');
  });

  it('mounts with a stale .state (sizes only) and manages passports without overriding file version', () => {
    const store = createInMemoryStateStore();
    store.save(layoutStateKey('default'), serializeLayoutState({ sizes: { 'pane-a': 240 } }, 'stale-version'));

    render(<NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} />);
    // файл (актуальная версия) бьёт клик: размеры из файла
    expect(screen.getByTestId('newf-layout-node-pane-a')).toHaveAttribute('data-size-px', '200');
  });

  it('layout.reset restores the layout file (sizes, active, order) and clears state', async () => {
    const store = createInMemoryStateStore();
    const commandsRef: { current: LayoutCommands | null } = { current: null };
    render(<NewfScreen store={store} layoutJson={FULL_LAYOUT} commandsRef={commandsRef} />);

    const divider = screen.getByRole('slider', { name: /pane-a.*pane-b/i });
    const paneA = screen.getByTestId('newf-layout-node-pane-a');
    const paneB = screen.getByTestId('newf-layout-node-pane-b');
    vi.spyOn(paneA, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 0, right: 200, top: 0, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(paneB, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 208, right: 408, top: 0, bottom: 100, x: 208, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 230 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 230 });
    expect(paneA).toHaveAttribute('data-size-px', '230');

    const agents = await screen.findByRole('region', { name: 'Agents' });
    const agentsList = agents.querySelector(':scope > ul') as HTMLElement;
    fireEvent.keyDown(agentsList, { key: 'ArrowDown' });
    fireEvent.keyDown(agentsList, { key: 'Enter' });
    expect(agents.querySelector('[data-agent-focused="true"]'))
      .toHaveAttribute('data-agent-id', 'alice');

    act(() => commandsRef.current?.resetLayout());

    expect(screen.getByTestId('newf-layout-node-pane-a')).toHaveAttribute('data-size-px', '200');
    expect(agents.querySelector('[data-agent-focused="true"]')).toBeNull();
    // .state очищен от кликов: только файловая версия, без sizes/order
    const afterReset = parseLayoutState(store.load(layoutStateKey('default')));
    expect(afterReset?.sizes).toBeUndefined();
    expect(afterReset?.agentOrder).toBeUndefined();
    expect(afterReset?.focusedAgent).toBeUndefined();
  });

  it('layout.clone saves a new layout file; switching to it works without reload', async () => {
    const store = createInMemoryStateStore();
    const commandsRef: { current: LayoutCommands | null } = { current: null };
    render(<NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} commandsRef={commandsRef} />);

    const id = commandsRef.current?.cloneLayout('My Layout');
    expect(id).toBe('my-layout');
    await vi.waitFor(() => expect(commandsRef.current?.layoutNames).toContain('my-layout'));
    // клон = копия текущего (отрендеренного) дерева
    expect(store.load(layoutStateKey('my-layout'))).toBeNull(); // состояния кликов у клона ещё нет
    expect(commandsRef.current?.activeLayoutId).toBe('default');

    commandsRef.current?.switchLayout('my-layout');
    await vi.waitFor(() => expect(commandsRef.current?.activeLayoutId).toBe('my-layout'));
    expect(screen.getByTestId('newf-workspace')).toHaveAttribute('data-layout-active', 'my-layout');
    expect(screen.getByTestId('newf-layout-node-pane-a')).toBeInTheDocument();
  });

  it('ctrl-shift-l switches layouts in a circle (default → clone → default)', async () => {
    const store = createInMemoryStateStore();
    const commandsRef: { current: LayoutCommands | null } = { current: null };
    render(<NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} commandsRef={commandsRef} />);

    const id = commandsRef.current?.cloneLayout('Draft');
    expect(id).toBe('draft');
    await vi.waitFor(() => expect(commandsRef.current?.layoutNames).toEqual(['default', 'draft']));

    fireEvent.keyDown(screen.getByTestId('newf-workspace'), { key: 'l', ctrlKey: true, shiftKey: true });
    await vi.waitFor(() => expect(commandsRef.current?.activeLayoutId).toBe('draft'));
    expect(screen.getByTestId('newf-workspace')).toHaveAttribute('data-layout-active', 'draft');

    fireEvent.keyDown(screen.getByTestId('newf-workspace'), { key: 'l', ctrlKey: true, shiftKey: true });
    await vi.waitFor(() => expect(commandsRef.current?.activeLayoutId).toBe('default'));
  });

  it('deliberate layout-file edit beats a click: version mismatch drops saved sizes', () => {
    const store = createInMemoryStateStore();
    const edited = JSON.stringify({
      id: 'root', type: 'row', children: [
        { id: 'a', type: 'block', size: { px: 300 }, min: 100, max: 400, content: { mod: 'files' } },
        { id: 'b', type: 'block', content: { mod: 'changes' } },
      ],
    });
    // .state сохранён под СТАРОЙ версией файла; файл с тех пор правлен
    store.save(layoutStateKey('default'), serializeLayoutState({ sizes: { a: 200 } }, fingerprint(INTERACTIVE_LAYOUT)));

    render(<NewfScreen store={store} layoutJson={edited} />);
    // файл правлен после сохранения клика → размер из файла (300), не из .state
    expect(screen.getByTestId('newf-layout-node-a')).toHaveAttribute('data-size-px', '300');
  });

  it('switchLayout persists the current .state before loading the target layout', async () => {
    const store = createInMemoryStateStore();
    const commandsRef: { current: LayoutCommands | null } = { current: null };
    render(<NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} commandsRef={commandsRef} />);

    const divider = screen.getByRole('slider', { name: /pane-a.*pane-b/i });
    const paneA = screen.getByTestId('newf-layout-node-pane-a');
    const paneB = screen.getByTestId('newf-layout-node-pane-b');
    vi.spyOn(paneA, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 0, right: 200, top: 0, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(paneB, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 208, right: 408, top: 0, bottom: 100, x: 208, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 230 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 230 });

    // autosave сохранил resize для default
    await vi.waitFor(() => {
      const savedDefault = parseLayoutState(store.load(layoutStateKey('default')));
      expect(savedDefault?.sizes?.['pane-a']).toBe(230);
    });

    // переключение на клон: клон = копия текущего дерева (с resize 230)
    commandsRef.current?.cloneLayout('Clone');
    await vi.waitFor(() => expect(commandsRef.current?.layoutNames).toContain('clone'));
    commandsRef.current?.switchLayout('clone');
    await vi.waitFor(() => expect(commandsRef.current?.activeLayoutId).toBe('clone'));
    expect(screen.getByTestId('newf-workspace')).toHaveAttribute('data-layout-active', 'clone');
    // файл клона хранит размеры текущего layout → они показываются
    expect(screen.getByTestId('newf-layout-node-pane-a')).toHaveAttribute('data-size-px', '230');
  });

  it('toolbar select switches layouts; Next cycles; Reset restores file; Clone creates and switches', async () => {
    const store = createInMemoryStateStore();
    const commandsRef: { current: LayoutCommands | null } = { current: null };
    render(<NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} commandsRef={commandsRef} />);

    // Clone через тулбар: имя → создаётся и переключается
    fireEvent.change(screen.getByTestId('newf-layout-clone-name'), { target: { value: 'UI Clone' } });
    fireEvent.click(screen.getByTestId('newf-layout-clone'));
    await vi.waitFor(() => expect(commandsRef.current?.activeLayoutId).toBe('ui-clone'));
    expect(screen.getByTestId('newf-workspace')).toHaveAttribute('data-layout-active', 'ui-clone');
    // autosave сразу пишет .state клона — но без кликов (sizes/focus пусты)
    const cloneState = parseLayoutState(store.load(layoutStateKey('ui-clone')));
    expect(cloneState?.sizes).toBeUndefined();
    expect(cloneState?.focusedAgent).toBeUndefined();

    // Next: ui-clone → default (круговое)
    fireEvent.click(screen.getByTestId('newf-layout-next'));
    await vi.waitFor(() => expect(commandsRef.current?.activeLayoutId).toBe('default'));

    // Select: вернуться к клону
    fireEvent.change(screen.getByTestId('newf-layout-select'), { target: { value: 'ui-clone' } });
    await vi.waitFor(() => expect(commandsRef.current?.activeLayoutId).toBe('ui-clone'));

    // Reset на клоне: фокус/размеры очищены
    fireEvent.click(screen.getByTestId('newf-layout-reset'));
    const afterReset = parseLayoutState(store.load(layoutStateKey('ui-clone')));
    expect(afterReset?.sizes).toBeUndefined();
    expect(afterReset?.focusedAgent).toBeUndefined();
  });

  it('toolbar select reflects active layout and exposes all registered ids', async () => {
    const store = createInMemoryStateStore();
    const commandsRef: { current: LayoutCommands | null } = { current: null };
    render(<NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} commandsRef={commandsRef} />);

    commandsRef.current?.cloneLayout('Draft');
    await vi.waitFor(() => expect(commandsRef.current?.layoutNames).toContain('draft'));

    const select = screen.getByTestId('newf-layout-select') as HTMLSelectElement;
    expect(select.value).toBe('default');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['default', 'draft']);
  });

  it('voice toggle button appears when bridge active; hidden otherwise', () => {
    const store = createInMemoryStateStore();
    const { unmount } = render(<NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} />);
    // mock-режим без bridge → кнопки голоса нет
    expect(screen.queryByTestId('newf-voice-toggle')).toBeNull();
    unmount();

    render(
      <VoiceUiContext.Provider value={{ open: false, setOpen: () => {}, active: true }}>
        <NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} />
      </VoiceUiContext.Provider>,
    );
    const toggle = screen.getByTestId('newf-voice-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('voice toggle opens/closes through context; panel renders inside flow', async () => {
    const store = createInMemoryStateStore();
    let open = false;
    const setOpen = (next: boolean) => { open = next; };
    const { rerender } = render(
      <VoiceUiContext.Provider value={{ open, setOpen, active: true }}>
        <NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} />
      </VoiceUiContext.Provider>,
    );
    const toggle = screen.getByTestId('newf-voice-toggle');
    fireEvent.click(toggle);
    expect(open).toBe(true);
    rerender(
      <VoiceUiContext.Provider value={{ open, setOpen, active: true }}>
        <NewfScreen store={store} layoutJson={INTERACTIVE_LAYOUT} />
      </VoiceUiContext.Provider>,
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
