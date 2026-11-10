// @vitest-environment jsdom — bridge binds on window.pywebview (pywebviewready)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDesktopBridge } from './adapter';
import type { PywebviewApi } from './types';

declare global {
  interface Window {
    pywebview?: { api: PywebviewApi };
  }
}

function installMockPywebview(overrides: Partial<PywebviewApi> = {}) {
  window.pywebview = {
    api: {
      app_info: vi.fn(async () => ({ app: 'AI-2 · Agent OS', version: '1.0', platform: 'win32', desktop: true })),
      set_title: vi.fn(async () => true),
      set_fullscreen: vi.fn(async () => true),
      toggle_fullscreen: vi.fn(async () => true),
      minimize: vi.fn(async () => true),
      close_window: vi.fn(async () => true),
      notify: vi.fn(async () => true),
      is_frameless: vi.fn(async () => true),
      pick_image: vi.fn(async () => null),
      save_text: vi.fn(async (filename: string) => `C:\\out\\${filename}`),
      emit: vi.fn(async () => true),
      ...overrides,
    },
  };
}

afterEach(() => {
  delete window.pywebview;
  vi.restoreAllMocks();
});

describe('getDesktopBridge (Task 7)', () => {
  it('is safe in a normal browser with no pywebview object', async () => {
    const bridge = await getDesktopBridge({ timeoutMs: 0 });
    expect(bridge.available).toBe(false);
    await expect(bridge.setTitle('NEXUS')).resolves.toBe(false);
    await expect(bridge.appInfo()).resolves.toBeNull();
    await expect(bridge.pickImage()).resolves.toBeNull();
    await expect(bridge.saveText('a.txt', 'x')).resolves.toBeNull();
    await expect(bridge.minimize()).resolves.toBe(false);
    await expect(bridge.closeWindow()).resolves.toBe(false);
  });

  it('binds when pywebviewready arrives after React mount', async () => {
    const pending = getDesktopBridge({ timeoutMs: 1000 });
    installMockPywebview();
    document.dispatchEvent(new Event('pywebviewready'));
    const bridge = await pending;
    expect(bridge.available).toBe(true);
  });

  it('binds immediately when api is already installed', async () => {
    installMockPywebview();
    const bridge = await getDesktopBridge({ timeoutMs: 0 });
    expect(bridge.available).toBe(true);
  });

  it('ignores the empty api:{} shell injected before _createApi', async () => {
    // pywebview 6.x: api.js создаёт window.pywebview.api={} раньше finish.js —
    // пустой объект не должен резолвиться как доступный мост (frameless-fix).
    window.pywebview = { api: {} };
    const pending = getDesktopBridge({ timeoutMs: 1000 });
    await new Promise((r) => setTimeout(r, 250)); // api:{} виден, методов нет
    installMockPywebview(); // приехал finish.js — методы появились
    const bridge = await pending;
    expect(bridge.available).toBe(true);
    await expect(bridge.isFrameless()).resolves.toBe(true);
    // а если методы так и не приехали — честный browser fallback, не ложный мост
    window.pywebview = { api: {} };
    await expect(getDesktopBridge({ timeoutMs: 50 })).resolves.toMatchObject({ available: false });
  });

  it('maps camelCase calls to python snake_case methods', async () => {
    installMockPywebview();
    const bridge = await getDesktopBridge();
    const info = await bridge.appInfo();
    expect(window.pywebview!.api.app_info).toHaveBeenCalledOnce();
    expect(info?.version).toBe('1.0');
    expect(info?.desktop).toBe(true);
  });

  it('wraps the host raw installed-tool list without altering rows', async () => {
    const rows = [
      {
        id: 'vscode',
        name: 'Visual Studio Code',
        status: 'available',
        reason: null,
        version: null,
        version_status: 'unavailable',
        version_reason: 'version_not_read',
      },
      { id: 'git', name: 'Git version probe', status: 'unavailable', reason: 'executable_not_found' },
    ];
    installMockPywebview({
      list_installed_tools: vi.fn(async () => rows),
    });
    const bridge = await getDesktopBridge();
    await expect(bridge.listInstalledTools()).resolves.toEqual({ tools: rows });
    expect(window.pywebview!.api.list_installed_tools).toHaveBeenCalledOnce();
  });

  it('returns unavailable/null when installed-tool methods are absent or browser-only', async () => {
    installMockPywebview();
    const legacy = await getDesktopBridge();
    await expect(legacy.listInstalledTools()).resolves.toBeNull();
    await expect(legacy.openInstalledTool('vscode')).resolves.toBeNull();

    delete window.pywebview;
    const browser = await getDesktopBridge({ timeoutMs: 0 });
    expect(browser.available).toBe(false);
    await expect(browser.listInstalledTools()).resolves.toBeNull();
    await expect(browser.openInstalledTool('vscode')).resolves.toBeNull();
  });

  it('forwards exact tool id and preserves the host launch result, including unknown-id errors', async () => {
    const openInstalledTool = vi.fn(async (toolId: string) => ({
      id: null,
      status: 'unavailable',
      reason: 'tool_not_allowlisted',
      requested_id: toolId,
    }));
    installMockPywebview({ open_installed_tool: openInstalledTool });
    const bridge = await getDesktopBridge();
    await expect(bridge.openInstalledTool('unknown-tool')).resolves.toEqual({
      id: null,
      status: 'unavailable',
      reason: 'tool_not_allowlisted',
      requested_id: 'unknown-tool',
    });
    expect(openInstalledTool).toHaveBeenCalledExactlyOnceWith('unknown-tool');
  });

  it('does not swallow installed-tool host exceptions as unavailable responses', async () => {
    installMockPywebview({
      list_installed_tools: vi.fn(async () => { throw new Error('host offline'); }),
    });
    const bridge = await getDesktopBridge();
    await expect(bridge.listInstalledTools()).rejects.toThrow('host offline');
  });

  it('preserves python null/false semantics (cancellation ≠ failure)', async () => {
    installMockPywebview({
      pick_image: vi.fn(async () => null),      // user cancelled dialog
      save_text: vi.fn(async () => 'C:\\out\\trajectory.jsonl'),
      notify: vi.fn(async () => false),          // tray absent
    });
    const bridge = await getDesktopBridge();
    await expect(bridge.pickImage()).resolves.toBeNull();
    await expect(bridge.saveText('trajectory.jsonl', '{}')).resolves.toBe('C:\\out\\trajectory.jsonl');
    await expect(bridge.notify('t', 'm')).resolves.toBe(false);
    expect(window.pywebview!.api.save_text).toHaveBeenCalledWith('trajectory.jsonl', '{}');
  });

  it('degrades to the browser bridge when a method rejects', async () => {
    installMockPywebview({ set_title: vi.fn(async () => { throw new Error('gone'); }) });
    const bridge = await getDesktopBridge();
    await expect(bridge.setTitle('NEXUS')).resolves.toBe(false);
  });

  it('falls back to browser bridge when api lacks a method', async () => {
    installMockPywebview();
    delete window.pywebview!.api.notify;
    const bridge = await getDesktopBridge();
    await expect(bridge.notify('t', 'm')).resolves.toBe(false);
  });

  it('openBrowser routes to the unprivileged window api (open_browser)', async () => {
    installMockPywebview({ open_browser: vi.fn(async () => true) });
    const bridge = await getDesktopBridge();
    await expect(bridge.openBrowser('https://example.com')).resolves.toBe(true);
    expect(window.pywebview!.api.open_browser).toHaveBeenCalledWith('https://example.com');
  });

  it('openBrowser degrades to false when the host lacks open_browser', async () => {
    installMockPywebview();
    // open_browser is optional in PywebviewApi — mock omits it entirely.
    const bridge = await getDesktopBridge();
    await expect(bridge.openBrowser('https://example.com')).resolves.toBe(false);
  });

  it('instagramWeb* routes to the managed-window api (INT-18)', async () => {
    installMockPywebview({
      instagram_web_state: vi.fn(async () => ({ state: 'closed', detail: null })),
      instagram_web_open: vi.fn(async () => ({ state: 'open' })),
      instagram_web_close: vi.fn(async () => ({ state: 'closed' })),
    });
    const bridge = await getDesktopBridge();
    await expect(bridge.instagramWebState()).resolves.toEqual({ state: 'closed', detail: null });
    await expect(bridge.instagramWebOpen()).resolves.toEqual({ state: 'open', detail: null });
    await expect(bridge.instagramWebClose()).resolves.toEqual({ state: 'closed', detail: null });
  });

  it('instagramWeb* is honest outside the shell and on missing methods', async () => {
    const browser = await getDesktopBridge({ timeoutMs: 0 });
    await expect(browser.instagramWebState()).resolves.toEqual({ state: 'unavailable' });
    await expect(browser.instagramWebOpen()).resolves.toEqual({ state: 'unavailable' });

    installMockPywebview(); // pywebview present but an older host lacks the methods
    const bridge = await getDesktopBridge();
    await expect(bridge.instagramWebState()).resolves.toEqual({ state: 'unavailable' });
  });

  it('unrealSceneOpen forwards themeId → NEXUS_SCENE_THEME seam', async () => {
    installMockPywebview({ unreal_scene_open: vi.fn(async () => ({ status: 'starting' })) });
    const bridge = await getDesktopBridge();
    await bridge.unrealSceneOpen('mech');
    expect(window.pywebview!.api.unreal_scene_open).toHaveBeenCalledWith('mech');
    await bridge.unrealSceneOpen();
    expect(window.pywebview!.api.unreal_scene_open).toHaveBeenLastCalledWith();
    // W1 S3: persona selection rides the second positional arg →
    // NEXUS_SCENE_ASSISTANT; theme stays null when only assistant is set.
    await bridge.unrealSceneOpen(undefined, 'codex');
    expect(window.pywebview!.api.unreal_scene_open).toHaveBeenLastCalledWith(null, 'codex');
  });

  it('unrealSceneSetActive forwards assistant verbatim; browser → null', async () => {
    const browser = await getDesktopBridge({ timeoutMs: 0 });
    await expect(browser.unrealSceneSetActive!('mech')).resolves.toBeNull();

    installMockPywebview({
      unreal_scene_set_active: vi.fn(async () => ({
        sent: true, state: { status: 'connected', activeAssistant: 'mech' },
      })),
    });
    const bridge = await getDesktopBridge();
    const r = await bridge.unrealSceneSetActive!('mech');
    expect(window.pywebview!.api.unreal_scene_set_active).toHaveBeenCalledWith('mech');
    expect(r).toEqual({ sent: true, state: { status: 'connected', activeAssistant: 'mech' } });
    // хост без метода → null, а не выдуманный sent
    installMockPywebview();
    const legacy = await getDesktopBridge();
    await expect(legacy.unrealSceneSetActive!('mech')).resolves.toBeNull();
  });

  it('unrealSceneSubscribe receives host pushes via DOM event; absent in browser', async () => {
    const browser = await getDesktopBridge({ timeoutMs: 0 });
    expect(browser.unrealSceneSubscribe).toBeUndefined(); // no push source — honest

    installMockPywebview();
    const bridge = await getDesktopBridge();
    const seen: unknown[] = [];
    const off = bridge.unrealSceneSubscribe!((s) => seen.push(s));
    window.dispatchEvent(new CustomEvent('unreal-scene.state', {
      detail: { status: 'connected', source: 'live' },
    }));
    // malformed pushes (non-object detail) are dropped, never delivered
    window.dispatchEvent(new CustomEvent('unreal-scene.state', { detail: 'junk' }));
    window.dispatchEvent(new CustomEvent('unreal-scene.state', { detail: null }));
    expect(seen).toEqual([{ status: 'connected', source: 'live' }]);
    off();
    window.dispatchEvent(new CustomEvent('unreal-scene.state', {
      detail: { status: 'stale' },
    }));
    expect(seen).toHaveLength(1); // unsubscribe really detaches
  });

  it('unrealSceneEvents receives host pushes via DOM event; absent in browser', async () => {
    const browser = await getDesktopBridge({ timeoutMs: 0 });
    expect(browser.unrealSceneEvents).toBeUndefined(); // no push source — honest

    installMockPywebview();
    const bridge = await getDesktopBridge();
    const seen: unknown[] = [];
    const off = bridge.unrealSceneEvents!((e) => seen.push(e));
    window.dispatchEvent(new CustomEvent('unreal-scene.event', {
      detail: { type: 'map-error', map: '/Game/Maps/StartScene_Arch', ts: 1700000000 },
    }));
    // malformed pushes (non-object detail) are dropped, never delivered
    window.dispatchEvent(new CustomEvent('unreal-scene.event', { detail: 'junk' }));
    window.dispatchEvent(new CustomEvent('unreal-scene.event', { detail: null }));
    expect(seen).toEqual([{ type: 'map-error', map: '/Game/Maps/StartScene_Arch', ts: 1700000000 }]);
    off();
    window.dispatchEvent(new CustomEvent('unreal-scene.event', { detail: { type: 'back' } }));
    expect(seen).toHaveLength(1); // unsubscribe really detaches
  });

  it('instagramWeb* never fabricates lifecycle: unknown wire state → error', async () => {
    installMockPywebview({
      instagram_web_state: vi.fn(async () => ({ state: 'floating' })),
      // wire contract violation on purpose — must not map onto a real state
      instagram_web_open: vi.fn(async () => 'ok') as unknown as PywebviewApi['instagram_web_open'],
    });
    const bridge = await getDesktopBridge();
    const weird = await bridge.instagramWebState();
    expect(weird.state).toBe('error');
    expect(weird.detail).toContain('floating');
    await expect(bridge.instagramWebOpen()).resolves.toEqual({ state: 'unavailable' });
  });
});
