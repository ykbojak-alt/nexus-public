/**
 * Mанифест продуктов NEXUS — verbatim данные из бандла :3124 (часть 73522).
 * Схема nexus.programs-manifest/1, generated 2026-10-28.
 *
 * Правила честности (из спеки):
 * - `href` — только реально существующие app-router-роуты; `null` = только
 *   встроенная панель (внутри программной страницы), наружный экран не строим.
 * - Программы со `status: 'soon'` — не кликабельные плитки.
 * - Программы, где `href != null`, — кнопки-ссылки; там, где `href = null`,
 *   — div с aria-disabled.
 */

export interface ProgramManifestEntry {
  id: string;
  nexusName: string;
  href: string | null;
  desc: string;
  art: string;
  artAlt: string;
  bayBg: string;
  tag: string;
  meta: string[];
  version: string | null;
  upstreamLicense: string | null;
  artifactUrl: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  minClientVersion: string | null;
  status: 'available' | 'downloadable' | 'setup' | 'soon';
  packageKind?: 'app' | 'stub';
  bayArt?: string;
}

export interface ProgramManifest {
  schema: string;
  generated: string;
  programs: ProgramManifestEntry[];
}

export const PROGRAMS_MANIFEST: ProgramManifest = {
  schema: 'nexus.programs-manifest/1',
  generated: '2026-10-28',
  programs: [
    {
      id: 'bus',
      nexusName: 'NEXUS Bus',
      href: '/bus-desktop',
      desc: 'NEXUS Bus — пульт шины окон и агентов: наблюдаемое состояние окон (observed), диспетч задач с верификацией доставки, очереди и ответы, стоп-кран диспатча, журнал дозора, субагенты и игровой режим. LUX-оболочка: obsidian-зал, золотые порталы окон и сферы статусов.',
      art: '/bus/lux/bus.mp4',
      artAlt: 'LUX-зал шины NEXUS Bus: автобус едет по золотой линии маршрута',
      bayBg: '/programs/bay-bg/bay-bg-bus.png',
      tag: 'сцена + desktop',
      meta: ['observed-состояние окон', 'dispatch с verify-delivery', 'watchdog + стоп-кран', 'pywebview desktop'],
      version: null,
      upstreamLicense: null,
      artifactUrl: null,
      sha256: null,
      sizeBytes: null,
      minClientVersion: null,
      status: 'available',
    },
    {
      id: 'swarm',
      nexusName: 'NEXUS SWARM',
      href: null,
      desc: 'NEXUS SWARM — торговый рой NEXUS: пул из 100 уникальных персон (13 семей — Scalper, Momentum, TrendFollower, Breakout, MeanReversion, Contrarian, RiskManager и другие — каждый со своим характером и промптом), за цикл голосуют топ-30 по дарвиновскому весу, спорят Три Ума (генератор, критик, арбитр). Рой мультивалютный: скринер выбирает актив каждый цикл, панель показывает портфель активов, счёт MarginPad, открытые позиции и сделки из истории. Аналитика — мультитаймфреймовый снапшот 1m + 15m, объём против SMA(20) и режим рынка (TRENDING_UP / TRENDING_DOWN / RANGING / VOLATILE). Прогон цикла из приложения идёт без реального ордера.',
      art: '/programs/bay-bg/bay-bg-swarm.png',
      artAlt: 'LUX-фон NEXUS SWARM: зал роя с золотыми световыми нитями между сферами-агентами',
      bayBg: '/programs/bay-bg/bay-bg-swarm.png',
      tag: 'трейдинг · рой',
      meta: ['пул 100 · топ-30', 'портфель и позиции', '1m + 15m · объём · режим', 'paper-счёт на реальных ценах'],
      version: null,
      upstreamLicense: null,
      artifactUrl: null,
      sha256: null,
      sizeBytes: null,
      minClientVersion: null,
      status: 'available',
    },
    {
      id: 'craft',
      nexusName: 'NEXUS Craft',
      href: '/tools/craft',
      desc: 'NEXUS Craft — фирменный инструмент интеграции. Пакет 0.1.0 — локальный craft-bridge (Node.js, только встроенные модули): health, список команд, pending/status, выполнение команд из allowlist и экспорт в workspace. Веб-экран /tools/craft подхватывает bridge через same-origin прокси; рядом запущенное CAD-приложение — следующий слой.',
      art: '/craft/craft.mp4',
      artAlt: 'Заставка NEXUS Craft: золотая сфера из световых осколков над мраморным постаментом в obsidian-зале',
      bayBg: '/programs/bay-bg/bay-bg-craft.png',
      tag: 'инструмент',
      meta: ['bridge-пакет 0.1.0', 'health · commands · pending/status', 'execute · export workspace', 'Node.js 18+'],
      version: '0.1.0',
      upstreamLicense: null,
      artifactUrl: '/artifacts/craft/nexus-craft-0.1.0.zip',
      sha256: 'e087d9ee2fe02011dcc97b73f96981729e430ca42b18b242a8fe33030b141474',
      sizeBytes: 960307,
      minClientVersion: '0.1.0',
      status: 'downloadable',
      packageKind: 'app',
    },
    {
      id: 'office',
      nexusName: 'NEXUS Office',
      href: '/tools/office',
      desc: 'NEXUS Office — собственная оболочка документов, таблиц, слайдов и PDF без апстрима. 0.3.1: CORS для веб-панели — документы открываются и сохраняются прямо на диск из NEXUS. 0.3.0: PDF — просмотр, поворот, удаление, перестановка, извлечение и объединение страниц (сохранение только копией), MCP-мост office-mcp.py для ИИ. Rich-text с заголовками и списками (docx/txt/md/html), редактируемая сетка (csv/xlsx), колода 16:9 (pptx), файловый браузер и системные диалоги. Ставится в выбранную папку и создаёт ярлык на рабочем столе. Сложное форматирование открывается упрощённо — границы честно описаны в README.',
      art: '/programs/bay-bg/bay-bg-office.png',
      artAlt: 'LUX-фон NEXUS Office: архивный зал со стеллажами и лампой-орбом',
      bayBg: '/programs/bay-bg/bay-bg-office.png',
      tag: 'инструмент',
      meta: ['своя оболочка · офлайн', 'документы · таблицы · слайды', 'docx · xlsx · pptx', 'pdf · mcp'],
      version: '0.3.1',
      upstreamLicense: null,
      artifactUrl: '/artifacts/office/nexus-office-0.3.1.zip',
      sha256: 'fe9551c64ec4cb5436d385ee9ab4099bc0b2048ac7efd62c4a3ffc2d2461df4d',
      sizeBytes: 1831813,
      minClientVersion: '0.1.0',
      status: 'downloadable',
      packageKind: 'app',
    },
    {
      id: 'igma',
      nexusName: 'NEXUS IGMA',
      href: null,
      desc: 'NEXUS IGMA — проект в разработке. Сейчас в приложении нет подтверждённой реализации IGMA или доступных функций.',
      art: '/programs/bay-bg/bay-bg-igma.png',
      artAlt: 'LUX-фон NEXUS IGMA: спящий сид с едва светящимся latitude-кольцом',
      bayBg: '/programs/bay-bg/bay-bg-igma.png',
      tag: 'инструмент',
      meta: ['в разработке'],
      version: null,
      upstreamLicense: 'MIT OR Apache-2.0',
      artifactUrl: null,
      sha256: null,
      sizeBytes: null,
      minClientVersion: null,
      status: 'soon',
    },
    {
      id: 'tplayer',
      nexusName: 'NEXUS TPLAYER',
      href: '/tools/tplayer',
      desc: 'NEXUS TPlayer — фирменный плеер с собственным P2P-движком. Пакет 0.2.0: LUX-оболочка (файлы, http(s)-потоки) + nexus-p2p на stdlib Python — bencode, http(s) announce-трекеры, TCP peer-wire BEP-3, однофайловые раздачи. UDP/DHT/multi-file — следующие слои.',
      art: '/programs/bay-bg/bay-bg-tplayer.png',
      artAlt: 'LUX-фон NEXUS TPlayer: кинозал с лучом проектора у краёв',
      bayBg: '/programs/bay-bg/bay-bg-tplayer.png',
      tag: 'медиа · desktop',
      meta: ['свой P2P-engine (stdlib)', 'magnet + .torrent (http-трекеры)', 'файлы + http(s)-потоки'],
      version: '0.2.0',
      upstreamLicense: 'MIT OR Apache-2.0',
      artifactUrl: '/artifacts/tplayer/nexus-tplayer-0.2.0.zip',
      sha256: '91501c9cb70eddb81ceecc73bdb168a5a772be275200d18242e60e409e9f6688',
      sizeBytes: 971480,
      minClientVersion: '0.1.0',
      status: 'downloadable',
      packageKind: 'app',
    },
    {
      id: 'vloader',
      nexusName: 'NEXUS VLOADER',
      href: '/tools/vloader',
      desc: 'NEXUS VLoader — фирменный загрузчик видео. Пакет 0.1.1 — самодостаточное приложение: LUX-оболочка с очередью задач, локальный engine на 127.0.0.1:8785, встроенный движок загрузки. Профили: лучшее качество, только аудио, плейлист + свои аргументы. Веб-панель ставит задачи в запущенный engine напрямую. Вывод — downloads\\ рядом с пакетом.',
      art: '/programs/bay-bg/bay-bg-vloader.png',
      artAlt: 'LUX-фон NEXUS VLoader: хранилище с золотым дата-водопадом у правого края',
      bayBg: '/programs/bay-bg/bay-bg-vloader.png',
      tag: 'медиа · CLI',
      meta: ['пакет с engine', 'очередь + прогресс', 'только разрешённый контент'],
      version: '0.1.1',
      upstreamLicense: 'MIT',
      artifactUrl: '/artifacts/vloader/nexus-vloader-0.1.1.zip',
      sha256: '1b9f22b5c786b8d37d31dc2e93114f08181928aebd081353996c1f1b7e9f0d8f',
      sizeBytes: 2433138,
      minClientVersion: '0.1.0',
      status: 'downloadable',
      packageKind: 'app',
    },
    {
      id: 'nexuslink',
      nexusName: 'NEXUS Link',
      href: null,
      desc: 'NEXUS Link — локальный AI-шлюз: принимает Anthropic-запросы от Claude Desktop и отдаёт их OpenAI-совместимым провайдерам. Пулы ключей и провайдеры крутятся по round-robin, отказавшие паркуются в blacklist на 15 минут; у окна контекста — авто-компакт с честным маркером, по ключам — метрики латентности и отказов. Панель управления встроена ниже — та же веб-версия, что открывается на 127.0.0.1:5679 и живёт в desktop-приложении с треем.',
      art: '/programs/bay-bg/bay-bg-default.png',
      artAlt: 'LUX-фон NEXUS Link: obsidian-зал с золотым мостом данных между порталами',
      bayBg: '/programs/bay-bg/bay-bg-default.png',
      tag: 'шлюз · desktop',
      meta: ['Anthropic → OpenAI', 'ротация ключей · blacklist', 'авто-компакт контекста', 'панель + трей'],
      version: '0.2.0',
      upstreamLicense: null,
      artifactUrl: null,
      sha256: null,
      sizeBytes: null,
      minClientVersion: null,
      status: 'available',
    },
    {
      id: 'deck',
      nexusName: 'NEXUS Deck',
      href: null,
      desc: 'NEXUS Deck — скачиваемое десктоп-приложение терминального рантайма: живые терминалы агентов, OSC-статусы, панели, спейсы/машины. Отдельное приложение (NUE-каталог), не вкладка веб-клиента; работает через мост nexus-core (/api/core/* + SSE). Артефакт nx-app.exe ещё не выдан owner — скачивание появится после публикации; сейчас карточка честно маркерует статус downloadable без артефакта.',
      art: '/programs/bay-bg/bay-bg-default.png',
      artAlt: 'LUX-фон NEXUS Deck: obsidian-зал с золотыми порталами терминалов',
      bayBg: '/programs/bay-bg/bay-bg-default.png',
      tag: 'deck · desktop',
      meta: ['терминалы агентов', 'OSC-статусы', 'спейсы · машины', 'мост nexus-core'],
      version: '0.0.1',
      upstreamLicense: null,
      artifactUrl: null,
      sha256: null,
      sizeBytes: null,
      minClientVersion: null,
      status: 'downloadable',
      packageKind: 'app',
    },
  ],
};
