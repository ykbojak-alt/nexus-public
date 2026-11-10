import type { NexusDesktopBridge } from './types';

/**
 * Browser fallback (Task 7): normal browser / SSR — no pywebview.
 * Every method resolves a safe default; `available` is false so the UI
 * hides desktop-only affordances (native dialogs, tray notify, titlebar).
 */
export function createBrowserBridge(): NexusDesktopBridge {
  return {
    available: false,
    appInfo: () => Promise.resolve(null),
    pickImage: () => Promise.resolve(null),
    saveText: () => Promise.resolve(null),
    openBrowser: () => Promise.resolve(false),
    instagramWebState: () => Promise.resolve({ state: 'unavailable' }),
    instagramWebOpen: () => Promise.resolve({ state: 'unavailable' }),
    instagramWebClose: () => Promise.resolve({ state: 'unavailable' }),
    listInstalledTools: () => Promise.resolve(null),
    openInstalledTool: () => Promise.resolve(null),
    systemMetrics: () => Promise.resolve(null),
    unrealSceneState: () => Promise.resolve(null),
    unrealSceneOpen: () => Promise.resolve(null),
    unrealSceneSetActive: () => Promise.resolve(null),
    setTitle: () => Promise.resolve(false),
    setFullscreen: () => Promise.resolve(false),
    toggleFullscreen: () => Promise.resolve(false),
    minimize: () => Promise.resolve(false),
    closeWindow: () => Promise.resolve(false),
    setBounds: () => Promise.resolve(false),
    toggleMaximize: () => Promise.resolve(null),
    notify: () => Promise.resolve(false),
    isFrameless: () => Promise.resolve(false),
    setWindowOpacity: () => Promise.resolve(false),
    getWindowOpacity: () => Promise.resolve(null),
    emit: () => Promise.resolve(false),
  };
}
