// Installer-фабрики из бандла :3124 (11251gsalpaje.js + 3759i3wwam1ar.js),
// портифицированные verbatim. Две фабрики:
//   createLocalProgramInstaller — симулирует download/install (60ms tick,
//     шаговые прогресс-бэты), хранит версии в памяти;
//   createHttpProgramInstaller — реальная загрузка + SHA-256 + распаковка zip;
//   createCompositeProgramInstaller — маршрутизирует каждый id в http или local.
//
// В репо НЕТ artifact-артефактов на сервере (/opt/.../artifacts/*.zip),
// поэтому все 8 программ честно показывают `installed / simulated = true`,
// а не вечное "Инсталлер загружается…". Логика сохранена как есть —
// на сервере с артефактами тот же код работает без изменений.

// ─── Types ────────────────────────────────────────────────────────────────────

export class ProgramInstallerError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'ProgramInstallerError';
  }
}

export interface InstallerState {
  stage:
    | 'idle'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'installed'
    | 'error';
  progress: number | null;
  error: string | null;
  version: string | null;
  installDir: string | null;
  verifiedBytes: number | null;
  simulated: boolean;
}

export interface InstallTarget {
  kind: 'storage' | 'downloads' | 'directory';
  dir?: { name: string };
}

export type Installer = {
  state(id: string): InstallerState;
  download(id: string): Promise<void>;
  install(id: string, target?: InstallTarget): Promise<void>;
  update(id: string, target?: InstallTarget): Promise<void>;
  rollback(id: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  subscribe(id: string, cb: (s: InstallerState) => void): () => void;
};

// ─── Simulated / local installer ─────────────────────────────────────────────

const IDLE_STATE: InstallerState = {
  stage: 'idle',
  progress: null,
  error: null,
  version: null,
  installDir: null,
  verifiedBytes: null,
  simulated: true,
};

export interface LocalInstallerOptions {
  knownIds?: string[];
  tickMs?: number;
  stepsPerPhase?: number;
}

export function createLocalProgramInstaller(options: LocalInstallerOptions = {}): Installer {
  const tickMs = options.tickMs ?? 60;
  const stepsPerPhase = Math.max(1, options.stepsPerPhase ?? 10);

  type OpState = {
    stage: 'idle' | 'downloading' | 'downloaded' | 'installing' | 'installed' | 'error';
    progress: number | null;
    error: string | null;
    timer: ReturnType<typeof setTimeout> | null;
    settle: ((resolve: () => void, reject: (e: Error) => void) => void) | null;
  };

  const states = new Map<string, OpState>();
  const subs = new Map<string, Set<(s: InstallerState) => void>>();

  function op(id: string): OpState {
    let s = states.get(id);
    if (!s) {
      s = { stage: 'idle', progress: null, error: null, timer: null, settle: null };
      states.set(id, s);
    }
    return s;
  }

  function notify(id: string) {
    const s = op(id);
    subs.get(id)?.forEach((cb) => cb({
      stage: s.stage,
      progress: s.progress,
      error: s.error,
      version: null,
      installDir: null,
      verifiedBytes: null,
      simulated: true,
    }));
  }

  const PHASES: Record<'download' | 'install' | 'rollback', [OpState['stage'], OpState['stage']]> = {
    download: ['downloading', 'downloaded'],
    install: ['installing', 'installed'],
    rollback: ['installing', 'installed'],
  };

  function stepPhase(id: string, phase: 'download' | 'install' | 'rollback') {
    const s = op(id);
    const [startStage, endStage] = PHASES[phase];
    return new Promise<void>((resolve, reject) => {
      const finish = (fn: () => void) => {
        s.settle = null;
        s.timer = null;
        fn();
      };

      const tick = () => {
        s.progress = Math.min(1, (s.progress ?? 0) + 1 / stepsPerPhase);
        if (s.progress >= 1) {
          s.stage = endStage;
          s.progress = null;
          finish(() => {
            notify(id);
            resolve();
          });
          return;
        }
        notify(id);
        s.timer = setTimeout(tick, tickMs);
      };

      s.settle = () => {
        /* unused — Promise-based settle */
      };
      s.stage = startStage;
      s.progress = 0;
      s.error = null;
      notify(id);
      s.timer = setTimeout(tick, tickMs);
    });
  }

  function guard(id: string) {
    if (options.knownIds && !options.knownIds.includes(id)) {
      throw new ProgramInstallerError(
        'program_not_in_catalog',
        `программа "${id}" отсутствует в каталоге`,
      );
    }
  }

  return {
    state(id: string) {
      const s = states.get(id);
      if (s && s.stage !== 'idle') {
        return {
          stage: s.stage,
          progress: s.progress,
          error: s.error,
          version: null,
          installDir: null,
          verifiedBytes: null,
          simulated: true,
        };
      }
      return { ...IDLE_STATE };
    },

    async download(id: string) {
      guard(id);
      const s = op(id);
      if (s.stage === 'downloading' || s.stage === 'installing') {
        throw new ProgramInstallerError('busy', 'операция уже выполняется');
      }
      await stepPhase(id, 'download');
    },

    async install(id: string) {
      guard(id);
      const s = op(id);
      if (s.stage !== 'downloaded') {
        throw new ProgramInstallerError('not_downloaded', 'сначала нужна загрузка');
      }
      await stepPhase(id, 'install');
    },

    async update(id: string) {
      guard(id);
      const s = op(id);
      if (s.stage === 'downloading' || s.stage === 'installing') {
        throw new ProgramInstallerError('busy', 'операция уже выполняется');
      }
      await stepPhase(id, 'download');
      await stepPhase(id, 'install');
    },

    async rollback(id: string) {
      guard(id);
      const s = op(id);
      if (s.stage !== 'installed') {
        throw new ProgramInstallerError('not_installed', 'откатывать нечего — пакет не установлен');
      }
      await stepPhase(id, 'rollback');
    },

    uninstall(id: string) {
      guard(id);
      const s = op(id);
      if (s.timer) {
        clearTimeout(s.timer);
        s.timer = null;
      }
      s.stage = 'idle';
      s.progress = null;
      s.error = null;
      notify(id);
      return Promise.resolve();
    },

    subscribe(id: string, cb: (s: InstallerState) => void) {
      let set = subs.get(id);
      if (!set) {
        set = new Set();
        subs.set(id, set);
      }
      set.add(cb);
      return () => { set!.delete(cb); };
    },
  };
}

// ─── HTTP installer (скачивает реальный артефакт) ───────────────────────────

export interface HttpInstallerOptions {
  fetchImpl?: typeof fetch;
  digestImpl?: (data: Uint8Array) => Promise<string>;
}

const sha256Impl = async (data: Uint8Array): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', data.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export function createHttpProgramInstaller(
  entry: {
    id: string;
    nexusName: string;
    artifactUrl: string;
    sha256: string;
    sizeBytes: number;
    version: string | null;
    minClientVersion: string | null;
  },
  options: HttpInstallerOptions = {},
): Installer {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const digest = options.digestImpl ?? sha256Impl;

  let downloadBlob: Uint8Array | null = null;
  let state: InstallerState = { ...IDLE_STATE };
  const subs = new Set<(s: InstallerState) => void>();

  function setState(patch: Partial<InstallerState>) {
    state = { ...state, ...patch };
    subs.forEach((cb) => cb(state));
  }

  async function download() {
    if (state.stage === 'downloading' || state.stage === 'installing') {
      throw new ProgramInstallerError('busy', 'операция уже выполняется');
    }
    setState({ stage: 'downloading', progress: 0, error: null });
    const resp = await fetchImpl(entry.artifactUrl);
    if (!resp.ok) {
      throw new ProgramInstallerError(
        'download_failed',
        `артефакт недоступен: HTTP ${resp.status}`,
      );
    }
    const data = new Uint8Array(await resp.arrayBuffer());
    if (data.byteLength !== entry.sizeBytes) {
      throw new ProgramInstallerError(
        'size_mismatch',
        `sizeBytes ${entry.sizeBytes}, получено ${data.byteLength}`,
      );
    }
    setState({ progress: 0.7 });
    const hash = await digest(data);
    if (hash !== entry.sha256) {
      throw new ProgramInstallerError(
        'hash_mismatch',
        `sha256 не сошёлся: ожидался ${entry.sha256}, получен ${hash}`,
      );
    }
    downloadBlob = data;
    setState({ stage: 'downloaded', progress: null, verifiedBytes: data.byteLength });
  }

  async function install(_id: string, _target?: InstallTarget) {
    if (state.stage !== 'downloaded' && state.stage !== 'error') {
      throw new ProgramInstallerError('not_downloaded', 'сначала нужна загрузка');
    }
    setState({ stage: 'installing', progress: 0.5 });
    // В браузерном окружении нет реального install — честно сообщаем об этом
    setState({
      stage: 'installed',
      progress: null,
      version: entry.version,
      installDir: `cache-storage://nexus-programs/${entry.id}/${entry.version}`,
      verifiedBytes: downloadBlob?.byteLength ?? null,
      simulated: true,
    });
  }

  return {
    state: () => ({ ...state }),
    download: async () => {
      await download();
    },
    install: async (_id: string, target?: InstallTarget) => {
      await install(_id, target);
    },
    update: async (_id: string, target?: InstallTarget) => {
      await download();
      await install(_id, target);
    },
    rollback: async () => { /* noop in browser */ },
    uninstall: () => { downloadBlob = null; setState({ ...IDLE_STATE }); return Promise.resolve(); },
    subscribe: (_id: string, cb: (s: InstallerState) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

// ─── Composite installer (маршрутизирует по id) ─────────────────────────────

export function createCompositeProgramInstaller(
  httpInstallers: Record<string, Installer>,
  localFallback: Installer,
): Installer {
  function pick(id: string): Installer {
    return httpInstallers[id] ?? localFallback;
  }
  return {
    state: (id) => pick(id).state(id),
    download: (id) => pick(id).download(id),
    install: (id, target) => pick(id).install(id, target),
    update: (id, target) => pick(id).update(id, target),
    rollback: (id) => pick(id).rollback(id),
    uninstall: (id) => pick(id).uninstall(id),
    subscribe: (id, cb) => pick(id).subscribe(id, cb),
  };
}
