import type { CalendarAgendaItem, PickedDocument, ServiceIntegration } from './types';

/**
 * Integrations catalog — one card per access path (contract: web/API/seller
 * are separate and never merged). `connectable` marks entries the mock can
 * simulate an OAuth path for; everything else stays honest not-connected
 * with its contract reason.
 */
export const serviceIntegrations: ServiceIntegration[] = [
  {
    id: 'google-search.web', name: 'Google Search', mode: 'web',
    state: 'not-connected', scopes: [], connectable: false,
    webUrl: 'https://www.google.com/',
    summary: 'Официальный Web-поиск в отдельном окне; API для поиска не заявлен.',
  },
  {
    id: 'gmail.api', name: 'Gmail', mode: 'api',
    state: 'not-connected', scopes: ['gmail.readonly'], connectable: true,
    summary: 'OAuth в системном браузере; сначала read-only чтение почты.',
  },
  {
    id: 'google-drive.api', name: 'Google Drive', mode: 'api',
    state: 'not-connected', scopes: ['drive.file'], connectable: true,
    summary: 'Доступ только к файлам, выбранным через Picker — без широкого scope.',
  },
  {
    id: 'google-calendar.api', name: 'Google Calendar', mode: 'api',
    state: 'not-connected', scopes: ['calendar.events.owned.readonly'], connectable: true,
    summary: 'Read-only повестка; создание/изменение встреч — отдельный consent.',
  },
  {
    id: 'google-docs.api', name: 'Google Docs', mode: 'api',
    state: 'not-connected', scopes: ['drive.file'], connectable: true,
    summary: 'Просмотр документов, выбранных через Google Picker; запись — с подтверждением.',
  },
  {
    id: 'yandex-maps.api', name: 'Яндекс Карты', mode: 'api',
    state: 'needs-permission', scopes: [], connectable: false,
    reason: 'Developer API key не настроен',
    webUrl: 'https://yandex.ru/maps/',
    summary: 'Встроенная карта при наличии ключа; без него — fallback на официальный сервис.',
  },
  {
    id: 'yandex-disk.api', name: 'Яндекс Диск', mode: 'api',
    state: 'not-connected', scopes: ['cloud_api:disk.read'], connectable: true,
    summary: 'OAuth Яндекс ID, read-only список выбранных папок/файлов.',
  },
  {
    id: 'yandex-go.web', name: 'Яндекс Go', mode: 'web',
    state: 'not-connected', scopes: [], connectable: false,
    webUrl: 'https://go.yandex/',
    summary: 'Официальный сайт/приложение; API личного заказа не существует.',
  },
  {
    id: 'tiktok-display.api', name: 'TikTok Display', mode: 'api',
    state: 'not-connected', scopes: ['user.info.basic', 'video.list'], connectable: true,
    summary: 'Login Kit + Display API для данных авторизовавшегося пользователя.',
  },
  {
    id: 'tiktok-post.api', name: 'TikTok Posting', mode: 'api',
    state: 'needs-review', scopes: ['video.publish'], connectable: false,
    reason: 'Content Posting требует app review; непроверенное приложение публикует только приватно.',
    summary: 'Отдельный scope публикации — после разрешения video.publish.',
  },
  {
    id: 'wildberries.web', name: 'Wildberries', mode: 'web',
    state: 'not-connected', scopes: [], connectable: false,
    webUrl: 'https://www.wildberries.ru/',
    summary: 'Официальный Web для покупок.',
  },
  {
    id: 'wildberries-seller.api', name: 'Wildberries Seller', mode: 'business-api',
    state: 'needs-review', scopes: [], connectable: false,
    reason: 'Seller connector — только при осознанном выборе продавца и минимальных категориях.',
    summary: 'Seller API для кабинета продавца; не API личного аккаунта.',
  },
  {
    id: 'ozon.web', name: 'Ozon', mode: 'web',
    state: 'not-connected', scopes: [], connectable: false,
    webUrl: 'https://www.ozon.ru/',
    summary: 'Официальный Web для покупок.',
  },
  {
    id: 'ozon-seller.api', name: 'Ozon Seller', mode: 'business-api',
    state: 'needs-review', scopes: [], connectable: false,
    reason: 'Client-Id/ключ или seller OAuth; начальный уровень — read-only и узкие ресурсы.',
    summary: 'Seller API для кабинета продавца.',
  },
  {
    id: 'avito.web', name: 'Avito', mode: 'web',
    state: 'not-connected', scopes: [], connectable: false,
    webUrl: 'https://www.avito.ru/',
    summary: 'Официальный Web для обычного аккаунта.',
  },
  {
    id: 'avito-pro.api', name: 'Avito Pro', mode: 'business-api',
    state: 'needs-review', scopes: [], connectable: false,
    reason: 'API для профессионального профиля/тарифа; каждое действие — с подтверждением.',
    summary: 'API интеграции чатов/объявлений для бизнес-профилей.',
  },
  {
    id: 'aliexpress.web', name: 'AliExpress', mode: 'web',
    state: 'not-connected', scopes: [], connectable: false,
    webUrl: 'https://aliexpress.ru/',
    summary: 'Официальный Web; Open Platform — seller/partner сценарии.',
  },
  {
    id: 'sber.web', name: 'СберБанк Онлайн', mode: 'web',
    state: 'not-connected', scopes: [], connectable: false,
    webUrl: 'https://online.sberbank.ru/',
    summary: 'Только официальный сайт в отдельной сессии; личного API нет.',
  },
  {
    id: 'hiro.native', name: 'Hiro VPN', mode: 'native-app',
    state: 'not-connected', scopes: [], connectable: false,
    reason: 'У провайдера не подтверждён desktop control/status API — состояние подключения не заявляется.',
    summary: 'Запуск официального приложения/страницы установки.',
  },
];

export const calendarAgenda: CalendarAgendaItem[] = [
  { id: 'ev-1', time: '10:00–10:30', title: 'Стендап команды', visibility: 'visible', source: 'Основной календарь' },
  { id: 'ev-2', time: '14:00–15:00', title: 'Личное событие', visibility: 'private', source: 'Личный' },
  { id: 'ev-3', time: '18:30–19:00', title: 'Ревью релиза 0.4', visibility: 'visible', source: 'Основной календарь' },
];

export const pickedDocuments: PickedDocument[] = [
  {
    docId: 'doc-1', name: 'NEXUS — roadmap Q4', meta: 'Google Docs · выбран через Picker (mock)',
    content: 'Q4: Runtime-интеграции, Local Executor, мобильная вертикаль.',
  },
];
