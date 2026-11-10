/** W1-133 host-owned chat compaction and W1-139 auto-compaction status. */
export type Ai2ChatCompactInput = (
  | { runIds: string[]; thread?: string; sessionId?: never }
  | { runIds?: never; thread: string; sessionId?: never }
  | { runIds?: never; sessionId: string; thread?: never }
) & {
  maxTokens?: number;
  maxMessages?: number;
  keepTokens?: number;
};

export interface Ai2ChatCompactSuccess {
  compacted: true;
  compactId: string;
  threadId: string;
  summary: string;
  coversMessageIds: string[];
  keptMessageIds: string[];
  createdAt: string;
}

export interface Ai2ChatCompactNoop {
  compacted: false;
  reason: string;
  threadId: string;
  coversMessageIds: string[];
  keptMessageIds: string[];
}

export type Ai2ChatCompactResult = Ai2ChatCompactSuccess | Ai2ChatCompactNoop;

export interface Ai2ChatCompactionConfig {
  windowTokens: number | null;
  reserveTokens: number;
  keepTokens: number;
  thresholdTokens: number | null;
}

/** W1-141/W3-143 GET /v1/chat/history — cursor-пагинация треда,
 *  newest-first. Message ids совпадают с refs компакта:
 *  `<run_id>:task` / `<run_id>:answer`. */
export type Ai2ChatHistoryEntry =
  | {
    type: 'message';
    id: string;
    role: 'user' | 'assistant';
    text: string | null;
    /** run.created_at — epoch s; хост может не знать → null. */
    createdAt: number | null;
    usageTokens: number | null;
  }
  | {
    type: 'compact';
    id: string;
    summary: string;
    coversMessageIds: string[];
    /** ISO-строка тома компакции; хост может не знать → null. */
    createdAt: string | null;
  };

export interface Ai2ChatHistoryPage {
  sessionId: string;
  /** Newest-first; перед показом в хронологической ленте — reverse(). */
  messages: Ai2ChatHistoryEntry[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface Ai2ChatHistoryQuery {
  /** Строго старше этого message-id (host `before_id`). */
  beforeId?: string;
  limit?: number;
  /** effective=1 — покрытые сообщения заменены compact-нодами. */
  effective?: boolean;
}

export interface Ai2ChatCompactionStatus {
  sessionId: string;
  /** Состояние авто-компакта verbatim (`checking`/`triggered`/`completed`/
   *  `disabled`/`unavailable`…); null — хост не сообщает состояния (нет
   *  компактора и durable-записи): блок `session` при этом всё равно едет. */
  compaction: string | null;
  triggered?: boolean;
  reason?: string;
  usedTokens?: number;
  thresholdTokens?: number;
  usageMethod?: string;
  compactId?: string;
  /** Протухание сессии по TTL (W1-173): блок `session` в ответе
   *  compaction-status. Неизвестная активность → expired:false без причины. */
  session?: Ai2ChatSessionExpiry;
}

/**
 * Состояние протухания сессии (W1-173): TTL по неактивности,
 * `AI2_SESSION_TTL_HOURS` (дефолт 24 ч). Протухшая сессия читается, но
 * новый ход в неё запрещён (409 `session_expired`).
 */
export interface Ai2ChatSessionExpiry {
  expired: boolean;
  ttlHours: number;
  /** Unix-время последней активности; null — активность неизвестна. */
  lastActivityAt: number | null;
  /** Секунды простоя; null — активность неизвестна. */
  idleSeconds: number | null;
  /** Честная причина протухания verbatim; null когда сессия жива. */
  reason: string | null;
}

/**
 * Сессия (тред) tenant'а — `GET /v1/chat/sessions` (W1-189/190/199).
 * `runs` — корневой прогон + прогоны, помеченные этой сессией.
 */
export interface Ai2ChatSession {
  sessionId: string;
  runs: number;
  /** ISO-строка создания корневого прогона; null — хост не знает. */
  createdAt: string | null;
  /** Unix-время последней активности; null — активность неизвестна. */
  lastActivityAt: number | null;
  expired: boolean;
  ttlHours: number;
  reason: string | null;
}

export interface Ai2ChatSessionsPage {
  sessions: Ai2ChatSession[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextCursor: string | null;
  ttlHours: number;
}

/** `POST /v1/chat/retry` — повтор сообщения истории (`<run_id>:task|:answer`). */
export interface Ai2ChatRetryInput {
  messageId: string;
  /** Idempotency-Key: повтор с тем же ключом вернёт уже созданный прогон. */
  idempotencyKey?: string;
}

/** Ответ 202 `POST /v1/chat/retry` — новый прогон-повтор в том же треде. */
export interface Ai2ChatRetryResult {
  runId: string;
  /** Реальная связь записей: исходный прогон, который повторили. */
  retryOf: string | null;
  sourceMessageId: string;
  status: string;
}
