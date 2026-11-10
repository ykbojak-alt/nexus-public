import type { TelegramChat, TelegramMessage } from './types';

export const telegramChats: TelegramChat[] = [
  { chatId: 'chat-ops', title: 'NEXUS Ops', lastText: 'Билд зелёный, можно выкатывать.', lastTs: 1760300400, unread: 2 },
  { chatId: 'chat-family', title: 'Семья', lastText: 'Во сколько заезжать?', lastTs: 1760298600, unread: 0 },
  { chatId: 'chat-saved', title: 'Избранное', lastText: 'ссылка на спеку TDLib', lastTs: 1760295000, unread: 0 },
];

export const telegramHistory: Record<string, TelegramMessage[]> = {
  'chat-ops': [
    { messageId: 'm1', chatId: 'chat-ops', fromMe: false, text: 'Собрал прогон 1042 — посмотри итог.', ts: 1760299800 },
    { messageId: 'm2', chatId: 'chat-ops', fromMe: true, text: 'Вижу, проверю после стендапа.', ts: 1760300100 },
    { messageId: 'm3', chatId: 'chat-ops', fromMe: false, text: 'Билд зелёный, можно выкатывать.', ts: 1760300400 },
  ],
  'chat-family': [
    { messageId: 'm4', chatId: 'chat-family', fromMe: false, text: 'Во сколько заезжать?', ts: 1760298600 },
  ],
  'chat-saved': [
    { messageId: 'm5', chatId: 'chat-saved', fromMe: true, text: 'ссылка на спеку TDLib', ts: 1760295000 },
  ],
};
