/**
 * DesktopBridge contracts (Task 7) — TypeScript view of the pywebview
 * `js_api` surface in ai2/desktop.py. Python methods are snake_case and
 * return promises after `pywebviewready`; null means "user cancelled /
 * not applicable", false means "refused / unavailable" — both preserved.
 */

/** ai2/desktop.py app_info() payload. */
export interface DesktopAppInfo {
  app: string;
  version: string;
  platform: string;
  desktop: boolean;
  pid?: boolean | null;
  [key: string]: unknown;
}

/** pick_image() result — a data-URL image for shell backgrounds. */
export interface PickedImage {
  name: string;
  mime: string;
  data_url: string;
}

/** Raw allowlisted installed-tool row returned by ai2/desktop.py. */
export interface InstalledTool {
  id: string;
  name: string;
  status: string;
  reason?: string | null;
  version?: string | null;
  version_status?: string;
  version_reason?: string | null;
  [key: string]: unknown;
}

/**
 * Local host metrics payload — `system_metrics()` in ai2/desktop.py
 * (NUE-2, spec `docs/product/desktop-local-metrics.md`). Read only from the
 * window that hosts the client; never sent outside the shell. All values are
 * null-able: a missing field degrades the widget honestly, never fabricated.
 */
export interface DesktopSystemMetrics {
  cpu: number | null;
  ram: number | null;
  disk: number | null;
  uptime_s: number | null;
  /** Top-N live processes of the local host (name + pid + status). */
  processes?: { pid: number; name: string; status?: string | null }[] | null;
  [key: string]: unknown;
}

/** Verbatim result from DesktopBridge.open_installed_tool(). */
export interface InstalledToolLaunchResult {
  id: string | null;
  status: string;
  reason?: string | null;
  [key: string]: unknown;
}

/**
 * Raw pywebview api surface (window.pywebview.api.*).
 * Methods may be absent — the adapter degrades each call safely.
 */
export interface PywebviewApi {
  app_info?: () => Promise<DesktopAppInfo>;
  set_title?: (title: string) => Promise<boolean>;
  set_fullscreen?: (on?: boolean) => Promise<boolean>;
  toggle_fullscreen?: () => Promise<boolean>;
  minimize?: () => Promise<boolean>;
  close_window?: () => Promise<boolean>;
  /** Frameless edge-resize: absolute window bounds in screen px. */
  set_bounds?: (x: number, y: number, width: number, height: number) => Promise<boolean>;
  /** Maximize/restore toggle — resolves the resulting maximized state,
   *  null when the window or backend refused. */
  toggle_maximize?: () => Promise<boolean | null>;
  notify?: (title: string, message: string) => Promise<boolean>;
  is_frameless?: () => Promise<boolean>;
  /** NUE window opacity: 1.0 opaque … 0.10 near-glass (Win32 layered). */
  set_window_opacity?: (alpha: number) => Promise<boolean>;
  get_window_opacity?: () => Promise<number>;
  pick_image?: () => Promise<PickedImage | null>;
  save_text?: (filename: string, text: string) => Promise<string | null>;
  /** Open an unprivileged Chromium child window for an http(s) URL. */
  open_browser?: (url: string) => Promise<boolean>;
  /** Allowlisted tool inventory; host returns a raw list and never launches. */
  list_installed_tools?: () => Promise<InstalledTool[]>;
  /** Explicit user action; host validates the ID against its allowlist. */
  open_installed_tool?: (toolId: string) => Promise<InstalledToolLaunchResult>;
  /** NUE-2: local host metrics (psutil in the desktop shell); absent → the
   *  adapter falls back to the remote /v1/metrics of the ai2 host. */
  system_metrics?: () => Promise<DesktopSystemMetrics | null>;
  /** INT-18: managed Instagram Web window lifecycle (separate profile, no js_api). */
  instagram_web_state?: () => Promise<{ state: string; detail?: string | null }>;
  instagram_web_open?: () => Promise<{ state: string; detail?: string | null }>;
  instagram_web_close?: () => Promise<{ state: string; detail?: string | null }>;
  /** Unreal runtime scene host (ai2/unreal_runtime_package.py) — camelCase wire. */
  unreal_scene_state?: () => Promise<UnrealSceneWireState>;
  /** themeId опционален — уходит в NEXUS_SCENE_THEME (material-contract §1);
   *  assistant (arch|mech|alice|codex|forge) — NEXUS_SCENE_ASSISTANT (W1 S3),
   *  выбор персоны профиля; невалидное значение хост не заводит. */
  unreal_scene_open?: (theme?: string | null, assistant?: string | null) => Promise<UnrealSceneWireState>;
  /** VIII V1.4: смена персоны живой сцены без перезапуска — host шлёт
   *  WS-команду `set-active`; ответ verbatim `{sent, state}`. */
  unreal_scene_set_active?: (assistant?: string | null) => Promise<UnrealSceneSetActiveResult>;
  emit?: (name: string, payload?: unknown) => Promise<boolean>;
}

/** ai2 `UnrealSceneHost.state()`/`open()` dict — status vocabulary is the
 *  host's; unknown strings must never be read as `connected` upstream. */
export interface UnrealSceneWireState {
  status?: string;
  source?: string | null;
  reason?: string | null;
  lastUpdated?: number | null;
  protocolVersion?: number | null;
  /** nexus-scene-v1 (W1 S3): активный ассистент сцены; отсутствует на
   *  старых хостах — UI показывает только когда сообщено. */
  activeAssistant?: string | null;
  /** VII V3-3: путь карты, открытой хостом (`/Game/Maps/...`).
   *  null/отсутствует — карта не сообщена; «карта не найдена» приходит
   *  как `status:'error'` + `reason` verbatim, а не отдельным статусом. */
  activeMap?: string | null;
}

/** Python→JS push `unreal-scene.event` (VII V3-1): обратные события сцены
 *  — клик по портрету, возврат, ошибка загрузки карты. Поля verbatim от
 *  хоста; `type` — открытый словарь, неизвестные типы не отбрасываются. */
/** ai2 `UnrealSceneHost.set_active()` dict — `sent` false на мёртвом
 *  канале/вне словаря; `state` — состояние хоста ПОСЛЕ команды. */
export interface UnrealSceneSetActiveResult {
  sent: boolean;
  state: UnrealSceneWireState;
}

export interface UnrealSceneWireEvent {
  type: string;
  assistant?: string | null;
  map?: string | null;
  detail?: unknown;
  /** host clock (epoch s); null/отсутствует — время не сообщено. */
  ts?: number | null;
}

/** INT-18 managed Instagram window lifecycle result — mirrors mock-data
 *  `InstagramWebState` structurally (no package dep in the bridge layer). */
export interface InstagramWebResult {
  state: 'closed' | 'opening' | 'open' | 'unavailable' | 'error';
  detail?: string | null;
}

/** Public facade — browser-safe: every method resolves a sane default. */
export interface NexusDesktopBridge {
  /** true when running inside the pywebview desktop shell. */
  readonly available: boolean;
  appInfo(): Promise<DesktopAppInfo | null>;
  pickImage(): Promise<PickedImage | null>;
  /** Returns the saved file path, or null when cancelled. */
  saveText(filename: string, text: string): Promise<string | null>;
  /** Open a separate Chromium window without the application JS bridge. */
  openBrowser(url: string): Promise<boolean>;
  /** null means the host method is absent or returned an invalid payload. */
  listInstalledTools(): Promise<{ tools: InstalledTool[] } | null>;
  /** null means unavailable/unsupported; host result fields remain verbatim. */
  openInstalledTool(toolId: string): Promise<InstalledToolLaunchResult | null>;
  /** NUE-2: local host metrics — null when the shell exposes no method or the
   *  host could not read them; callers fall back to the remote ai2 /v1/metrics. */
  systemMetrics(): Promise<DesktopSystemMetrics | null>;
  /** INT-18: managed Instagram Web window — 'unavailable' outside the shell. */
  instagramWebState(): Promise<InstagramWebResult>;
  instagramWebOpen(): Promise<InstagramWebResult>;
  instagramWebClose(): Promise<InstagramWebResult>;
  /** Unreal scene host state — null when the shell exposes no scene methods. */
  unrealSceneState(): Promise<UnrealSceneWireState | null>;
  /** Request scene launch — the host may still answer not-installed/error.
   *  `theme` forwards to NEXUS_SCENE_THEME (bounded, host-validated);
   *  `assistant` — profile persona for NEXUS_SCENE_ASSISTANT (host validates
   *  the closed set; omitted/unknown → the scene falls back to alice). */
  unrealSceneOpen(theme?: string, assistant?: string): Promise<UnrealSceneWireState | null>;
  /** VIII V1.4: переключить персону живой сцены — null вне десктопной
   *  оболочки; `sent:false` — канала нет/значение отвергнуто хостом. */
  unrealSceneSetActive?(assistant: string): Promise<UnrealSceneSetActiveResult | null>;
  /** Python→JS push `unreal-scene.state` — absent outside the desktop shell
   *  (the browser bridge has no push source; callers must fall back to
   *  polling `unrealSceneState` honestly). Returns unsubscribe. */
  unrealSceneSubscribe?(onState: (state: UnrealSceneWireState) => void): () => void;
  /** Python→JS push `unreal-scene.event` — обратные события сцены
   *  (portrait-click/back/map-error…). Отсутствует вне десктопной оболочки
   *  — браузерному мосту нечего слушать; UI показывает только пришедшее. */
  unrealSceneEvents?(onEvent: (event: UnrealSceneWireEvent) => void): () => void;
  setTitle(title: string): Promise<boolean>;
  setFullscreen(on: boolean): Promise<boolean>;
  toggleFullscreen(): Promise<boolean>;
  minimize(): Promise<boolean>;
  closeWindow(): Promise<boolean>;
  /** Frameless resize/move — absolute bounds in screen px; false when the
   *  host cannot move the window (browser bridge → always false). */
  setBounds(x: number, y: number, width: number, height: number): Promise<boolean>;
  /** Maximize ↔ restore; resolves the resulting state, null on refusal. */
  toggleMaximize(): Promise<boolean | null>;
  /** OS tray notification — false when the tray isn't running. */
  notify(title: string, message: string): Promise<boolean>;
  /** Frameless window flag — the UI draws its own titlebar. */
  isFrameless(): Promise<boolean>;
  /** Непрозрачность окна 0.10–1.0 — Win32 layered, затемняет всё окно.
   *  false вне десктопной оболочки/не-Windows/без окна. */
  setWindowOpacity(alpha: number): Promise<boolean>;
  /** Последняя применённая хостом непрозрачность; null вне оболочки. */
  getWindowOpacity(): Promise<number | null>;
  /** JS → Python event bus (DesktopBridge.emit listeners). */
  emit(name: string, payload?: unknown): Promise<boolean>;
}
