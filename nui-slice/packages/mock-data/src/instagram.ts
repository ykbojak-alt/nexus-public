import type { InstagramComment, InstagramDmThread, InstagramMedia } from './types';

/** Scope names verbatim from the contract (Meta permission names). */
export const IG_SCOPE_BASIC = 'instagram_business_basic';
export const IG_SCOPE_COMMENTS = 'instagram_business_manage_comments';
export const IG_SCOPE_MESSAGES = 'instagram_business_manage_messages';
export const IG_SCOPE_PUBLISH = 'instagram_business_content_publish';

export const instagramMedia: InstagramMedia[] = [
  { mediaId: 'ig-1001', caption: 'Сборка NEXUS 0.4 — changelog в комментариях', mediaType: 'IMAGE', ts: 1760280000 },
  { mediaId: 'ig-1002', caption: 'Демо AgentFlow за 30 секунд', mediaType: 'VIDEO', ts: 1760200000 },
  { mediaId: 'ig-1003', caption: 'Карточки тем оформления', mediaType: 'CAROUSEL_ALBUM', ts: 1760100000 },
];

export const instagramComments: Record<string, InstagramComment[]> = {
  'ig-1001': [
    { commentId: 'c-1', mediaId: 'ig-1001', from: '@early_adopter', text: 'Ждём релиз!', ts: 1760283600 },
    { commentId: 'c-2', mediaId: 'ig-1001', from: '@qa_maria', text: 'А миграция памяти вошла?', ts: 1760287200 },
  ],
  'ig-1002': [
    { commentId: 'c-3', mediaId: 'ig-1002', from: '@dev_petr', text: 'Граф читается отлично.', ts: 1760204000 },
  ],
};

export const instagramDmThreads: InstagramDmThread[] = [
  { threadId: 'dm-1', withHandle: '@partner_kate', lastText: 'Пришлите доступ к тестовому стенду', ts: 1760301000 },
  { threadId: 'dm-2', withHandle: '@support_ig', lastText: 'Ваш запрос принят, ждите ответа.', ts: 1760250000 },
];
